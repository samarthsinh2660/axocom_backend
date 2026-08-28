import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const KEY_ID = "rzp_test_example";
const KEY_SECRET = "test_secret_value";

const mockOrdersCreate = jest.fn<(...args: any[]) => Promise<any>>();

jest.mock("../config/env", () => ({
    RAZORPAY_KEY_ID: "rzp_test_example",
    RAZORPAY_KEY_SECRET: "test_secret_value",
}));

jest.mock("razorpay", () => {
    return {
        __esModule: true,
        default: class {
            orders = { create: (...args: any[]) => mockOrdersCreate(...args) };
        },
    };
});

// Imported after the mocks so the module picks them up.
const {
    verifyPaymentSignature,
    createRazorpayOrder,
    getRazorpayKeyId,
    isRazorpayConfigured,
    MIN_ORDER_AMOUNT,
} = require("./razorpay");
const { ERRORS } = require("./error");

const sign = (orderId: string, paymentId: string, secret = KEY_SECRET) =>
    createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");

describe("verifyPaymentSignature", () => {
    const razorpayOrderId = "order_ABC123";
    const razorpayPaymentId = "pay_XYZ789";

    it("accepts a signature produced with the key secret", () => {
        expect(verifyPaymentSignature({
            razorpayOrderId,
            razorpayPaymentId,
            razorpaySignature: sign(razorpayOrderId, razorpayPaymentId),
        })).toBe(true);
    });

    /**
     * The whole point of the check: a browser can send any payment id it likes,
     * only Razorpay can produce the matching digest.
     */
    it("rejects a signature forged with the wrong secret", () => {
        expect(verifyPaymentSignature({
            razorpayOrderId,
            razorpayPaymentId,
            razorpaySignature: sign(razorpayOrderId, razorpayPaymentId, "attacker_secret"),
        })).toBe(false);
    });

    it("rejects a signature lifted from a different order", () => {
        expect(verifyPaymentSignature({
            razorpayOrderId: "order_OTHER",
            razorpayPaymentId,
            razorpaySignature: sign(razorpayOrderId, razorpayPaymentId),
        })).toBe(false);
    });

    it("rejects a signature lifted from a different payment", () => {
        expect(verifyPaymentSignature({
            razorpayOrderId,
            razorpayPaymentId: "pay_OTHER",
            razorpaySignature: sign(razorpayOrderId, razorpayPaymentId),
        })).toBe(false);
    });

    it("is not fooled by order and payment ids being swapped", () => {
        expect(verifyPaymentSignature({
            razorpayOrderId: razorpayPaymentId,
            razorpayPaymentId: razorpayOrderId,
            razorpaySignature: sign(razorpayOrderId, razorpayPaymentId),
        })).toBe(false);
    });

    it("returns false rather than throwing on a length mismatch", () => {
        expect(verifyPaymentSignature({
            razorpayOrderId,
            razorpayPaymentId,
            razorpaySignature: "short",
        })).toBe(false);
    });

    it("returns false when any field is missing", () => {
        for (const patch of [
            { razorpayOrderId: "" },
            { razorpayPaymentId: "" },
            { razorpaySignature: "" },
        ]) {
            expect(verifyPaymentSignature({
                razorpayOrderId,
                razorpayPaymentId,
                razorpaySignature: sign(razorpayOrderId, razorpayPaymentId),
                ...patch,
            })).toBe(false);
        }
    });
});

describe("createRazorpayOrder", () => {
    beforeEach(() => {
        mockOrdersCreate.mockReset();
    });

    it("passes the amount, currency and receipt through to Razorpay", async () => {
        mockOrdersCreate.mockResolvedValue({
            id: "order_ABC123",
            amount: 599800,
            currency: "INR",
        });

        const order = await createRazorpayOrder({
            amount: 599800,
            currency: "INR",
            receipt: "dlg_1",
            notes: { registrationId: "dlg_1" },
        });

        expect(order).toEqual({ orderId: "order_ABC123", amount: 599800, currency: "INR" });
        expect(mockOrdersCreate).toHaveBeenCalledWith({
            amount: 599800,
            currency: "INR",
            receipt: "dlg_1",
            notes: { registrationId: "dlg_1" },
        });
    });

    it("refuses an amount below the Razorpay minimum without calling the API", async () => {
        for (const amount of [0, 99, -100]) {
            await expect(
                createRazorpayOrder({ amount, currency: "INR", receipt: "dlg_1" })
            ).rejects.toBe(ERRORS.INVALID_ORDER_AMOUNT);
        }
        expect(mockOrdersCreate).not.toHaveBeenCalled();
    });

    it("refuses a fractional amount", async () => {
        await expect(
            createRazorpayOrder({ amount: 100.5, currency: "INR", receipt: "dlg_1" })
        ).rejects.toBe(ERRORS.INVALID_ORDER_AMOUNT);
        expect(mockOrdersCreate).not.toHaveBeenCalled();
    });

    it("accepts exactly the minimum amount", async () => {
        mockOrdersCreate.mockResolvedValue({ id: "order_MIN", amount: 100, currency: "INR" });

        await expect(
            createRazorpayOrder({ amount: MIN_ORDER_AMOUNT, currency: "INR", receipt: "dlg_1" })
        ).resolves.toMatchObject({ orderId: "order_MIN" });
    });

    it("maps a 401 from Razorpay to an auth failure", async () => {
        mockOrdersCreate.mockRejectedValue({ statusCode: 401 });

        await expect(
            createRazorpayOrder({ amount: 599800, currency: "INR", receipt: "dlg_1" })
        ).rejects.toBe(ERRORS.RAZORPAY_AUTH_FAILED);
    });

    it("maps any other gateway failure to an order failure", async () => {
        mockOrdersCreate.mockRejectedValue({ statusCode: 500, error: "server error" });

        await expect(
            createRazorpayOrder({ amount: 599800, currency: "INR", receipt: "dlg_1" })
        ).rejects.toBe(ERRORS.RAZORPAY_ORDER_FAILED);
    });
});

describe("configuration", () => {
    it("reports configured when both keys are present", () => {
        expect(isRazorpayConfigured()).toBe(true);
    });

    it("exposes only the public key id", () => {
        expect(getRazorpayKeyId()).toBe(KEY_ID);
        expect(getRazorpayKeyId()).not.toContain(KEY_SECRET);
    });
});
