// What the browser extension asks the bot for: extras for a Steam store page, a spotlight card for the streamer's overlay, and the
// numbers behind the toolbar badge. Every call comes with the member's link code, so it all belongs to a member who linked the bot.
import { sameGame } from "./abgfeed.js";
import { whoIsPlaying } from "./nowplaying.js";
import { clubProgress, monthOf } from "./gameclub.js";
import { isDlc } from "./freemenu.js";

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
export async function badgeFor({ db, itad, abg, userId, now = Date.now() }) {
    let free = [], tests = [];
    try { free = (await itad.getGiveawayList()).filter(g => /^https:\/\//i.test(g.url ?? "") && !isDlc(g)).map(g => String(g.id)).slice(0, 40); } catch { /* none */ }
    try { tests = ((await abg?.latest?.()) ?? []).filter(x => x.date >= now - 14 * 86400_000 && !x.wishlistOnly).map(x => String(x.id)).slice(0, 40); } catch { /* none */ }
    return { free, playtests: tests, unread: db.unreadNotifications(userId) };
}
