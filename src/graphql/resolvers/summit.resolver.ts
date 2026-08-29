import type { GraphQLContext } from "../context";
import { requireAdmin, toGraphQLError } from "../context";
import { delegatePassRepository } from "../../repositories/delegate_pass.repository";
import { nominationRepository } from "../../repositories/nomination.repository";
import { refundRequestRepository } from "../../repositories/refund_request.repository";
import type { CreateDelegatePassInput, PaymentStatus } from "../../models/delegate_pass.model";
import type { CreateNominationInput } from "../../models/nomination.model";
import { REFUND_STATUS } from "../../models/refund_request.model";

function mapDelegatePass(row: Record<string, unknown>) {
    return {
        id: row.id,
        fullName: row.full_name,
        designation: row.designation,
        organisation: row.organisation,
        email: row.email,
        phone: row.phone,
        passName: row.pass_name,
        audience: row.audience,
        quantity: row.quantity,
        unitAmount: row.unit_amount,
        unitGstAmount: row.unit_gst_amount,
        subtotalAmount: row.subtotal_amount,
        gstRateBps: row.gst_rate_bps,
        gstAmount: row.gst_amount,
        totalAmount: row.total_amount,
        currency: row.currency,
        gstNumber: row.gst_number,
        startupDetails: row.startup_details,
        contactConsentAt: row.contact_consent_at,
        paymentStatus: row.payment_status,
        razorpayOrderId: row.razorpay_order_id,
        razorpayPaymentId: row.razorpay_payment_id,
        paidAt: row.paid_at,
        adminNote: row.admin_note,
        reviewedAt: row.reviewed_at,
        reviewedByAdminId: row.reviewed_by_admin_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function mapNomination(row: Record<string, unknown>) {
    return {
        id: row.id,
        nomineeName: row.nominee_name,
        organisation: row.organisation,
        designation: row.designation,
        email: row.email,
        phone: row.phone,
        website: row.website,
        achievements: row.achievements,
        planName: row.plan_name,
        baseAmount: row.base_amount,
        gstRateBps: row.gst_rate_bps,
        gstAmount: row.gst_amount,
        totalAmount: row.total_amount,
        currency: row.currency,
        contactConsentAt: row.contact_consent_at,
        paymentStatus: row.payment_status,
        razorpayOrderId: row.razorpay_order_id,
        razorpayPaymentId: row.razorpay_payment_id,
        paidAt: row.paid_at,
        adminNote: row.admin_note,
        reviewedAt: row.reviewed_at,
        reviewedByAdminId: row.reviewed_by_admin_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

export const summitResolvers = {
    Query: {
        adminDelegatePassRegistrations: async (
            _: unknown,
            args: { paymentStatus?: PaymentStatus; search?: string; page?: number; limit?: number },
            context: GraphQLContext
        ) => {
            requireAdmin(context);
            const result = await delegatePassRepository.listAdmin(args);
            if (result.isErr()) throw toGraphQLError(result.error);
            return {
                data: result.value.data.map((row) => mapDelegatePass(row as unknown as Record<string, unknown>)),
                pagination: result.value.pagination,
            };
        },

        adminDelegatePassRegistration: async (
            _: unknown,
            args: { id: string },
            context: GraphQLContext
        ) => {
            requireAdmin(context);
            const result = await delegatePassRepository.getById(args.id);
            if (result.isErr()) throw toGraphQLError(result.error);
            return mapDelegatePass(result.value as unknown as Record<string, unknown>);
        },

        adminNominationRegistrations: async (
            _: unknown,
            args: { paymentStatus?: PaymentStatus; search?: string; page?: number; limit?: number },
            context: GraphQLContext
        ) => {
            requireAdmin(context);
            const result = await nominationRepository.listAdmin(args);
            if (result.isErr()) throw toGraphQLError(result.error);
            return {
                data: result.value.data.map((row) => mapNomination(row as unknown as Record<string, unknown>)),
                pagination: result.value.pagination,
            };
        },

        adminNominationRegistration: async (
            _: unknown,
            args: { id: string },
            context: GraphQLContext
        ) => {
            requireAdmin(context);
            const result = await nominationRepository.getById(args.id);
            if (result.isErr()) throw toGraphQLError(result.error);
            return mapNomination(result.value as unknown as Record<string, unknown>);
        },

        adminSummitStats: async (_: unknown, __: unknown, context: GraphQLContext) => {
            requireAdmin(context);

            const delegatePaid = await delegatePassRepository.countByPaymentStatus("paid");
            if (delegatePaid.isErr()) throw toGraphQLError(delegatePaid.error);

            const delegatePending = await delegatePassRepository.countByPaymentStatus("pending");
            if (delegatePending.isErr()) throw toGraphQLError(delegatePending.error);

            const nominationPaid = await nominationRepository.countByPaymentStatus("paid");
            if (nominationPaid.isErr()) throw toGraphQLError(nominationPaid.error);

            const nominationPending = await nominationRepository.countByPaymentStatus("pending");
            if (nominationPending.isErr()) throw toGraphQLError(nominationPending.error);

            const openRefunds = await refundRequestRepository.countByStatus(REFUND_STATUS.OPEN);
            if (openRefunds.isErr()) throw toGraphQLError(openRefunds.error);

            return {
                delegatePaid: delegatePaid.value,
                delegatePending: delegatePending.value,
                nominationPaid: nominationPaid.value,
                nominationPending: nominationPending.value,
                openRefundRequests: openRefunds.value,
            };
        },
    },

    Mutation: {
        registerDelegatePass: async (
            _: unknown,
            args: { input: CreateDelegatePassInput & { unitAmount?: number; audience?: string } }
        ) => {
            const { input } = args;
            // Built field by field rather than forwarded whole: the input type
            // still accepts unitAmount and audience from older clients, and
            // neither may reach the repository.
            const result = await delegatePassRepository.create({
                fullName: input.fullName,
                designation: input.designation,
                organisation: input.organisation,
                email: input.email,
                phone: input.phone,
                passName: input.passName,
                quantity: input.quantity,
                gstNumber: input.gstNumber,
                startupDetails: input.startupDetails,
                contactConsent: input.contactConsent,
            });
            if (result.isErr()) throw toGraphQLError(result.error);
            return result.value;
        },

        registerNomination: async (
            _: unknown,
            args: { input: CreateNominationInput & { baseAmount?: number } }
        ) => {
            const { input } = args;
            // See registerDelegatePass: baseAmount is accepted but never passed on.
            const result = await nominationRepository.create({
                nomineeName: input.nomineeName,
                organisation: input.organisation,
                designation: input.designation,
                email: input.email,
                phone: input.phone,
                website: input.website,
                achievements: input.achievements,
                planName: input.planName,
                contactConsent: input.contactConsent,
            });
            if (result.isErr()) throw toGraphQLError(result.error);
            return result.value;
        },

        updateDelegatePassPaymentStatus: async (
            _: unknown,
            args: { id: string; input: { paymentStatus: PaymentStatus; adminNote?: string | null } },
            context: GraphQLContext
        ) => {
            const admin = requireAdmin(context);
            const result = await delegatePassRepository.updatePaymentStatus(
                args.id,
                args.input.paymentStatus,
                args.input.adminNote,
                admin.id
            );
            if (result.isErr()) throw toGraphQLError(result.error);
            return true;
        },

        updateNominationPaymentStatus: async (
            _: unknown,
            args: { id: string; input: { paymentStatus: PaymentStatus; adminNote?: string | null } },
            context: GraphQLContext
        ) => {
            const admin = requireAdmin(context);
            const result = await nominationRepository.updatePaymentStatus(
                args.id,
                args.input.paymentStatus,
                args.input.adminNote,
                admin.id
            );
            if (result.isErr()) throw toGraphQLError(result.error);
            return true;
        },
    },
};
