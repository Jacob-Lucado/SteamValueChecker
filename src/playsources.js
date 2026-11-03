// Where playtests, betas and demos are found, other than a game's own Steam announcements. Each source turns its feed into the same
// small shape, and one merged list goes to the alerts, the server channels and the dashboard page:
//   { id, source, sourceName, game, type, kind, label?, url, date, summary, image, appid?, wishlistOnly? }
// `kind` is one of signup, playtest, demo, alpha, beta (the same words the Alpha Beta Gamer reader uses).
//
// Sources: Alpha Beta Gamer (abgfeed.js), GamerPower's beta and playtest key listings, itch.io's "playtest" tag, and Steam's own
// list of new demos. Steam gets dozens of demos a day, so those only count for games someone has on a wishlist (`wishlistOnly`).
// Looked at and left out: BetaBound (gadgets and apps, not games), GamingOnLinux (about one relevant article in thirty), Reddit and
// IndieDB (both refuse bots).
import { createAbgFeed, decodeEntities, normName, sameGame } from "./abgfeed.js";
import { steamArt, safeUrl } from "./render.js";

const UA = "SteamValueChecker/1.0 (+https://steamvaluechecker.com)";
const DAY = 86400_000;
const cdata = s => String(s ?? "").replace(/^\s*<!\[CDATA\[/, "").replace(/\]\]>\s*$/, "");
const tag = (xml, name) => { const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(xml); return m ? cdata(m[1]) : ""; };

/** "Zero King (Beta) Steam Key Giveaway" -> "Zero King"; "STRANDED: The Ashen Relics (Playtest)" -> "STRANDED: The Ashen Relics". */
export function cleanGame(title) {
    const t = decodeEntities(title).replace(/\s+/g, " ").trim();
    const m = /^(.*?)\s*[:\-–—(\[]?\s*\b(?:(?:open|closed|private|public|steam)\s+)?(?:beta|playtest|play\s*test|demo|alpha)\b/i.exec(t);
    const game = (m && m[1].trim().replace(/[:\-–—(\[\s]+$/, "")) || t.replace(/\s*(?:Steam\s+)?Key Giveaway\s*$/i, "");
    return (game || t).slice(0, 100);
}
/** playtest / demo / beta / alpha from the words in a title. */
export function kindFromText(text) {
    const t = String(text ?? "");
    if (/play\s*-?\s*tests?/i.test(t)) return "playtest";
    if (/\balpha\b/i.test(t)) return "alpha";
    if (/\bdemo\b/i.test(t)) return "demo";
    return "beta";
}
/** What a post counts as, for not announcing the same thing twice: a demo, a free weekend, or a test (playtest, sign-up, alpha, beta). */
export const kindGroup = kind => (kind === "demo" ? "demo" : kind === "weekend" ? "weekend" : "test");

// ---------- GamerPower: https://www.gamerpower.com/api/giveaways?type=beta ----------
export const GAMERPOWER_URL = "https://www.gamerpower.com/api/giveaways?type=beta";
export function parseGamerPower(json, { now = Date.now() } = {}) {
    let list = json;
    if (typeof json === "string") { try { list = JSON.parse(json); } catch { return []; } }
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const x of list) {
        const date = Date.parse(String(x.published_date ?? "").replace(" ", "T") + "Z");
        const url = safeUrl(x.gamerpower_url) ?? safeUrl(x.open_giveaway_url);
        if (!x.title || !url || !Number.isFinite(date)) continue;
        if (String(x.status ?? "Active") !== "Active") continue;
        const end = Date.parse(String(x.end_date ?? "").replace(" ", "T") + "Z");
        if (Number.isFinite(end) && end < now) continue;
        if (!/\b(?:beta|playtest|play\s*test|alpha|demo)\b/i.test(x.title)) continue;
        out.push({ id: `gp:${x.id}`, source: "gamerpower", sourceName: "GamerPower", game: cleanGame(x.title), type: "", kind: kindFromText(x.title), url, date, summary: decodeEntities(String(x.description ?? "")).replace(/\s+/g, " ").trim().slice(0, 300), image: safeUrl(x.image) ?? safeUrl(x.thumbnail) ?? null });
    }
    return out.sort((a, b) => b.date - a.date);
}

// ---------- itch.io: https://itch.io/games/newest/tag-playtest.xml ----------
export const ITCH_URL = "https://itch.io/games/newest/tag-playtest.xml";
export function parseItch(xml, { kind = "playtest" } = {}) {
    const out = [];
    for (const m of String(xml ?? "").matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
        const it = m[1];
        const title = decodeEntities(tag(it, "plainTitle") || tag(it, "title").replace(/\s*\[[^\]]*\]/g, "")).replace(/\s+/g, " ").trim();
        const url = safeUrl(tag(it, "link").trim()), date = Date.parse(tag(it, "createDate") || tag(it, "pubDate"));
        if (!title || !url || !Number.isFinite(date)) continue;
        const desc = decodeEntities(tag(it, "description").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
        out.push({ id: `itch:${tag(it, "guid").trim() || url}`, source: "itch", sourceName: "itch.io", game: cleanGame(title), type: "", kind, url, date, summary: desc.slice(0, 300), image: safeUrl(tag(it, "imageurl")) ?? null });
    }
    return out.sort((a, b) => b.date - a.date);
}

// ---------- Steam's list of new demos ----------
export const STEAM_DEMOS_URL = "https://store.steampowered.com/search/results/?query&start=0&count=100&category1=10&sort_by=Released_DESC&json=1&infinite=1";
export function parseSteamDemos(json) {
    let d = json;
    if (typeof json === "string") { try { d = JSON.parse(json); } catch { return []; } }
    const out = [];
    // The link goes to the full game's page when there is one, so its id is the game's, not the demo's.
    for (const m of String(d?.results_html ?? "").matchAll(/<a href="https:\/\/store\.steampowered\.com\/app\/(\d+)\/[^"]*"[^>]*?data-ds-appid="(\d+)"[\s\S]*?<span class="title">([\s\S]*?)<\/span>[\s\S]*?search_released[^>]*>\s*([^<]*?)\s*</gi)) {
        const [, linkApp, demoApp, rawTitle, released] = m;
        const date = Date.parse(`${released} UTC`);
        const title = decodeEntities(rawTitle).replace(/\s+/g, " ").trim();
        if (!title || !Number.isFinite(date)) continue;
        const fullGame = linkApp !== demoApp;
        const game = title.replace(/\s*[-:–]?\s*\bdemo\b\s*$/i, "").trim() || title;
        out.push({ id: `steamdemo:${demoApp}`, source: "steamdemo", sourceName: "the Steam store", game: game.slice(0, 100), type: "", kind: "demo", label: "Demo", url: `https://store.steampowered.com/app/${linkApp}/`, date, summary: fullGame ? "A free demo is on the Steam store page." : "A free demo is on Steam.", image: steamArt(linkApp), appid: Number(linkApp), wishlistOnly: true });
    }
    return out.sort((a, b) => b.date - a.date);
}

// ---------- the merge, and the filter against duplicates ----------
/** Lower number wins when two sources list the same thing. Alpha Beta Gamer writes its own excerpt for each post, so it comes first. */
const PRIORITY = { abg: 0, gamerpower: 1, itch: 2, steamdemo: 3 };
const SAME_WINDOW = 7 * DAY;

/**
 * One entry per game and kind of announcement. Two items are the same when the game names match (sameGame, so a subtitle or a
 * trailing "Demo" doesn't make a difference), they are in the same group (demo or test) and they are within a week of each other.
 * The one from the higher-priority source stays, ties go to the newest.
 */
export function dedupeItems(items) {
    const ranked = [...items].sort((a, b) => (PRIORITY[a.source ?? "abg"] ?? 9) - (PRIORITY[b.source ?? "abg"] ?? 9) || b.date - a.date);
    const kept = [];
    for (const it of ranked) {
        const g = kindGroup(it.kind);
        if (kept.some(k => kindGroup(k.kind) === g && Math.abs(k.date - it.date) <= SAME_WINDOW && sameGame(k.game, it.game))) continue;
        kept.push(it);
    }
    return kept.sort((a, b) => b.date - a.date);
}

/** Keys that remember "this game was announced in this group", for people and servers. A bucket is three weeks; the last two count. */
const BUCKET_MS = 21 * DAY;
export function gameKeys(item, now = Date.now()) {
    const base = `pg:${normName(cleanGame(item.game))}:${kindGroup(item.kind)}`, b = Math.floor(now / BUCKET_MS);
    return { mark: `${base}:${b}`, check: [`${base}:${b}`, `${base}:${b - 1}`] };
}

/** A source that is read on demand, remembered for a while, and still answers from the last good copy when the site is down. */
function cached({ name, ttlMs, load, now }) {
    let cache = null;
    return {
        name,
        async get() {
            if (cache && now() - cache.at < ttlMs) return cache.items;
            try { cache = { at: now(), items: await load() }; }
            catch (err) { if (!cache) throw err; cache.at = now() - ttlMs + 5 * 60_000; }
            return cache.items;
        },
        health: () => (cache ? { at: cache.at, count: cache.items.length } : null)
    };
}

/**
 * Everything in one list: `latest()` has the same shape the Alpha Beta Gamer reader gave, so the checks that used it keep working.
 * A source that fails costs only itself; the merge throws only when every source fails with nothing remembered.
 */
export function createPlaytestSources({ fetchImpl = globalThis.fetch, now = () => Date.now(), abg = null, log = () => {}, ttlMs = 30 * 60_000 } = {}) {
    const get = async (url, as) => {
        const res = await fetchImpl(url, { signal: AbortSignal.timeout(10_000), headers: { "User-Agent": UA, Accept: as === "json" ? "application/json" : "application/xml, text/xml, */*" } });
        if (!res.ok) throw new Error(`${new URL(url).hostname} ${res.status}`);
        return as === "json" ? res.json() : res.text();
    };
    const abgFeed = abg ?? createAbgFeed({ fetchImpl, now, ttlMs });
    const sources = [
        { name: "Alpha Beta Gamer", get: () => abgFeed.latest().then(list => list.map(x => ({ ...x, source: "abg", sourceName: "Alpha Beta Gamer" }))), health: () => null },
        cached({ name: "GamerPower", ttlMs, now, load: async () => parseGamerPower(await get(GAMERPOWER_URL, "json"), { now: now() }) }),
        cached({ name: "itch.io", ttlMs: Math.max(ttlMs, 60 * 60_000), now, load: async () => parseItch(await get(ITCH_URL, "text")) }),
        cached({ name: "Steam demos", ttlMs, now, load: async () => parseSteamDemos(await get(STEAM_DEMOS_URL, "json")) })
    ];
    async function latest() {
        const settled = await Promise.allSettled(sources.map(s => s.get()));
        const items = [];
        let ok = 0, firstErr = null;
        settled.forEach((r, i) => {
            if (r.status === "fulfilled") { ok++; items.push(...r.value); }
            else { firstErr ??= r.reason; log(`playtest source ${sources[i].name}: ${r.reason?.code ?? r.reason?.name ?? r.reason?.message}`); }
        });
        if (!ok) throw firstErr ?? new Error("no playtest source answered");
        return dedupeItems(items);
    }
    return { latest, health: () => Object.fromEntries(sources.map(s => [s.name, s.health?.() ?? null])) };
}
