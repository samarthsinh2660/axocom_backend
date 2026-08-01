import type { RowDataPacket } from "mysql2";
import type { ReviewStatus } from "./solution.model";

export const MENTOR_APPLICATIONS_TABLE = "mentor_applications";

export const CREATE_MENTOR_APPLICATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS mentor_applications (
    id VARCHAR(255) PRIMARY KEY,
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    normalized_email VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    normalized_phone VARCHAR(20) NOT NULL,
    current_role VARCHAR(255) NOT NULL,
    organisation VARCHAR(255),
    expertise TEXT NOT NULL,
    experience_summary TEXT NOT NULL,
    motivation TEXT NOT NULL,
    profile_url TEXT,
    contact_consent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status ENUM('pending', 'accepted', 'rejected') NOT NULL DEFAULT 'pending',
    admin_note TEXT,
    reviewed_at TIMESTAMP NULL,
    reviewed_by_admin_id INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_mentor_normalized_email (normalized_email),
    UNIQUE KEY unique_mentor_normalized_phone (normalized_phone),
    INDEX idx_mentor_status (status),
    INDEX idx_mentor_created_at (created_at),
    CONSTRAINT fk_mentor_reviewer FOREIGN KEY (reviewed_by_admin_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB
`;

export interface MentorApplicationRow extends RowDataPacket {
    id: string;
    full_name: string;
    email: string;
    normalized_email: string;
    phone: string;
    normalized_phone: string;
    current_role: string;
    organisation: string | null;
    expertise: string;
    experience_summary: string;
    motivation: string;
    profile_url: string | null;
    contact_consent_at: Date;
    status: ReviewStatus;
    admin_note: string | null;
    reviewed_at: Date | null;
    reviewed_by_admin_id: number | null;
    created_at: Date;
    updated_at: Date;
}

export type PublicMentor = Pick<
    MentorApplicationRow,
    | "id"
    | "full_name"
    | "current_role"
    | "organisation"
    | "expertise"
    | "experience_summary"
    | "motivation"
    | "profile_url"
    | "created_at"
    | "status"
>;

export type CreateMentorInput = {
    fullName: string;
    email: string;
    phone: string;
    currentRole: string;
    organisation?: string | null;
    expertise: string | string[];
    experienceSummary: string;
    motivation: string;
    profileUrl?: string | null;
    contactConsent: boolean;
};