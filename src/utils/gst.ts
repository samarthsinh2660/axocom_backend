import { GST_RATE_BPS } from "../config/env";

/** Basis points (1800 = 18.00%) keeps the rate an integer. */
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
 * GST per unit, rounded, then multiplied by quantity - matching an invoice
 * line rather than taxing the combined subtotal.
 *
 * Amounts are integer paise in and out.
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
