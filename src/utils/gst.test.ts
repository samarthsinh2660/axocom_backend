import { describe, expect, it } from "@jest/globals";
import { calculateGst, formatGstRate, DEFAULT_GST_RATE_BPS } from "./gst";

const rupees = (paise: number) => paise / 100;

describe("calculateGst", () => {
    it("adds 18 percent to a single pass", () => {
        const gst = calculateGst(299900, 1);

        expect(gst.unitGstAmount).toBe(53982); // 2999 x 18% = 539.82
        expect(gst.subtotalAmount).toBe(299900);
        expect(gst.gstAmount).toBe(53982);
        expect(gst.totalAmount).toBe(353882); // 3538.82
        expect(rupees(gst.totalAmount)).toBe(3538.82);
    });

    /**
     * The rule that matters: GST is charged on each pass and then multiplied,
     * not applied once to the combined subtotal.
     */
    it("charges GST per unit and multiplies, not on the lumped subtotal", () => {
        const gst = calculateGst(299900, 3);

        expect(gst.unitGstAmount).toBe(53982);
        expect(gst.gstAmount).toBe(53982 * 3);
        expect(gst.subtotalAmount).toBe(299900 * 3);
        expect(gst.totalAmount).toBe((299900 + 53982) * 3);
    });

    it("keeps the total equal to subtotal plus GST for every listed price", () => {
        const listed = [149900, 299900, 750000, 1499900, 2499900, 999900, 1999900, 3499900];
        for (const unitAmount of listed) {
            for (const quantity of [1, 2, 5, 10]) {
                const gst = calculateGst(unitAmount, quantity);
                expect(gst.subtotalAmount + gst.gstAmount).toBe(gst.totalAmount);
                expect(Number.isInteger(gst.totalAmount)).toBe(true);
                expect(Number.isInteger(gst.gstAmount)).toBe(true);
            }
        }
    });

    it("produces whole paise for prices that do not divide evenly", () => {
        // 1499 x 18% = 269.82 exactly; 7500 x 18% = 1350 exactly
        expect(calculateGst(149900, 1).unitGstAmount).toBe(26982);
        expect(calculateGst(750000, 1).unitGstAmount).toBe(135000);
    });

    it("rounds a fractional paisa to the nearest whole paisa", () => {
        // 1 paisa at 18% is 0.18 paise, which must not stay fractional
        const gst = calculateGst(1, 1);
        expect(Number.isInteger(gst.unitGstAmount)).toBe(true);
        expect(gst.unitGstAmount).toBe(0);
    });

    it("records the rate that was applied", () => {
        expect(calculateGst(299900, 1).gstRateBps).toBe(DEFAULT_GST_RATE_BPS);
        expect(calculateGst(299900, 1, 500).gstRateBps).toBe(500);
    });

    it("honours an explicit rate", () => {
        const gst = calculateGst(100000, 2, 500); // 5%
        expect(gst.unitGstAmount).toBe(5000);
        expect(gst.totalAmount).toBe(210000);
    });

    it("adds nothing at a zero rate", () => {
        const gst = calculateGst(299900, 2, 0);
        expect(gst.gstAmount).toBe(0);
        expect(gst.totalAmount).toBe(gst.subtotalAmount);
    });
});

describe("formatGstRate", () => {
    it("renders whole and fractional percentages", () => {
        expect(formatGstRate(1800)).toBe("18%");
        expect(formatGstRate(500)).toBe("5%");
        expect(formatGstRate(0)).toBe("0%");
        expect(formatGstRate(1850)).toBe("18.5%");
    });
});
