import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { err, ok } from "neverthrow";
import { ERRORS } from "../../utils/error";
import { delegatePassRepository } from "../../repositories/delegate_pass.repository";
import { nominationRepository } from "../../repositories/nomination.repository";
import {
    createRazorpayOrder,
    reconcileByReceipt,
    verifyPaymentSignature,
} from "../../utils/razorpay";
import type { GraphQLContext } from "../context";
import { paymentResolvers } from "./payment.resolver";

jest.mock("../../repositories/delegate_pass.repository", () => ({
    delegatePassRepository: {
        getById: jest.fn(),
        attachRazorpayOrder: jest.fn(),
        markPaid: jest.fn(),
        markPaidFromGateway: jest.fn(),
    },
}));
jest.mock("../../repositories/nomination.repository", () => ({
    nominationRepository: {
        getById: jest.fn(),
        attachRazorpayOrder: jest.fn(),
        markPaid: jest.fn(),
        markPaidFromGateway: jest.fn(),
    },
}));
jest.mock("../../utils/razorpay", () => ({
    createRazorpayOrder: jest.fn(),
    verifyPaymentSignature: jest.fn(),
    reconcileByReceipt: jest.fn(),
    getRazorpayKeyId: () => ok("rzp_test_example"),
}));

const mockDelegate = delegatePassRepository as jest.Mocked<typeof delegatePassRepository>;
const mockNomination = nominationRepository as jest.Mocked<typeof nominationRepository>;
const mockCreateOrder = createRazorpayOrder as jest.MockedFunction<typeof createRazorpayOrder>;
const mockVerifySignature = verifyPaymentSignature as jest.MockedFunction<typeof verifyPaymentSignature>;
const mockReconcile = reconcileByReceipt as jest.MockedFunction<typeof reconcileByReceipt>;

const capturedPayment = {
    paymentId: "pay_XYZ789",
    status: "captured",
    amount: 707764,
    method: "upi",
    email: "asha@example.com",
    contact: "9876543210",
    createdAt: 1,
};

const gatewayWithCapture = {
    orderId: "order_ABC123",
    orderStatus: "paid",
    orderAmount: 707764,
    amountPaid: 707764,
    payments: [capturedPayment],
    capturedPayment,
};

const gatewayWithNothing = {
    orderId: "order_ABC123",
    orderStatus: "created",
    orderAmount: 707764,
    amountPaid: 0,
    payments: [],
    capturedPayment: null,
};

const adminContext = { id: 7, is_admin: true };

function contextFor(user: { id: number; is_admin: boolean }): GraphQLContext {
    return {
        req: {} as GraphQLContext["req"],
        user,
        loaders: {} as GraphQLContext["loaders"],
    };
}

const delegateRow = {
    id: "dlg_1",
    full_name: "Asha Menon",
    email: "asha@example.com",
    phone: "9876543210",
    total_amount: 599800,
    currency: "INR",
    payment_status: "pending",
    razorpay_order_id: null,
};

const validPayment = {
    registrationType: "delegate_pass" as const,
    registrationId: "dlg_1",
    razorpayOrderId: "order_ABC123",
    razorpayPaymentId: "pay_XYZ789",
    razorpaySignature: "a".repeat(64),
};

describe("PaymentResolvers.createPaymentOrder", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    /**
     * The client picks a registration, never a price. If the amount came from
     * the request a 5,998 rupee registration could be paid off with 1 rupee.
     */
    it("takes the amount from the stored registration, not the request", async () => {
        mockDelegate.getById.mockResolvedValue(ok(delegateRow as never));
        mockCreateOrder.mockResolvedValue(ok({ orderId: "order_ABC123", amount: 599800, currency: "INR" }));
        mockDelegate.attachRazorpayOrder.mockResolvedValue(ok(true));

        const result = await paymentResolvers.Mutation.createPaymentOrder(null, {
            registrationType: "delegate_pass",
            registrationId: "dlg_1",
        });

        expect(mockCreateOrder).toHaveBeenCalledWith({
            amount: 599800,
            currency: "INR",
            receipt: "dlg_1",
            notes: { registrationType: "delegate_pass", registrationId: "dlg_1" },
        });
        expect(result).toMatchObject({
            orderId: "order_ABC123",
            amount: 599800,
            currency: "INR",
            keyId: "rzp_test_example",
            registrationId: "dlg_1",
        });
    });

    it("returns prefill details and the public key id only", async () => {
        mockDelegate.getById.mockResolvedValue(ok(delegateRow as never));
        mockCreateOrder.mockResolvedValue(ok({ orderId: "order_ABC123", amount: 599800, currency: "INR" }));
        mockDelegate.attachRazorpayOrder.mockResolvedValue(ok(true));

        const result = await paymentResolvers.Mutation.createPaymentOrder(null, {
            registrationType: "delegate_pass",
            registrationId: "dlg_1",
        });

        expect(result.prefillName).toBe("Asha Menon");
        expect(result.prefillEmail).toBe("asha@example.com");
        expect(result.prefillContact).toBe("9876543210");
        expect(JSON.stringify(result)).not.toMatch(/secret/i);
    });

    it("stores the opened order against the registration", async () => {
        mockDelegate.getById.mockResolvedValue(ok(delegateRow as never));
        mockCreateOrder.mockResolvedValue(ok({ orderId: "order_ABC123", amount: 599800, currency: "INR" }));
        mockDelegate.attachRazorpayOrder.mockResolvedValue(ok(true));

        await paymentResolvers.Mutation.createPaymentOrder(null, {
            registrationType: "delegate_pass",
            registrationId: "dlg_1",
        });

        expect(mockDelegate.attachRazorpayOrder).toHaveBeenCalledWith("dlg_1", "order_ABC123");
    });

    it.each(["paid", "refunded"])("refuses to open an order for a %s registration", async (status) => {
        mockDelegate.getById.mockResolvedValue(ok({ ...delegateRow, payment_status: status } as never));

        await expect(
            paymentResolvers.Mutation.createPaymentOrder(null, {
                registrationType: "delegate_pass",
                registrationId: "dlg_1",
            })
        ).rejects.toMatchObject({ extensions: { errorCode: 90006 } });
        expect(mockCreateOrder).not.toHaveBeenCalled();
    });

    it("surfaces an unknown registration as not found", async () => {
        mockDelegate.getById.mockResolvedValue(err(ERRORS.DELEGATE_PASS_NOT_FOUND));

        await expect(
            paymentResolvers.Mutation.createPaymentOrder(null, {
                registrationType: "delegate_pass",
                registrationId: "dlg_missing",
            })
        ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });
        expect(mockCreateOrder).not.toHaveBeenCalled();
    });

    it("surfaces a gateway auth failure without leaking gateway internals", async () => {
        mockDelegate.getById.mockResolvedValue(ok(delegateRow as never));
        mockCreateOrder.mockResolvedValue(err(ERRORS.RAZORPAY_AUTH_FAILED));

        await expect(
            paymentResolvers.Mutation.createPaymentOrder(null, {
                registrationType: "delegate_pass",
                registrationId: "dlg_1",
            })
        ).rejects.toMatchObject({ extensions: { errorCode: 90003 } });
    });

    it("reads a nomination from the nomination repository", async () => {
        mockNomination.getById.mockResolvedValue(ok({
            id: "nom_1",
            nominee_name: "Ravi Kumar",
            email: "ravi@example.com",
            phone: "9876500011",
            total_amount: 1999900,
            currency: "INR",
            payment_status: "pending",
            razorpay_order_id: null,
        } as never));
        mockCreateOrder.mockResolvedValue(ok({ orderId: "order_NOM", amount: 1999900, currency: "INR" }));
        mockNomination.attachRazorpayOrder.mockResolvedValue(ok(true));

        const result = await paymentResolvers.Mutation.createPaymentOrder(null, {
            registrationType: "nomination",
            registrationId: "nom_1",
        });

        expect(result.prefillName).toBe("Ravi Kumar");
        expect(mockCreateOrder.mock.calls[0][0].amount).toBe(1999900);
        expect(mockDelegate.getById).not.toHaveBeenCalled();
    });
});

describe("PaymentResolvers.verifyPayment", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("marks the registration paid when the signature checks out", async () => {
        mockVerifySignature.mockReturnValue(ok(true));
        mockDelegate.markPaid.mockResolvedValue(ok(true));

        const result = await paymentResolvers.Mutation.verifyPayment(null, { input: validPayment });

        // The gateway references come back so the payer can be shown a receipt.
        expect(result).toEqual({
            verified: true,
            registrationId: "dlg_1",
            paymentStatus: "paid",
            razorpayOrderId: "order_ABC123",
            razorpayPaymentId: "pay_XYZ789",
        });
        expect(mockDelegate.markPaid).toHaveBeenCalledWith("dlg_1", {
            orderId: "order_ABC123",
            paymentId: "pay_XYZ789",
            signature: validPayment.razorpaySignature,
        });
    });

    /**
     * The single most important behaviour in the integration: a bad signature
     * must never reach markPaid.
     */
    it("rejects an invalid signature and leaves the registration untouched", async () => {
        mockVerifySignature.mockReturnValue(ok(false));

        await expect(
            paymentResolvers.Mutation.verifyPayment(null, { input: validPayment })
        ).rejects.toMatchObject({
            extensions: { code: "BAD_USER_INPUT", errorCode: 90005 },
        });
        expect(mockDelegate.markPaid).not.toHaveBeenCalled();
        expect(mockNomination.markPaid).not.toHaveBeenCalled();
    });

    it("rejects a payload missing any razorpay field before checking anything", async () => {
        for (const patch of [
            { razorpayOrderId: "" },
            { razorpayPaymentId: "" },
            { razorpaySignature: "" },
        ]) {
            await expect(
                paymentResolvers.Mutation.verifyPayment(null, {
                    input: { ...validPayment, ...patch },
                })
            ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
        }
        expect(mockVerifySignature).not.toHaveBeenCalled();
        expect(mockDelegate.markPaid).not.toHaveBeenCalled();
    });

    it("surfaces an order that belongs to a different registration", async () => {
        mockVerifySignature.mockReturnValue(ok(true));
        mockDelegate.markPaid.mockResolvedValue(err(ERRORS.PAYMENT_ORDER_MISMATCH));

        await expect(
            paymentResolvers.Mutation.verifyPayment(null, { input: validPayment })
        ).rejects.toMatchObject({ extensions: { errorCode: 90007 } });
    });

    it("surfaces a replayed verification of an already paid registration", async () => {
        mockVerifySignature.mockReturnValue(ok(true));
        mockDelegate.markPaid.mockResolvedValue(err(ERRORS.PAYMENT_ALREADY_COMPLETED));

        await expect(
            paymentResolvers.Mutation.verifyPayment(null, { input: validPayment })
        ).rejects.toMatchObject({ extensions: { code: "CONFLICT", errorCode: 90006 } });
    });

    it("routes a nomination verification to the nomination repository", async () => {
        mockVerifySignature.mockReturnValue(ok(true));
        mockNomination.markPaid.mockResolvedValue(ok(true));

        await paymentResolvers.Mutation.verifyPayment(null, {
            input: { ...validPayment, registrationType: "nomination", registrationId: "nom_1" },
        });

        expect(mockNomination.markPaid).toHaveBeenCalled();
        expect(mockDelegate.markPaid).not.toHaveBeenCalled();
    });
});

describe("PaymentResolvers.reconcilePayment", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("keys the lookup on the registration id, not the stored order id", async () => {
        mockDelegate.getById.mockResolvedValue(ok({ ...delegateRow, razorpay_order_id: "order_STALE" } as never));
        mockReconcile.mockResolvedValue(ok(gatewayWithCapture));

        const result = await paymentResolvers.Mutation.reconcilePayment(
            null,
            { registrationType: "delegate_pass", registrationId: "dlg_1" },
            contextFor(adminContext)
        );

        // Every order carries the registration id as its receipt, so a retry
        // that overwrote razorpay_order_id cannot hide a captured payment.
        expect(mockReconcile).toHaveBeenCalledWith("dlg_1");
        expect(result.capturedPayment).toEqual(capturedPayment);
    });

    it("blocks a non-admin", async () => {
        await expect(
            paymentResolvers.Mutation.reconcilePayment(
                null,
                { registrationType: "delegate_pass", registrationId: "dlg_1" },
                contextFor({ id: 2, is_admin: false })
            )
        ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
        expect(mockReconcile).not.toHaveBeenCalled();
    });

    it.each([
        ["pending", true],
        ["failed", true],
        ["paid", false],
        // A partial refund leaves the payment captured at the gateway, so
        // "not paid" would wrongly offer to flip a refund back to paid.
        ["refunded", false],
    ])("reports settleable=%s correctly when our record is %s", async (status, expected) => {
        mockDelegate.getById.mockResolvedValue(ok({ ...delegateRow, payment_status: status } as never));
        mockReconcile.mockResolvedValue(ok(gatewayWithCapture));

        const result = await paymentResolvers.Mutation.reconcilePayment(
            null,
            { registrationType: "delegate_pass", registrationId: "dlg_1" },
            contextFor(adminContext)
        );

        expect(result.settleable).toBe(expected);
    });

    it("is never settleable when the gateway captured nothing", async () => {
        mockDelegate.getById.mockResolvedValue(ok(delegateRow as never));
        mockReconcile.mockResolvedValue(ok(gatewayWithNothing));

        const result = await paymentResolvers.Mutation.reconcilePayment(
            null,
            { registrationType: "delegate_pass", registrationId: "dlg_1" },
            contextFor(adminContext)
        );

        expect(result.settleable).toBe(false);
        expect(result.capturedPayment).toBeNull();
    });
});

describe("PaymentResolvers.settlePaymentFromGateway", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("settles using the order that actually holds the money", async () => {
        mockDelegate.getById.mockResolvedValue(ok({ ...delegateRow, razorpay_order_id: "order_STALE" } as never));
        mockReconcile.mockResolvedValue(ok(gatewayWithCapture));
        mockDelegate.markPaidFromGateway.mockResolvedValue(ok(true));

        const result = await paymentResolvers.Mutation.settlePaymentFromGateway(
            null,
            { registrationType: "delegate_pass", registrationId: "dlg_1" },
            contextFor(adminContext)
        );

        expect(mockDelegate.markPaidFromGateway).toHaveBeenCalledWith(
            "dlg_1",
            { orderId: "order_ABC123", paymentId: "pay_XYZ789" },
            7
        );
        expect(result.ourPaymentStatus).toBe("paid");
        expect(result.settleable).toBe(false);
    });

    it("does not re-query the gateway after committing", async () => {
        mockDelegate.getById.mockResolvedValue(ok(delegateRow as never));
        mockReconcile.mockResolvedValue(ok(gatewayWithCapture));
        mockDelegate.markPaidFromGateway.mockResolvedValue(ok(true));

        await paymentResolvers.Mutation.settlePaymentFromGateway(
            null,
            { registrationType: "delegate_pass", registrationId: "dlg_1" },
            contextFor(adminContext)
        );

        // A second round-trip could fail after the row was already written and
        // report a failure for a settle that succeeded.
        expect(mockReconcile).toHaveBeenCalledTimes(1);
    });

    it("refuses when the gateway captured nothing", async () => {
        mockDelegate.getById.mockResolvedValue(ok(delegateRow as never));
        mockReconcile.mockResolvedValue(ok(gatewayWithNothing));

        await expect(
            paymentResolvers.Mutation.settlePaymentFromGateway(
                null,
                { registrationType: "delegate_pass", registrationId: "dlg_1" },
                contextFor(adminContext)
            )
        ).rejects.toMatchObject({ extensions: { errorCode: 90010 } });
        expect(mockDelegate.markPaidFromGateway).not.toHaveBeenCalled();
    });

    it("refuses to settle a refunded registration", async () => {
        mockDelegate.getById.mockResolvedValue(ok({ ...delegateRow, payment_status: "refunded" } as never));
        mockReconcile.mockResolvedValue(ok(gatewayWithCapture));

        await expect(
            paymentResolvers.Mutation.settlePaymentFromGateway(
                null,
                { registrationType: "delegate_pass", registrationId: "dlg_1" },
                contextFor(adminContext)
            )
        ).rejects.toMatchObject({ extensions: { errorCode: 90011 } });
        expect(mockDelegate.markPaidFromGateway).not.toHaveBeenCalled();
    });

    it("blocks a non-admin", async () => {
        await expect(
            paymentResolvers.Mutation.settlePaymentFromGateway(
                null,
                { registrationType: "delegate_pass", registrationId: "dlg_1" },
                contextFor({ id: 2, is_admin: false })
            )
        ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
        expect(mockDelegate.markPaidFromGateway).not.toHaveBeenCalled();
    });
});
