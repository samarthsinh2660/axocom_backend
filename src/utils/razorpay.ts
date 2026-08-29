import { createHmac, timingSafeEqual } from "node:crypto";
import Razorpay from "razorpay";
import { err, ok, type Result } from "neverthrow";
import { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET } from "../config/env";
import { ERRORS, RequestError } from "./error";
import createLogger from "./logger";

const logger = createLogger("@razorpay");

/** Razorpay rejects anything under one rupee. */
export const MIN_ORDER_AMOUNT = 100;

export const isRazorpayConfigured = (): boolean =>
    Boolean(RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET);

let client: Razorpay | null = null;

/** Built lazily so importing this file does not fail when keys are absent. */
function getRazorpayClient(): Result<Razorpay, RequestError> {
    if (!isRazorpayConfigured()) return err(ERRORS.RAZORPAY_NOT_CONFIGURED);
    if (!client) {
        client = new Razorpay({
            key_id: RAZORPAY_KEY_ID as string,
            key_secret: RAZORPAY_KEY_SECRET as string,
        });
    }
    return ok(client);
}

export function getRazorpayKeyId(): Result<string, RequestError> {
    if (!RAZORPAY_KEY_ID) return err(ERRORS.RAZORPAY_NOT_CONFIGURED);
    return ok(RAZORPAY_KEY_ID);
}

export type CreatedOrder = {
    orderId: string;
    amount: number;
    currency: string;
};

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

/** `receipt` is the registration id, so a dashboard entry maps to a row. */
export async function createRazorpayOrder(options: {
    amount: number;
    currency: string;
    receipt: string;
    notes?: Record<string, string>;
}): Promise<Result<CreatedOrder, RequestError>> {
    if (!Number.isInteger(options.amount) || options.amount < MIN_ORDER_AMOUNT) {
        return err(ERRORS.INVALID_ORDER_AMOUNT);
    }

    const clientResult = getRazorpayClient();
    if (clientResult.isErr()) return err(clientResult.error);

    try {
        const order = await clientResult.value.orders.create({
            amount: options.amount,
            currency: options.currency,
            receipt: options.receipt,
            notes: options.notes,
        });

        return ok({
            orderId: String(order.id),
            amount: Number(order.amount),
            currency: String(order.currency),
        });
    } catch (error: unknown) {
        return err(translateGatewayError(error, "order creation"));
    }
}

/**
 * Verifies HMAC-SHA256(order_id|payment_id) keyed with the key secret, in
 * constant time. Must be true before a registration is marked paid.
 */
export function verifyPaymentSignature(input: {
    razorpayOrderId: string;
    razorpayPaymentId: string;
    razorpaySignature: string;
}): Result<boolean, RequestError> {
    if (!RAZORPAY_KEY_SECRET) return err(ERRORS.RAZORPAY_NOT_CONFIGURED);
    if (!input.razorpayOrderId || !input.razorpayPaymentId || !input.razorpaySignature) {
        return ok(false);
    }

    const expected = createHmac("sha256", RAZORPAY_KEY_SECRET)
        .update(`${input.razorpayOrderId}|${input.razorpayPaymentId}`)
        .digest("hex");

    const expectedBuffer = Buffer.from(expected, "utf8");
    const receivedBuffer = Buffer.from(input.razorpaySignature, "utf8");

    // timingSafeEqual throws on a length mismatch.
    if (expectedBuffer.length !== receivedBuffer.length) return ok(false);
    return ok(timingSafeEqual(expectedBuffer, receivedBuffer));
}

/**
 * Reports every order Razorpay holds for this receipt. The row's
 * razorpay_order_id holds only the latest attempt, which a retry overwrites.
 */
export async function reconcileByReceipt(
    receipt: string
): Promise<Result<OrderReconciliation, RequestError>> {
    if (!receipt) return err(ERRORS.PAYMENT_ORDER_MISSING);

    const clientResult = getRazorpayClient();
    if (clientResult.isErr()) return err(clientResult.error);
    const gateway = clientResult.value;

    try {
        const orderList: any = await gateway.orders.all({ receipt } as never);
        const orders: any[] = orderList?.items ?? [];
        if (orders.length === 0) return err(ERRORS.PAYMENT_ORDER_NOT_AT_GATEWAY);

        const perOrder = await Promise.all(
            orders.map(async (order: any) => ({
                order,
                payments: toGatewayPayments(await gateway.orders.fetchPayments(String(order.id))),
            }))
        );

        const payments = perOrder.flatMap((entry) => entry.payments);
        const captured = perOrder.find((entry) =>
            entry.payments.some((p) => p.status === "captured")
        );
        // Report against the order holding the money, else the most recent.
        const subject = captured?.order ?? orders[0];

        return ok({
            orderId: String(subject.id),
            orderStatus: String(subject.status),
            orderAmount: Number(subject.amount),
            amountPaid: orders.reduce((sum: number, o: any) => sum + Number(o.amount_paid ?? 0), 0),
            payments,
            // Only "captured" means the money is ours.
            capturedPayment: payments.find((p) => p.status === "captured") ?? null,
        });
    } catch (error: unknown) {
        return err(translateGatewayError(error, "reconciliation by receipt"));
    }
}

/** Fetches a single order and its payments. */
export async function reconcileOrder(
    orderId: string
): Promise<Result<OrderReconciliation, RequestError>> {
    if (!orderId) return err(ERRORS.PAYMENT_ORDER_MISSING);

    const clientResult = getRazorpayClient();
    if (clientResult.isErr()) return err(clientResult.error);
    const gateway = clientResult.value;

    try {
        const [order, paymentList] = await Promise.all([
            gateway.orders.fetch(orderId),
            gateway.orders.fetchPayments(orderId),
        ]);
        const payments = toGatewayPayments(paymentList);

        return ok({
            orderId: String(order.id),
            orderStatus: String(order.status),
            orderAmount: Number(order.amount),
            amountPaid: Number(order.amount_paid ?? 0),
            payments,
            capturedPayment: payments.find((p) => p.status === "captured") ?? null,
        });
    } catch (error: unknown) {
        return err(translateGatewayError(error, "reconciliation"));
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

function translateGatewayError(error: unknown, context: string): RequestError {
    if (error instanceof RequestError) return error;
    const status = (error as { statusCode?: number })?.statusCode;
    // 401 is a bad key pair, not a caller error.
    if (status === 401) {
        logger.error(`Razorpay rejected our API credentials during ${context}`);
        return ERRORS.RAZORPAY_AUTH_FAILED;
    }
    if (status === 400 || status === 404) return ERRORS.PAYMENT_ORDER_NOT_AT_GATEWAY;
    logger.error(`Razorpay ${context} failed:`, error);
    return ERRORS.RAZORPAY_ORDER_FAILED;
}
