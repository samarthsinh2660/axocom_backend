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
    unit_gst_amount BIGINT NOT NULL DEFAULT 0,
    subtotal_amount BIGINT NOT NULL,
    gst_rate_bps INT NOT NULL DEFAULT 1800,
    gst_amount BIGINT NOT NULL DEFAULT 0,
    total_amount BIGINT NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    gst_number VARCHAR(50),
    startup_details TEXT,
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

/** Money state of a registration, distinct from the hackathon review status. */
export const PAYMENT_STATUS = {
    PENDING: "pending",
    PAID: "paid",
    FAILED: "failed",
    REFUNDED: "refunded",
} as const;

export type PaymentStatus = (typeof PAYMENT_STATUS)[keyof typeof PAYMENT_STATUS];

export const PAYMENT_STATUSES: PaymentStatus[] = Object.values(PAYMENT_STATUS);

/** Only a registration with no money recorded against it can be settled. */
export const SETTLEABLE_PAYMENT_STATUSES: PaymentStatus[] = [
    PAYMENT_STATUS.PENDING,
    PAYMENT_STATUS.FAILED,
];

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
    /** Per pass, exclusive of GST. */
    unit_amount: number;
    /** GST on one pass. */
    unit_gst_amount: number;
    /** unit_amount x quantity, exclusive of GST. */
    subtotal_amount: number;
    gst_rate_bps: number;
    /** unit_gst_amount x quantity. */
    gst_amount: number;
    /** subtotal_amount + gst_amount. This is what is charged. */
    total_amount: number;
    currency: string;
    gst_number: string | null;
    /** Required for passes that declare it in config/pricing. */
    startup_details: string | null;
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
    /** Must match a pass in config/pricing; the price is looked up there. */
    passName: string;
    quantity: number;
    gstNumber?: string | null;
    startupDetails?: string | null;
    contactConsent: boolean;
};
