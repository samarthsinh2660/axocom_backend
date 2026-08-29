import { randomBytes } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { err, ok, type Result } from "neverthrow";
import { db } from "../dataconfig/db";
import {
    REFUND_REQUEST_MESSAGES_TABLE,
    REFUND_REQUESTS_TABLE,
    REFUND_STATUSES,
    type CreateRefundRequestInput,
    type RefundMessageAuthor,
    type RefundRequestMessageRow,
    type RefundRequestRow,
    type RefundStatus,
    type SupportRequestType,
    SUPPORT_REQUEST_TYPES,
} from "../models/refund_request.model";
import { DELEGATE_PASS_REGISTRATIONS_TABLE } from "../models/delegate_pass.model";
import { NOMINATION_REGISTRATIONS_TABLE } from "../models/nomination.model";
import { ERRORS, RequestError } from "../utils/error";
import createLogger from "../utils/logger";
import { isValidNormalizedPhone, normalizeEmail, normalizePhone } from "../utils/normalize";
import { buildPagination, clampPage, type Paginated } from "../utils/pagination";

const logger = createLogger("@refund_request.repository");

const REGISTRATION_TYPES = ["delegate_pass", "nomination"];

const REGISTRATION_TABLES: Record<string, string> = {
    delegate_pass: DELEGATE_PASS_REGISTRATIONS_TABLE,
    nomination: NOMINATION_REGISTRATIONS_TABLE,
};

function newMessageId() {
    return `rmsg_${randomBytes(9).toString("base64url")}`;
}

class RefundRequestRepository {
    /** Creates the ticket and seeds the thread with the requester's reason. */
    async create(
        input: CreateRefundRequestInput
    ): Promise<Result<{ ticketId: string; status: RefundStatus }, RequestError>> {
        if (!input.fullName?.trim() || !input.email?.trim() || !input.phone?.trim()) {
            return err(ERRORS.INVALID_REQUEST_BODY);
        }
        if (!input.reason?.trim()) {
            return err(ERRORS.REFUND_REASON_REQUIRED);
        }
        if (!REGISTRATION_TYPES.includes(input.registrationType)) {
            return err(ERRORS.INVALID_REGISTRATION_TYPE);
        }
        // Without a reference nothing ties the ticket to a registration.
        const requestType: SupportRequestType = input.requestType ?? "refund";
        if (!SUPPORT_REQUEST_TYPES.includes(requestType)) {
            return err(ERRORS.INVALID_SUPPORT_REQUEST_TYPE);
        }

        const registrationId = input.registrationId?.trim();
        if (!registrationId) return err(ERRORS.REFUND_REGISTRATION_REQUIRED);

        const normalizedEmail = normalizeEmail(input.email);
        const normalizedPhone = normalizePhone(input.phone);
        if (!isValidNormalizedPhone(normalizedPhone)) {
            return err(new RequestError("A valid 10-digit mobile number is required", 10002, 400));
        }

        // Scoped by email so a ticket cannot be opened on someone else's
        // registration. One shared error message avoids confirming existence.
        try {
            const [owned] = await db.execute<Array<{ id: string } & RowDataPacket>>(
                `SELECT id FROM ${REGISTRATION_TABLES[input.registrationType]}
                 WHERE id = ? AND normalized_email = ?`,
                [registrationId, normalizedEmail]
            );
            if (!owned[0]) return err(ERRORS.REFUND_REGISTRATION_MISMATCH);
        } catch (error) {
            logger.error("Error validating refund registration reference:", error);
            return err(ERRORS.DATABASE_ERROR);
        }

        const ticketId = `rfd_${randomBytes(9).toString("base64url")}`;
        const reason = input.reason.trim();

        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            await connection.execute(
                `INSERT INTO ${REFUND_REQUESTS_TABLE}
                (id, request_type, full_name, email, normalized_email, phone, normalized_phone,
                 registration_type, registration_id, payment_reference, reason, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
                [
                    ticketId,
                    requestType,
                    input.fullName.trim(),
                    input.email.trim(),
                    normalizedEmail,
                    input.phone.trim(),
                    normalizedPhone,
                    input.registrationType,
                    registrationId,
                    input.paymentReference?.trim() || null,
                    reason,
                ]
            );
            await connection.execute(
                `INSERT INTO ${REFUND_REQUEST_MESSAGES_TABLE} (id, refund_request_id, author, message)
                 VALUES (?, ?, 'user', ?)`,
                [newMessageId(), ticketId, reason]
            );
            await connection.commit();
            return ok({ ticketId, status: "open" });
        } catch (error) {
            await connection.rollback();
            logger.error("Error creating refund request:", error);
            return err(ERRORS.DATABASE_ERROR);
        } finally {
            connection.release();
        }
    }

    /** Public lookup: requires the ticket id and the email it was filed with. */
    async getByTicketAndEmail(
        ticketId: string,
        email: string
    ): Promise<Result<RefundRequestRow, RequestError>> {
        if (!ticketId?.trim() || !email?.trim()) return err(ERRORS.INVALID_REQUEST_BODY);

        try {
            const [rows] = await db.execute<RefundRequestRow[]>(
                `SELECT * FROM ${REFUND_REQUESTS_TABLE} WHERE id = ? AND normalized_email = ?`,
                [ticketId.trim(), normalizeEmail(email)]
            );
            if (!rows[0]) return err(ERRORS.REFUND_REQUEST_NOT_FOUND);
            return ok(rows[0]);
        } catch (error) {
            logger.error("Error fetching refund request by ticket:", error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async getById(id: string): Promise<Result<RefundRequestRow, RequestError>> {
        try {
            const [rows] = await db.execute<RefundRequestRow[]>(
                `SELECT * FROM ${REFUND_REQUESTS_TABLE} WHERE id = ?`,
                [id]
            );
            if (!rows[0]) return err(ERRORS.REFUND_REQUEST_NOT_FOUND);
            return ok(rows[0]);
        } catch (error) {
            logger.error("Error fetching refund request:", error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async listMessages(
        refundRequestId: string
    ): Promise<Result<RefundRequestMessageRow[], RequestError>> {
        try {
            const [rows] = await db.execute<RefundRequestMessageRow[]>(
                `SELECT * FROM ${REFUND_REQUEST_MESSAGES_TABLE}
                 WHERE refund_request_id = ? ORDER BY created_at ASC`,
                [refundRequestId]
            );
            return ok(rows);
        } catch (error) {
            logger.error("Error listing refund request messages:", error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async listAdmin(options: {
        status?: string | null;
        requestType?: string | null;
        registrationType?: string | null;
        search?: string | null;
        page?: number;
        limit?: number;
    }): Promise<Result<Paginated<RefundRequestRow>, RequestError>> {
        const { pageNumber, limitNumber, offset } = clampPage(options.page ?? 1, options.limit ?? 20);
        let where = "WHERE 1=1";
        const params: Array<string | number> = [];

        if (options.status) {
            where += " AND status = ?";
            params.push(options.status);
        }
        if (options.requestType) {
            where += " AND request_type = ?";
            params.push(options.requestType);
        }
        if (options.registrationType) {
            where += " AND registration_type = ?";
            params.push(options.registrationType);
        }
        if (options.search) {
            where += " AND (full_name LIKE ? OR email LIKE ? OR phone LIKE ? OR id LIKE ? OR payment_reference LIKE ?)";
            const search = `%${options.search}%`;
            params.push(search, search, search, search, search);
        }

        try {
            const [rows] = await db.execute<RefundRequestRow[]>(
                `SELECT * FROM ${REFUND_REQUESTS_TABLE} ${where} ORDER BY created_at DESC LIMIT ${limitNumber} OFFSET ${offset}`,
                params
            );
            const [countRows] = await db.execute<Array<{ total: number } & RowDataPacket>>(
                `SELECT COUNT(*) AS total FROM ${REFUND_REQUESTS_TABLE} ${where}`,
                params
            );
            const total = Number(countRows[0]?.total ?? 0);
            return ok({ data: rows, pagination: buildPagination(total, pageNumber, limitNumber) });
        } catch (error) {
            logger.error("Error listing refund requests:", error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async updateStatus(
        id: string,
        status: RefundStatus,
        adminId: number
    ): Promise<Result<true, RequestError>> {
        if (!REFUND_STATUSES.includes(status)) return err(ERRORS.INVALID_REFUND_STATUS);

        const isResolved = ["approved", "rejected", "refunded", "resolved"].includes(status);

        try {
            const [result] = await db.execute<ResultSetHeader>(
                `UPDATE ${REFUND_REQUESTS_TABLE}
                 SET status = ?,
                     resolved_at = ${isResolved ? "NOW()" : "NULL"},
                     reviewed_by_admin_id = ?
                 WHERE id = ?`,
                [status, adminId, id]
            );
            if (result.affectedRows === 0) return err(ERRORS.REFUND_REQUEST_NOT_FOUND);
            return ok(true);
        } catch (error) {
            logger.error("Error updating refund request status:", error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async addMessage(
        refundRequestId: string,
        author: RefundMessageAuthor,
        message: string,
        adminId: number | null
    ): Promise<Result<RefundRequestMessageRow, RequestError>> {
        if (!message?.trim()) return err(ERRORS.REFUND_MESSAGE_REQUIRED);

        const existing = await this.getById(refundRequestId);
        if (existing.isErr()) return err(existing.error);

        const messageId = newMessageId();

        try {
            await db.execute(
                `INSERT INTO ${REFUND_REQUEST_MESSAGES_TABLE} (id, refund_request_id, author, author_admin_id, message)
                 VALUES (?, ?, ?, ?, ?)`,
                [messageId, refundRequestId, author, adminId, message.trim()]
            );
            // Touch the parent so the admin list re-sorts.
            await db.execute(
                `UPDATE ${REFUND_REQUESTS_TABLE} SET updated_at = NOW() WHERE id = ?`,
                [refundRequestId]
            );

            const [rows] = await db.execute<RefundRequestMessageRow[]>(
                `SELECT * FROM ${REFUND_REQUEST_MESSAGES_TABLE} WHERE id = ?`,
                [messageId]
            );
            return ok(rows[0]);
        } catch (error) {
            logger.error("Error adding refund request message:", error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async countByStatus(status: RefundStatus): Promise<Result<number, RequestError>> {
        try {
            const [rows] = await db.execute<Array<{ total: number } & RowDataPacket>>(
                `SELECT COUNT(*) AS total FROM ${REFUND_REQUESTS_TABLE} WHERE status = ?`,
                [status]
            );
            return ok(Number(rows[0]?.total ?? 0));
        } catch (error) {
            logger.error("Error counting refund requests:", error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }
}

export const refundRequestRepository = new RefundRequestRepository();
