// What the browser extension asks the bot for: extras for a Steam store page, a spotlight card for the streamer's overlay, and the
// numbers behind the toolbar badge. Every call comes with the member's link code, so it all belongs to a member who linked the bot.
import { sameGame } from "./abgfeed.js";
import { whoIsPlaying } from "./nowplaying.js";
import { clubProgress, monthOf } from "./gameclub.js";
import { isDlc } from "./freemenu.js";
import { enrichFree } from "./freeinfo.js";
import { steamAppid } from "./freeinfo.js";
import { viewRows } from "./wishlist.js";

const SPOT_MS = 10 * 60_000;
const WINDOW_MS = 45 * 86400_000;

/** A playtest, beta or demo for this game that is open now (Steam's own demo list matches by app number, the sites by name). */
export async function playtestFor({ abg, appid, name, now = Date.now() }) {
    if (!abg) return null;
    let list;
    try { list = await abg.latest(); } catch { return null; }
    const hit = list.find(x => x.date >= now - WINDOW_MS && (x.appid === appid || (name && sameGame(x.game, name))));
    return hit ? { label: hit.label ?? "Playtest", source: hit.sourceName ?? "Playtest", url: hit.url } : null;
}

/** Counts only, from members who opted in to sharing: how many in the member's server own the game, and how many are in it right now. */
export async function socialFor({ db, nowPlaying, userId, appid }) {
    const u = db.getUser(userId), gid = u?.guild_id;
    if (!gid) return null;
    const others = db.sharingMembers(gid).filter(id => id !== userId);
    const owners = others.filter(id => db.listLibrary(id).some(g => g.appid === appid)).length;
    let playing = 0;
    try { playing = (await whoIsPlaying(db, nowPlaying, gid)).games.find(g => g.appid === appid)?.players.filter(p => p.userId !== userId).length ?? 0; } catch { /* Steam busy */ }
    const club = db.getClub(gid);
    const pick = club?.title && club.appid === appid && club.month === monthOf(Date.now()) ? { title: club.title, month: club.month, finished: clubProgress(db, club).owners.filter(r => r.finished).length } : null;
    return { owners, sharing: others.length, playing, club: pick };
}

/** The card the streamer's overlay shows for a few minutes after they press "Spotlight on stream". */
export function setSpotlight(db, userId, card, now = Date.now()) {
    db.setMeta(`spot:${userId}`, JSON.stringify({ ...card, until: now + SPOT_MS }));
    return now + SPOT_MS;
}
export function getSpotlight(db, userId, now = Date.now()) {
    try { const c = JSON.parse(db.getMeta(`spot:${userId}`) ?? "null"); return c && c.until > now ? { kind: "deal", spot: true, title: c.title, price: c.price, regular: c.regular ?? null, discount: c.discount ?? 0, currency: c.currency ?? "USD", shop: c.shop ?? null, appid: c.appid } : null; } catch { return null; }
}

/** Toolbar badge: what is new that the member may not have looked at. Ids let the extension count only what it has not shown yet. */
export async function badgeFor({ db, itad, abg, userId, now = Date.now(), fetchImpl = globalThis.fetch }) {
    let free = [], tests = [], claimable = [], hits = [];
    let giveaways = [];
    try { giveaways = await itad.getGiveawayList(); } catch { /* none */ }
    free = giveaways.filter(g => /^https:\/\//i.test(g.url ?? "") && !isDlc(g)).map(g => String(g.id)).slice(0, 40);
    // Steam games that are free to keep right now, which the extension can add to the account with one click (never free weekends or always-free games).
    try {
        const steam = giveaways.filter(g => !g.weekend && steamAppid(g)).slice(0, 12);
        for (const g of await enrichFree(steam, fetchImpl)) if (!g.alwaysFree && !g.weekend) claimable.push({ appid: steamAppid(g), title: String(g.title).slice(0, 100), dlc: g.type === "dlc" });
    } catch { /* none */ }
    try { tests = ((await abg?.latest?.()) ?? []).filter(x => x.date >= now - 14 * 86400_000 && !x.wishlistOnly).map(x => String(x.id)).slice(0, 40); } catch { /* none */ }
    // Wishlist games that are on sale now: at or under their alert price, or at least half off.
    try {
        const user = db.getUser(userId);
        if (user) hits = (await viewRows(db, itad, user)).rows.filter(r => !r.owned && r.best && (r.discount >= 50 || (r.trigger_type === "price" && r.best.price <= Number(r.trigger_value)))).slice(0, 6)
            .map(r => ({ title: r.title, price: r.best.price, shop: r.best.shop, cut: Math.round(r.discount), currency: r.currency, appid: r.appid }));
    } catch { /* none */ }
    return { free, playtests: tests, unread: db.unreadNotifications(userId), claimable, hits };
}

/** Adds Steam games to a member's library from their app numbers, which the extension reads from the Steam page they are signed in to.
 *  Only new games are added; nothing already in the library (or what was paid for it) is touched. */
export async function syncFromApps({ db, itad, userId, appids, limit = 150 }) {
    const ids = [...new Set(appids.filter(n => Number.isInteger(n) && n > 0 && n < 1e9))];
    const map = await itad.lookupShopIds(61, ids.map(a => `app/${a}`));
    const have = new Set(db.listLibrary(userId).map(g => g.itad_id));
    const fresh = [], notFound = [];
    for (const a of ids) { const id = map.get(`app/${a}`); if (!id) notFound.push(a); else if (!have.has(id)) fresh.push(id); }
    const take = fresh.slice(0, limit), games = [];
    for (let i = 0; i < take.length; i += 5) await Promise.all(take.slice(i, i + 5).map(async id => { try { const t = await itad.getTitle(id); if (t?.title) games.push({ itad_id: id, title: t.title, paid: null }); } catch { /* skipped, next sync retries */ } }));
    const r = games.length ? db.upsertLibrary(userId, games) : { added: 0, skippedForLimit: 0 };
    return { added: r.added, already: ids.length - notFound.length - fresh.length, notFound: notFound.length, remaining: fresh.length - take.length, skippedForLimit: r.skippedForLimit };
}

// A small board for spare copies: members list a game they have extra of, others in the server claim it, and they sort the key out in
// Discord. Keys never touch the bot; the board only holds game names.
const GIFT_MAX = 40;
const giftKey = guildId => `gifts:${guildId}`;
export function listGifts(db, guildId) { try { const l = JSON.parse(db.getMeta(giftKey(guildId)) ?? "[]"); return Array.isArray(l) ? l : []; } catch { return []; } }
export function offerGift(db, guildId, userId, title, now = Date.now()) {
    const t = String(title ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
    if (!t) return { error: "I need a game name." };
    const list = listGifts(db, guildId);
    if (list.filter(g => g.user === userId && !g.claimedBy).length >= 10) return { error: "You already have 10 spare copies listed." };
    if (list.some(g => g.user === userId && !g.claimedBy && g.title.toLowerCase() === t.toLowerCase())) return { error: "That one is already listed." };
    const gift = { id: `${now.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`, user: userId, title: t, at: now, claimedBy: null };
    db.setMeta(giftKey(guildId), JSON.stringify([gift, ...list].slice(0, GIFT_MAX)));
    return { gift };
}
export function claimGift(db, guildId, userId, id, now = Date.now()) {
    const list = listGifts(db, guildId), g = list.find(x => x.id === id);
    if (!g) return { error: "That one is gone." };
    if (g.claimedBy) return { error: "Someone already claimed that." };
    if (g.user === userId) return { error: "That's your own listing." };
    g.claimedBy = userId; g.claimedAt = now;
    db.setMeta(giftKey(guildId), JSON.stringify(list));
    return { gift: g };
}
export function withdrawGift(db, guildId, userId, id) {
    const list = listGifts(db, guildId), g = list.find(x => x.id === id && x.user === userId);
    if (!g) return { error: "That isn't yours." };
    db.setMeta(giftKey(guildId), JSON.stringify(list.filter(x => x !== g)));
    return { ok: true };
}
