import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { err, ok } from "neverthrow";
import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../context";
import { ERRORS } from "../../utils/error";
import { mentorRepository } from "../../repositories/mentor.repository";
import { solutionRepository } from "../../repositories/solution.repository";
import { solutionResolvers } from "./solution.resolver";

jest.mock("../../repositories/solution.repository", () => ({
    solutionRepository: {
        create: jest.fn(),
        listPublic: jest.fn(),
        listAdmin: jest.fn(),
        countAccepted: jest.fn(),
        updateStatus: jest.fn(),
    },
}));
jest.mock("../../repositories/mentor.repository", () => ({
    mentorRepository: { countAccepted: jest.fn() },
}));

const mockSolutionRepository = solutionRepository as jest.Mocked<typeof solutionRepository>;
const mockMentorRepository = mentorRepository as jest.Mocked<typeof mentorRepository>;

function contextFor(user: GraphQLContext["user"], solutionById?: unknown): GraphQLContext {
    return {
        req: {} as GraphQLContext["req"],
        user,
        loaders: {
            solutionById: { load: jest.fn(async () => solutionById) },
        } as unknown as GraphQLContext["loaders"],
    };
}

describe("SolutionResolvers", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("maps public repository rows to the pace GraphQL contract", async () => {
        const createdAt = new Date("2026-01-01");
        mockSolutionRepository.listPublic.mockResolvedValue(ok({
            data: [{
                id: "sub_1",
                full_name: "Asha Rawat",
                problem_code: "P-001",
                solution_title: "Mountain Link",
                solution_description: "Description",
                prototype_url: null,
                created_at: createdAt,
                status: "accepted",
            }],
            pagination: { total: 1, page: 1, limit: 50, totalPages: 1 },
        }));

        const result = await solutionResolvers.Query.publicSolutions(null, { problemCode: "P-001" });

        expect(result.data).toEqual([{
            id: "sub_1",
            fullName: "Asha Rawat",
            problemCode: "P-001",
            solutionTitle: "Mountain Link",
            solutionDescription: "Description",
            prototypeUrl: null,
            createdAt,
            status: "accepted",
        }]);
        expect(mockSolutionRepository.listPublic).toHaveBeenCalledWith({ problemCode: "P-001" });
    });

    it("combines accepted mentor and solution counts", async () => {
        mockSolutionRepository.countAccepted.mockResolvedValue(ok(12));
        mockMentorRepository.countAccepted.mockResolvedValue(ok(5));

        await expect(solutionResolvers.Query.publicStats()).resolves.toEqual({
            acceptedSolutions: 12,
            acceptedMentors: 5,
        });
    });

    it("translates repository submission conflicts to GraphQL errors", async () => {
        mockSolutionRepository.create.mockResolvedValue(err(ERRORS.DUPLICATE_SUBMISSION));

        const promise = solutionResolvers.Mutation.submitSolution(null, {
            input: {
                fullName: "Asha Rawat",
                email: "asha@example.com",
                phone: "9876543210",
                problemCode: "P-001",
                solutionTitle: "Mountain Link",
                solutionDescription: "Description",
                contactConsent: true,
            },
        });

        await expect(promise).rejects.toMatchObject({
            extensions: { code: "CONFLICT", statusCode: 409, errorCode: 60001 },
        });
    });

    it("blocks non-admin users from moderation queries", async () => {
        const context = contextFor({ id: 2, is_admin: false });

        await expect(solutionResolvers.Query.adminSolutionSubmissions(null, {}, context))
            .rejects.toBeInstanceOf(GraphQLError);
        expect(mockSolutionRepository.listAdmin).not.toHaveBeenCalled();
    });

    it("loads an admin detail through the request DataLoader", async () => {
        const createdAt = new Date("2026-01-01");
        const context = contextFor({ id: 7, is_admin: true }, {
            id: "sub_1",
            full_name: "Asha Rawat",
            email: "asha@example.com",
            phone: "9876543210",
            problem_code: "P-001",
            solution_title: "Mountain Link",
            solution_description: "Description",
            prototype_url: null,
            contact_consent_at: createdAt,
            status: "pending",
            admin_note: null,
            reviewed_at: null,
            reviewed_by_admin_id: null,
            created_at: createdAt,
            updated_at: createdAt,
        });

        const result = await solutionResolvers.Query.adminSolutionSubmission(null, { id: "sub_1" }, context);

        expect(context.loaders.solutionById.load).toHaveBeenCalledWith("sub_1");
        expect(result).toMatchObject({ id: "sub_1", fullName: "Asha Rawat", problemCode: "P-001" });
    });

    it("uses the Axocom admin id when updating review status", async () => {
        mockSolutionRepository.updateStatus.mockResolvedValue(ok(true));
        const context = contextFor({ id: 42, is_admin: true, email: "admin@example.com" });

        const result = await solutionResolvers.Mutation.updateSolutionStatus(
            null,
            { id: "sub_1", input: { status: "accepted", adminNote: "Strong fit" } },
            context
        );

        expect(result).toBe(true);
        expect(mockSolutionRepository.updateStatus).toHaveBeenCalledWith(
            "sub_1",
            "accepted",
            "Strong fit",
            42
        );
    });
});