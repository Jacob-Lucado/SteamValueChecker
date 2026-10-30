// A public wishlist page a member can share (for gifting). Off until they turn it on. Shows game names, art and today's
// best price only: never their Discord account, settings, library or anything else.
import { UserError } from "./errors.js";
import { summarize } from "./report.js";
import { current } from "./alerts.js";
import { artUrl } from "./render.js";

export const SLUG_RE = /^[a-z0-9][a-z0-9_-]{2,23}$/;

export function cleanSlug(input) {
    const s = String(input ?? "").trim().toLowerCase();
    if (!SLUG_RE.test(s)) throw new UserError("Pick a name of 3 to 24 letters, numbers, dashes or underscores.");
    return s;
}

/** Turns the page on or off, optionally choosing the name. Returns { slug, public }. */
export function setProfile(db, userId, { enabled, slug }) {
    const user = db.getUser(userId);
    let name = user?.profile_slug ?? null;
    if (slug !== undefined && slug !== null && slug !== "") name = cleanSlug(slug);
    if (enabled && !name) throw new UserError("Choose a page name first, for example `/publicpage enabled:true name:jacob`.");
    try { db.setProfile(userId, { slug: name, isPublic: Boolean(enabled) }); }
    catch (err) { if (/UNIQUE/i.test(err.message)) throw new UserError("That page name is taken. Try another."); throw err; }
    return { slug: name, public: Boolean(enabled) };
}

export async function publicWishlist(db, itad, slug, token = null) {
    const user = db.getProfileBySlug(String(slug ?? "").toLowerCase());
    if (!user || !user.profile_public) return null;
    // Games the owner already has are not worth gifting, so they are left off the page.
    const owned = new Set(db.listLibrary(user.discord_id).map(x => x.itad_id));
    const claims = db.giftClaimMap(user.discord_id, token);
    const soon = user.guild_id ? db.soonIds(user.guild_id) : new Set();
    const items = db.listItems(user.discord_id).filter(i => i.source !== "watch" && !owned.has(i.itad_id)).slice(0, 100);
    const prices = items.length ? await itad.getPrices(items.map(i => i.itad_id), user.region).catch(() => new Map()) : new Map();
    const games = items.map(it => {
        const s = summarize(prices.get(it.itad_id), { majorOnly: user.stores === "major" });
        const now = current(s);
        return { id: it.itad_id, soon: soon.has(it.itad_id), claim: claims.get(it.itad_id) ?? null, title: it.title, art: artUrl(it) ?? null, price: s.best?.price ?? null, shop: s.best?.shop ?? null, url: /^https:\/\//i.test(s.best?.url ?? "") ? s.best.url : null, discount: Math.round((now.discount ?? 0) * 100), currency: s.currency ?? "USD" };
    }).sort((a, b) => b.discount - a.discount || a.title.localeCompare(b.title));
    return { slug: user.profile_slug, guild_id: user.guild_id ?? null, games };
}
