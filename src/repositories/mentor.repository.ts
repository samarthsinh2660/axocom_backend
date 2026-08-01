import { randomBytes } from "node:crypto";
import { err, ok, type Result } from "neverthrow";
import { db } from "../dataconfig/db";
import {
    MENTOR_APPLICATIONS_TABLE,
    type CreateMentorInput,
    type MentorApplicationRow,
    type PublicMentor,
} from "../models/mentor.model";
import type { Pagination, ReviewStatus } from "../models/solution.model";
import { ERRORS, RequestError, isDuplicateKeyError } from "../utils/error";
import createLogger from "../utils/logger";
import { normalizeEmail, normalizePhone, isValidNormalizedPhone } from "../utils/normalize";

const logger = createLogger("@mentor.repository");

export type Paginated<T> = { data: T[]; pagination: Pagination };

function clampPage(page: number, limit: number) {
    const pageNumber = Math.max(1, page || 1);
    const limitNumber = Math.min(100, Math.max(1, limit || 20));
    return { pageNumber, limitNumber, offset: (pageNumber - 1) * limitNumber };
}

function createApplicationId(): string {
    return `men_${randomBytes(9).toString("base64url")}`;
}

class MentorRepository {
    async create(input: CreateMentorInput): Promise<Result<{ submissionId: string; status: string }, RequestError>> {
        if (
            !input.fullName
            || !input.email
            || !input.phone
            || !input.currentRole
            || !input.expertise
            || !input.experienceSummary
            || !input.motivation
            || input.contactConsent !== true
        ) {
            return err(ERRORS.INVALID_REQUEST_BODY);
        }

        if (input.profileUrl && !input.profileUrl.startsWith("https://")) {
            return err(new RequestError("Profile URL must be a valid HTTPS URL", 10002, 400));
        }

        const normalizedEmail = normalizeEmail(input.email);
        const normalizedPhone = normalizePhone(input.phone);
        if (!isValidNormalizedPhone(normalizedPhone)) {
            return err(new RequestError("A valid 10-digit mobile number is required", 10002, 400));
        }

        const applicationId = createApplicationId();
        const expertise = Array.isArray(input.expertise) ? input.expertise.join(", ") : input.expertise;

        try {
            await db.execute(
                `INSERT INTO ${MENTOR_APPLICATIONS_TABLE}
                (id, full_name, email, normalized_email, phone, normalized_phone, current_role, organisation, expertise, experience_summary, motivation, profile_url, contact_consent_at, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'pending')`,
                [
                    applicationId,
                    input.fullName,
                    input.email.trim(),
                    normalizedEmail,
                    input.phone.trim(),
                    normalizedPhone,
                    input.currentRole,
                    input.organisation || null,
                    expertise,
                    input.experienceSummary,
                    input.motivation,
                    input.profileUrl || null,
                ]
            );
            return ok({ submissionId: applicationId, status: "received" });
        } catch (error) {
            if (isDuplicateKeyError(error)) return err(ERRORS.DUPLICATE_SUBMISSION);
            logger.error("Error creating mentor application:", error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async listPublic(options: {
        page?: number;
        limit?: number;
    }): Promise<Result<Paginated<PublicMentor>, RequestError>> {
        const { pageNumber, limitNumber, offset } = clampPage(options.page ?? 1, options.limit ?? 50);

        try {
            const [rows] = await db.execute<MentorApplicationRow[]>(
                `SELECT id, full_name, current_role, organisation, expertise, experience_summary, motivation, profile_url, created_at, status
                 FROM ${MENTOR_APPLICATIONS_TABLE}
                 WHERE status = 'accepted'
                 ORDER BY created_at DESC
                 LIMIT ${limitNumber} OFFSET ${offset}`
            );
            const [countRows] = await db.execute<Array<{ total: number } & import("mysql2").RowDataPacket>>(
                `SELECT COUNT(*) AS total FROM ${MENTOR_APPLICATIONS_TABLE} WHERE status = 'accepted'`
            );
            const total = Number(countRows[0]?.total ?? 0);
            return ok({
                data: rows as PublicMentor[],
                pagination: {
                    total,
                    page: pageNumber,
                    limit: limitNumber,
                    totalPages: Math.ceil(total / limitNumber) || 1,
                },
            });
        } catch (error) {
            logger.error("Error listing public mentors:", error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async listAdmin(options: {
        status?: string | null;
        search?: string | null;
        page?: number;
        limit?: number;
    }): Promise<Result<Paginated<MentorApplicationRow>, RequestError>> {
        const { pageNumber, limitNumber, offset } = clampPage(options.page ?? 1, options.limit ?? 20);
        let where = "WHERE 1=1";
        const params: Array<string | number> = [];

        if (options.status) {
            where += " AND status = ?";
            params.push(options.status);
        }
        if (options.search) {
            where += " AND (full_name LIKE ? OR email LIKE ? OR phone LIKE ? OR current_role LIKE ? OR organisation LIKE ?)";
            const search = `%${options.search}%`;
            params.push(search, search, search, search, search);
        }

        try {
            const [rows] = await db.execute<MentorApplicationRow[]>(
                `SELECT * FROM ${MENTOR_APPLICATIONS_TABLE} ${where} ORDER BY created_at DESC LIMIT ${limitNumber} OFFSET ${offset}`,
                params
            );
            const [countRows] = await db.execute<Array<{ total: number } & import("mysql2").RowDataPacket>>(
                `SELECT COUNT(*) AS total FROM ${MENTOR_APPLICATIONS_TABLE} ${where}`,
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
            logger.error("Error listing mentor applications:", error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async getById(id: string): Promise<Result<MentorApplicationRow, RequestError>> {
        try {
            const [rows] = await db.execute<MentorApplicationRow[]>(
                `SELECT * FROM ${MENTOR_APPLICATIONS_TABLE} WHERE id = ?`,
                [id]
            );
            if (!rows[0]) return err(ERRORS.MENTOR_NOT_FOUND);
            return ok(rows[0]);
        } catch (error) {
            logger.error("Error fetching mentor application:", error);
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
                `UPDATE ${MENTOR_APPLICATIONS_TABLE}
                 SET status = ?, admin_note = ?, reviewed_at = NOW(), reviewed_by_admin_id = ?
                 WHERE id = ?`,
                [status, adminNote ?? null, adminId, id]
            );
            if (result.affectedRows === 0) return err(ERRORS.MENTOR_NOT_FOUND);
            return ok(true);
        } catch (error) {
            logger.error("Error updating mentor status:", error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }

    async countAccepted(): Promise<Result<number, RequestError>> {
        try {
            const [rows] = await db.execute<Array<{ total: number } & import("mysql2").RowDataPacket>>(
                `SELECT COUNT(*) AS total FROM ${MENTOR_APPLICATIONS_TABLE} WHERE status = 'accepted'`
            );
            return ok(Number(rows[0]?.total ?? 0));
        } catch (error) {
            logger.error("Error counting accepted mentors:", error);
            return err(ERRORS.DATABASE_ERROR);
        }
    }
}

export const mentorRepository = new MentorRepository();