import type { GraphQLContext } from "../context";
import { toGraphQLError } from "../context";
import { delegatePassRepository } from "../../repositories/delegate_pass.repository";
import { nominationRepository } from "../../repositories/nomination.repository";
import { ERRORS, isRequestError } from "../../utils/error";
import createLogger from "../../utils/logger";
import {
    createRazorpayOrder,
    getRazorpayKeyId,
    reconcileByReceipt,
    verifyPaymentSignature,
} from "../../utils/razorpay";
import { requireAdmin } from "../context";

const logger = createLogger("@payment.resolver");

type RegistrationType = "delegate_pass" | "nomination";

/**
 * Both registration tables expose the same three things payments care about -
 * an amount, a currency and someone to prefill Checkout with - so the two
 * repositories are reached through one shape rather than branching everywhere.
 */
async function loadRegistration(registrationType: RegistrationType, registrationId: string) {
    if (registrationType === "delegate_pass") {
        const result = await delegatePassRepository.getById(registrationId);
        if (result.isErr()) throw toGraphQLError(result.error);
        const row = result.value;
        return {
            amount: Number(row.total_amount),
            currency: row.currency,
            paymentStatus: row.payment_status,
            razorpayOrderId: row.razorpay_order_id,
            name: row.full_name,
            email: row.email,
            phone: row.phone,
        };
    }

    const result = await nominationRepository.getById(registrationId);
    if (result.isErr()) throw toGraphQLError(result.error);
    const row = result.value;
    return {
        amount: Number(row.total_amount),
        currency: row.currency,
        paymentStatus: row.payment_status,
        razorpayOrderId: row.razorpay_order_id,
        name: row.nominee_name,
        email: row.email,
        phone: row.phone,
    };
}

const repositoryFor = (registrationType: RegistrationType) =>
    registrationType === "delegate_pass" ? delegatePassRepository : nominationRepository;

async function buildReconciliation(
    registrationType: RegistrationType,
    registrationId: string
) {
    const registration = await loadRegistration(registrationType, registrationId);

    let gateway;
    try {
        // Keyed on the registration id, which every order carries as its
        // receipt, rather than on the row's razorpay_order_id - that column
        // holds only the most recent attempt.
        gateway = await reconcileByReceipt(registrationId);
    } catch (error) {
        if (isRequestError(error)) throw toGraphQLError(error);
        logger.error("Unexpected error reconciling payment:", error);
        throw toGraphQLError(ERRORS.RAZORPAY_ORDER_FAILED);
    }

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
        // Money at the gateway that our own record is missing. Only pending and
        // failed qualify: a refunded registration still has a captured payment
        // at the gateway (a partial refund leaves the payment captured), so
        // testing for "not paid" would offer to flip a refund back to paid.
        settleable:
            gateway.capturedPayment !== null
            && (registration.paymentStatus === "pending" || registration.paymentStatus === "failed"),
    };
}

export const paymentResolvers = {
    Mutation: {
        createPaymentOrder: async (
            _: unknown,
            args: { registrationType: RegistrationType; registrationId: string }
        ) => {
            const { registrationType, registrationId } = args;
            const registration = await loadRegistration(registrationType, registrationId);

            if (registration.paymentStatus === "paid") {
                throw toGraphQLError(ERRORS.PAYMENT_ALREADY_COMPLETED);
            }

            let order;
            try {
                order = await createRazorpayOrder({
                    // Amount is taken from the stored registration, never from
                    // the request, so the price cannot be chosen by the caller.
                    amount: registration.amount,
                    currency: registration.currency,
                    receipt: registrationId,
                    notes: { registrationType, registrationId },
                });
            } catch (error) {
                if (isRequestError(error)) throw toGraphQLError(error);
                logger.error("Unexpected error creating payment order:", error);
                throw toGraphQLError(ERRORS.RAZORPAY_ORDER_FAILED);
            }

            const attached = await repositoryFor(registrationType).attachRazorpayOrder(
                registrationId,
                order.orderId
            );
            if (attached.isErr()) throw toGraphQLError(attached.error);

            return {
                orderId: order.orderId,
                amount: order.amount,
                currency: order.currency,
                keyId: getRazorpayKeyId(),
                registrationId,
                registrationType,
                prefillName: registration.name,
                prefillEmail: registration.email,
                prefillContact: registration.phone,
            };
        },

        /**
         * Read-only: reports what Razorpay holds against this registration's
         * order. Never writes, so it is safe to run on any claim - including a
         * fabricated one, which simply comes back with no matching payment.
         */
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

            // Re-checks the gateway rather than trusting a prior read, so this
            // cannot settle anything Razorpay has not actually captured.
            const reconciliation = await buildReconciliation(registrationType, registrationId);

            // Order matters: a refunded registration still has a captured
            // payment, so reporting "nothing was captured" would be the wrong
            // diagnosis for an admin looking at it.
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

            // Built from what we already hold rather than re-querying: the row
            // is committed by this point, so a gateway timeout on a second
            // round-trip would report a failure for a settle that succeeded.
            return { ...reconciliation, ourPaymentStatus: "paid", settleable: false };
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

            let signatureValid: boolean;
            try {
                signatureValid = verifyPaymentSignature(input);
            } catch (error) {
                if (isRequestError(error)) throw toGraphQLError(error);
                throw toGraphQLError(ERRORS.RAZORPAY_NOT_CONFIGURED);
            }

            // A forged or replayed callback stops here: nothing is written and
            // the registration stays unpaid.
            if (!signatureValid) {
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
                paymentStatus: "paid",
                razorpayPaymentId: input.razorpayPaymentId,
                razorpayOrderId: input.razorpayOrderId,
            };
        },
    },
};
