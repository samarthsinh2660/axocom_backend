export function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

export function normalizePhone(phone: string | null | undefined): string | null {
    if (phone == null) return null;

    const digits = String(phone).trim().replace(/\D/g, "");
    if (!digits) return null;

    return digits.length >= 10 ? digits.slice(-10) : digits;
}

export function isValidNormalizedPhone(normalizedPhone: string | null): normalizedPhone is string {
    return normalizedPhone != null && /^\d{10}$/.test(normalizedPhone);
}