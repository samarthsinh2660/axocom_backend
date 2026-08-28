import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { err, ok } from "neverthrow";
import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../context";
import { ERRORS } from "../../utils/error";
import { delegatePassRepository } from "../../repositories/delegate_pass.repository";
import { nominationRepository } from "../../repositories/nomination.repository";
import { refundRequestRepository } from "../../repositories/refund_request.repository";
import { summitResolvers } from "./summit.resolver";

jest.mock("../../repositories/delegate_pass.repository", () => ({
    delegatePassRepository: {
        create: jest.fn(),
        listAdmin: jest.fn(),
        getById: jest.fn(),
        updatePaymentStatus: jest.fn(),
        countByPaymentStatus: jest.fn(),
    },
}));
jest.mock("../../repositories/nomination.repository", () => ({
    nominationRepository: {
        create: jest.fn(),
        listAdmin: jest.fn(),
        getById: jest.fn(),
        updatePaymentStatus: jest.fn(),
        countByPaymentStatus: jest.fn(),
    },
}));
jest.mock("../../repositories/refund_request.repository", () => ({
    refundRequestRepository: { countByStatus: jest.fn() },
}));

const mockDelegate = delegatePassRepository as jest.Mocked<typeof delegatePassRepository>;
const mockNomination = nominationRepository as jest.Mocked<typeof nominationRepository>;
const mockRefund = refundRequestRepository as jest.Mocked<typeof refundRequestRepository>;

function contextFor(user: GraphQLContext["user"]): GraphQLContext {
    return {
        req: {} as GraphQLContext["req"],
        user,
        loaders: {} as GraphQLContext["loaders"],
    };
}

const createdAt = new Date("2026-01-01");

const delegateRow = {
    id: "dlg_1",
    full_name: "Asha Menon",
    designation: "CTO",
    organisation: "Acme Labs",
    email: "asha@example.com",
    phone: "9876543210",
    pass_name: "Professional Pass",
    audience: "Professionals",
    quantity: 2,
    unit_amount: 299900,
    unit_gst_amount: 53982,
    subtotal_amount: 599800,
    gst_rate_bps: 1800,
    gst_amount: 107964,
    total_amount: 707764,
    currency: "INR",
    gst_number: "29ABCDE1234F1Z5",
    contact_consent_at: createdAt,
    payment_status: "pending",
    razorpay_order_id: null,
    razorpay_payment_id: null,
    paid_at: null,
    admin_note: null,
    reviewed_at: null,
    reviewed_by_admin_id: null,
    created_at: createdAt,
    updated_at: createdAt,
};

describe("SummitResolvers", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("maps delegate pass rows to the GraphQL contract", async () => {
        mockDelegate.listAdmin.mockResolvedValue(ok({
            data: [delegateRow as never],
            pagination: { total: 1, page: 1, limit: 20, totalPages: 1 },
        }));

        const result = await summitResolvers.Query.adminDelegatePassRegistrations(
            null,
            {},
            contextFor({ id: 7, is_admin: true })
        );

        expect(result.data).toEqual([{
            id: "dlg_1",
            fullName: "Asha Menon",
            designation: "CTO",
            organisation: "Acme Labs",
            email: "asha@example.com",
            phone: "9876543210",
            passName: "Professional Pass",
            audience: "Professionals",
            quantity: 2,
            unitAmount: 299900,
            unitGstAmount: 53982,
            subtotalAmount: 599800,
            gstRateBps: 1800,
            gstAmount: 107964,
            totalAmount: 707764,
            currency: "INR",
            gstNumber: "29ABCDE1234F1Z5",
            contactConsentAt: createdAt,
            paymentStatus: "pending",
            razorpayOrderId: null,
            razorpayPaymentId: null,
            paidAt: null,
            adminNote: null,
            reviewedAt: null,
            reviewedByAdminId: null,
            createdAt,
            updatedAt: createdAt,
        }]);
    });

    /**
     * Registration is public - the pages are open - but everything that reads
     * or changes money must be admin only.
     */
    it("allows registration without a session", async () => {
        mockDelegate.create.mockResolvedValue(ok({
            registrationId: "dlg_1",
            subtotalAmount: 599800,
            gstAmount: 107964,
            gstRateBps: 1800,
            totalAmount: 707764,
            paymentStatus: "pending",
        }));

        const result = await summitResolvers.Mutation.registerDelegatePass(null, {
            input: {
                fullName: "Asha Menon",
                designation: "CTO",
                organisation: "Acme Labs",
                email: "asha@example.com",
                phone: "9876543210",
                passName: "Professional Pass",
                audience: "Professionals",
                quantity: 2,
                unitAmount: 299900,
                contactConsent: true,
            },
        });

        expect(result).toEqual({
            registrationId: "dlg_1",
            subtotalAmount: 599800,
            gstAmount: 107964,
            gstRateBps: 1800,
            totalAmount: 707764,
            paymentStatus: "pending",
        });
    });

    it.each([
        ["adminDelegatePassRegistrations", () => summitResolvers.Query.adminDelegatePassRegistrations],
        ["adminNominationRegistrations", () => summitResolvers.Query.adminNominationRegistrations],
        ["adminSummitStats", () => summitResolvers.Query.adminSummitStats],
    ])("blocks a signed-in non-admin from %s", async (_name, getResolver) => {
        const resolver = getResolver() as (a: unknown, b: unknown, c: GraphQLContext) => Promise<unknown>;

        await expect(resolver(null, {}, contextFor({ id: 2, is_admin: false })))
            .rejects.toBeInstanceOf(GraphQLError);
        expect(mockDelegate.listAdmin).not.toHaveBeenCalled();
        expect(mockNomination.listAdmin).not.toHaveBeenCalled();
    });

    it("blocks an anonymous caller from admin queries", async () => {
        await expect(
            summitResolvers.Query.adminDelegatePassRegistrations(null, {}, contextFor(null))
        ).rejects.toMatchObject({ extensions: { code: "UNAUTHORIZED" } });
        expect(mockDelegate.listAdmin).not.toHaveBeenCalled();
    });

    it("blocks a non-admin from changing payment status", async () => {
        await expect(
            summitResolvers.Mutation.updateDelegatePassPaymentStatus(
                null,
                { id: "dlg_1", input: { paymentStatus: "paid" } },
                contextFor({ id: 2, is_admin: false })
            )
        ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
        expect(mockDelegate.updatePaymentStatus).not.toHaveBeenCalled();
    });

    it("records the acting admin id when marking a delegate pass paid", async () => {
        mockDelegate.updatePaymentStatus.mockResolvedValue(ok(true));

        const result = await summitResolvers.Mutation.updateDelegatePassPaymentStatus(
            null,
            { id: "dlg_1", input: { paymentStatus: "paid", adminNote: "Verified NEFT" } },
            contextFor({ id: 42, is_admin: true })
        );

        expect(result).toBe(true);
        expect(mockDelegate.updatePaymentStatus).toHaveBeenCalledWith(
            "dlg_1",
            "paid",
            "Verified NEFT",
            42
        );
    });

    it("records the acting admin id when marking a nomination paid", async () => {
        mockNomination.updatePaymentStatus.mockResolvedValue(ok(true));

        await summitResolvers.Mutation.updateNominationPaymentStatus(
            null,
            { id: "nom_1", input: { paymentStatus: "refunded" } },
            contextFor({ id: 9, is_admin: true })
        );

        expect(mockNomination.updatePaymentStatus).toHaveBeenCalledWith(
            "nom_1",
            "refunded",
            undefined,
            9
        );
    });

    it("translates a repository error into a GraphQL error carrying the domain code", async () => {
        mockDelegate.create.mockResolvedValue(err(ERRORS.INVALID_QUANTITY));

        await expect(
            summitResolvers.Mutation.registerDelegatePass(null, { input: {} as never })
        ).rejects.toMatchObject({
            extensions: { code: "BAD_USER_INPUT", statusCode: 400, errorCode: 70005 },
        });
    });

    it("surfaces a missing registration as NOT_FOUND", async () => {
        mockDelegate.getById.mockResolvedValue(err(ERRORS.DELEGATE_PASS_NOT_FOUND));

        await expect(
            summitResolvers.Query.adminDelegatePassRegistration(
                null,
                { id: "dlg_missing" },
                contextFor({ id: 7, is_admin: true })
            )
        ).rejects.toMatchObject({
            extensions: { code: "NOT_FOUND", statusCode: 404, errorCode: 70001 },
        });
    });

    it("aggregates paid and pending totals across both registration types", async () => {
        mockDelegate.countByPaymentStatus
            .mockResolvedValueOnce(ok({ count: 3, amount: 1799400 }))
            .mockResolvedValueOnce(ok({ count: 1, amount: 299900 }));
        mockNomination.countByPaymentStatus
            .mockResolvedValueOnce(ok({ count: 2, amount: 3999800 }))
            .mockResolvedValueOnce(ok({ count: 4, amount: 7999600 }));
        mockRefund.countByStatus.mockResolvedValue(ok(5));

        const result = await summitResolvers.Query.adminSummitStats(
            null,
            null,
            contextFor({ id: 7, is_admin: true })
        );

        expect(result).toEqual({
            delegatePaid: { count: 3, amount: 1799400 },
            delegatePending: { count: 1, amount: 299900 },
            nominationPaid: { count: 2, amount: 3999800 },
            nominationPending: { count: 4, amount: 7999600 },
            openRefundRequests: 5,
        });
    });
});
