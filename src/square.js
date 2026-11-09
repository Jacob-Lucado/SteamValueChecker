// Square checkout for supporter passes. The bot makes a payment link that carries the member's Discord ID, Square calls back when it is paid,
// and the bot checks that call is really from Square before it believes it. No card details ever touch this server.
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const PLANS = [
    { id: "m1", name: "1 month", days: 30, cents: 300 },
    { id: "m3", name: "3 months", days: 90, cents: 800 },
    { id: "y1", name: "12 months", days: 365, cents: 3000 }
];
export const SUPPORTER_XP_BOOST = 1.25;
const REF = /^svc:(\d{5,25}):(m1|m3|y1)$/;
const VERSION = "2024-07-17";

export function squareConfig(env = process.env) {
    return { accessToken: env.SQUARE_ACCESS_TOKEN || null, locationId: env.SQUARE_LOCATION_ID || null, signatureKey: env.SQUARE_WEBHOOK_SIGNATURE_KEY || null, sandbox: env.SQUARE_ENV === "sandbox", webhookUrl: env.SQUARE_WEBHOOK_URL || null };
}

export function createSquare({ accessToken, locationId, signatureKey, sandbox = false, webhookUrl = null, publicUrl = "", fetch: doFetch = globalThis.fetch } = {}) {
    const enabled = Boolean(accessToken && locationId && signatureKey);
    const base = sandbox ? "https://connect.squareupsandbox.com" : "https://connect.squareup.com";
    const notificationUrl = webhookUrl || `${publicUrl}/api/square/webhook`;
    const call = async (method, path, body) => {
        const res = await doFetch(base + path, { method, headers: { Authorization: `Bearer ${accessToken}`, "Square-Version": VERSION, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(`Square said no (${res.status}): ${json?.errors?.[0]?.detail ?? "no details"}`.slice(0, 200));
        return json;
    };

    /** A one-time checkout page for a pass. Returns the address to send the member to. */
    async function checkout({ userId, planId, redirectUrl }) {
        const plan = PLANS.find(p => p.id === planId);
        if (!enabled) throw new Error("Supporter passes aren't switched on yet.");
        if (!plan) throw new Error("Pick one of the passes.");
        if (!/^\d{5,25}$/.test(String(userId))) throw new Error("Sign in first.");
        const r = await call("POST", "/v2/online-checkout/payment-links", {
            idempotency_key: randomUUID(),
            order: { location_id: locationId, reference_id: `svc:${userId}:${plan.id}`, line_items: [{ name: `Steam Value Checker supporter, ${plan.name}`, quantity: "1", base_price_money: { amount: plan.cents, currency: "USD" } }] },
            checkout_options: { redirect_url: redirectUrl, ask_for_shipping_address: false }
        });
        const url = r?.payment_link?.url;
        if (!url) throw new Error("Square didn't give back a checkout page.");
        return url;
    }

    /** Square signs notificationUrl + body with the webhook key (HMAC-SHA256, base64). */
    function verify(rawBody, signature) {
        if (!signatureKey || !signature) return false;
        const want = createHmac("sha256", signatureKey).update(notificationUrl + rawBody).digest();
        let got; try { got = Buffer.from(String(signature), "base64"); } catch { return false; }
        return got.length === want.length && timingSafeEqual(got, want);
    }

    /** A finished payment for a supporter pass, or null for anything else. The order is read back from Square, never trusted from the call. */
    async function paidPass(event) {
        if (!event || (event.type !== "payment.updated" && event.type !== "payment.created")) return null;
        const pay = event.data?.object?.payment;
        if (!pay || pay.status !== "COMPLETED" || !pay.order_id) return null;
        const order = (await call("GET", `/v2/orders/${encodeURIComponent(pay.order_id)}`))?.order;
        const m = REF.exec(String(order?.reference_id ?? ""));
        if (!m || order.location_id !== locationId) return null;
        const plan = PLANS.find(p => p.id === m[2]);
        const paid = Number(pay.total_money?.amount ?? pay.amount_money?.amount ?? 0);
        if (!plan || pay.amount_money?.currency !== "USD" || paid < plan.cents) return null;
        return { userId: m[1], plan, paymentId: String(pay.id) };
    }

    return { enabled, checkout, verify, paidPass, notificationUrl };
}
