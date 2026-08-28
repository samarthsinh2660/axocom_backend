import type { GraphQLContext } from "../context";
import { requireAdmin, toGraphQLError } from "../context";
import { refundRequestRepository } from "../../repositories/refund_request.repository";
import type { RefundRegistrationType, RefundStatus } from "../../models/refund_request.model";

function mapMessage(row: Record<string, unknown>) {
    return {
        id: row.id,
        author: row.author,
        message: row.message,
        createdAt: row.created_at,
    };
}

function mapRefundRequest(row: Record<string, unknown>) {
    return {
        id: row.id,
        fullName: row.full_name,
        email: row.email,
        phone: row.phone,
        registrationType: row.registration_type,
        registrationId: row.registration_id,
        paymentReference: row.payment_reference,
        reason: row.reason,
        status: row.status,
        resolvedAt: row.resolved_at,
        reviewedByAdminId: row.reviewed_by_admin_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

/** Public ticket view — deliberately omits email, phone and reviewer fields. */
function mapRefundTicket(row: Record<string, unknown>) {
    return {
        id: row.id,
        fullName: row.full_name,
        registrationType: row.registration_type,
        registrationId: row.registration_id,
        paymentReference: row.payment_reference,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        resolvedAt: row.resolved_at,
    };
}

async function loadMessages(refundRequestId: string) {
    const result = await refundRequestRepository.listMessages(refundRequestId);
    if (result.isErr()) throw toGraphQLError(result.error);
    return result.value.map((row) => mapMessage(row as unknown as Record<string, unknown>));
}

export const refundRequestResolvers = {
    // Thread is resolved lazily so list queries do not pay for it.
    RefundTicket: {
        messages: (parent: { id: string }) => loadMessages(parent.id),
    },

    RefundRequest: {
        messages: (parent: { id: string }) => loadMessages(parent.id),
    },

    Query: {
        refundTicket: async (_: unknown, args: { ticketId: string; email: string }) => {
            const result = await refundRequestRepository.getByTicketAndEmail(args.ticketId, args.email);
            if (result.isErr()) throw toGraphQLError(result.error);
            return mapRefundTicket(result.value as unknown as Record<string, unknown>);
        },

        adminRefundRequests: async (
            _: unknown,
            args: {
                status?: RefundStatus;
                registrationType?: RefundRegistrationType;
                search?: string;
                page?: number;
                limit?: number;
            },
            context: GraphQLContext
        ) => {
            requireAdmin(context);
            const result = await refundRequestRepository.listAdmin(args);
            if (result.isErr()) throw toGraphQLError(result.error);
            return {
                data: result.value.data.map((row) => mapRefundRequest(row as unknown as Record<string, unknown>)),
                pagination: result.value.pagination,
            };
        },

        adminRefundRequest: async (_: unknown, args: { id: string }, context: GraphQLContext) => {
            requireAdmin(context);
            const result = await refundRequestRepository.getById(args.id);
            if (result.isErr()) throw toGraphQLError(result.error);
            return mapRefundRequest(result.value as unknown as Record<string, unknown>);
        },
    },

    Mutation: {
        createRefundRequest: async (
            _: unknown,
            args: { input: Parameters<typeof refundRequestRepository.create>[0] }
        ) => {
            const result = await refundRequestRepository.create(args.input);
            if (result.isErr()) throw toGraphQLError(result.error);
            return result.value;
        },

        replyToRefundTicket: async (
            _: unknown,
            args: { ticketId: string; email: string; message: string }
        ) => {
            const ticket = await refundRequestRepository.getByTicketAndEmail(args.ticketId, args.email);
            if (ticket.isErr()) throw toGraphQLError(ticket.error);

            const result = await refundRequestRepository.addMessage(
                ticket.value.id,
                "user",
                args.message,
                null
            );
            if (result.isErr()) throw toGraphQLError(result.error);
            return mapMessage(result.value as unknown as Record<string, unknown>);
        },

        replyToRefundRequest: async (
            _: unknown,
            args: { id: string; message: string },
            context: GraphQLContext
        ) => {
            const admin = requireAdmin(context);
            const result = await refundRequestRepository.addMessage(args.id, "admin", args.message, admin.id);
            if (result.isErr()) throw toGraphQLError(result.error);
            return mapMessage(result.value as unknown as Record<string, unknown>);
        },

        updateRefundRequestStatus: async (
            _: unknown,
            args: { id: string; status: RefundStatus },
            context: GraphQLContext
        ) => {
            const admin = requireAdmin(context);
            const result = await refundRequestRepository.updateStatus(args.id, args.status, admin.id);
            if (result.isErr()) throw toGraphQLError(result.error);
            return true;
        },
    },
};
