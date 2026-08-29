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

/** Built lazily so importing this file does not throw when keys are absent. */
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

/** `receipt` is the registration id, so a dashboard entry maps to a row. */
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
        // 401 is a bad key pair, not a caller error.
        if (status === 401) {
            logger.error("Razorpay rejected our API credentials");
            throw ERRORS.RAZORPAY_AUTH_FAILED;
        }
        logger.error("Razorpay order creation failed:", error);
        throw ERRORS.RAZORPAY_ORDER_FAILED;
    }
}

/**
 * Verifies HMAC-SHA256(order_id|payment_id) keyed with the key secret, in
 * constant time. Must return true before a registration is marked paid.
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

    // timingSafeEqual throws on a length mismatch.
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

/** Fetches an order and its payments from Razorpay. */
export async function reconcileByReceipt(receipt: string): Promise<OrderReconciliation> {
    if (!receipt) throw ERRORS.PAYMENT_ORDER_MISSING;

    try {
        const client = getRazorpayClient();
        // Finds every order for this registration. The row's razorpay_order_id
        // holds only the latest attempt, which a retry overwrites.
        const orderList: any = await client.orders.all({ receipt } as never);
        const orders: any[] = orderList?.items ?? [];
        if (orders.length === 0) throw ERRORS.PAYMENT_ORDER_NOT_AT_GATEWAY;

        const perOrder = await Promise.all(
            orders.map(async (order: any) => ({
                order,
                payments: toGatewayPayments(await client.orders.fetchPayments(String(order.id))),
            }))
        );

        const payments = perOrder.flatMap((entry) => entry.payments);
        const captured = perOrder.find((entry) =>
            entry.payments.some((p) => p.status === "captured")
        );
        // Report against the order holding the money, else the most recent.
        const subject = captured?.order ?? orders[0];

        return {
            orderId: String(subject.id),
            orderStatus: String(subject.status),
            orderAmount: Number(subject.amount),
            amountPaid: orders.reduce((sum: number, o: any) => sum + Number(o.amount_paid ?? 0), 0),
            payments,
            capturedPayment: payments.find((p) => p.status === "captured") ?? null,
        };
    } catch (error: unknown) {
        throw translateGatewayError(error, "reconciliation by receipt");
    }
}

function toGatewayPayments(paymentList: any): GatewayPayment[] {
    return (paymentList?.items ?? []).map((item: any) => ({
        paymentId: String(item.id),
        status: String(item.status),
        amount: Number(item.amount),
        method: item.method ? String(item.method) : null,
        email: item.email ? String(item.email) : null,
        contact: item.contact ? String(item.contact) : null,
        createdAt: item.created_at ? Number(item.created_at) : null,
    }));
}

function translateGatewayError(error: unknown, context: string): unknown {
    if (isRequestError(error)) return error;
    const status = (error as { statusCode?: number })?.statusCode;
    if (status === 401) {
        logger.error(`Razorpay rejected our API credentials during ${context}`);
        return ERRORS.RAZORPAY_AUTH_FAILED;
    }
    if (status === 400 || status === 404) return ERRORS.PAYMENT_ORDER_NOT_AT_GATEWAY;
    logger.error(`Razorpay ${context} failed:`, error);
    return ERRORS.RAZORPAY_ORDER_FAILED;
}

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
            // Only "captured" means the money is ours.
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
