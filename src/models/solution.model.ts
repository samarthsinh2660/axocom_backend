import type { RowDataPacket } from "mysql2";

export const SOLUTION_SUBMISSIONS_TABLE = "solution_submissions";

export const CREATE_SOLUTION_SUBMISSIONS_TABLE = `
CREATE TABLE IF NOT EXISTS solution_submissions (
    id VARCHAR(255) PRIMARY KEY,
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    normalized_email VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    normalized_phone VARCHAR(20) NOT NULL,
    problem_code VARCHAR(100) NOT NULL,
    solution_title VARCHAR(255) NOT NULL,
    solution_description TEXT NOT NULL,
    prototype_url TEXT,
    contact_consent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status ENUM('pending', 'accepted', 'rejected') NOT NULL DEFAULT 'pending',
    admin_note TEXT,
    reviewed_at TIMESTAMP NULL,
    reviewed_by_admin_id INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_solution_normalized_email (normalized_email),
    UNIQUE KEY unique_solution_normalized_phone (normalized_phone),
    INDEX idx_solution_status (status),
    INDEX idx_solution_created_at (created_at),
    INDEX idx_solution_problem_code (problem_code),
    CONSTRAINT fk_solution_reviewer FOREIGN KEY (reviewed_by_admin_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB
`;

export type ReviewStatus = "pending" | "accepted" | "rejected";

export interface SolutionSubmissionRow extends RowDataPacket {
    id: string;
    full_name: string;
    email: string;
    normalized_email: string;
    phone: string;
    normalized_phone: string;
    problem_code: string;
    solution_title: string;
    solution_description: string;
    prototype_url: string | null;
    contact_consent_at: Date;
    status: ReviewStatus;
    admin_note: string | null;
    reviewed_at: Date | null;
    reviewed_by_admin_id: number | null;
    created_at: Date;
    updated_at: Date;
}

export type PublicSolution = Pick<
    SolutionSubmissionRow,
    | "id"
    | "full_name"
    | "problem_code"
    | "solution_title"
    | "solution_description"
    | "prototype_url"
    | "created_at"
    | "status"
>;

export type CreateSolutionInput = {
    fullName: string;
    email: string;
    phone: string;
    problemCode: string;
    solutionTitle: string;
    solutionDescription: string;
    prototypeUrl?: string | null;
    contactConsent: boolean;
};

export type Pagination = {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
};