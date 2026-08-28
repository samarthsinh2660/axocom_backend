import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { nominationRepository } from "./nomination.repository";
import { ERRORS } from "../utils/error";

const mockExecute = jest.fn<(...args: any[]) => Promise<any>>();

jest.mock("../dataconfig/db", () => ({
    db: { execute: (...args: any[]) => mockExecute(...args) },
}));

const validInput = {
    nomineeName: "Ravi Kumar",
    organisation: "InnovateX",
    designation: "Founder",
    email: " RAVI@Example.COM ",
    phone: "+91 98765-00011",
    website: "https://innovatex.in",
    achievements: "Built rural AI clinics across three districts.",
    planName: "Premium Nomination",
    baseAmount: 1999900,
    contactConsent: true,
};

describe("NominationRepository", () => {
    beforeEach(() => {
        mockExecute.mockReset();
    });

    it("creates a pending nomination with normalized identity fields", async () => {
        mockExecute.mockResolvedValue([{ affectedRows: 1 }, []]);

        const result = await nominationRepository.create(validInput);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
            expect(result.value.paymentStatus).toBe("pending");
            expect(result.value.registrationId).toMatch(/^nom_[A-Za-z0-9_-]{12}$/);
        }
        expect(mockExecute.mock.calls[0][0]).toContain("INSERT INTO nomination_registrations");
        expect(mockExecute.mock.calls[0][1]).toEqual(expect.arrayContaining([
            "RAVI@Example.COM",
            "ravi@example.com",
            "+91 98765-00011",
            "9876500011",
            1999900,
        ]));
    });

    it("rejects a non-positive or fractional amount", async () => {
        for (const baseAmount of [0, -1, 999.5]) {
            const result = await nominationRepository.create({ ...validInput, baseAmount });
            expect(result.isErr()).toBe(true);
            if (result.isErr()) expect(result.error).toBe(ERRORS.INVALID_NOMINATION_PLAN);
        }
        expect(mockExecute).not.toHaveBeenCalled();
    });

    it("requires achievements and a plan before storing anything", async () => {
        for (const patch of [{ achievements: "   " }, { planName: "" }]) {
            const result = await nominationRepository.create({ ...validInput, ...patch });
            expect(result.isErr()).toBe(true);
            if (result.isErr()) expect(result.error).toBe(ERRORS.INVALID_REQUEST_BODY);
        }
        expect(mockExecute).not.toHaveBeenCalled();
    });

    it("rejects a website that is not an http(s) URL", async () => {
        const result = await nominationRepository.create({
            ...validInput,
            website: "javascript:alert(1)",
        });

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error.statusCode).toBe(400);
        expect(mockExecute).not.toHaveBeenCalled();
    });

    it("accepts an omitted website and stores it as null", async () => {
        mockExecute.mockResolvedValue([{ affectedRows: 1 }, []]);

        const result = await nominationRepository.create({ ...validInput, website: null });

        expect(result.isOk()).toBe(true);
        expect(mockExecute.mock.calls[0][1]).toContain(null);
    });

    it("rejects a phone number that is not a 10 digit mobile", async () => {
        const result = await nominationRepository.create({ ...validInput, phone: "99" });

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error.statusCode).toBe(400);
        expect(mockExecute).not.toHaveBeenCalled();
    });

    it("returns not found when fetching a nomination that does not exist", async () => {
        mockExecute.mockResolvedValue([[], []]);

        const result = await nominationRepository.getById("nom_missing");

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.NOMINATION_NOT_FOUND);
    });

    it("stamps paid_at only on the first transition to paid", async () => {
        mockExecute.mockResolvedValue([{ affectedRows: 1 }, []]);

        await nominationRepository.updatePaymentStatus("nom_1", "paid", null, 42);

        const [sql, params] = mockExecute.mock.calls[0];
        expect(sql).toContain("paid_at = CASE WHEN ? = 'paid' AND paid_at IS NULL THEN NOW() ELSE paid_at END");
        expect(params).toEqual(["paid", null, "paid", 42, "nom_1"]);
    });

    it("rejects a payment status outside the enum", async () => {
        const result = await nominationRepository.updatePaymentStatus("nom_1", "void" as never, null, 1);

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.INVALID_PAYMENT_STATUS);
        expect(mockExecute).not.toHaveBeenCalled();
    });

    it("returns not found when the status update matches no row", async () => {
        mockExecute.mockResolvedValue([{ affectedRows: 0 }, []]);

        const result = await nominationRepository.updatePaymentStatus("nom_gone", "paid", null, 1);

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.NOMINATION_NOT_FOUND);
    });

    it("adds GST on top of the listed plan price", async () => {
        mockExecute.mockResolvedValue([{ affectedRows: 1 }, []]);

        const result = await nominationRepository.create(validInput);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
            // 19,999 ex GST, 18% adds 3,599.82, charged 23,598.82
            expect(result.value.subtotalAmount).toBe(1999900);
            expect(result.value.gstAmount).toBe(359982);
            expect(result.value.totalAmount).toBe(2359882);
        }
    });

    it("sums paid revenue alongside the nomination count", async () => {
        mockExecute.mockResolvedValue([[{ total: 2, amount: 3999800 }], []]);

        const result = await nominationRepository.countByPaymentStatus("paid");

        expect(result.isOk()).toBe(true);
        if (result.isOk()) expect(result.value).toEqual({ count: 2, amount: 3999800 });
    });

    it("filters the admin listing by payment status and search term", async () => {
        mockExecute
            .mockResolvedValueOnce([[], []])
            .mockResolvedValueOnce([[{ total: 0 }], []]);

        await nominationRepository.listAdmin({ paymentStatus: "pending", search: "ravi" });

        const [sql, params] = mockExecute.mock.calls[0];
        expect(sql).toContain("payment_status = ?");
        expect(params[0]).toBe("pending");
        expect(params.slice(1)).toEqual(Array(5).fill("%ravi%"));
    });

    it("returns a database error when the insert fails", async () => {
        mockExecute.mockRejectedValue(new Error("connection lost"));

        const result = await nominationRepository.create(validInput);

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.DATABASE_ERROR);
    });
});
