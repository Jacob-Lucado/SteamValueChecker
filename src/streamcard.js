// The streamer's "cards" overlay for OBS: a private link that rotates through the best deal on their wishlist, a free game that is live right now,
// and a "gift me" card pointing at their public wishlist page. One link per person (not per server), so it follows them everywhere.
// The link shows only public things: game names, prices and the public page address. Never a Discord id or anything private.
import { randomBytes } from "node:crypto";

export const STREAMCARD_KINDS = ["game", "deal", "free", "gift"];

export const streamCardSchema = `
CREATE TABLE IF NOT EXISTS stream_card (
    user_id TEXT PRIMARY KEY,
    token   TEXT NOT NULL UNIQUE,
    kinds   TEXT NOT NULL DEFAULT 'game,deal,free,gift',
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

/** One short plain-text line for a chat command (!deals, !free, !wishlist). Kept well under Twitch's 500 character limit. */
export function streamCardLine(cards, kind) {
    const c = (cards ?? []).find(x => x.kind === kind);
    if (kind === "deal") {
        if (!c) return "No deals on my wishlist right now.";
        let money = n => Number(n).toFixed(2);
        try { const f = new Intl.NumberFormat("en-US", { style: "currency", currency: c.currency || "USD" }); money = n => f.format(n); } catch { /* plain number */ }
        return `${c.title} is ${c.discount}% off: ${money(c.price)}${c.regular ? ` (was ${money(c.regular)})` : ""}${c.shop ? " at " + c.shop : ""}`.slice(0, 300);
    }
    if (kind === "free") {
        if (!c) return "No free games right now.";
        const until = c.expiry && Number.isFinite(Date.parse(c.expiry)) ? " until " + new Date(c.expiry).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "";
        return `Free right now: ${c.title}${c.shop ? " on " + c.shop : ""}${until}`.slice(0, 300);
    }
    if (kind === "game") return c ? `Playing ${c.title}${c.hours ? ` (${c.hours}h played)` : ""}` : "Not in a game right now.";
    return c ? `Gift me a game: ${c.url}` : "I don't have a public wishlist page yet.";
}

/** The chat commands a streamer pastes into their chat bot. `url(kind)` is the address that returns the line for that command. */
export function chatCommandSets(url) {
    const NAMES = [["game", "game"], ["deals", "deal"], ["free", "free"], ["wishlist", "gift"]];
    const tools = {
        nightbot: { label: "Nightbot", line: (n, u) => `!commands add !${n} $(urlfetch ${u})` },
        streamelements: { label: "StreamElements", line: (n, u) => `!command add ${n} \${customapi.${u}}` },
        streamlabs: { label: "Streamlabs Cloudbot", line: (n, u) => `!addcommand !${n} {readapi.${u}}` },
        fossabot: { label: "Fossabot", line: (n, u) => `!command add ${n} $(customapi ${u})` }
    };
    return Object.fromEntries(Object.entries(tools).map(([k, t]) => [k, { label: t.label, lines: NAMES.map(([n, kind]) => t.line(n, url(kind))) }]));
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
