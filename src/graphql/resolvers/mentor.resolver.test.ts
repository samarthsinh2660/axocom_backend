import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { err, ok } from "neverthrow";
import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../context";
import { ERRORS } from "../../utils/error";
import { mentorRepository } from "../../repositories/mentor.repository";
import { mentorResolvers } from "./mentor.resolver";

jest.mock("../../repositories/mentor.repository", () => ({
    mentorRepository: {
        create: jest.fn(),
        listPublic: jest.fn(),
        listAdmin: jest.fn(),
        updateStatus: jest.fn(),
    },
}));

const mockMentorRepository = mentorRepository as jest.Mocked<typeof mentorRepository>;

function contextFor(user: GraphQLContext["user"], mentorById?: unknown): GraphQLContext {
    return {
        req: {} as GraphQLContext["req"],
        user,
        loaders: {
            mentorById: { load: jest.fn(async () => mentorById) },
        } as unknown as GraphQLContext["loaders"],
    };
}

describe("MentorResolvers", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("maps public repository rows to the pace GraphQL contract", async () => {
        const createdAt = new Date("2026-01-01");
        mockMentorRepository.listPublic.mockResolvedValue(ok({
            data: [{
                id: "men_1",
                full_name: "Dev Singh",
                current_role: "Engineering Lead",
                organisation: "Hill Labs",
                expertise: "AI, Cloud",
                experience_summary: "Experience",
                motivation: "Motivation",
                profile_url: null,
                created_at: createdAt,
                status: "accepted",
            }],
            pagination: { total: 1, page: 1, limit: 50, totalPages: 1 },
        }));

        const result = await mentorResolvers.Query.publicMentors(null, { page: 1 });

        expect(result.data).toEqual([{
            id: "men_1",
            fullName: "Dev Singh",
            currentRole: "Engineering Lead",
            organisation: "Hill Labs",
            expertise: "AI, Cloud",
            experienceSummary: "Experience",
            motivation: "Motivation",
            profileUrl: null,
            createdAt,
            status: "accepted",
        }]);
    });

    it("returns the submission receipt from a public application", async () => {
        mockMentorRepository.create.mockResolvedValue(ok({ submissionId: "men_1", status: "received" }));
        const input = {
            fullName: "Dev Singh",
            email: "dev@example.com",
            phone: "9123456789",
            currentRole: "Engineering Lead",
            expertise: ["AI"],
            experienceSummary: "Experience",
            motivation: "Motivation",
            contactConsent: true,
        };

        await expect(mentorResolvers.Mutation.applyAsMentor(null, { input })).resolves.toEqual({
            submissionId: "men_1",
            status: "received",
        });
        expect(mockMentorRepository.create).toHaveBeenCalledWith(input);
    });

    it("translates repository failures to GraphQL errors", async () => {
        mockMentorRepository.listPublic.mockResolvedValue(err(ERRORS.DATABASE_ERROR));

        await expect(mentorResolvers.Query.publicMentors(null, {})).rejects.toMatchObject({
            extensions: { code: "INTERNAL_SERVER_ERROR", statusCode: 500 },
        });
    });

    it("blocks non-admin users from moderation queries", async () => {
        const context = contextFor({ id: 2, is_admin: false });

        await expect(mentorResolvers.Query.adminMentorApplications(null, {}, context))
            .rejects.toBeInstanceOf(GraphQLError);
        expect(mockMentorRepository.listAdmin).not.toHaveBeenCalled();
    });

    it("loads an admin detail through the request DataLoader", async () => {
        const createdAt = new Date("2026-01-01");
        const context = contextFor({ id: 7, is_admin: true }, {
            id: "men_1",
            full_name: "Dev Singh",
            email: "dev@example.com",
            phone: "9123456789",
            current_role: "Engineering Lead",
            organisation: "Hill Labs",
            expertise: "AI, Cloud",
            experience_summary: "Experience",
            motivation: "Motivation",
            profile_url: null,
            contact_consent_at: createdAt,
            status: "pending",
            admin_note: null,
            reviewed_at: null,
            reviewed_by_admin_id: null,
            created_at: createdAt,
            updated_at: createdAt,
        });

        const result = await mentorResolvers.Query.adminMentorApplication(null, { id: "men_1" }, context);

        expect(context.loaders.mentorById.load).toHaveBeenCalledWith("men_1");
        expect(result).toMatchObject({ id: "men_1", fullName: "Dev Singh", currentRole: "Engineering Lead" });
    });

    it("uses the Axocom admin id when updating review status", async () => {
        mockMentorRepository.updateStatus.mockResolvedValue(ok(true));
        const context = contextFor({ id: 42, is_admin: true, email: "admin@example.com" });

        const result = await mentorResolvers.Mutation.updateMentorStatus(
            null,
            { id: "men_1", input: { status: "rejected", adminNote: "Outside scope" } },
            context
        );

        expect(result).toBe(true);
        expect(mockMentorRepository.updateStatus).toHaveBeenCalledWith(
            "men_1",
            "rejected",
            "Outside scope",
            42
        );
    });
});