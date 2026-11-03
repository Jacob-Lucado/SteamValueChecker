// The streamer's "cards" overlay for OBS: a private link that rotates through the best deal on their wishlist, a free game that is live right now,
// and a "gift me" card pointing at their public wishlist page. One link per person (not per server), so it follows them everywhere.
// The link shows only public things: game names, prices and the public page address. Never a Discord id or anything private.
import { randomBytes } from "node:crypto";

export const STREAMCARD_KINDS = ["deal", "free", "gift"];

export const streamCardSchema = `
CREATE TABLE IF NOT EXISTS stream_card (
    user_id TEXT PRIMARY KEY,
    token   TEXT NOT NULL UNIQUE,
    kinds   TEXT NOT NULL DEFAULT 'deal,free,gift',
    created INTEGER NOT NULL
);
`;

const cleanKinds = v => STREAMCARD_KINDS.filter(k => (Array.isArray(v) ? v : String(v ?? "").split(",")).includes(k));

export function streamCardStore({ run, get, now }) {
    const row = r => r ? { user_id: r.user_id, token: r.token, kinds: cleanKinds(r.kinds), created: r.created } : null;
    return {
        getStreamCard: userId => row(get("SELECT * FROM stream_card WHERE user_id = ?", String(userId))),
        /** Makes the link, or replaces it with a new one (the old link stops working at once). Keeps the chosen cards. */
        resetStreamCard(userId) {
            const token = "svcd_" + randomBytes(24).toString("base64url");
            run("INSERT INTO stream_card (user_id, token, kinds, created) VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET token = excluded.token, created = excluded.created", String(userId), token, STREAMCARD_KINDS.join(","), now());
            return token;
        },
        setStreamCardKinds: (userId, kinds) => run("UPDATE stream_card SET kinds = ? WHERE user_id = ?", cleanKinds(kinds).join(","), String(userId)),
        removeStreamCard: userId => run("DELETE FROM stream_card WHERE user_id = ?", String(userId)),
        streamCardByToken: token => /^svcd_[A-Za-z0-9_-]{32}$/.test(String(token ?? "")) ? row(get("SELECT * FROM stream_card WHERE token = ?", String(token))) : null
    };
}

/**
 * What the overlay shows right now: [{ kind, ... }]. `deals` and `free` are functions that fetch lazily, so a card the streamer switched off costs nothing.
 * Each part fails on its own; a missing price source never blanks the gift card.
 */
export async function streamCardData({ kinds, user, deals, free, giftUrl }) {
    const cards = [];
    if (kinds.includes("deal")) {
        try {
            const rows = (await deals()) ?? [];
            const best = rows.filter(r => !r.owned && r.best && Number.isFinite(r.best.price) && r.discount > 0)
                .sort((a, b) => Number(b.priority) - Number(a.priority) || b.discount - a.discount || a.title.localeCompare(b.title))[0];
            if (best) cards.push({ kind: "deal", title: best.title, price: best.best.price, regular: best.regular ?? null, discount: Math.round(best.discount * 100), currency: best.currency ?? "USD", shop: best.best.shop ?? null, appid: best.appid ?? null });
        } catch { /* no price source right now */ }
    }
    if (kinds.includes("free")) {
        try {
            const g = ((await free()) ?? [])[0];
            if (g) cards.push({ kind: "free", title: g.title, shop: g.shop ?? null, expiry: g.expiry ?? null, art: g.art ?? null });
        } catch { /* skip */ }
    }
    if (kinds.includes("gift") && giftUrl) cards.push({ kind: "gift", text: "Gift me a game", url: giftUrl });
    return { name: user?.name ?? null, cards };
}
