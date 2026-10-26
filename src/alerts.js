// Decides whether a price should trigger an alert. Pure functions, no Discord or network code.

import { TRIGGERS } from "./db.js";

const EPS = 0.005;

/** Current numbers for one game from a report.js summary: price now, discount, all-time low. */
export function current(summary) {
    const price = summary?.best?.price ?? null;
    const regular = summary?.msrp ?? null;
    const discount = price !== null && regular ? Math.max(0, 1 - price / regular) : 0;
    return { price, regular, discount, shop: summary?.best?.shop ?? null, url: summary?.best?.url ?? null, atl: summary?.atl ?? null, low1y: summary?.low1y ?? null, low3m: summary?.low3m ?? null, currency: summary?.currency ?? null, slug: summary?.slug ?? null };
}

/** Does the price meet the user's trigger for this game? */
export function meetsTrigger(item, now) {
    if (now.price === null) return false;
    switch (item.trigger_type) {
        case "percent": return now.discount * 100 >= (item.trigger_value ?? 0) - EPS && now.discount > 0;
        case "price": return item.trigger_value != null && now.price <= item.trigger_value + EPS;
        case "atl": return now.atl !== null && now.price <= now.atl + EPS;
        case "any":
        default: return now.discount > 0.0001;
    }
}

/**
 * Returns { action: "alert" | "reset" | "none", reason }.
 * - alert: the trigger is met and this is new (never alerted for this sale, or the price dropped further)
 * - reset: the trigger is no longer met, so a future sale should alert again
 * - none:  already alerted for this price, or nothing to do
 */
export function evaluate(item, summary) {
    const now = current(summary);
    if (!TRIGGERS.includes(item.trigger_type)) return { action: "none", now };
    if (!meetsTrigger(item, now)) {
        return { action: item.last_alert_price != null ? "reset" : "none", now };
    }
    if (item.last_alert_price == null) return { action: "alert", now, reason: "new" };
    if (now.price < item.last_alert_price - EPS) return { action: "alert", now, reason: "lower" };
    return { action: "none", now };
}

export function describeTrigger(item) {
    switch (item.trigger_type) {
        case "percent": return `${item.trigger_value}% off or more`;
        case "price": return `at or under ${item.trigger_value}`;
        case "atl": return "all-time low";
        default: return "any sale";
    }
}

/** Validates a trigger choice from a command. Returns { type, value } or throws an Error with a user-facing message. */
export function parseTrigger(type, value) {
    const t = type ?? "any";
    if (!TRIGGERS.includes(t)) throw new Error("Unknown alert type.");
    if (t === "percent") {
        if (value == null || value < 1 || value > 99) throw new Error("For a percentage alert, give a value from 1 to 99.");
        return { type: t, value };
    }
    if (t === "price") {
        if (value == null || value <= 0) throw new Error("For a price alert, give the price you want to pay or less.");
        return { type: t, value };
    }
    return { type: t, value: null };
}

/**
 * Plain-language read on a price, using the lows ITAD reports. Returns { level, text } or null.
 * level: "great" (at the all-time low), "good" (close to a recent low), "wait" (it has been cheaper), "info".
 */
export function dealVerdict(now) {
    const p = now?.price;
    if (p === null || p === undefined) return null;
    const near = (low, pct) => low !== null && low !== undefined && p <= low * (1 + pct) + EPS;
    if (now.atl != null && p <= now.atl + EPS) return { level: "great", text: "All-time low" };
    if (near(now.low1y, 0.05)) return { level: "good", text: "At its 1-year low" };
    if (near(now.atl, 0.1)) return { level: "good", text: "Within 10% of its all-time low" };
    if (near(now.low3m, 0.05)) return { level: "good", text: "At its 3-month low" };
    if (now.atl != null && now.atl > 0) {
        return { level: now.discount > 0 ? "wait" : "info", text: `Has been cheaper (low ${now.atl.toFixed(2)})` };
    }
    return null;
}
