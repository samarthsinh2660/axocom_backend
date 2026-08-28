import { createHmac, timingSafeEqual } from "node:crypto";
import Razorpay from "razorpay";
import { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET } from "../config/env";
import { ERRORS, RequestError } from "./error";
import createLogger from "./logger";

const logger = createLogger("@razorpay");

/** Razorpay rejects anything under one rupee. */
export const MIN_ORDER_AMOUNT = 100;

export const isRazorpayConfigured = (): boolean =>
    Boolean(RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET);

let client: Razorpay | null = null;

/**
 * Built lazily rather than at module scope so that importing anything in this
 * file does not throw when the keys are absent - the rest of the API has to
 * keep working without payments configured.
 */
export function getRazorpayClient(): Razorpay {
    if (!isRazorpayConfigured()) throw ERRORS.RAZORPAY_NOT_CONFIGURED;
    if (!client) {
        client = new Razorpay({
            key_id: RAZORPAY_KEY_ID as string,
            key_secret: RAZORPAY_KEY_SECRET as string,
        });
    }
    return client;
}

export const getRazorpayKeyId = (): string => {
    if (!RAZORPAY_KEY_ID) throw ERRORS.RAZORPAY_NOT_CONFIGURED;
    return RAZORPAY_KEY_ID;
};

export type CreatedOrder = {
    orderId: string;
    amount: number;
    currency: string;
};

/**
 * `receipt` is our own registration id, which lets a Razorpay dashboard entry
 * be traced back to a row without a lookup table.
 */
export async function createRazorpayOrder(options: {
    amount: number;
    currency: string;
    receipt: string;
    notes?: Record<string, string>;
}): Promise<CreatedOrder> {
    if (!Number.isInteger(options.amount) || options.amount < MIN_ORDER_AMOUNT) {
        throw ERRORS.INVALID_ORDER_AMOUNT;
    }

    try {
        const order = await getRazorpayClient().orders.create({
            amount: options.amount,
            currency: options.currency,
            receipt: options.receipt,
            notes: options.notes,
        });

        return {
            orderId: order.id,
            amount: Number(order.amount),
            currency: order.currency,
        };
    } catch (error: unknown) {
        const status = (error as { statusCode?: number })?.statusCode;
        // 401 means our own keys are wrong, which is a deployment fault rather
        // than anything the caller did.
        if (status === 401) {
            logger.error("Razorpay rejected our API credentials");
            throw ERRORS.RAZORPAY_AUTH_FAILED;
        }
        logger.error("Razorpay order creation failed:", error);
        throw ERRORS.RAZORPAY_ORDER_FAILED;
    }
}

/**
 * Checkout returns `razorpay_signature` = HMAC-SHA256(order_id|payment_id)
 * keyed with the key secret. Recomputing it is what proves the callback came
 * from Razorpay and was not forged by the browser, so a registration must
 * never be marked paid without this returning true.
 */
export function verifyPaymentSignature(input: {
    razorpayOrderId: string;
    razorpayPaymentId: string;
    razorpaySignature: string;
}): boolean {
    if (!RAZORPAY_KEY_SECRET) throw ERRORS.RAZORPAY_NOT_CONFIGURED;
    if (!input.razorpayOrderId || !input.razorpayPaymentId || !input.razorpaySignature) {
        return false;
    }

    const expected = createHmac("sha256", RAZORPAY_KEY_SECRET)
        .update(`${input.razorpayOrderId}|${input.razorpayPaymentId}`)
        .digest("hex");

    const expectedBuffer = Buffer.from(expected, "utf8");
    const receivedBuffer = Buffer.from(input.razorpaySignature, "utf8");

    // timingSafeEqual throws on a length mismatch, so compare lengths first;
    // the constant-time comparison is what keeps the digest from leaking a
    // byte at a time to an attacker probing signatures.
    if (expectedBuffer.length !== receivedBuffer.length) return false;
    return timingSafeEqual(expectedBuffer, receivedBuffer);
}

export type { RequestError };
