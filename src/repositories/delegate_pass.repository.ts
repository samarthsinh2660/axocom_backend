import { randomBytes } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { err, ok, type Result } from "neverthrow";
import { db } from "../dataconfig/db";
import {
    DELEGATE_PASS_REGISTRATIONS_TABLE,
    type CreateDelegatePassInput,
    type DelegatePassRegistrationRow,
    type PaymentStatus,
} from "../models/delegate_pass.model";
import { ERRORS, RequestError, isDuplicateKeyError } from "../utils/error";
import createLogger from "../utils/logger";
import { isValidNormalizedPhone, normalizeEmail, normalizePhone } from "../utils/normalize";
import { buildPagination, clampPage, type Paginated } from "../utils/pagination";
import { calculateGst } from "../utils/gst";
import { findDelegatePass } from "../config/pricing";

const logger = createLogger("@delegate_pass.repository");

const MAX_QUANTITY = 10;
const MIN_STARTUP_DETAILS = 20;
const PAYMENT_STATUSES: PaymentStatus[] = ["pending", "paid", "failed", "refunded"];

/** Only a registration with no money recorded against it can be settled. */
const SETTLEABLE_STATUSES: PaymentStatus[] = ["pending", "failed"];

class DelegatePassRepository {
    async create(input: CreateDelegatePassInput): Promise<
        Result<
            {
                registrationId: string;
                subtotalAmount: number;
                gstAmount: number;
                gstRateBps: number;
                totalAmount: number;
                paymentStatus: string;
            },
            RequestError
        >
    > {
        if (
            !input.fullName?.trim()
            || !input.designation?.trim()
            || !input.organisation?.trim()
            || !input.email?.trim()
            || !input.phone?.trim()
            || !input.passName?.trim()
            || input.contactConsent !== true
        ) {
            return err(ERRORS.INVALID_REQUEST_BODY);
        }

        if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > MAX_QUANTITY) {
            return err(ERRORS.INVALID_QUANTITY);
        }

        // Price from the server list, not the request.
        const pass = findDelegatePass(input.passName);
        if (!pass) return err(ERRORS.INVALID_PASS_SELECTION);

        // Whether details are needed is a property of the pass, not a name check.
        const startupDetails = input.startupDetails?.trim() || null;
        if (pass.requiresStartupDetails && (startupDetails?.length ?? 0) < MIN_STARTUP_DETAILS) {
            return err(ERRORS.STARTUP_DETAILS_REQUIRED);
        }

        const normalizedEmail = normalizeEmail(input.email);
        const normalizedPhone = normalizePhone(input.phone);
        if (!isValidNormalizedPhone(normalizedPhone)) {
            return err(new RequestError("A valid 10-digit mobile number is required", 10002, 400));
        }

        const registrationId = `dlg_${randomBytes(9).toString("base64url")}`;
        // Listed prices exclude GST; the server adds it.
        const gst = calculateGst(pass.unitAmount, input.quantity);

        try {
            await db.execute(
                `INSERT INTO ${DELEGATE_PASS_REGISTRATIONS_TABLE}
                (id, full_name, designation, organisation, email, normalized_email, phone, normalized_phone,
                 pass_name, audience, quantity, unit_amount, unit_gst_amount, subtotal_amount,
                 gst_rate_bps, gst_amount, total_amount, gst_number, startup_details,
                 contact_consent_at, payment_status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'pending')`,
                [
                    registrationId,
                    input.fullName.trim(),
                    input.designation.trim(),
                    input.organisation.trim(),
                    input.email.trim(),
                    normalizedEmail,
                    input.phone.trim(),
                    normalizedPhone,
                    pass.name,
                    pass.audience,
                    input.quantity,
                    gst.unitAmount,
                    gst.unitGstAmount,
                    gst.subtotalAmount,
                    gst.gstRateBps,
                    gst.gstAmount,
                    gst.totalAmount,
                    input.gstNumber?.trim() || null,
                    startupDetails,
                ]
            );
            return ok({
                registrationId,
                subtotalAmount: gst.subtotalAmount,
                gstAmount: gst.gstAmount,
                gstRateBps: gst.gstRateBps,
                totalAmount: gst.totalAmount,
                paymentStatus: "pending",
            });
        } catch (error) {
            if (isDuplicateKeyError(error)) return err(ERRORS.DUPLICATE_SUBMISSION);
            logger.error("Error creating delegate pass registration:", error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async listAdmin(options: {
        paymentStatus?: string | null;
        search?: string | null;
        page?: number;
        limit?: number;
    }): Promise<Result<Paginated<DelegatePassRegistrationRow>, RequestError>> {
        const { pageNumber, limitNumber, offset } = clampPage(options.page ?? 1, options.limit ?? 20);
        let where = "WHERE 1=1";
        const params: Array<string | number> = [];

        if (options.paymentStatus) {
            where += " AND payment_status = ?";
            params.push(options.paymentStatus);
        }
        if (options.search) {
            where += " AND (full_name LIKE ? OR email LIKE ? OR phone LIKE ? OR organisation LIKE ? OR id LIKE ?)";
            const search = `%${options.search}%`;
            params.push(search, search, search, search, search);
        }

        try {
            const [rows] = await db.execute<DelegatePassRegistrationRow[]>(
                `SELECT * FROM ${DELEGATE_PASS_REGISTRATIONS_TABLE} ${where} ORDER BY created_at DESC LIMIT ${limitNumber} OFFSET ${offset}`,
                params
            );
            const [countRows] = await db.execute<Array<{ total: number } & RowDataPacket>>(
                `SELECT COUNT(*) AS total FROM ${DELEGATE_PASS_REGISTRATIONS_TABLE} ${where}`,
                params
            );
            const total = Number(countRows[0]?.total ?? 0);
            return ok({ data: rows, pagination: buildPagination(total, pageNumber, limitNumber) });
        } catch (error) {
            logger.error("Error listing delegate pass registrations:", error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async getById(id: string): Promise<Result<DelegatePassRegistrationRow, RequestError>> {
        try {
            const [rows] = await db.execute<DelegatePassRegistrationRow[]>(
                `SELECT * FROM ${DELEGATE_PASS_REGISTRATIONS_TABLE} WHERE id = ?`,
                [id]
            );
            if (!rows[0]) return err(ERRORS.DELEGATE_PASS_NOT_FOUND);
            return ok(rows[0]);
        } catch (error) {
            logger.error("Error fetching delegate pass registration:", error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    /**
     * Admin-driven payment status change. The Razorpay flow will set the same
     * columns from a verified webhook/callback rather than through this method.
     */
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
                `UPDATE ${DELEGATE_PASS_REGISTRATIONS_TABLE}
                 SET payment_status = ?,
                     admin_note = ?,
                     paid_at = CASE WHEN ? = 'paid' AND paid_at IS NULL THEN NOW() ELSE paid_at END,
                     reviewed_at = NOW(),
                     reviewed_by_admin_id = ?
                 WHERE id = ?`,
                [paymentStatus, adminNote ?? null, paymentStatus, adminId, id]
            );
            if (result.affectedRows === 0) return err(ERRORS.DELEGATE_PASS_NOT_FOUND);
            return ok(true);
        } catch (error) {
            logger.error("Error updating delegate pass payment status:", error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    /** Records the order opened for this registration, overwriting any prior. */
    async attachRazorpayOrder(id: string, orderId: string): Promise<Result<true, RequestError>> {
        try {
            const [result] = await db.execute<ResultSetHeader>(
                `UPDATE ${DELEGATE_PASS_REGISTRATIONS_TABLE}
                 SET razorpay_order_id = ?
                 WHERE id = ? AND payment_status <> 'paid'`,
                [orderId, id]
            );
            if (result.affectedRows === 0) return err(ERRORS.PAYMENT_ALREADY_COMPLETED);
            return ok(true);
        } catch (error) {
            logger.error("Error attaching razorpay order to delegate pass:", error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    /**
     * Marks paid from a verified Checkout callback. The order id must match the
     * one this registration opened; the signature is verified before this runs.
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
                `UPDATE ${DELEGATE_PASS_REGISTRATIONS_TABLE}
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
            logger.error("Error marking delegate pass paid:", error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }


    /**
     * Settles a gateway-captured payment we never recorded. No Checkout
     * callback arrived, so there is no signature to store; the reviewer and
     * admin note are what mark this route apart from a verified callback.
     */
    async markPaidFromGateway(
        id: string,
        payment: { orderId: string; paymentId: string },
        /** Null when a webhook settled it, since no human reviewed it. The
         *  column is a foreign key to users, so a sentinel id would not hold. */
        adminId: number | null
    ): Promise<Result<true, RequestError>> {
        const existing = await this.getById(id);
        if (existing.isErr()) return err(existing.error);
        // A refunded row still has a captured payment at the gateway, so
        // "not paid" would let a refund be flipped back to paid.
        if (!SETTLEABLE_STATUSES.includes(existing.value.payment_status)) {
            return err(ERRORS.PAYMENT_ALREADY_COMPLETED);
        }
        // Not compared against the stored column: the order id comes from a
        // gateway lookup keyed on this registration's receipt. The row is
        // corrected to the order that holds the money.

        try {
            const [result] = await db.execute<ResultSetHeader>(
                `UPDATE ${DELEGATE_PASS_REGISTRATIONS_TABLE}
                 SET payment_status = 'paid',
                     razorpay_order_id = ?,
                     razorpay_payment_id = ?,
                     paid_at = COALESCE(paid_at, NOW()),
                     reviewed_at = NOW(),
                     reviewed_by_admin_id = ?,
                     admin_note = TRIM(CONCAT(COALESCE(admin_note, ''), ' [settled from gateway reconciliation]'))
                 WHERE id = ? AND payment_status IN ('pending', 'failed')`,
                [payment.orderId, payment.paymentId, adminId, id]
            );
            if (result.affectedRows === 0) return err(ERRORS.PAYMENT_ALREADY_COMPLETED);
            return ok(true);
        } catch (error) {
            logger.error("Error settling payment from gateway:", error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async countByPaymentStatus(
        paymentStatus: PaymentStatus
    ): Promise<Result<{ count: number; amount: number }, RequestError>> {
        try {
            const [rows] = await db.execute<Array<{ total: number; amount: number } & RowDataPacket>>(
                `SELECT COUNT(*) AS total, COALESCE(SUM(total_amount), 0) AS amount
                 FROM ${DELEGATE_PASS_REGISTRATIONS_TABLE} WHERE payment_status = ?`,
                [paymentStatus]
            );
            return ok({ count: Number(rows[0]?.total ?? 0), amount: Number(rows[0]?.amount ?? 0) });
        } catch (error) {
            logger.error("Error counting delegate pass registrations:", error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }
}

export const delegatePassRepository = new DelegatePassRepository();
