import type { RowDataPacket } from "mysql2";

export const REFUND_REQUESTS_TABLE = "refund_requests";
export const REFUND_REQUEST_MESSAGES_TABLE = "refund_request_messages";

export const CREATE_REFUND_REQUESTS_TABLE = `
CREATE TABLE IF NOT EXISTS refund_requests (
    id VARCHAR(255) PRIMARY KEY,
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    normalized_email VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    normalized_phone VARCHAR(20) NOT NULL,
    request_type ENUM('refund', 'payment_not_reflected', 'other') NOT NULL DEFAULT 'refund',
    registration_type ENUM('delegate_pass', 'nomination') NOT NULL,
    registration_id VARCHAR(255),
    payment_reference VARCHAR(255),
    reason TEXT NOT NULL,
    status ENUM('open', 'in_review', 'approved', 'rejected', 'refunded', 'resolved') NOT NULL DEFAULT 'open',
    resolved_at TIMESTAMP NULL,
    reviewed_by_admin_id INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_refund_status (status),
    INDEX idx_refund_request_type (request_type),
    INDEX idx_refund_created_at (created_at),
    INDEX idx_refund_normalized_email (normalized_email),
    INDEX idx_refund_registration (registration_type, registration_id),
    CONSTRAINT fk_refund_reviewer FOREIGN KEY (reviewed_by_admin_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB
`;

export const CREATE_REFUND_REQUEST_MESSAGES_TABLE = `
CREATE TABLE IF NOT EXISTS refund_request_messages (
    id VARCHAR(255) PRIMARY KEY,
    refund_request_id VARCHAR(255) NOT NULL,
    author ENUM('user', 'admin') NOT NULL,
    author_admin_id INT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_refund_message_request (refund_request_id, created_at),
    CONSTRAINT fk_refund_message_request FOREIGN KEY (refund_request_id) REFERENCES refund_requests(id) ON DELETE CASCADE,
    CONSTRAINT fk_refund_message_admin FOREIGN KEY (author_admin_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB
`;

export const REFUND_STATUS = {
    OPEN: "open",
    IN_REVIEW: "in_review",
    APPROVED: "approved",
    REJECTED: "rejected",
    REFUNDED: "refunded",
    RESOLVED: "resolved",
} as const;

export type RefundStatus = (typeof REFUND_STATUS)[keyof typeof REFUND_STATUS];

/** What the request is about. Only the closing status differs between them. */
export const SUPPORT_REQUEST_TYPE = {
    REFUND: "refund",
    PAYMENT_NOT_REFLECTED: "payment_not_reflected",
    OTHER: "other",
} as const;

export type SupportRequestType =
    (typeof SUPPORT_REQUEST_TYPE)[keyof typeof SUPPORT_REQUEST_TYPE];

export const SUPPORT_REQUEST_TYPES: SupportRequestType[] = Object.values(SUPPORT_REQUEST_TYPE);
import type { RegistrationType } from "../utils/registration_type";

/** Alias kept so refund code reads in its own terms; one definition underneath. */
export type RefundRegistrationType = RegistrationType;
export const REFUND_MESSAGE_AUTHOR = { USER: "user", ADMIN: "admin" } as const;

export type RefundMessageAuthor =
    (typeof REFUND_MESSAGE_AUTHOR)[keyof typeof REFUND_MESSAGE_AUTHOR];

export const REFUND_STATUSES: RefundStatus[] = Object.values(REFUND_STATUS);

/** Statuses that close a ticket and stamp resolved_at. */
export const CLOSING_REFUND_STATUSES: RefundStatus[] = [
    REFUND_STATUS.APPROVED,
    REFUND_STATUS.REJECTED,
    REFUND_STATUS.REFUNDED,
    REFUND_STATUS.RESOLVED,
];

export interface RefundRequestRow extends RowDataPacket {
    id: string;
    request_type: SupportRequestType;
    full_name: string;
    email: string;
    normalized_email: string;
    phone: string;
    normalized_phone: string;
    registration_type: RefundRegistrationType;
    registration_id: string | null;
    payment_reference: string | null;
    reason: string;
    status: RefundStatus;
    resolved_at: Date | null;
    reviewed_by_admin_id: number | null;
    created_at: Date;
    updated_at: Date;
}

export interface RefundRequestMessageRow extends RowDataPacket {
    id: string;
    refund_request_id: string;
    author: RefundMessageAuthor;
    author_admin_id: number | null;
    message: string;
    created_at: Date;
}

export type CreateRefundRequestInput = {
    fullName: string;
    email: string;
    phone: string;
    requestType?: SupportRequestType | null;
    registrationType: RefundRegistrationType;
    /**
     * Required by the repository, but typed optional because the GraphQL input
     * accepts its absence in order to return a usable error rather than a
     * validation failure to an older client.
     */
    registrationId?: string | null;
    paymentReference?: string | null;
    reason: string;
};
