import { NODE_ENV, PAYMENT_TEST_AMOUNT_PAISE } from "./env";

/**
 * The authoritative price list. Registration takes a pass or plan name and the
 * price is looked up here, so the browser never supplies an amount - otherwise
 * a VIP pass could be registered for one rupee and Checkout would faithfully
 * charge it.
 *
 * Prices are in paise and exclude GST.
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

/** Only these environments may collapse prices. Anything else - including an
 * unset NODE_ENV, "prod", "staging" or a typo - is treated as real money. */
const ENVIRONMENTS_ALLOWING_TEST_PRICING = ["development", "test"];

/**
 * Collapses every price to a token amount so a real payment can be driven end
 * to end without moving real money.
 *
 * This is an allow-list rather than a check for production on purpose. The
 * failure mode is charging one rupee for a 24,999 rupee pass, so an unset or
 * unexpected NODE_ENV has to fail closed: `npm start` runs a bare
 * `node dist/index.js` and sets nothing, so blocking only the exact string
 * "production" would leave the switch live on a real deployment that happened
 * to inherit PAYMENT_TEST_AMOUNT_PAISE from a test environment.
 */
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
