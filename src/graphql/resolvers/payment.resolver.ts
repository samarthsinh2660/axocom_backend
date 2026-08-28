import { toGraphQLError } from "../context";
import { delegatePassRepository } from "../../repositories/delegate_pass.repository";
import { nominationRepository } from "../../repositories/nomination.repository";
import { ERRORS, isRequestError } from "../../utils/error";
import createLogger from "../../utils/logger";
import {
    createRazorpayOrder,
    getRazorpayKeyId,
    verifyPaymentSignature,
} from "../../utils/razorpay";

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
        name: row.nominee_name,
        email: row.email,
        phone: row.phone,
    };
}

const repositoryFor = (registrationType: RegistrationType) =>
    registrationType === "delegate_pass" ? delegatePassRepository : nominationRepository;

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
            };
        },
    },
};
