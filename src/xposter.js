// Posts the free games the bot finds to the project's X account. X charges for every post it takes through the API
// (about 1.5 cents for plain text, and about 20 cents once a post has a link in it), so this only ever posts plain text,
// at most a few a day, and does nothing until the owner switches it on and has added the four keys.
import { offerKind } from "./freeinfo.js";
import { dealUrl } from "./deallinks.js";
import { freeArt } from "./render.js";
import { recordProblem } from "./adminlog.js";
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

export const X_POST_URL = "https://api.x.com/2/tweets";
export const X_ME_URL = "https://api.x.com/2/users/me";
export const X_MEDIA_URL = "https://api.x.com/2/media/upload";
const ON = "xposter:on", CAP = "xposter:daily", LAST = "xposter:last", ERR = "xposter:error", DAYKEY = "xposter:day:", SEEN = "xposted:";
const LINKS = "xposter:links", IMGERR = "xposter:imageerror", QIMG = "xposter:qimg:", FALLBACK_IMG = new URL("../public/icon-512.png", import.meta.url), MAX_QUEUE_IMAGE = 2 * 1024 * 1024;
const BUNDLEDONE = "xposted:bundle:", HIST = "xposter:history", QUEUE = "xposter:queue", SPEND = "xposter:spend:", MANUAL = "xposter:manual:";
export const DEFAULT_DAILY = 2, MAX_DAILY = 6, GAP_MS = 3 * 3_600_000, COST_PER_POST = 0.015, COST_LINK_POST = 0.20, MAX_MANUAL_PER_DAY = 20, MAX_QUEUED = 20, MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** What X counts: a link is always 23, and emoji and most non-Latin characters count double. */
const LINK_RE = /https?:\/\/\S+|\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|gg|tv|me|co|app|dev|xyz)\b(?:\/\S*)?/gi;
export const hasLink = t => { LINK_RE.lastIndex = 0; return LINK_RE.test(String(t)); };
export function xLength(text) {
    let n = 0;
    for (const ch of String(text).replace(LINK_RE, () => "x".repeat(23))) { const cp = ch.codePointAt(0); n += cp <= 4351 || (cp >= 8192 && cp <= 8205) || (cp >= 8208 && cp <= 8223) || (cp >= 8242 && cp <= 8247) ? 1 : 2; }
    return n;
}
const readList = v => { try { const a = JSON.parse(v ?? "[]"); return Array.isArray(a) ? a : []; } catch { return []; } };

/** Hashtags: one for the store the game or bundle is from, then a few popular gaming ones that rotate, so no two posts carry the exact same set. */
const TAGS = "xposter:tags", ALWAYS = "xposter:always", INGAME = "xposter:ingame";
export const DEFAULT_TAGS = ["#FreeGames", "#PCGaming", "#Gaming", "#Giveaway", "#GameDeals", "#Freebie", "#SteamDeals"];
const STORE_TAGS = [[/steam/i, "#Steam"], [/epic/i, "#EpicGames"], [/gog/i, "#GOG"], [/humble/i, "#HumbleBundle"], [/fanatical/i, "#Fanatical"], [/indie\s?gala/i, "#IndieGala"], [/itch/i, "#itchio"], [/ubisoft/i, "#Ubisoft"], [/prime/i, "#PrimeGaming"], [/battle\.?net|blizzard/i, "#Blizzard"]];
export function cleanTags(input) {
    const list = (Array.isArray(input) ? input : String(input ?? "").split(/[\s,]+/)).map(t => String(t).trim().replace(/^#+/, "")).filter(Boolean);
    const bad = list.find(t => !/^[A-Za-z0-9_]{2,30}$/.test(t));
    if (bad) throw Object.assign(new Error(`"${bad}" can't be a hashtag. Use letters, numbers and underscores only.`), { user: true });
    return [...new Set(list.map(t => "#" + t))].slice(0, 12);
}
export function hashtagsFor(shop, title, pool = DEFAULT_TAGS, max = 4) {
    const own = STORE_TAGS.find(([re]) => re.test(String(shop ?? "")))?.[1];
    const rest = pool.filter(t => t.toLowerCase() !== own?.toLowerCase());
    let h = 0; for (const c of String(title ?? "")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const picked = rest.length ? Array.from({ length: Math.min(max - (own ? 1 : 0), rest.length) }, (_, i) => rest[(h + i) % rest.length]) : [];
    return [...(own ? [own] : []), ...new Set(picked)].join(" ");
}

/** A bundle as a post: plain text unless `link` is set, because a link makes X charge about thirteen times more. */
export function bundleText(b, { tags = DEFAULT_TAGS, link = false, now = Date.now() } = {}) {
    const store = b.storeName ?? b.store ?? "", count = b.gameCount ?? b.games?.length ?? 0;
    const head = `📦 New bundle: ${String(b.title).slice(0, 90)}${store ? ` (${store})` : ""}`;
    const lines = [];
    if (b.price) lines.push(`💰 ${String(b.price).slice(0, 60)}`);
    const games = (b.games ?? []).slice(0, 3), all = count && games.length >= count; // every game fits in the list, so don't say "like"
    const named = games.length > 1 ? `${games.slice(0, -1).join(", ")} and ${games[games.length - 1]}` : games[0];
    if (count) lines.push(`🎮 ${count} game${count === 1 ? "" : "s"}${games.length ? (all ? `: ${named}` : `, including ${games.join(", ")}`) : ""}`);
    if (b.expiresAt && b.expiresAt > now) lines.push(`⏳ Ends ${new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" }).format(new Date(b.expiresAt))}`);
    // a blank line between the headline, the details, the link and the hashtags, so it reads cleanly in the feed
    const tail = `\n\n${link && b.url ? b.url : "Link in bio."}\n\n${hashtagsFor(store, b.title, tags.filter(t => !/^#(free\w*|giveaway)$/i.test(t)))}`; // a bundle isn't free or a giveaway
    const build = () => head + (lines.length ? "\n\n" + lines.join("\n") : "") + tail;
    let text = build();
    for (let i = 0; xLength(text) > 280 && lines.length; i++) { // drop the extras, longest first, until it fits
        const j = lines.findIndex(l => l.startsWith("🎮")); if (j >= 0) lines.splice(j, 1); else lines.pop();
        text = build();
    }
    return text;
}

/** Ready-made posts for the page's "start from" list. The ones without a link cost 1.5 cents, so "link in bio" is the default. */
export const TEMPLATES = [
    { id: "intro", name: "Meet the bot", text: "What's your Steam library really worth? 💸\n\nSteam Value Checker is a free Discord bot that:\n\n🏷️ Adds up your library's value\n🔔 Alerts you to wishlist sales\n🎁 Posts free games and bundle deals\n✨ Makes a shareable profile card\n\nLink in bio.\n\n#Steam #PCGaming #Gaming" },
    { id: "wishlist", name: "Wishlist alerts", text: "Stop checking Steam every day for sales.\n\nAdd your wishlist to Steam Value Checker and the Discord bot pings you the moment a game drops to a price you like. Free to use. Link in bio. 🔔\n\n#SteamDeals #GameDeals #PCGaming" },
    { id: "library", name: "Library value game", text: "Quick question for Steam players: how much is your library worth?\n\nRun it through Steam Value Checker, then reply with your number. Highest one wins bragging rights. 💸\n\nLink in bio.\n\n#Steam #PCGaming #Gaming" },
    { id: "free", name: "Free games alerts", text: "Free games come and go fast, and most people find out a day late.\n\nOur Discord bot posts every free PC game the moment it drops, from Steam, Epic, GOG and more. Link in bio. 🎁\n\n#FreeGames #Giveaway #Freebie" },
    { id: "grabber", name: "FanaticalGrabber", text: "Got a Fanatical bundle and a pile of keys to reveal one at a time?\n\nFanaticalGrabber is a Chrome extension that reveals them all and exports the keys to TXT or Excel. Link in bio. 🔑\n\n#Fanatical #PCGaming #GameDeals" },
    { id: "supporter", name: "Supporter pass", text: "Steam Value Checker stays free for everyone. If you want to chip in toward the hosting, a supporter pass gets you a role, a glowing profile badge, extra themes and bonus XP. 💖\n\nLink in bio.\n\n#Steam #PCGaming #Gaming" },
    { id: "indie-ask", name: "Indie: hidden gem question", text: "What's the best indie game you've played this year that almost nobody talks about? 🎮\n\nDrop it below. We'll pick our favorites for the weekly spotlight.\n\n#IndieGames #IndieDev #Steam" },
    { id: "indie-showcase", name: "Indie: weekly showcase", text: "Every Wednesday we put one indie game in the spotlight. 🌟\n\nNo big studio budget, just a game that deserves more eyes. Our Discord bot shares it with every server that opts in. Link in bio.\n\n#IndieGames #IndieShowcase #PCGaming" },
    { id: "indie-submit", name: "Indie: devs, submit your game", text: "Making an indie game? 🛠️\n\nSubmit it to the Steam Value Checker indie showcase. Approved games get their own page and a shot at the weekly spotlight. Link in bio.\n\n#IndieDev #IndieGames #gamedev" },
    { id: "indie-reply", name: "Indie: reply with yours", text: "Indie devs: reply with your game and one line on why people should play it. 👇\n\nWe'll boost the best ones and feature a few in our weekly spotlight.\n\n#IndieDev #IndieGames #Steam" },
    { id: "profile", name: "Profile cards", text: "Your Steam profile, as a card you can actually share. 🎮\n\nSteam Value Checker builds a profile page with your library value, playtime and favorites, and a picture version for Discord or X. Link in bio.\n\n#Steam #PCGaming #Gaming" }
];

const enc = s => encodeURIComponent(String(s)).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());

/** The OAuth 1.0a header X wants for a user-context call. A JSON body isn't part of the signature, only the query string is. */
export function oauthHeader({ method, url, keys, nonce = randomBytes(16).toString("hex"), timestamp = Math.floor(Date.now() / 1000) }) {
    const u = new URL(url);
    const oauth = { oauth_consumer_key: keys.apiKey, oauth_nonce: nonce, oauth_signature_method: "HMAC-SHA1", oauth_timestamp: String(timestamp), oauth_token: keys.accessToken, oauth_version: "1.0" };
    const params = [...Object.entries(oauth), ...u.searchParams.entries()].map(([k, v]) => [enc(k), enc(v)]).sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));
    const base = [method.toUpperCase(), enc(u.origin + u.pathname), enc(params.map(([k, v]) => `${k}=${v}`).join("&"))].join("&");
    const signature = createHmac("sha1", `${enc(keys.apiSecret)}&${enc(keys.accessSecret)}`).update(base).digest("base64");
    return "OAuth " + Object.entries({ ...oauth, oauth_signature: signature }).map(([k, v]) => `${enc(k)}="${enc(v)}"`).join(", ");
}

/** The day in Eastern time as YYYY-MM-DD, so "per day" means the owner's day. */
const dayOf = ms => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(ms));

/** The text of an automatic free-game post. With `link`, it has the claim link in it, which X bills as a link post. */
export function freeGameText(g, now = Date.now(), tags = DEFAULT_TAGS, { link = false } = {}) {
    const shop = g.shop ? ` on ${g.shop}` : "";
    const left = g.expiry && g.expiry > now ? g.expiry - now : null;
    const when = left === null ? "" : left < 36 * 3_600_000 ? `\n⏳ Ends ${left < 3_600_000 ? "within the hour" : `in about ${Math.round(left / 3_600_000)} hours`}.` : `\n⏳ Ends ${new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" }).format(new Date(g.expiry))}.`;
    let title = String(g.title).slice(0, 110);
    const kind = offerKind(g);
    const head = kind === "weekend" ? "🎮 Free to play this weekend" : kind === "ingame" ? "🎁 Free in-game offer" : "🎁 Free right now";
    const body = kind === "weekend" ? "Play it free for a limited time. It goes back to full price after, so grab it before then." : kind === "ingame" ? "The game itself is always free. This is a limited-time freebie inside it. Our Discord bot catches these too." : kind === "always" ? "Free to play any time. Our Discord bot posts every free game as it drops." : "Keep it forever once you claim it. Our Discord bot posts every free game as it drops.";
    const make = () => `${head}: ${title}${shop}${when}\n\n${body}\n\n${link && g.url ? `Claim it: ${g.url}` : "Link in bio."}\n\n${hashtagsFor(g.shop, g.title, tags)}`;
    let text = make();
    while (xLength(text) > 280 && title.length > 20) { title = title.slice(0, -10).trimEnd() + "…"; text = make(); }
    return text;
}

// A link to one of our landing pages becomes a big card on X, showing that page's own picture. So those posts carry the link and no
// uploaded image: the card is the picture, and tapping it opens the page.
export const hasCardLink = text => /https?:\/\/(?:www\.)?steamvaluechecker\.com\/[bd]\/\d+/i.test(String(text ?? ""));

export function createXPoster({ env = process.env, db, fetchImpl = globalThis.fetch, now = () => Date.now(), log = () => {} }) {
    // pasted values often come with a space, a line break or quote marks stuck to them
    const clean = v => String(v ?? "").trim().replace(/^["']+|["']+$/g, "").trim();
    const keys = { apiKey: clean(env.X_API_KEY), apiSecret: clean(env.X_API_SECRET), accessToken: clean(env.X_ACCESS_TOKEN), accessSecret: clean(env.X_ACCESS_SECRET) };
    const configured = () => Object.values(keys).every(v => String(v ?? "").trim());
    const enabled = () => db.getMeta(ON) === "1";
    const daily = () => Math.min(MAX_DAILY, Math.max(1, Number(db.getMeta(CAP)) || DEFAULT_DAILY));
    const postedToday = () => Number(db.getMeta(DAYKEY + dayOf(now()))) || 0;
    const linksOn = () => db.getMeta(LINKS) !== "0"; // links in automatic posts: on unless switched off
    /** A picture from a web address, as base64. Only https, only real image types, 5 MB at most. */
    async function imageFrom(url) {
        if (!/^https:\/\//i.test(String(url ?? ""))) throw new Error("no picture address");
        const res = await fetchImpl(url, { headers: { Accept: "image/*" }, signal: AbortSignal.timeout(15_000) });
        if (!res.ok) throw new Error(`the picture answered ${res.status}`);
        const type = String(res.headers?.get?.("content-type") ?? "image/jpeg").split(";")[0].trim().toLowerCase();
        if (!/^image\/(png|jpe?g|gif|webp)$/.test(type)) throw new Error("that isn't a picture X accepts");
        const buf = Buffer.from(await res.arrayBuffer());
        if (!buf.length || buf.length > MAX_IMAGE_BYTES) throw new Error("the picture is empty or over 5 MB");
        return buf.toString("base64");
    }
    /** The picture for a post: the one at `url`, or the project logo if there isn't one or it can't be fetched. */
    async function pictureFor(url) {
        try { return await imageFrom(url); } catch (err) { log(`picture fallback: ${err.message}`); }
        try { return readFileSync(FALLBACK_IMG).toString("base64"); } catch { return null; }
    }
    const tags = () => { try { const t = cleanTags(db.getMeta(TAGS) ?? ""); return t.length ? t : DEFAULT_TAGS; } catch { return DEFAULT_TAGS; } };
    const monthKey = () => dayOf(now()).slice(0, 7);
    const spendCents = () => Number(db.getMeta(SPEND + monthKey())) || 0;
    function record(entry) { // the last 30 posts, and what this month has cost so far
        const hist = [entry, ...readList(db.getMeta(HIST))].slice(0, 30);
        db.setMeta(HIST, JSON.stringify(hist));
        db.setMeta(SPEND + monthKey(), String(spendCents() + Math.round((hasLink(entry.text) ? COST_LINK_POST : COST_PER_POST) * 100 * 10) / 10));
    }

    async function call(method, url, body) {
        const res = await fetchImpl(url, { method, headers: { Authorization: oauthHeader({ method, url, keys, timestamp: Math.floor(now() / 1000) }), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15_000) });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
            const why = res.status === 402 || /credit|billing|payment/i.test(JSON.stringify(json)) ? "X says the account is out of credits. Add some in the X developer console."
                : res.status === 401 ? "X rejected the keys. Check all four are copied right, and that the access token was made after the API key (regenerating the key kills the old token)."
                : res.status === 403 ? "X refused it. The app needs Read and write access, and billing has to be switched on for the project."
                : res.status === 429 ? "X is rate limiting this account. It will try again later."
                : `X answered ${res.status}${json?.detail ? ": " + String(json.detail).slice(0, 160) : "."}`;
            throw Object.assign(new Error(why), { status: res.status });
        }
        return json;
    }

    /** One post, with up to four uploaded pictures if there are any. */
    async function post(text, mediaIds = []) {
        if (!configured()) throw new Error("The four X keys aren't set yet.");
        const out = await call("POST", X_POST_URL, { text: String(text).slice(0, 560), ...(mediaIds.length ? { media: { media_ids: mediaIds } } : {}) });
        return { id: out?.data?.id ?? null };
    }
    /** Uploads one picture and gives back its id. Nothing is posted yet. */
    async function uploadImage(base64) {
        if (!configured()) throw new Error("The four X keys aren't set yet.");
        const bytes = Buffer.from(String(base64), "base64");
        if (!bytes.length) throw Object.assign(new Error("That picture is empty."), { user: true });
        if (bytes.length > MAX_IMAGE_BYTES) throw Object.assign(new Error("Pictures can be 5 MB at most."), { user: true });
        const out = await call("POST", X_MEDIA_URL, { media: bytes.toString("base64"), media_category: "tweet_image" });
        const id = out?.data?.id ?? out?.media_id_string ?? null;
        if (!id) throw new Error("X took the picture but didn't give an id back.");
        return String(id);
    }
    function checkText(text) {
        const t = String(text ?? "").trim();
        if (!t) throw Object.assign(new Error("Write something to post first."), { user: true });
        if (xLength(t) > 280) throw Object.assign(new Error(`That's ${xLength(t)} characters. X allows 280, and a link counts as 23.`), { user: true });
        return t;
    }
    /** A post the owner wrote. Not held to the daily limit of the automatic ones, but to a sane one of its own. */
    async function manual({ text, image = null, imageUrl = null, kind = "manual", bundleId = null, freeId = null }) {
        const t = checkText(text);
        const key = MANUAL + dayOf(now()), used = Number(db.getMeta(key)) || 0;
        if (used >= MAX_MANUAL_PER_DAY) throw Object.assign(new Error(`That's ${MAX_MANUAL_PER_DAY} manual posts today. Try again tomorrow.`), { user: true });
        const pic = image || (imageUrl && !hasCardLink(t) ? await pictureFor(imageUrl) : null); // a landing link brings its own card picture
        const mediaIds = pic ? [await uploadImage(pic)] : []; // if the picture fails, the post doesn't go out without it
        const r = await post(t, mediaIds);
        db.setMeta(key, String(used + 1));
        record({ id: r.id, text: t, at: now(), kind: bundleId ? "bundle" : freeId ? "auto" : kind, media: mediaIds.length > 0 });
        if (freeId) db.setMeta(SEEN + freeId, String(now())); // so the automatic posts never repeat a game you posted by hand
        if (bundleId) db.setMeta(BUNDLEDONE + bundleId, String(now()));
        return { id: r.id, cost: hasLink(t) ? COST_LINK_POST : COST_PER_POST };
    }
    /** Saves a post to go out later. Text only, and it goes within a few minutes of the time. */
    function schedule({ text, at, image = null }) {
        const t = checkText(text), when = Math.round(Number(at));
        if (!(when > now() + 30_000)) throw Object.assign(new Error("Pick a time in the future."), { user: true });
        if (when > now() + 60 * 86_400_000) throw Object.assign(new Error("That's more than 60 days away."), { user: true });
        const q = readList(db.getMeta(QUEUE));
        if (q.length >= MAX_QUEUED) throw Object.assign(new Error(`${MAX_QUEUED} posts are already waiting. Delete one first.`), { user: true });
        if (image && Buffer.byteLength(String(image), "base64") > MAX_QUEUE_IMAGE) throw Object.assign(new Error("A picture on a scheduled post can be 2 MB at most."), { user: true });
        const item = { key: `q${now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, text: t, at: when, media: Boolean(image) };
        if (image) db.setMeta(QIMG + item.key, String(image));
        db.setMeta(QUEUE, JSON.stringify([...q, item].sort((a, b) => a.at - b.at)));
        return item;
    }
    function unschedule(key) {
        const q = readList(db.getMeta(QUEUE)); db.setMeta(QUEUE, JSON.stringify(q.filter(i => i.key !== key))); db.setMeta(QIMG + key, "");
    }
    /** Sends whatever scheduled posts have come due. A failed one is dropped with a note, not retried. */
    async function flush() {
        if (!configured()) return { sent: 0 };
        const q = readList(db.getMeta(QUEUE)), due = q.filter(i => i.at <= now());
        if (!due.length) return { sent: 0 };
        db.setMeta(QUEUE, JSON.stringify(q.filter(i => i.at > now()))); // taken off the list first, so a failure can't repeat itself and cost money
        let sent = 0;
        for (const i of due) {
            try {
                const img = db.getMeta(QIMG + i.key), ids = img ? [await uploadImage(img)] : [];
                const r = await post(i.text, ids); record({ id: r.id, text: i.text, at: now(), kind: "scheduled", media: ids.length > 0 }); sent++; db.setMeta(ERR, "");
            }
            catch (err) { db.setMeta(ERR, JSON.stringify({ at: now(), message: `A scheduled post didn't go out: ${err.message}` })); log(`scheduled post failed: ${err.message}`); }
            finally { db.setMeta(QIMG + i.key, ""); }
        }
        return { sent };
    }
    /** Takes a post down from the account. */
    async function remove(id) {
        if (!/^\d{5,25}$/.test(String(id))) throw Object.assign(new Error("That isn't a post id."), { user: true });
        await call("DELETE", `${X_POST_URL}/${id}`);
        db.setMeta(HIST, JSON.stringify(readList(db.getMeta(HIST)).filter(h => h.id !== String(id))));
        return { ok: true };
    }
    /** Proves the keys work without posting anything. */
    async function check() {
        if (!configured()) throw new Error("The four X keys aren't set yet.");
        const out = await call("GET", X_ME_URL);
        return { username: out?.data?.username ?? null };
    }

    /** Posts at most one new free game now, if it's switched on, under today's cap and far enough after the last one. */
    /** How many visits an average post for each store has pulled in, from the landing pages' own counters. */
    function shopScores() {
        const sums = new Map();
        try { for (const { id, shop } of db.recentFreePages?.() ?? []) { const v = Number(db.getMeta(`dealvisit:${id}`)) || 0, s = sums.get(shop) ?? { n: 0, v: 0 }; s.n++; s.v += v; sums.set(shop, s); } } catch { /* no data yet */ }
        return new Map([...sums].filter(([, s]) => s.n >= 2).map(([shop, s]) => [shop, s.v / s.n]));
    }
    /** What to post next. Anything about to end goes first, since it can't wait; otherwise the store whose posts people open most. */
    function pickNext(fresh) {
        const byEnd = [...fresh].sort((a, b) => (a.expiry ?? Infinity) - (b.expiry ?? Infinity));
        if (byEnd[0]?.expiry && byEnd[0].expiry - now() < 12 * 3_600_000) return byEnd[0];
        const score = shopScores();
        return byEnd.sort((a, b) => (score.get(b.shop) ?? 0) - (score.get(a.shop) ?? 0))[0]; // a stable sort, so ties keep the soonest-ending first
    }
    // Games that are free to play all the time are left out unless the owner turns that on; in-game freebies are on by default.
    const offerOk = g => { const k = offerKind(g); return k === "always" ? db.getMeta(ALWAYS) === "1" : k === "ingame" ? db.getMeta(INGAME) !== "0" : true; };
    /** What the next automatic post would look like, without sending or marking anything. */
    function peek(list) {
        if (!enabled() || !configured()) return { off: true };
        const fresh = (list ?? []).filter(g => g.type !== "dlc" && offerOk(g) && /^https:\/\//.test(g.url ?? "") && g.title && !db.getMeta(SEEN + g.id) && (!g.expiry || g.expiry - now() > 2 * 3_600_000));
        const g = pickNext(fresh);
        if (!g) return { nothing: true };
        const link = linksOn();
        const page = link ? dealUrl({ key: `free:${g.id ?? g.url}`, kind: "free", title: g.title, shop: g.shop, url: g.url, image: freeArt(g), expiry: g.expiry }) : g.url;
        const text = freeGameText({ ...g, url: page }, now(), tags(), { link });
        const gapLeft = Math.max(0, GAP_MS - (now() - (Number(db.getMeta(LAST)) || 0)));
        return { title: g.title, shop: g.shop, expiry: g.expiry ?? null, text, chars: text.length, cost: hasCardLink(text) ? COST_LINK_POST : COST_PER_POST, image: freeArt(g) ?? null, link, capped: postedToday() >= daily(), waitMs: gapLeft };
    }
    async function tick(list) {
        if (!enabled() || !configured()) return { skipped: "off" };
        if (postedToday() >= daily()) return { skipped: "cap" };
        if (now() - (Number(db.getMeta(LAST)) || 0) < GAP_MS) return { skipped: "gap" };
        const fresh = (list ?? []).filter(g => g.type !== "dlc" && offerOk(g) && /^https:\/\//.test(g.url ?? "") && g.title && !db.getMeta(SEEN + g.id) && (!g.expiry || g.expiry - now() > 2 * 3_600_000));
        const g = pickNext(fresh);
        if (!g) return { skipped: "nothing" };
        db.setMeta(SEEN + g.id, String(now())); // marked first, so a failure can't turn into a loop of retries that each cost money
        try {
            // the link goes through our own page on the site, which counts the visit and then sends people on to the store
            const linked = linksOn() ? { ...g, url: dealUrl({ key: `free:${g.id ?? g.url}`, kind: "free", title: g.title, shop: g.shop, url: g.url, image: freeArt(g), expiry: g.expiry }) } : g;
            const text = freeGameText(linked, now(), tags(), { link: linksOn() });
            let mediaIds = [];
            try { const pic = hasCardLink(text) ? null : await pictureFor(freeArt(g)); if (pic) mediaIds = [await uploadImage(pic)]; db.setMeta(IMGERR, ""); }
            catch (err) { db.setMeta(IMGERR, JSON.stringify({ at: now(), message: err.message })); log(`posting without a picture: ${err.message}`); } // better a post without a picture than no post
            const r = await post(text, mediaIds);
            db.setMeta(LAST, String(now())); db.setMeta(DAYKEY + dayOf(now()), String(postedToday() + 1)); db.setMeta(ERR, "");
            record({ id: r.id, text, at: now(), kind: "auto", media: mediaIds.length > 0 });
            log(`posted ${g.title}`);
            return { posted: g.title, id: r.id };
        } catch (err) {
            db.setMeta(ERR, JSON.stringify({ at: now(), message: err.message }));
            recordProblem(db, "X post", err.message);
            log(`post failed: ${err.message}`);
            return { error: err.message };
        }
    }

    function status() {
        let err = null; try { err = db.getMeta(ERR) ? JSON.parse(db.getMeta(ERR)) : null; } catch { /* none */ }
        const d = daily();
        return { configured: configured(), enabled: enabled(), daily: d, postedToday: postedToday(), lastAt: Number(db.getMeta(LAST)) || null, error: err, links: linksOn(), always: db.getMeta(ALWAYS) === "1", ingame: db.getMeta(INGAME) !== "0", imageError: (() => { try { return db.getMeta(IMGERR) ? JSON.parse(db.getMeta(IMGERR)) : null; } catch { return null; } })(), monthlyCost: Math.round(d * 30 * (linksOn() ? COST_LINK_POST : COST_PER_POST) * 100) / 100, maxDaily: MAX_DAILY, tags: tags().join(" "), defaultTags: DEFAULT_TAGS.join(" "),
            monthSpend: Math.round(spendCents()) / 100, history: readList(db.getMeta(HIST)), queue: readList(db.getMeta(QUEUE)), templates: TEMPLATES, manualToday: Number(db.getMeta(MANUAL + dayOf(now()))) || 0, manualMax: MAX_MANUAL_PER_DAY, linkCost: COST_LINK_POST, plainCost: COST_PER_POST };
    }
    function setSettings({ enabled: on, daily: n, tags: tg, links: lk, always, ingame } = {}) {
        if (always !== undefined) db.setMeta(ALWAYS, always ? "1" : "0");
        if (ingame !== undefined) db.setMeta(INGAME, ingame ? "1" : "0");
        if (lk !== undefined) db.setMeta(LINKS, lk ? "1" : "0");
        if (tg !== undefined) { const t = cleanTags(tg); db.setMeta(TAGS, t.join(" ")); }
        if (on !== undefined) db.setMeta(ON, on ? "1" : "0");
        if (n !== undefined) { const v = Math.round(Number(n)); if (!(v >= 1 && v <= MAX_DAILY)) throw Object.assign(new Error(`Posts per day must be between 1 and ${MAX_DAILY}.`), { user: true }); db.setMeta(CAP, String(v)); }
        return status();
    }
    const freePosted = id => Boolean(db.getMeta(SEEN + id));
    const bundlePosted = id => Boolean(db.getMeta(BUNDLEDONE + id));
    return { freePosted, bundlePosted, tags, configured, post, check, peek, tick, status, setSettings, manual, schedule, unschedule, flush, remove, uploadImage };
}
