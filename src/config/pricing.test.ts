import { describe, expect, it, jest } from "@jest/globals";

// Pinned explicitly so the suite never depends on the developer's own .env -
// a local PAYMENT_TEST_AMOUNT_PAISE would otherwise rewrite every price here.
jest.mock("./env", () => ({
    NODE_ENV: "test",
    PAYMENT_TEST_AMOUNT_PAISE: undefined,
}));

const {
    DELEGATE_PASSES,
    NOMINATION_PLANS,
    findDelegatePass,
    findNominationPlan,
} = require("./pricing");

/**
 * These are the prices shown on the public pages. They are pinned here because
 * this list is what customers are actually charged - an accidental edit would
 * silently over- or under-charge, and nothing else in the system would notice.
 *
 * If a price genuinely changes, change it here deliberately.
 */
const PUBLISHED_PASS_PRICES: Record<string, number> = {
    "Startup Pass": 149900,
    "Professional Pass": 299900,
    "Delegate Pass": 750000,
    "Executive Pass": 1499900,
    "VIP Pass": 2499900,
};

const PUBLISHED_PLAN_PRICES: Record<string, number> = {
    "Standard Nomination": 999900,
    "Premium Nomination": 1999900,
    "Platinum Nomination": 3499900,
};

describe("delegate pass pricing", () => {
    it("matches the prices published on the delegate pass page", () => {
        const actual = Object.fromEntries(DELEGATE_PASSES.map((p) => [p.name, p.unitAmount]));
        expect(actual).toEqual(PUBLISHED_PASS_PRICES);
    });

    it("looks a pass up by its exact name", () => {
        expect(findDelegatePass("VIP Pass")?.unitAmount).toBe(2499900);
        expect(findDelegatePass("  VIP Pass  ")?.unitAmount).toBe(2499900);
    });

    it("returns null for a name that is not on the list", () => {
        for (const name of ["Free Pass", "vip pass", "VIP", ""]) {
            expect(findDelegatePass(name)).toBeNull();
        }
    });

    it("carries the audience so it is not taken from the request either", () => {
        expect(findDelegatePass("VIP Pass")?.audience).toBe("VIP");
    });
});

describe("nomination pricing", () => {
    it("matches the prices published on the nomination page", () => {
        const actual = Object.fromEntries(NOMINATION_PLANS.map((p) => [p.name, p.baseAmount]));
        expect(actual).toEqual(PUBLISHED_PLAN_PRICES);
    });

    it("returns null for a plan that is not on the list", () => {
        expect(findNominationPlan("Free Nomination")).toBeNull();
    });
});

describe("test pricing override", () => {
    it("is inactive when unset, so the real prices apply", () => {
        expect(findDelegatePass("VIP Pass")?.unitAmount).toBe(2499900);
        expect(findNominationPlan("Platinum Nomination")?.baseAmount).toBe(3499900);
    });
});
