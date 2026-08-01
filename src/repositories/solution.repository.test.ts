import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { solutionRepository } from "./solution.repository";
import { ERRORS } from "../utils/error";

const mockExecute = jest.fn<(...args: any[]) => Promise<any>>();

jest.mock("../dataconfig/db", () => ({
    db: { execute: (...args: any[]) => mockExecute(...args) },
}));

const validInput = {
    fullName: "Asha Rawat",
    email: " ASHA@Example.COM ",
    phone: "+91 98765-43210",
    problemCode: "P-001",
    solutionTitle: "Mountain Link",
    solutionDescription: "A practical solution for remote communities.",
    prototypeUrl: "https://example.com/prototype",
    contactConsent: true,
};

describe("SolutionRepository", () => {
    beforeEach(() => {
        mockExecute.mockReset();
    });

    it("creates a pending submission with normalized identity fields", async () => {
        mockExecute.mockResolvedValue([{ affectedRows: 1 }, []]);

        const result = await solutionRepository.create(validInput);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
            expect(result.value.status).toBe("received");
            expect(result.value.submissionId).toMatch(/^sub_[A-Za-z0-9_-]{12}$/);
        }
        expect(mockExecute).toHaveBeenCalledTimes(1);
        expect(mockExecute.mock.calls[0][0]).toContain("INSERT INTO solution_submissions");
        expect(mockExecute.mock.calls[0][1]).toEqual(expect.arrayContaining([
            "ASHA@Example.COM",
            "asha@example.com",
            "+91 98765-43210",
            "9876543210",
            "P-001",
        ]));
    });

    it("accepts a normalized problem code defined by a future frontend", async () => {
        mockExecute.mockResolvedValue([{ affectedRows: 1 }, []]);

        const result = await solutionRepository.create({
            ...validInput,
            problemCode: "  UKIS-2027-HEALTH-01  ",
        });

        expect(result.isOk()).toBe(true);
        expect(mockExecute.mock.calls[0][1]).toEqual(expect.arrayContaining([
            "UKIS-2027-HEALTH-01",
        ]));
    });

    it("rejects problem codes that exceed the database column limit", async () => {
        const result = await solutionRepository.create({ ...validInput, problemCode: "P".repeat(101) });

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.INVALID_REQUEST_BODY);
        expect(mockExecute).not.toHaveBeenCalled();
    });

    it("rejects invalid phone numbers and insecure prototype URLs", async () => {
        const invalidPhone = await solutionRepository.create({ ...validInput, phone: "12345" });
        const invalidUrl = await solutionRepository.create({ ...validInput, prototypeUrl: "http://example.com" });

        expect(invalidPhone.isErr()).toBe(true);
        expect(invalidUrl.isErr()).toBe(true);
        expect(mockExecute).not.toHaveBeenCalled();
    });

    it("maps duplicate database keys to the domain duplicate error", async () => {
        mockExecute.mockRejectedValue({ code: "ER_DUP_ENTRY" });

        const result = await solutionRepository.create(validInput);

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.DUPLICATE_SUBMISSION);
    });

    it("lists accepted solutions with filters and pagination metadata", async () => {
        const row = {
            id: "sub_1",
            full_name: "Asha Rawat",
            problem_code: "P-001",
            solution_title: "Mountain Link",
            solution_description: "Description",
            prototype_url: null,
            created_at: new Date("2026-01-01"),
            status: "accepted",
        };
        mockExecute
            .mockResolvedValueOnce([[row], []])
            .mockResolvedValueOnce([[{ total: 21 }], []]);

        const result = await solutionRepository.listPublic({ problemCode: "P-001", page: 2, limit: 10 });

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
            expect(result.value.data).toEqual([row]);
            expect(result.value.pagination).toEqual({ total: 21, page: 2, limit: 10, totalPages: 3 });
        }
        expect(mockExecute.mock.calls[0][0]).toContain("LIMIT 10 OFFSET 10");
        expect(mockExecute.mock.calls[0][1]).toEqual(["P-001"]);
    });

    it("returns not found when a submission does not exist", async () => {
        mockExecute.mockResolvedValue([[], []]);

        const result = await solutionRepository.getById("sub_missing");

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.SOLUTION_NOT_FOUND);
    });

    it("records the Axocom admin user when updating status", async () => {
        mockExecute.mockResolvedValue([{ affectedRows: 1 }, []]);

        const result = await solutionRepository.updateStatus("sub_1", "accepted", "Strong fit", 42);

        expect(result.isOk()).toBe(true);
        expect(mockExecute).toHaveBeenCalledWith(
            expect.stringContaining("reviewed_by_admin_id = ?"),
            ["accepted", "Strong fit", 42, "sub_1"]
        );
    });

    it("rejects unsupported review statuses without querying the database", async () => {
        const result = await solutionRepository.updateStatus("sub_1", "archived" as any, null, 42);

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.INVALID_REVIEW_STATUS);
        expect(mockExecute).not.toHaveBeenCalled();
    });
});