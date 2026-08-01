import type { GraphQLContext } from "../context";
import { requireAdmin, toGraphQLError } from "../context";
import { mentorRepository } from "../../repositories/mentor.repository";
import type { ReviewStatus } from "../../models/solution.model";

function mapPublicMentor(row: Record<string, unknown>) {
    return {
        id: row.id,
        fullName: row.full_name,
        currentRole: row.current_role,
        organisation: row.organisation,
        expertise: row.expertise,
        experienceSummary: row.experience_summary,
        motivation: row.motivation,
        profileUrl: row.profile_url,
        createdAt: row.created_at,
        status: row.status,
    };
}

function mapAdminMentor(row: Record<string, unknown>) {
    return {
        ...mapPublicMentor(row),
        email: row.email,
        phone: row.phone,
        contactConsentAt: row.contact_consent_at,
        adminNote: row.admin_note,
        reviewedAt: row.reviewed_at,
        reviewedByAdminId: row.reviewed_by_admin_id,
        updatedAt: row.updated_at,
    };
}

export const mentorResolvers = {
    Query: {
        publicMentors: async (_: unknown, args: { page?: number; limit?: number }) => {
            const result = await mentorRepository.listPublic(args);
            if (result.isErr()) throw toGraphQLError(result.error);
            return {
                data: result.value.data.map((row) => mapPublicMentor(row as unknown as Record<string, unknown>)),
                pagination: result.value.pagination,
            };
        },

        adminMentorApplications: async (
            _: unknown,
            args: { status?: ReviewStatus; search?: string; page?: number; limit?: number },
            context: GraphQLContext
        ) => {
            requireAdmin(context);
            const result = await mentorRepository.listAdmin(args);
            if (result.isErr()) throw toGraphQLError(result.error);
            return {
                data: result.value.data.map((row) => mapAdminMentor(row as unknown as Record<string, unknown>)),
                pagination: result.value.pagination,
            };
        },

        adminMentorApplication: async (_: unknown, args: { id: string }, context: GraphQLContext) => {
            requireAdmin(context);
            const application = await context.loaders.mentorById.load(args.id);
            return application ? mapAdminMentor(application as unknown as Record<string, unknown>) : null;
        },
    },

    Mutation: {
        applyAsMentor: async (_: unknown, args: { input: Parameters<typeof mentorRepository.create>[0] }) => {
            const result = await mentorRepository.create(args.input);
            if (result.isErr()) throw toGraphQLError(result.error);
            return result.value;
        },

        updateMentorStatus: async (
            _: unknown,
            args: { id: string; input: { status: ReviewStatus; adminNote?: string | null } },
            context: GraphQLContext
        ) => {
            const admin = requireAdmin(context);
            const result = await mentorRepository.updateStatus(
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