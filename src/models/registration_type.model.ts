/**
 * The one definition of which thing a payment, refund or query belongs to.
 * Everything else - GraphQL enum, repository guard, webhook notes - resolves
 * back to this.
 */
export const REGISTRATION_TYPE = {
    DELEGATE_PASS: "delegate_pass",
    NOMINATION: "nomination",
} as const;

export type RegistrationType = (typeof REGISTRATION_TYPE)[keyof typeof REGISTRATION_TYPE];

export const REGISTRATION_TYPES: RegistrationType[] = Object.values(REGISTRATION_TYPE);

export function isRegistrationType(value: unknown): value is RegistrationType {
    return typeof value === "string" && REGISTRATION_TYPES.includes(value as RegistrationType);
}
