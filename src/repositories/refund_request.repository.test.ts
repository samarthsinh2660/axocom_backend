import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { refundRequestRepository } from "./refund_request.repository";
import { ERRORS } from "../utils/error";

const mockExecute = jest.fn<(...args: any[]) => Promise<any>>();
const mockConnectionExecute = jest.fn<(...args: any[]) => Promise<any>>();
const mockBeginTransaction = jest.fn<() => Promise<void>>();
const mockCommit = jest.fn<() => Promise<void>>();
const mockRollback = jest.fn<() => Promise<void>>();
const mockRelease = jest.fn<() => void>();

jest.mock("../dataconfig/db", () => ({
    db: {
        execute: (...args: any[]) => mockExecute(...args),
        getConnection: async () => ({
            beginTransaction: mockBeginTransaction,
            execute: (...args: any[]) => mockConnectionExecute(...args),
            commit: mockCommit,
            rollback: mockRollback,
            release: mockRelease,
        }),
    },
}));

const validInput = {
    fullName: "Asha Menon",
    email: " ASHA@Example.COM ",
    phone: "+91 98765-43210",
    registrationType: "delegate_pass" as const,
    registrationId: "dlg_abc123",
    paymentReference: "pay_TEST123",
    reason: "Cannot attend, please refund my two passes.",
};

const ticketRow = {
    id: "rfd_abc123456789",
    full_name: "Asha Menon",
    email: "asha@example.com",
    normalized_email: "asha@example.com",
    phone: "9876543210",
    normalized_phone: "9876543210",
    registration_type: "delegate_pass",
    registration_id: "dlg_abc123",
    payment_reference: "pay_TEST123",
    reason: "Cannot attend",
    status: "open",
    resolved_at: null,
    reviewed_by_admin_id: null,
    created_at: new Date("2026-01-01"),
    updated_at: new Date("2026-01-01"),
};

describe("RefundRequestRepository", () => {
    beforeEach(() => {
        mockExecute.mockReset();
        mockConnectionExecute.mockReset();
        mockBeginTransaction.mockReset();
        mockCommit.mockReset();
        mockRollback.mockReset();
        mockRelease.mockReset();
    });

    /**
     * The ticket row and its opening message must land together, otherwise a
     * requester can end up with a ticket whose thread does not show what they
     * actually asked for.
     */
    it("creates the ticket and seeds the thread with the reason in one transaction", async () => {
        // The reference is checked against the registration table first.
        mockExecute.mockResolvedValue([[{ id: "dlg_abc123" }], []]);
        mockConnectionExecute.mockResolvedValue([{ affectedRows: 1 }, []]);

        const result = await refundRequestRepository.create(validInput);

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
            expect(result.value.status).toBe("open");
            expect(result.value.ticketId).toMatch(/^rfd_[A-Za-z0-9_-]{12}$/);
        }

        expect(mockBeginTransaction).toHaveBeenCalledTimes(1);
        expect(mockCommit).toHaveBeenCalledTimes(1);
        expect(mockRollback).not.toHaveBeenCalled();
        expect(mockRelease).toHaveBeenCalledTimes(1);

        expect(mockConnectionExecute.mock.calls[0][0]).toContain("INSERT INTO refund_requests");
        expect(mockConnectionExecute.mock.calls[1][0]).toContain("INSERT INTO refund_request_messages");
        expect(mockConnectionExecute.mock.calls[1][1]).toEqual(
            expect.arrayContaining(["Cannot attend, please refund my two passes."])
        );
    });

    it("rolls back and releases the connection when the insert fails", async () => {
        mockExecute.mockResolvedValue([[{ id: "dlg_abc123" }], []]);
        mockConnectionExecute.mockRejectedValue(new Error("deadlock"));

        const result = await refundRequestRepository.create(validInput);

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.DATABASE_ERROR);
        expect(mockRollback).toHaveBeenCalledTimes(1);
        expect(mockCommit).not.toHaveBeenCalled();
        expect(mockRelease).toHaveBeenCalledTimes(1);
    });

    /**
     * A reference that is not theirs must not open a ticket - otherwise a
     * refund could be filed against a stranger's registration.
     */
    it("refuses a registration reference that does not belong to the filer", async () => {
        mockExecute.mockResolvedValue([[], []]);

        const result = await refundRequestRepository.create(validInput);

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.REFUND_REGISTRATION_MISMATCH);
        expect(mockBeginTransaction).not.toHaveBeenCalled();
    });

    it("requires a registration reference", async () => {
        const result = await refundRequestRepository.create({
            ...validInput,
            registrationId: "   ",
        });

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.REFUND_REGISTRATION_REQUIRED);
        expect(mockExecute).not.toHaveBeenCalled();
    });

    it("requires a reason", async () => {
        const result = await refundRequestRepository.create({ ...validInput, reason: "   " });

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.REFUND_REASON_REQUIRED);
        expect(mockBeginTransaction).not.toHaveBeenCalled();
    });

    it("rejects a registration type outside the enum", async () => {
        const result = await refundRequestRepository.create({
            ...validInput,
            registrationType: "sponsorship" as never,
        });

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.INVALID_REGISTRATION_TYPE);
        expect(mockBeginTransaction).not.toHaveBeenCalled();
    });

    it("rejects a phone number that is not a 10 digit mobile", async () => {
        const result = await refundRequestRepository.create({ ...validInput, phone: "12" });

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error.statusCode).toBe(400);
        expect(mockBeginTransaction).not.toHaveBeenCalled();
    });

    /**
     * A ticket id alone must never open a ticket: the lookup is scoped by the
     * normalized email so a guessed or leaked reference is not enough.
     */
    it("scopes the public lookup by normalized email as well as ticket id", async () => {
        mockExecute.mockResolvedValue([[ticketRow], []]);

        const result = await refundRequestRepository.getByTicketAndEmail(
            "rfd_abc123456789",
            "  ASHA@Example.COM  "
        );

        expect(result.isOk()).toBe(true);
        const [sql, params] = mockExecute.mock.calls[0];
        expect(sql).toContain("WHERE id = ? AND normalized_email = ?");
        expect(params).toEqual(["rfd_abc123456789", "asha@example.com"]);
    });

    it("returns not found when the email does not match the ticket", async () => {
        mockExecute.mockResolvedValue([[], []]);

        const result = await refundRequestRepository.getByTicketAndEmail(
            "rfd_abc123456789",
            "attacker@evil.com"
        );

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.REFUND_REQUEST_NOT_FOUND);
    });

    it("rejects an empty ticket id or email without querying", async () => {
        const result = await refundRequestRepository.getByTicketAndEmail("", "asha@example.com");

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.INVALID_REQUEST_BODY);
        expect(mockExecute).not.toHaveBeenCalled();
    });

    it("returns the thread in chronological order", async () => {
        mockExecute.mockResolvedValue([[], []]);

        await refundRequestRepository.listMessages("rfd_abc123456789");

        expect(mockExecute.mock.calls[0][0]).toContain("ORDER BY created_at ASC");
    });

    it("stamps resolved_at for terminal statuses", async () => {
        mockExecute.mockResolvedValue([{ affectedRows: 1 }, []]);

        for (const status of ["approved", "rejected", "refunded"] as const) {
            mockExecute.mockClear();
            await refundRequestRepository.updateStatus("rfd_1", status, 7);
            expect(mockExecute.mock.calls[0][0]).toContain("resolved_at = NOW()");
        }
    });

    it("clears resolved_at when a ticket returns to review", async () => {
        mockExecute.mockResolvedValue([{ affectedRows: 1 }, []]);

        await refundRequestRepository.updateStatus("rfd_1", "in_review", 7);

        expect(mockExecute.mock.calls[0][0]).toContain("resolved_at = NULL");
    });

    it("rejects a status outside the enum", async () => {
        const result = await refundRequestRepository.updateStatus("rfd_1", "closed" as never, 7);

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.INVALID_REFUND_STATUS);
        expect(mockExecute).not.toHaveBeenCalled();
    });

    it("returns not found when the status update matches no ticket", async () => {
        mockExecute.mockResolvedValue([{ affectedRows: 0 }, []]);

        const result = await refundRequestRepository.updateStatus("rfd_gone", "approved", 7);

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.REFUND_REQUEST_NOT_FOUND);
    });

    it("records an admin reply against the admin id and touches the ticket", async () => {
        const messageRow = {
            id: "rmsg_1",
            refund_request_id: "rfd_abc123456789",
            author: "admin",
            author_admin_id: 42,
            message: "Approved.",
            created_at: new Date("2026-01-02"),
        };
        mockExecute
            .mockResolvedValueOnce([[ticketRow], []])      // getById guard
            .mockResolvedValueOnce([{ affectedRows: 1 }, []]) // insert message
            .mockResolvedValueOnce([{ affectedRows: 1 }, []]) // touch parent
            .mockResolvedValueOnce([[messageRow], []]);       // read back

        const result = await refundRequestRepository.addMessage(
            "rfd_abc123456789",
            "admin",
            "Approved.",
            42
        );

        expect(result.isOk()).toBe(true);
        if (result.isOk()) expect(result.value.author).toBe("admin");
        expect(mockExecute.mock.calls[1][1]).toEqual(
            expect.arrayContaining(["rfd_abc123456789", "admin", 42, "Approved."])
        );
        expect(mockExecute.mock.calls[2][0]).toContain("UPDATE refund_requests SET updated_at = NOW()");
    });

    it("rejects an empty message", async () => {
        const result = await refundRequestRepository.addMessage("rfd_1", "user", "   ", null);

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.REFUND_MESSAGE_REQUIRED);
        expect(mockExecute).not.toHaveBeenCalled();
    });

    it("refuses to add a message to a ticket that does not exist", async () => {
        mockExecute.mockResolvedValue([[], []]);

        const result = await refundRequestRepository.addMessage("rfd_gone", "user", "Hello", null);

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(ERRORS.REFUND_REQUEST_NOT_FOUND);
    });

    it("filters the admin listing by status, type and search term", async () => {
        mockExecute
            .mockResolvedValueOnce([[], []])
            .mockResolvedValueOnce([[{ total: 0 }], []]);

        await refundRequestRepository.listAdmin({
            status: "open",
            registrationType: "nomination",
            search: "asha",
        });

        const [sql, params] = mockExecute.mock.calls[0];
        expect(sql).toContain("status = ?");
        expect(sql).toContain("registration_type = ?");
        expect(params.slice(0, 2)).toEqual(["open", "nomination"]);
        expect(params.slice(2)).toEqual(Array(5).fill("%asha%"));
    });
});
