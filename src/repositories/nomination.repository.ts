import { randomBytes } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { err, ok, type Result } from "neverthrow";
import { db } from "../dataconfig/db";
import type { PaymentStatus } from "../models/delegate_pass.model";
import {
    NOMINATION_REGISTRATIONS_TABLE,
    type CreateNominationInput,
    type NominationRegistrationRow,
} from "../models/nomination.model";
import { ERRORS, RequestError, isDuplicateKeyError } from "../utils/error";
import createLogger from "../utils/logger";
import { isValidNormalizedPhone, normalizeEmail, normalizePhone } from "../utils/normalize";
import { buildPagination, clampPage, type Paginated } from "../utils/pagination";

const logger = createLogger("@nomination.repository");

const PAYMENT_STATUSES: PaymentStatus[] = ["pending", "paid", "failed", "refunded"];

class NominationRepository {
    async create(
        input: CreateNominationInput
    ): Promise<Result<{ registrationId: string; totalAmount: number; paymentStatus: string }, RequestError>> {
        if (
            !input.nomineeName?.trim()
            || !input.organisation?.trim()
            || !input.designation?.trim()
            || !input.email?.trim()
            || !input.phone?.trim()
            || !input.achievements?.trim()
            || !input.planName?.trim()
            || input.contactConsent !== true
        ) {
            return err(ERRORS.INVALID_REQUEST_BODY);
        }

        if (!Number.isInteger(input.totalAmount) || input.totalAmount <= 0) {
            return err(ERRORS.INVALID_NOMINATION_PLAN);
        }

        if (input.website && !/^https?:\/\//i.test(input.website.trim())) {
            return err(new RequestError("Website or profile URL must start with http:// or https://", 10002, 400));
        }

        const normalizedEmail = normalizeEmail(input.email);
        const normalizedPhone = normalizePhone(input.phone);
        if (!isValidNormalizedPhone(normalizedPhone)) {
            return err(new RequestError("A valid 10-digit mobile number is required", 10002, 400));
        }

        const registrationId = `nom_${randomBytes(9).toString("base64url")}`;

        try {
            await db.execute(
                `INSERT INTO ${NOMINATION_REGISTRATIONS_TABLE}
                (id, nominee_name, organisation, designation, email, normalized_email, phone, normalized_phone,
                 website, achievements, plan_name, total_amount, contact_consent_at, payment_status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'pending')`,
                [
                    registrationId,
                    input.nomineeName.trim(),
                    input.organisation.trim(),
                    input.designation.trim(),
                    input.email.trim(),
                    normalizedEmail,
                    input.phone.trim(),
                    normalizedPhone,
                    input.website?.trim() || null,
                    input.achievements.trim(),
                    input.planName.trim(),
                    input.totalAmount,
                ]
            );
            return ok({ registrationId, totalAmount: input.totalAmount, paymentStatus: "pending" });
        } catch (error) {
            if (isDuplicateKeyError(error)) return err(ERRORS.DUPLICATE_SUBMISSION);
            logger.error("Error creating nomination registration:", error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async listAdmin(options: {
        paymentStatus?: string | null;
        search?: string | null;
        page?: number;
        limit?: number;
    }): Promise<Result<Paginated<NominationRegistrationRow>, RequestError>> {
        const { pageNumber, limitNumber, offset } = clampPage(options.page ?? 1, options.limit ?? 20);
        let where = "WHERE 1=1";
        const params: Array<string | number> = [];

        if (options.paymentStatus) {
            where += " AND payment_status = ?";
            params.push(options.paymentStatus);
        }
        if (options.search) {
            where += " AND (nominee_name LIKE ? OR email LIKE ? OR phone LIKE ? OR organisation LIKE ? OR id LIKE ?)";
            const search = `%${options.search}%`;
            params.push(search, search, search, search, search);
        }

        try {
            const [rows] = await db.execute<NominationRegistrationRow[]>(
                `SELECT * FROM ${NOMINATION_REGISTRATIONS_TABLE} ${where} ORDER BY created_at DESC LIMIT ${limitNumber} OFFSET ${offset}`,
                params
            );
            const [countRows] = await db.execute<Array<{ total: number } & RowDataPacket>>(
                `SELECT COUNT(*) AS total FROM ${NOMINATION_REGISTRATIONS_TABLE} ${where}`,
                params
            );
            const total = Number(countRows[0]?.total ?? 0);
            return ok({ data: rows, pagination: buildPagination(total, pageNumber, limitNumber) });
        } catch (error) {
            logger.error("Error listing nomination registrations:", error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async getById(id: string): Promise<Result<NominationRegistrationRow, RequestError>> {
        try {
            const [rows] = await db.execute<NominationRegistrationRow[]>(
                `SELECT * FROM ${NOMINATION_REGISTRATIONS_TABLE} WHERE id = ?`,
                [id]
            );
            if (!rows[0]) return err(ERRORS.NOMINATION_NOT_FOUND);
            return ok(rows[0]);
        } catch (error) {
            logger.error("Error fetching nomination registration:", error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async updatePaymentStatus(
        id: string,
        paymentStatus: PaymentStatus,
        adminNote: string | null | undefined,
        adminId: number
    ): Promise<Result<true, RequestError>> {
        if (!PAYMENT_STATUSES.includes(paymentStatus)) {
            return err(ERRORS.INVALID_PAYMENT_STATUS);
        }

        try {
            const [result] = await db.execute<ResultSetHeader>(
                `UPDATE ${NOMINATION_REGISTRATIONS_TABLE}
                 SET payment_status = ?,
                     admin_note = ?,
                     paid_at = CASE WHEN ? = 'paid' AND paid_at IS NULL THEN NOW() ELSE paid_at END,
                     reviewed_at = NOW(),
                     reviewed_by_admin_id = ?
                 WHERE id = ?`,
                [paymentStatus, adminNote ?? null, paymentStatus, adminId, id]
            );
            if (result.affectedRows === 0) return err(ERRORS.NOMINATION_NOT_FOUND);
            return ok(true);
        } catch (error) {
            logger.error("Error updating nomination payment status:", error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    /**
     * Records the Razorpay order opened for this nomination. Re-running
     * checkout after a dismissed modal simply overwrites the previous order.
     */
    async attachRazorpayOrder(id: string, orderId: string): Promise<Result<true, RequestError>> {
        try {
            const [result] = await db.execute<ResultSetHeader>(
                `UPDATE ${NOMINATION_REGISTRATIONS_TABLE}
                 SET razorpay_order_id = ?
                 WHERE id = ? AND payment_status <> 'paid'`,
                [orderId, id]
            );
            if (result.affectedRows === 0) return err(ERRORS.PAYMENT_ALREADY_COMPLETED);
            return ok(true);
        } catch (error) {
            logger.error("Error attaching razorpay order to nomination:", error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    /**
     * Marks paid only when the order id matches the one this nomination
     * opened, so a valid payment for a different (cheaper) registration cannot
     * be replayed against this one. Signature validity is checked before this
     * is ever called.
     */
    async markPaid(
        id: string,
        payment: { orderId: string; paymentId: string; signature: string }
    ): Promise<Result<true, RequestError>> {
        const existing = await this.getById(id);
        if (existing.isErr()) return err(existing.error);
        if (existing.value.payment_status === "paid") return err(ERRORS.PAYMENT_ALREADY_COMPLETED);
        if (existing.value.razorpay_order_id !== payment.orderId) {
            return err(ERRORS.PAYMENT_ORDER_MISMATCH);
        }

        try {
            const [result] = await db.execute<ResultSetHeader>(
                `UPDATE ${NOMINATION_REGISTRATIONS_TABLE}
                 SET payment_status = 'paid',
                     razorpay_payment_id = ?,
                     razorpay_signature = ?,
                     paid_at = NOW()
                 WHERE id = ? AND razorpay_order_id = ? AND payment_status <> 'paid'`,
                [payment.paymentId, payment.signature, id, payment.orderId]
            );
            if (result.affectedRows === 0) return err(ERRORS.PAYMENT_ALREADY_COMPLETED);
            return ok(true);
        } catch (error) {
            logger.error("Error marking nomination paid:", error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async countByPaymentStatus(
        paymentStatus: PaymentStatus
    ): Promise<Result<{ count: number; amount: number }, RequestError>> {
        try {
            const [rows] = await db.execute<Array<{ total: number; amount: number } & RowDataPacket>>(
                `SELECT COUNT(*) AS total, COALESCE(SUM(total_amount), 0) AS amount
                 FROM ${NOMINATION_REGISTRATIONS_TABLE} WHERE payment_status = ?`,
                [paymentStatus]
            );
            return ok({ count: Number(rows[0]?.total ?? 0), amount: Number(rows[0]?.amount ?? 0) });
        } catch (error) {
            logger.error("Error counting nomination registrations:", error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }
}

export const nominationRepository = new NominationRepository();
