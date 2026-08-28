import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { delegatePassRepository } from "./delegate_pass.repository";
import { ERRORS } from "../utils/error";

const mockExecute = jest.fn<(...args: any[]) => Promise<any>>();

jest.mock("../dataconfig/db", () => ({
    db: { execute: (...args: any[]) => mockExecute(...args) },
}));

const validInput = {
    fullName: "Asha Menon",
    designation: "CTO",
    organisation: "Acme Labs",
    email: " ASHA@Example.COM ",
    phone: "+91 98765-43210",
    passName: "Professional Pass",
    audience: "Professionals",
    quantity: 2,
    unitAmount: 299900,
    gstNumber: "29ABCDE1234F1Z5",
    contactConsent: true,
};

describe("DelegatePassRepository", () => {
    beforeEach(() => {
        mockExecute.mockReset();
    });

    it("creates a pending registration with normalized identity fields", async () => {
        mockExecute.mockResolvedValue([{ affectedRows: 1 }, []]);

        const result = await delegatePassRepository.create(validInput);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
            expect(result.value.paymentStatus).toBe("pending");
            expect(result.value.registrationId).toMatch(/^dlg_[A-Za-z0-9_-]{12}$/);
        }
        expect(mockExecute.mock.calls[0][0]).toContain("INSERT INTO delegate_pass_registrations");
        expect(mockExecute.mock.calls[0][1]).toEqual(expect.arrayContaining([
            "ASHA@Example.COM",
            "asha@example.com",
            "+91 98765-43210",
            "9876543210",
        ]));
    });

    /**
     * The client sends a unit price, never a total. If the total were taken from
     * the request a 24,999 rupee pass could be bought for one rupee.
     */
    it("derives the total server-side from unit amount, quantity and GST", async () => {
        mockExecute.mockResolvedValue([{ affectedRows: 1 }, []]);

        const result = await delegatePassRepository.create(validInput);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
            // 2999 x 2 = 5998 ex GST, 18% adds 1079.64, charged 7077.64
            expect(result.value.subtotalAmount).toBe(599800);
            expect(result.value.gstAmount).toBe(107964);
            expect(result.value.gstRateBps).toBe(1800);
            expect(result.value.totalAmount).toBe(707764);
        }
    });

    /**
     * GST is charged per pass and then multiplied, the way an invoice line
     * works, so the stored per-unit figure reconciles against the invoice.
     */
    it("charges GST per pass rather than on the combined subtotal", async () => {
        mockExecute.mockResolvedValue([{ affectedRows: 1 }, []]);

        await delegatePassRepository.create({ ...validInput, quantity: 3 });

        const params = mockExecute.mock.calls[0][1];
        // unit 299900, unit GST 53982, subtotal 899700, GST 161946, total 1061646
        expect(params).toEqual(expect.arrayContaining([299900, 53982, 899700, 1800, 161946, 1061646]));
    });

    it("rejects a quantity outside the supported range", async () => {
        for (const quantity of [0, 11, 99, 1.5]) {
            const result = await delegatePassRepository.create({ ...validInput, quantity });
            expect(result.isErr()).toBe(true);
            if (result.isErr()) expect(result.error).toBe(ERRORS.INVALID_QUANTITY);
        }
        expect(mockExecute).not.toHaveBeenCalled();
    });

    it("rejects a non-positive or fractional unit amount", async () => {
        for (const unitAmount of [0, -100, 1999.5]) {
            const result = await delegatePassRepository.create({ ...validInput, unitAmount });
            expect(result.isErr()).toBe(true);
            if (result.isErr()) expect(result.error).toBe(ERRORS.INVALID_PASS_SELECTION);
        }
        expect(mockExecute).not.toHaveBeenCalled();
    });

    it("rejects a phone number that is not a 10 digit mobile", async () => {
        const result = await delegatePassRepository.create({ ...validInput, phone: "123" });

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error.statusCode).toBe(400);
        expect(mockExecute).not.toHaveBeenCalled();
    });

    it("requires contact consent before storing anything", async () => {
        const result = await delegatePassRepository.create({ ...validInput, contactConsent: false });

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.INVALID_REQUEST_BODY);
        expect(mockExecute).not.toHaveBeenCalled();
    });

    it("stores an omitted GST number as null rather than an empty string", async () => {
        mockExecute.mockResolvedValue([{ affectedRows: 1 }, []]);

        await delegatePassRepository.create({ ...validInput, gstNumber: "   " });

        expect(mockExecute.mock.calls[0][1]).toContain(null);
    });

    it("reports a duplicate key as a submission conflict", async () => {
        mockExecute.mockRejectedValue({ code: "ER_DUP_ENTRY", errno: 1062 });

        const result = await delegatePassRepository.create(validInput);

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.DUPLICATE_SUBMISSION);
    });

    it("returns a database error when the insert fails for any other reason", async () => {
        mockExecute.mockRejectedValue(new Error("connection lost"));

        const result = await delegatePassRepository.create(validInput);

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.DATABASE_ERROR);
    });

    it("returns not found when fetching a registration that does not exist", async () => {
        mockExecute.mockResolvedValue([[], []]);

        const result = await delegatePassRepository.getById("dlg_missing");

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.DELEGATE_PASS_NOT_FOUND);
    });

    it("rejects a payment status outside the enum", async () => {
        const result = await delegatePassRepository.updatePaymentStatus(
            "dlg_1",
            "settled" as never,
            null,
            7
        );

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.INVALID_PAYMENT_STATUS);
        expect(mockExecute).not.toHaveBeenCalled();
    });

    /**
     * paid_at records when money actually arrived, so re-marking an already paid
     * registration must not move the timestamp forward.
     */
    it("stamps paid_at only on the first transition to paid", async () => {
        mockExecute.mockResolvedValue([{ affectedRows: 1 }, []]);

        await delegatePassRepository.updatePaymentStatus("dlg_1", "paid", "Verified", 7);

        const [sql, params] = mockExecute.mock.calls[0];
        expect(sql).toContain("paid_at = CASE WHEN ? = 'paid' AND paid_at IS NULL THEN NOW() ELSE paid_at END");
        expect(params).toEqual(["paid", "Verified", "paid", 7, "dlg_1"]);
    });

    it("records the reviewing admin id on a status change", async () => {
        mockExecute.mockResolvedValue([{ affectedRows: 1 }, []]);

        const result = await delegatePassRepository.updatePaymentStatus("dlg_1", "refunded", null, 42);

        expect(result.isOk()).toBe(true);
        expect(mockExecute.mock.calls[0][1]).toEqual(["refunded", null, "refunded", 42, "dlg_1"]);
    });

    it("returns not found when the status update matches no row", async () => {
        mockExecute.mockResolvedValue([{ affectedRows: 0 }, []]);

        const result = await delegatePassRepository.updatePaymentStatus("dlg_gone", "paid", null, 7);

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.DELEGATE_PASS_NOT_FOUND);
    });

    it("sums paid revenue alongside the registration count", async () => {
        mockExecute.mockResolvedValue([[{ total: 3, amount: 1799400 }], []]);

        const result = await delegatePassRepository.countByPaymentStatus("paid");

        expect(result.isOk()).toBe(true);
        if (result.isOk()) expect(result.value).toEqual({ count: 3, amount: 1799400 });
    });

    it("reports zero rather than null when nothing has been paid", async () => {
        mockExecute.mockResolvedValue([[{ total: 0, amount: null }], []]);

        const result = await delegatePassRepository.countByPaymentStatus("paid");

        expect(result.isOk()).toBe(true);
        if (result.isOk()) expect(result.value).toEqual({ count: 0, amount: 0 });
    });

    it("filters the admin listing by payment status and search term", async () => {
        mockExecute
            .mockResolvedValueOnce([[], []])
            .mockResolvedValueOnce([[{ total: 0 }], []]);

        await delegatePassRepository.listAdmin({ paymentStatus: "paid", search: "asha" });

        const [sql, params] = mockExecute.mock.calls[0];
        expect(sql).toContain("payment_status = ?");
        expect(params[0]).toBe("paid");
        expect(params.slice(1)).toEqual(Array(5).fill("%asha%"));
    });

    it("clamps an oversized page limit", async () => {
        mockExecute
            .mockResolvedValueOnce([[], []])
            .mockResolvedValueOnce([[{ total: 0 }], []]);

        const result = await delegatePassRepository.listAdmin({ page: 1, limit: 5000 });

        expect(result.isOk()).toBe(true);
        if (result.isOk()) expect(result.value.pagination.limit).toBe(100);
        expect(mockExecute.mock.calls[0][0]).toContain("LIMIT 100");
    });
});
