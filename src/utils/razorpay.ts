import { createHmac, timingSafeEqual } from "node:crypto";
import Razorpay from "razorpay";
import { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET } from "../config/env";
import { ERRORS, RequestError, isRequestError } from "./error";
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

export type GatewayPayment = {
    paymentId: string;
    status: string;
    amount: number;
    method: string | null;
    email: string | null;
    contact: string | null;
    createdAt: number | null;
};

export type OrderReconciliation = {
    orderId: string;
    orderStatus: string;
    orderAmount: number;
    amountPaid: number;
    payments: GatewayPayment[];
    capturedPayment: GatewayPayment | null;
};

/**
 * Asks Razorpay what actually happened to an order.
 *
 * This is the answer to "the customer says they paid". Our own database only
 * records what the browser managed to report back, so a payment made in a tab
 * that closed before verification looks identical to one that never happened -
 * and identical to a fabricated claim. Only the gateway knows which it is.
 */
export async function reconcileOrder(orderId: string): Promise<OrderReconciliation> {
    if (!orderId) throw ERRORS.PAYMENT_ORDER_MISSING;

    try {
        const client = getRazorpayClient();
        const [order, paymentList] = await Promise.all([
            client.orders.fetch(orderId),
            client.orders.fetchPayments(orderId),
        ]);

        const payments: GatewayPayment[] = (paymentList?.items ?? []).map((item: any) => ({
            paymentId: String(item.id),
            status: String(item.status),
            amount: Number(item.amount),
            method: item.method ? String(item.method) : null,
            email: item.email ? String(item.email) : null,
            contact: item.contact ? String(item.contact) : null,
            createdAt: item.created_at ? Number(item.created_at) : null,
        }));

        return {
            orderId: String(order.id),
            orderStatus: String(order.status),
            orderAmount: Number(order.amount),
            amountPaid: Number(order.amount_paid ?? 0),
            payments,
            // "captured" is the only status where the money is actually ours.
            // "authorized" means held but not taken; "failed" means nothing moved.
            capturedPayment: payments.find((p) => p.status === "captured") ?? null,
        };
    } catch (error: unknown) {
        if (isRequestError(error)) throw error;
        const status = (error as { statusCode?: number })?.statusCode;
        if (status === 401) {
            logger.error("Razorpay rejected our API credentials during reconciliation");
            throw ERRORS.RAZORPAY_AUTH_FAILED;
        }
        if (status === 400 || status === 404) throw ERRORS.PAYMENT_ORDER_NOT_AT_GATEWAY;
        logger.error("Razorpay reconciliation failed:", error);
        throw ERRORS.RAZORPAY_ORDER_FAILED;
    }
}
