import type { RowDataPacket } from "mysql2";
import type { PaymentStatus } from "./delegate_pass.model";

export const NOMINATION_REGISTRATIONS_TABLE = "nomination_registrations";

export const CREATE_NOMINATION_REGISTRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS nomination_registrations (
    id VARCHAR(255) PRIMARY KEY,
    nominee_name VARCHAR(255) NOT NULL,
    organisation VARCHAR(255) NOT NULL,
    designation VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    normalized_email VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    normalized_phone VARCHAR(20) NOT NULL,
    website VARCHAR(500),
    achievements TEXT NOT NULL,
    plan_name VARCHAR(255) NOT NULL,
    base_amount BIGINT NOT NULL,
    gst_rate_bps INT NOT NULL DEFAULT 1800,
    gst_amount BIGINT NOT NULL DEFAULT 0,
    total_amount BIGINT NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    contact_consent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    payment_status ENUM('pending', 'paid', 'failed', 'refunded') NOT NULL DEFAULT 'pending',
    razorpay_order_id VARCHAR(255),
    razorpay_payment_id VARCHAR(255),
    razorpay_signature VARCHAR(255),
    paid_at TIMESTAMP NULL,
    admin_note TEXT,
    reviewed_at TIMESTAMP NULL,
    reviewed_by_admin_id INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_nomination_razorpay_order (razorpay_order_id),
    UNIQUE KEY unique_nomination_razorpay_payment (razorpay_payment_id),
    INDEX idx_nomination_payment_status (payment_status),
    INDEX idx_nomination_created_at (created_at),
    INDEX idx_nomination_normalized_email (normalized_email),
    CONSTRAINT fk_nomination_reviewer FOREIGN KEY (reviewed_by_admin_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB
`;

export interface NominationRegistrationRow extends RowDataPacket {
    id: string;
    nominee_name: string;
    organisation: string;
    designation: string;
    email: string;
    normalized_email: string;
    phone: string;
    normalized_phone: string;
    website: string | null;
    achievements: string;
    plan_name: string;
    /** Listed plan price, exclusive of GST. */
    base_amount: number;
    gst_rate_bps: number;
    gst_amount: number;
    /** base_amount + gst_amount. This is what is charged. */
    total_amount: number;
    currency: string;
    contact_consent_at: Date;
    payment_status: PaymentStatus;
    razorpay_order_id: string | null;
    razorpay_payment_id: string | null;
    razorpay_signature: string | null;
    paid_at: Date | null;
    admin_note: string | null;
    reviewed_at: Date | null;
    reviewed_by_admin_id: number | null;
    created_at: Date;
    updated_at: Date;
}

export type CreateNominationInput = {
    nomineeName: string;
    organisation: string;
    designation: string;
    email: string;
    phone: string;
    website?: string | null;
    achievements: string;
    /** Must match a plan in config/pricing; the price is looked up there. */
    planName: string;
    contactConsent: boolean;
};
