import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { err, ok } from "neverthrow";
import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../context";
import { ERRORS } from "../../utils/error";
import { refundRequestRepository } from "../../repositories/refund_request.repository";
import { refundRequestResolvers } from "./refund_request.resolver";

jest.mock("../../repositories/refund_request.repository", () => ({
    refundRequestRepository: {
        create: jest.fn(),
        getByTicketAndEmail: jest.fn(),
        getById: jest.fn(),
        listMessages: jest.fn(),
        listAdmin: jest.fn(),
        updateStatus: jest.fn(),
        addMessage: jest.fn(),
    },
}));

const mockRepo = refundRequestRepository as jest.Mocked<typeof refundRequestRepository>;

function contextFor(user: GraphQLContext["user"]): GraphQLContext {
    return {
        req: {} as GraphQLContext["req"],
        user,
        loaders: {} as GraphQLContext["loaders"],
    };
}

const createdAt = new Date("2026-01-01");

const ticketRow = {
    id: "rfd_1",
    full_name: "Asha Menon",
    email: "asha@example.com",
    normalized_email: "asha@example.com",
    phone: "9876543210",
    normalized_phone: "9876543210",
    registration_type: "delegate_pass",
    registration_id: "dlg_1",
    payment_reference: "pay_1",
    reason: "Cannot attend",
    status: "open",
    resolved_at: null,
    reviewed_by_admin_id: null,
    created_at: createdAt,
    updated_at: createdAt,
};

describe("RefundRequestResolvers", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    /**
     * The public ticket view is served to anyone holding the reference and the
     * email, so it must not carry contact details or internal reviewer fields.
     */
    it("omits contact and reviewer fields from the public ticket view", async () => {
        mockRepo.getByTicketAndEmail.mockResolvedValue(ok(ticketRow as never));

        const result = await refundRequestResolvers.Query.refundTicket(null, {
            ticketId: "rfd_1",
            email: "asha@example.com",
        });

        expect(result).toEqual({
            id: "rfd_1",
            fullName: "Asha Menon",
            registrationType: "delegate_pass",
            registrationId: "dlg_1",
            paymentReference: "pay_1",
            status: "open",
            createdAt,
            updatedAt: createdAt,
            resolvedAt: null,
        });
        expect(result).not.toHaveProperty("email");
        expect(result).not.toHaveProperty("phone");
        expect(result).not.toHaveProperty("reviewedByAdminId");
        expect(result).not.toHaveProperty("reason");
    });

    it("surfaces a mismatched ticket and email as NOT_FOUND", async () => {
        mockRepo.getByTicketAndEmail.mockResolvedValue(err(ERRORS.REFUND_REQUEST_NOT_FOUND));

        await expect(
            refundRequestResolvers.Query.refundTicket(null, {
                ticketId: "rfd_1",
                email: "attacker@evil.com",
            })
        ).rejects.toMatchObject({
            extensions: { code: "NOT_FOUND", statusCode: 404, errorCode: 80001 },
        });
    });

    it("creates a ticket without a session and returns its reference", async () => {
        mockRepo.create.mockResolvedValue(ok({ ticketId: "rfd_1", status: "open" }));

        const result = await refundRequestResolvers.Mutation.createRefundRequest(null, {
            input: {
                fullName: "Asha Menon",
                email: "asha@example.com",
                phone: "9876543210",
                registrationType: "delegate_pass",
                registrationId: "dlg_1",
                reason: "Cannot attend",
            },
        });

        expect(result).toEqual({ ticketId: "rfd_1", status: "open" });
    });

    /**
     * A requester replying on their own ticket proves ownership with the same
     * reference + email pair used for the lookup, never with the id alone.
     */
    it("re-verifies ticket and email before accepting a requester reply", async () => {
        mockRepo.getByTicketAndEmail.mockResolvedValue(ok(ticketRow as never));
        mockRepo.addMessage.mockResolvedValue(ok({
            id: "rmsg_1",
            refund_request_id: "rfd_1",
            author: "user",
            author_admin_id: null,
            message: "Thanks",
            created_at: createdAt,
        } as never));

        const result = await refundRequestResolvers.Mutation.replyToRefundTicket(null, {
            ticketId: "rfd_1",
            email: "asha@example.com",
            message: "Thanks",
        });

        expect(mockRepo.getByTicketAndEmail).toHaveBeenCalledWith("rfd_1", "asha@example.com");
        expect(mockRepo.addMessage).toHaveBeenCalledWith("rfd_1", "user", "Thanks", null);
        expect(result).toEqual({
            id: "rmsg_1",
            author: "user",
            message: "Thanks",
            createdAt,
        });
    });

    it("refuses a requester reply when the email does not match the ticket", async () => {
        mockRepo.getByTicketAndEmail.mockResolvedValue(err(ERRORS.REFUND_REQUEST_NOT_FOUND));

        await expect(
            refundRequestResolvers.Mutation.replyToRefundTicket(null, {
                ticketId: "rfd_1",
                email: "attacker@evil.com",
                message: "Refund me instead",
            })
        ).rejects.toBeInstanceOf(GraphQLError);
        expect(mockRepo.addMessage).not.toHaveBeenCalled();
    });

    it("blocks a non-admin from the admin listing", async () => {
        await expect(
            refundRequestResolvers.Query.adminRefundRequests(null, {}, contextFor({ id: 2, is_admin: false }))
        ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
        expect(mockRepo.listAdmin).not.toHaveBeenCalled();
    });

    it("blocks a non-admin from replying as the team", async () => {
        await expect(
            refundRequestResolvers.Mutation.replyToRefundRequest(
                null,
                { id: "rfd_1", message: "Approved" },
                contextFor({ id: 2, is_admin: false })
            )
        ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
        expect(mockRepo.addMessage).not.toHaveBeenCalled();
    });

    it("attributes an admin reply to the acting admin", async () => {
        mockRepo.addMessage.mockResolvedValue(ok({
            id: "rmsg_2",
            refund_request_id: "rfd_1",
            author: "admin",
            author_admin_id: 42,
            message: "Approved, refund initiated.",
            created_at: createdAt,
        } as never));

        const result = await refundRequestResolvers.Mutation.replyToRefundRequest(
            null,
            { id: "rfd_1", message: "Approved, refund initiated." },
            contextFor({ id: 42, is_admin: true })
        );

        expect(mockRepo.addMessage).toHaveBeenCalledWith(
            "rfd_1",
            "admin",
            "Approved, refund initiated.",
            42
        );
        expect(result.author).toBe("admin");
    });

    it("records the acting admin when changing ticket status", async () => {
        mockRepo.updateStatus.mockResolvedValue(ok(true));

        const result = await refundRequestResolvers.Mutation.updateRefundRequestStatus(
            null,
            { id: "rfd_1", status: "approved" },
            contextFor({ id: 42, is_admin: true })
        );

        expect(result).toBe(true);
        expect(mockRepo.updateStatus).toHaveBeenCalledWith("rfd_1", "approved", 42);
    });

    it("resolves the thread lazily through the field resolver", async () => {
        mockRepo.listMessages.mockResolvedValue(ok([{
            id: "rmsg_1",
            refund_request_id: "rfd_1",
            author: "user",
            author_admin_id: null,
            message: "Cannot attend",
            created_at: createdAt,
        }] as never));

        const messages = await refundRequestResolvers.RefundTicket.messages({ id: "rfd_1" });

        expect(mockRepo.listMessages).toHaveBeenCalledWith("rfd_1");
        expect(messages).toEqual([{
            id: "rmsg_1",
            author: "user",
            message: "Cannot attend",
            createdAt,
        }]);
    });
});
