import { GST_RATE_BPS } from "../config/env";

/**
 * GST is held in basis points (1800 = 18.00%) so the rate itself is an integer
 * and never carries float error into a money calculation.
 */
export const DEFAULT_GST_RATE_BPS = 1800;

export function getGstRateBps(): number {
    const configured = Number(GST_RATE_BPS);
    if (!Number.isInteger(configured) || configured < 0 || configured > 10000) {
        return DEFAULT_GST_RATE_BPS;
    }
    return configured;
}

export type GstBreakdown = {
    unitAmount: number;
    unitGstAmount: number;
    quantity: number;
    subtotalAmount: number;
    gstAmount: number;
    totalAmount: number;
    gstRateBps: number;
};

/**
 * GST is charged per unit and then multiplied, the way a line item on an
 * invoice works - not by taxing the combined subtotal. The two only ever differ
 * by a paisa of rounding, but the per-unit figure is the one that has to
 * reconcile against an invoice line, so it is the one we round and store.
 *
 * All amounts are integer paise in and out.
 */
export function calculateGst(
    unitAmount: number,
    quantity: number,
    gstRateBps: number = getGstRateBps()
): GstBreakdown {
    const unitGstAmount = Math.round((unitAmount * gstRateBps) / 10000);

    return {
        unitAmount,
        unitGstAmount,
        quantity,
        subtotalAmount: unitAmount * quantity,
        gstAmount: unitGstAmount * quantity,
        totalAmount: (unitAmount + unitGstAmount) * quantity,
        gstRateBps,
    };
}

/** Renders 1800 as "18%" and 1850 as "18.5%" for display and invoices. */
export function formatGstRate(gstRateBps: number): string {
    const percent = gstRateBps / 100;
    return `${Number.isInteger(percent) ? percent : percent.toFixed(2).replace(/0$/, "")}%`;
}
