import type { GraphQLContext } from "../context";
import { requireAdmin, toGraphQLError } from "../context";
import { mentorRepository } from "../../repositories/mentor.repository";
import { solutionRepository } from "../../repositories/solution.repository";
import type { ReviewStatus } from "../../models/solution.model";

function mapPublicSolution(row: Record<string, unknown>) {
    return {
        id: row.id,
        fullName: row.full_name,
        problemCode: row.problem_code,
        solutionTitle: row.solution_title,
        solutionDescription: row.solution_description,
        prototypeUrl: row.prototype_url,
        createdAt: row.created_at,
        status: row.status,
    };
}

function mapAdminSolution(row: Record<string, unknown>) {
    return {
        ...mapPublicSolution(row),
        email: row.email,
        phone: row.phone,
        contactConsentAt: row.contact_consent_at,
        adminNote: row.admin_note,
        reviewedAt: row.reviewed_at,
        reviewedByAdminId: row.reviewed_by_admin_id,
        updatedAt: row.updated_at,
    };
}

export const solutionResolvers = {
    Query: {
        publicSolutions: async (_: unknown, args: { problemCode?: string; page?: number; limit?: number }) => {
            const result = await solutionRepository.listPublic(args);
            if (result.isErr()) throw toGraphQLError(result.error);
            return {
                data: result.value.data.map((row) => mapPublicSolution(row as unknown as Record<string, unknown>)),
                pagination: result.value.pagination,
            };
        },

        publicStats: async () => {
            const solutions = await solutionRepository.countAccepted();
            if (solutions.isErr()) throw toGraphQLError(solutions.error);

            const mentors = await mentorRepository.countAccepted();
            if (mentors.isErr()) throw toGraphQLError(mentors.error);

            return { acceptedSolutions: solutions.value, acceptedMentors: mentors.value };
        },

        adminSolutionSubmissions: async (
            _: unknown,
            args: { status?: ReviewStatus; search?: string; problemCode?: string; page?: number; limit?: number },
            context: GraphQLContext
        ) => {
            requireAdmin(context);
            const result = await solutionRepository.listAdmin(args);
            if (result.isErr()) throw toGraphQLError(result.error);
            return {
                data: result.value.data.map((row) => mapAdminSolution(row as unknown as Record<string, unknown>)),
                pagination: result.value.pagination,
            };
        },

        adminSolutionSubmission: async (_: unknown, args: { id: string }, context: GraphQLContext) => {
            requireAdmin(context);
            const submission = await context.loaders.solutionById.load(args.id);
            return submission ? mapAdminSolution(submission as unknown as Record<string, unknown>) : null;
        },
    },

    Mutation: {
        submitSolution: async (_: unknown, args: { input: Parameters<typeof solutionRepository.create>[0] }) => {
            const result = await solutionRepository.create(args.input);
            if (result.isErr()) throw toGraphQLError(result.error);
            return result.value;
        },

        updateSolutionStatus: async (
            _: unknown,
            args: { id: string; input: { status: ReviewStatus; adminNote?: string | null } },
            context: GraphQLContext
        ) => {
            const admin = requireAdmin(context);
            const result = await solutionRepository.updateStatus(
                args.id,
                args.input.status,
                args.input.adminNote,
                admin.id
            );
            if (result.isErr()) throw toGraphQLError(result.error);
            return true;
        },
    },
};