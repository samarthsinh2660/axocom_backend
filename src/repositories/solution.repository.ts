import { randomBytes } from "node:crypto";
import { err, ok, type Result } from "neverthrow";
import { db } from "../dataconfig/db";
import {
    SOLUTION_SUBMISSIONS_TABLE,
    type CreateSolutionInput,
    type Pagination,
    type PublicSolution,
    type ReviewStatus,
    type SolutionSubmissionRow,
} from "../models/solution.model";
import { ERRORS, RequestError, isDuplicateKeyError } from "../utils/error";
import createLogger from "../utils/logger";
import { isValidNormalizedPhone, normalizeEmail, normalizePhone } from "../utils/normalize";

const logger = createLogger("@solution.repository");

export type Paginated<T> = { data: T[]; pagination: Pagination };

function clampPage(page: number, limit: number) {
    const pageNumber = Math.max(1, page || 1);
    const limitNumber = Math.min(100, Math.max(1, limit || 20));
    return { pageNumber, limitNumber, offset: (pageNumber - 1) * limitNumber };
}

class SolutionRepository {
    async create(input: CreateSolutionInput): Promise<Result<{ submissionId: string; status: string }, RequestError>> {
        if (
            !input.fullName
            || !input.email
            || !input.phone
            || !input.problemCode
            || !input.solutionTitle
            || !input.solutionDescription
            || input.contactConsent !== true
        ) {
            return err(ERRORS.INVALID_REQUEST_BODY);
        }

        const problemCode = input.problemCode.trim();
        if (!problemCode || problemCode.length > 100) return err(ERRORS.INVALID_REQUEST_BODY);

        if (input.prototypeUrl && !input.prototypeUrl.startsWith("https://")) {
            return err(new RequestError("Prototype URL must be a valid HTTPS URL", 10002, 400));
        }

        const normalizedEmail = normalizeEmail(input.email);
        const normalizedPhone = normalizePhone(input.phone);
        if (!isValidNormalizedPhone(normalizedPhone)) {
            return err(new RequestError("A valid 10-digit mobile number is required", 10002, 400));
        }

        const submissionId = `sub_${randomBytes(9).toString("base64url")}`;

        try {
            await db.execute(
                `INSERT INTO ${SOLUTION_SUBMISSIONS_TABLE}
                (id, full_name, email, normalized_email, phone, normalized_phone, problem_code, solution_title, solution_description, prototype_url, contact_consent_at, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'pending')`,
                [
                    submissionId,
                    input.fullName,
                    input.email.trim(),
                    normalizedEmail,
                    input.phone.trim(),
                    normalizedPhone,
                    problemCode,
                    input.solutionTitle,
                    input.solutionDescription,
                    input.prototypeUrl || null,
                ]
            );
            return ok({ submissionId, status: "received" });
        } catch (error) {
            if (isDuplicateKeyError(error)) return err(ERRORS.DUPLICATE_SUBMISSION);
            logger.error("Error creating solution submission:", error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async listPublic(options: {
        problemCode?: string | null;
        page?: number;
        limit?: number;
    }): Promise<Result<Paginated<PublicSolution>, RequestError>> {
        const { pageNumber, limitNumber, offset } = clampPage(options.page ?? 1, options.limit ?? 50);
        let where = "WHERE status = 'accepted'";
        const params: Array<string | number> = [];

        if (options.problemCode) {
            where += " AND problem_code = ?";
            params.push(options.problemCode);
        }

        try {
            const [rows] = await db.execute<SolutionSubmissionRow[]>(
                `SELECT id, full_name, problem_code, solution_title, solution_description, prototype_url, created_at, status
                 FROM ${SOLUTION_SUBMISSIONS_TABLE}
                 ${where}
                 ORDER BY created_at DESC
                 LIMIT ${limitNumber} OFFSET ${offset}`,
                params
            );
            const [countRows] = await db.execute<Array<{ total: number } & import("mysql2").RowDataPacket>>(
                `SELECT COUNT(*) AS total FROM ${SOLUTION_SUBMISSIONS_TABLE} ${where}`,
                params
            );
            const total = Number(countRows[0]?.total ?? 0);
            return ok({
                data: rows as PublicSolution[],
                pagination: {
                    total,
                    page: pageNumber,
                    limit: limitNumber,
                    totalPages: Math.ceil(total / limitNumber) || 1,
                },
            });
        } catch (error) {
            logger.error("Error listing public solutions:", error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async listAdmin(options: {
        status?: string | null;
        search?: string | null;
        problemCode?: string | null;
        page?: number;
        limit?: number;
    }): Promise<Result<Paginated<SolutionSubmissionRow>, RequestError>> {
        const { pageNumber, limitNumber, offset } = clampPage(options.page ?? 1, options.limit ?? 20);
        let where = "WHERE 1=1";
        const params: Array<string | number> = [];

        if (options.status) {
            where += " AND status = ?";
            params.push(options.status);
        }
        if (options.problemCode) {
            where += " AND problem_code = ?";
            params.push(options.problemCode);
        }
        if (options.search) {
            where += " AND (full_name LIKE ? OR email LIKE ? OR phone LIKE ? OR solution_title LIKE ?)";
            const search = `%${options.search}%`;
            params.push(search, search, search, search);
        }

        try {
            const [rows] = await db.execute<SolutionSubmissionRow[]>(
                `SELECT * FROM ${SOLUTION_SUBMISSIONS_TABLE} ${where} ORDER BY created_at DESC LIMIT ${limitNumber} OFFSET ${offset}`,
                params
            );
            const [countRows] = await db.execute<Array<{ total: number } & import("mysql2").RowDataPacket>>(
                `SELECT COUNT(*) AS total FROM ${SOLUTION_SUBMISSIONS_TABLE} ${where}`,
                params
            );
            const total = Number(countRows[0]?.total ?? 0);
            return ok({
                data: rows,
                pagination: {
                    total,
                    page: pageNumber,
                    limit: limitNumber,
                    totalPages: Math.ceil(total / limitNumber) || 1,
                },
            });
        } catch (error) {
            logger.error("Error listing solution submissions:", error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async getById(id: string): Promise<Result<SolutionSubmissionRow, RequestError>> {
        try {
            const [rows] = await db.execute<SolutionSubmissionRow[]>(
                `SELECT * FROM ${SOLUTION_SUBMISSIONS_TABLE} WHERE id = ?`,
                [id]
            );
            if (!rows[0]) return err(ERRORS.SOLUTION_NOT_FOUND);
            return ok(rows[0]);
        } catch (error) {
            logger.error("Error fetching solution submission:", error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async updateStatus(
        id: string,
        status: ReviewStatus,
        adminNote: string | null | undefined,
        adminId: number
    ): Promise<Result<true, RequestError>> {
        if (!["pending", "accepted", "rejected"].includes(status)) {
            return err(ERRORS.INVALID_REVIEW_STATUS);
        }

        try {
            const [result] = await db.execute<import("mysql2").ResultSetHeader>(
                `UPDATE ${SOLUTION_SUBMISSIONS_TABLE}
                 SET status = ?, admin_note = ?, reviewed_at = NOW(), reviewed_by_admin_id = ?
                 WHERE id = ?`,
                [status, adminNote ?? null, adminId, id]
            );
            if (result.affectedRows === 0) return err(ERRORS.SOLUTION_NOT_FOUND);
            return ok(true);
        } catch (error) {
            logger.error("Error updating solution status:", error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async countAccepted(): Promise<Result<number, RequestError>> {
        try {
            const [rows] = await db.execute<Array<{ total: number } & import("mysql2").RowDataPacket>>(
                `SELECT COUNT(*) AS total FROM ${SOLUTION_SUBMISSIONS_TABLE} WHERE status = 'accepted'`
            );
            return ok(Number(rows[0]?.total ?? 0));
        } catch (error) {
            logger.error("Error counting accepted solutions:", error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }
}

export const solutionRepository = new SolutionRepository();