import type { RowDataPacket } from "mysql2";

export const DELEGATE_PASS_REGISTRATIONS_TABLE = "delegate_pass_registrations";

export const CREATE_DELEGATE_PASS_REGISTRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS delegate_pass_registrations (
    id VARCHAR(255) PRIMARY KEY,
    full_name VARCHAR(255) NOT NULL,
    designation VARCHAR(255) NOT NULL,
    organisation VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    normalized_email VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    normalized_phone VARCHAR(20) NOT NULL,
    pass_name VARCHAR(255) NOT NULL,
    audience VARCHAR(255) NOT NULL,
    quantity INT NOT NULL DEFAULT 1,
    unit_amount BIGINT NOT NULL,
    total_amount BIGINT NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    gst_number VARCHAR(50),
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
    UNIQUE KEY unique_delegate_razorpay_order (razorpay_order_id),
    UNIQUE KEY unique_delegate_razorpay_payment (razorpay_payment_id),
    INDEX idx_delegate_payment_status (payment_status),
    INDEX idx_delegate_created_at (created_at),
    INDEX idx_delegate_normalized_email (normalized_email),
    CONSTRAINT fk_delegate_reviewer FOREIGN KEY (reviewed_by_admin_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB
`;

/**
 * Money state of a registration. Distinct from the review status used by the
 * hackathon tables: a registration is never "accepted", it is paid for or not.
 */
export type PaymentStatus = "pending" | "paid" | "failed" | "refunded";

export interface DelegatePassRegistrationRow extends RowDataPacket {
    id: string;
    full_name: string;
    designation: string;
    organisation: string;
    email: string;
    normalized_email: string;
    phone: string;
    normalized_phone: string;
    pass_name: string;
    audience: string;
    quantity: number;
    unit_amount: number;
    total_amount: number;
    currency: string;
    gst_number: string | null;
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

export type CreateDelegatePassInput = {
    fullName: string;
    designation: string;
    organisation: string;
    email: string;
    phone: string;
    passName: string;
    audience: string;
    quantity: number;
    unitAmount: number;
    gstNumber?: string | null;
    contactConsent: boolean;
};
