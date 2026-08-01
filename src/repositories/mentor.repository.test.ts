import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { mentorRepository } from "./mentor.repository";
import { ERRORS } from "../utils/error";

const mockExecute = jest.fn<(...args: any[]) => Promise<any>>();

jest.mock("../dataconfig/db", () => ({
    db: { execute: (...args: any[]) => mockExecute(...args) },
}));

const validInput = {
    fullName: "Dev Singh",
    email: " DEV@Example.COM ",
    phone: "+91 91234-56789",
    currentRole: "Engineering Lead",
    organisation: "Hill Labs",
    expertise: ["AI", "Cloud"],
    experienceSummary: "Ten years building public-interest technology.",
    motivation: "Support local teams.",
    profileUrl: "https://example.com/dev",
    contactConsent: true,
};

describe("MentorRepository", () => {
    beforeEach(() => {
        mockExecute.mockReset();
    });

    it("creates a pending application with normalized identity and expertise", async () => {
        mockExecute.mockResolvedValue([{ affectedRows: 1 }, []]);

        const result = await mentorRepository.create(validInput);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
            expect(result.value.status).toBe("received");
            expect(result.value.submissionId).toMatch(/^men_[A-Za-z0-9_-]{12}$/);
        }
        expect(mockExecute.mock.calls[0][0]).toContain("INSERT INTO mentor_applications");
        expect(mockExecute.mock.calls[0][1]).toEqual(expect.arrayContaining([
            "DEV@Example.COM",
            "dev@example.com",
            "+91 91234-56789",
            "9123456789",
            "AI, Cloud",
        ]));
    });

    it("rejects missing consent before querying the database", async () => {
        const result = await mentorRepository.create({ ...validInput, contactConsent: false });

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.INVALID_REQUEST_BODY);
        expect(mockExecute).not.toHaveBeenCalled();
    });

    it("rejects invalid phone numbers and insecure profile URLs", async () => {
        const invalidPhone = await mentorRepository.create({ ...validInput, phone: "12345" });
        const invalidUrl = await mentorRepository.create({ ...validInput, profileUrl: "http://example.com" });

        expect(invalidPhone.isErr()).toBe(true);
        expect(invalidUrl.isErr()).toBe(true);
        expect(mockExecute).not.toHaveBeenCalled();
    });

    it("maps duplicate database keys to the domain duplicate error", async () => {
        mockExecute.mockRejectedValue({ errno: 1062 });

        const result = await mentorRepository.create(validInput);

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.DUPLICATE_SUBMISSION);
    });

    it("lists accepted mentors with pagination metadata", async () => {
        const row = {
            id: "men_1",
            full_name: "Dev Singh",
            current_role: "Engineering Lead",
            organisation: "Hill Labs",
            expertise: "AI, Cloud",
            experience_summary: "Experience",
            motivation: "Motivation",
            profile_url: null,
            created_at: new Date("2026-01-01"),
            status: "accepted",
        };
        mockExecute
            .mockResolvedValueOnce([[row], []])
            .mockResolvedValueOnce([[{ total: 11 }], []]);

        const result = await mentorRepository.listPublic({ page: 2, limit: 10 });

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
            expect(result.value.data).toEqual([row]);
            expect(result.value.pagination).toEqual({ total: 11, page: 2, limit: 10, totalPages: 2 });
        }
        expect(mockExecute.mock.calls[0][0]).toContain("LIMIT 10 OFFSET 10");
    });

    it("applies admin status and search filters", async () => {
        mockExecute
            .mockResolvedValueOnce([[], []])
            .mockResolvedValueOnce([[{ total: 0 }], []]);

        const result = await mentorRepository.listAdmin({ status: "pending", search: "Dev", page: 1, limit: 20 });

        expect(result.isOk()).toBe(true);
        expect(mockExecute.mock.calls[0][0]).toContain("status = ?");
        expect(mockExecute.mock.calls[0][0]).toContain("full_name LIKE ?");
        expect(mockExecute.mock.calls[0][1]).toEqual([
            "pending",
            "%Dev%",
            "%Dev%",
            "%Dev%",
            "%Dev%",
            "%Dev%",
        ]);
    });

    it("returns not found when an application does not exist", async () => {
        mockExecute.mockResolvedValue([[], []]);

        const result = await mentorRepository.getById("men_missing");

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.MENTOR_NOT_FOUND);
    });

    it("records the Axocom admin user when updating status", async () => {
        mockExecute.mockResolvedValue([{ affectedRows: 1 }, []]);

        const result = await mentorRepository.updateStatus("men_1", "rejected", "Outside scope", 42);

        expect(result.isOk()).toBe(true);
        expect(mockExecute).toHaveBeenCalledWith(
            expect.stringContaining("reviewed_by_admin_id = ?"),
            ["rejected", "Outside scope", 42, "men_1"]
        );
    });
});