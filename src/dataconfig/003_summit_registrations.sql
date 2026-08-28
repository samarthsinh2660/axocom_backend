-- Devbhoomi AI Summit paid registrations (delegate passes + award nominations)
-- and the refund request ticket system.
--
-- Amounts are stored in the smallest currency unit (paise for INR), matching
-- Razorpay's convention, so no floating point rounding is possible.
--
-- The razorpay_* columns are written by the payment flow. They are nullable and
-- unique: NULL until an order is created, and unique afterwards so a replayed
-- gateway callback cannot record the same payment twice.

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
) ENGINE=InnoDB;

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
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS refund_requests (
    id VARCHAR(255) PRIMARY KEY,
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    normalized_email VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    normalized_phone VARCHAR(20) NOT NULL,
    registration_type ENUM('delegate_pass', 'nomination') NOT NULL,
    registration_id VARCHAR(255),
    payment_reference VARCHAR(255),
    reason TEXT NOT NULL,
    status ENUM('open', 'in_review', 'approved', 'rejected', 'refunded') NOT NULL DEFAULT 'open',
    resolved_at TIMESTAMP NULL,
    reviewed_by_admin_id INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_refund_status (status),
    INDEX idx_refund_created_at (created_at),
    INDEX idx_refund_normalized_email (normalized_email),
    INDEX idx_refund_registration (registration_type, registration_id),
    CONSTRAINT fk_refund_reviewer FOREIGN KEY (reviewed_by_admin_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

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
) ENGINE=InnoDB;
