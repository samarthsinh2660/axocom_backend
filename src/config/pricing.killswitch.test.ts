import { describe, expect, it, jest } from "@jest/globals";

/**
 * The override must fail CLOSED. `npm start` runs a bare `node dist/index.js`
 * and sets no NODE_ENV, so an unset or unexpected value must mean real prices.
 */
function pricingFor(nodeEnv: unknown) {
    jest.resetModules();
    jest.doMock("./env", () => ({
        NODE_ENV: nodeEnv,
        PAYMENT_TEST_AMOUNT_PAISE: "100",
    }));
    return require("./pricing");
}

describe("test pricing kill switch", () => {
    it.each([undefined, "", "production", "PRODUCTION", "prod", "staging", "Development", "live"])(
        "refuses to collapse prices when NODE_ENV is %p",
        (nodeEnv) => {
            const { findDelegatePass, isTestPricingActive } = pricingFor(nodeEnv);
            expect(isTestPricingActive()).toBe(false);
            expect(findDelegatePass("VIP Pass").unitAmount).toBe(2499900);
        }
    );

    it.each(["development", "test"])("allows the override in %p", (nodeEnv) => {
        const { findDelegatePass, isTestPricingActive } = pricingFor(nodeEnv);
        expect(isTestPricingActive()).toBe(true);
        expect(findDelegatePass("VIP Pass").unitAmount).toBe(100);
    });
});
