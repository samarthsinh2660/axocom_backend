import { err, ok, type Result } from "neverthrow";
import type { RequestError } from "../../utils/error";
import type { GraphQLContext } from "../context";
import { toGraphQLError } from "../context";
import { delegatePassRepository } from "../../repositories/delegate_pass.repository";
import { nominationRepository } from "../../repositories/nomination.repository";
import { ERRORS } from "../../utils/error";
import {
    PAYMENT_STATUS,
    PAYABLE_PAYMENT_STATUSES,
} from "../../models/delegate_pass.model";
import {
    REGISTRATION_TYPE,
    type RegistrationType,
} from "../../utils/registration_type";
import createLogger from "../../utils/logger";
import {
    createRazorpayOrder,
    getRazorpayKeyId,
    reconcileByReceipt,
    verifyPaymentSignature,
} from "../../utils/razorpay";
import { requireAdmin } from "../context";

const logger = createLogger("@payment.resolver");

/** Normalises both registration tables to the fields payments need. */
async function loadRegistration(registrationType: RegistrationType, registrationId: string) {
    if (registrationType === REGISTRATION_TYPE.DELEGATE_PASS) {
        const result = await delegatePassRepository.getById(registrationId);
        if (result.isErr()) return err(result.error);
        const row = result.value;
        return ok({
            amount: Number(row.total_amount),
            currency: row.currency,
            paymentStatus: row.payment_status,
            razorpayOrderId: row.razorpay_order_id,
            name: row.full_name,
            email: row.email,
            phone: row.phone,
        });
    }

    const result = await nominationRepository.getById(registrationId);
    if (result.isErr()) return err(result.error);
    const row = result.value;
    return ok({
        amount: Number(row.total_amount),
        currency: row.currency,
        paymentStatus: row.payment_status,
        razorpayOrderId: row.razorpay_order_id,
        name: row.nominee_name,
        email: row.email,
        phone: row.phone,
    });
}

const repositoryFor = (registrationType: RegistrationType) =>
    registrationType === REGISTRATION_TYPE.DELEGATE_PASS
        ? delegatePassRepository
        : nominationRepository;

async function buildReconciliation(
    registrationType: RegistrationType,
    registrationId: string
) {
    const registrationResult = await loadRegistration(registrationType, registrationId);
    if (registrationResult.isErr()) throw toGraphQLError(registrationResult.error);
    const registration = registrationResult.value;

    // Keyed on the registration id, which every order carries as its receipt.
    // The row's razorpay_order_id holds only the latest attempt.
    const gatewayResult = await reconcileByReceipt(registrationId);
    if (gatewayResult.isErr()) throw toGraphQLError(gatewayResult.error);
    const gateway = gatewayResult.value;

    return {
        registrationId,
        ourPaymentStatus: registration.paymentStatus,
        ourAmount: registration.amount,
        orderId: gateway.orderId,
        orderStatus: gateway.orderStatus,
        orderAmount: gateway.orderAmount,
        amountPaid: gateway.amountPaid,
        payments: gateway.payments,
        capturedPayment: gateway.capturedPayment,
        // Only pending and failed qualify. A refunded registration still has a
        // captured payment at the gateway, so "not paid" would be wrong here.
        settleable:
            gateway.capturedPayment !== null
            && PAYABLE_PAYMENT_STATUSES.includes(registration.paymentStatus),
    };
}

export const paymentResolvers = {
    Mutation: {
        createPaymentOrder: async (
            _: unknown,
            args: { registrationType: RegistrationType; registrationId: string }
        ) => {
            const { registrationType, registrationId } = args;
            const registrationResult = await loadRegistration(registrationType, registrationId);
            if (registrationResult.isErr()) throw toGraphQLError(registrationResult.error);
            const registration = registrationResult.value;

            // A refunded row must not be re-chargeable either; the same set
            // gates the gateway settlement path.
            if (!PAYABLE_PAYMENT_STATUSES.includes(registration.paymentStatus)) {
                throw toGraphQLError(ERRORS.PAYMENT_ALREADY_COMPLETED);
            }

            const orderResult = await createRazorpayOrder({
                // From the stored row, never the request.
                amount: registration.amount,
                currency: registration.currency,
                receipt: registrationId,
                notes: { registrationType, registrationId },
            });
            if (orderResult.isErr()) throw toGraphQLError(orderResult.error);
            const order = orderResult.value;

            const attached = await repositoryFor(registrationType).attachRazorpayOrder(
                registrationId,
                order.orderId
            );
            if (attached.isErr()) throw toGraphQLError(attached.error);

            const keyIdResult = getRazorpayKeyId();
            if (keyIdResult.isErr()) throw toGraphQLError(keyIdResult.error);

            return {
                orderId: order.orderId,
                amount: order.amount,
                currency: order.currency,
                keyId: keyIdResult.value,
                registrationId,
                registrationType,
                prefillName: registration.name,
                prefillEmail: registration.email,
                prefillContact: registration.phone,
            };
        },

        /** Read-only report of what Razorpay holds for this registration. */
        reconcilePayment: async (
            _: unknown,
            args: { registrationType: RegistrationType; registrationId: string },
            context: GraphQLContext
        ) => {
            requireAdmin(context);
            return buildReconciliation(args.registrationType, args.registrationId);
        },

        settlePaymentFromGateway: async (
            _: unknown,
            args: { registrationType: RegistrationType; registrationId: string },
            context: GraphQLContext
        ) => {
            const admin = requireAdmin(context);
            const { registrationType, registrationId } = args;

            // Re-checks the gateway rather than trusting a prior read.
            const reconciliation = await buildReconciliation(registrationType, registrationId);

            // Order matters: a refunded registration has a captured payment,
            // so "nothing captured" would be the wrong diagnosis.
            if (!reconciliation.capturedPayment) {
                throw toGraphQLError(ERRORS.PAYMENT_NOT_CAPTURED);
            }
            if (!reconciliation.settleable) {
                throw toGraphQLError(ERRORS.PAYMENT_ALREADY_SETTLED);
            }

            const settled = await repositoryFor(registrationType).markPaidFromGateway(
                registrationId,
                {
                    orderId: reconciliation.orderId,
                    paymentId: reconciliation.capturedPayment.paymentId,
                },
                admin.id
            );
            if (settled.isErr()) throw toGraphQLError(settled.error);

            logger.info(
                `Admin ${admin.id} settled ${registrationType} ${registrationId} from gateway payment ${reconciliation.capturedPayment.paymentId}`
            );

            // Built from what we hold: the row is committed, so a timeout on a
            // second round-trip would report a failure for a successful settle.
            return {
                ...reconciliation,
                ourPaymentStatus: PAYMENT_STATUS.PAID,
                settleable: false,
            };
        },

        verifyPayment: async (
            _: unknown,
            args: {
                input: {
                    registrationType: RegistrationType;
                    registrationId: string;
                    razorpayOrderId: string;
                    razorpayPaymentId: string;
                    razorpaySignature: string;
                };
            }
        ) => {
            const { input } = args;

            if (!input.razorpayOrderId || !input.razorpayPaymentId || !input.razorpaySignature) {
                throw toGraphQLError(ERRORS.INVALID_REQUEST_BODY);
            }

            const signatureResult = verifyPaymentSignature(input);
            if (signatureResult.isErr()) throw toGraphQLError(signatureResult.error);

            // Nothing is written; the registration stays unpaid.
            if (!signatureResult.value) {
                logger.error(
                    `Rejected payment with invalid signature for ${input.registrationType} ${input.registrationId}`
                );
                throw toGraphQLError(ERRORS.PAYMENT_SIGNATURE_INVALID);
            }

            const marked = await repositoryFor(input.registrationType).markPaid(
                input.registrationId,
                {
                    orderId: input.razorpayOrderId,
                    paymentId: input.razorpayPaymentId,
                    signature: input.razorpaySignature,
                }
            );
            if (marked.isErr()) throw toGraphQLError(marked.error);

            return {
                verified: true,
                registrationId: input.registrationId,
                paymentStatus: PAYMENT_STATUS.PAID,
                razorpayPaymentId: input.razorpayPaymentId,
                razorpayOrderId: input.razorpayOrderId,
            };
        },
    },
};
