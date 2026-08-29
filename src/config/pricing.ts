import { NODE_ENV, PAYMENT_TEST_AMOUNT_PAISE } from "./env";

/**
 * Authoritative price list. Registration supplies a name; the price is looked
 * up here and never taken from the request.
 *
 * Amounts are paise, exclusive of GST.
 */

export type DelegatePass = {
    name: string;
    audience: string;
    unitAmount: number;
};

export type NominationPlan = {
    name: string;
    baseAmount: number;
};

export const DELEGATE_PASSES: DelegatePass[] = [
    { name: "Startup Pass", audience: "Startups", unitAmount: 149900 },
    { name: "Professional Pass", audience: "Professionals", unitAmount: 299900 },
    { name: "Delegate Pass", audience: "Delegates", unitAmount: 750000 },
    { name: "Executive Pass", audience: "Executives", unitAmount: 1499900 },
    { name: "VIP Pass", audience: "VIP", unitAmount: 2499900 },
];

export const NOMINATION_PLANS: NominationPlan[] = [
    { name: "Standard Nomination", baseAmount: 999900 },
    { name: "Premium Nomination", baseAmount: 1999900 },
    { name: "Platinum Nomination", baseAmount: 3499900 },
];

/** Allow-list, not a production check: an unset or unrecognised NODE_ENV must
 *  fail closed to real prices. */
const ENVIRONMENTS_ALLOWING_TEST_PRICING = ["development", "test"];

/** Returns the override price, or null unless NODE_ENV is allow-listed and
 *  PAYMENT_TEST_AMOUNT_PAISE is a positive integer. */
function testAmountOverride(): number | null {
    if (!ENVIRONMENTS_ALLOWING_TEST_PRICING.includes(String(NODE_ENV))) return null;
    const override = Number(PAYMENT_TEST_AMOUNT_PAISE);
    if (!Number.isInteger(override) || override <= 0) return null;
    return override;
}

export function isTestPricingActive(): boolean {
    return testAmountOverride() !== null;
}

export function findDelegatePass(name: string): DelegatePass | null {
    const pass = DELEGATE_PASSES.find((item) => item.name === name?.trim());
    if (!pass) return null;

    const override = testAmountOverride();
    return override === null ? pass : { ...pass, unitAmount: override };
}

export function findNominationPlan(name: string): NominationPlan | null {
    const plan = NOMINATION_PLANS.find((item) => item.name === name?.trim());
    if (!plan) return null;

    const override = testAmountOverride();
    return override === null ? plan : { ...plan, baseAmount: override };
}
