import { createHmac, timingSafeEqual } from "node:crypto";
import { Router, raw, type Request, type Response } from "express";
import { RAZORPAY_WEBHOOK_SECRET } from "../../config/env";
import { delegatePassRepository } from "../../repositories/delegate_pass.repository";
import { nominationRepository } from "../../repositories/nomination.repository";
import createLogger from "../../utils/logger";
import {
    REGISTRATION_TYPE,
    isRegistrationType,
    type RegistrationType,
} from "../../models/registration_type.model";

const logger = createLogger("@razorpay.webhook");

/**
 * Records a payment straight from Razorpay, covering the case where the payer's
 * browser never reaches verifyPayment.
 *
 * Must be mounted with a raw body parser BEFORE express.json(): the signature
 * covers the exact bytes sent, and a re-serialised object will not match.
 */
export const razorpayWebhookRoutes = Router();

type RazorpayWebhookPayload = {
    event?: string;
    payload?: {
        payment?: {
            entity?: {
                id?: string;
                order_id?: string;
                status?: string;
                amount?: number;
                notes?: { registrationType?: string; registrationId?: string };
            };
        };
    };
};

function isSignatureValid(rawBody: Buffer, signature: string | undefined): boolean {
    if (!RAZORPAY_WEBHOOK_SECRET || !signature) return false;

    const expected = createHmac("sha256", RAZORPAY_WEBHOOK_SECRET)
        .update(rawBody)
        .digest("hex");

    const expectedBuffer = Buffer.from(expected, "utf8");
    const receivedBuffer = Buffer.from(signature, "utf8");
    if (expectedBuffer.length !== receivedBuffer.length) return false;
    return timingSafeEqual(expectedBuffer, receivedBuffer);
}

const repositoryFor = (registrationType: RegistrationType) =>
    registrationType === REGISTRATION_TYPE.NOMINATION
        ? nominationRepository
        : delegatePassRepository;

razorpayWebhookRoutes.post(
    "/razorpay",
    raw({ type: "application/json" }),
    async (req: Request, res: Response) => {
        const rawBody = req.body as Buffer;
        const signature = req.header("x-razorpay-signature");

        if (!Buffer.isBuffer(rawBody)) {
            // The JSON parser ran first and the raw bytes are gone.
            logger.error("Webhook received without a raw body; check middleware order");
            return res.status(500).json({ success: false });
        }

        if (!isSignatureValid(rawBody, signature)) {
            // The endpoint is public; an unsigned call is expected, never acted on.
            logger.error("Rejected a Razorpay webhook with an invalid signature");
            return res.status(400).json({ success: false });
        }

        let payload: RazorpayWebhookPayload;
        try {
            payload = JSON.parse(rawBody.toString("utf8"));
        } catch {
            return res.status(400).json({ success: false });
        }

        // Acknowledge first: Razorpay retries on a non-2xx.
        res.status(200).json({ success: true });

        if (payload.event !== "payment.captured") return;

        const entity = payload.payload?.payment?.entity;
        const paymentId = entity?.id;
        const orderId = entity?.order_id;
        const registrationId = entity?.notes?.registrationId;
        const notedType = entity?.notes?.registrationType;
        const registrationType: RegistrationType = isRegistrationType(notedType)
            ? notedType
            : REGISTRATION_TYPE.DELEGATE_PASS;

        if (!paymentId || !orderId || !registrationId) {
            logger.error(`Webhook ${payload.event} missing ids or registration notes`);
            return;
        }

        const settled = await repositoryFor(registrationType).markPaidFromGateway(
            registrationId,
            { orderId, paymentId },
            // Null, not a sentinel: the column is a foreign key to users.
            null
        );

        if (settled.isErr()) {
            // Already paid: the browser got there first.
            if (settled.error.code === 90006) return;
            logger.error(
                `Webhook could not settle ${registrationType} ${registrationId}: ${settled.error.message}`
            );
            return;
        }

        logger.info(`Webhook settled ${registrationType} ${registrationId} from ${paymentId}`);
    }
);

export default razorpayWebhookRoutes;
