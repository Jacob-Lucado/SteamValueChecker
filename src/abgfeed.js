// Alpha Beta Gamer (alphabetagamer.com) lists free alpha, beta and playtest sign-ups and demos. Its public RSS feed is read here.
// Only the title, a short excerpt, a picture and the link are used, and every post links back to the site.
export const ABG_FEED = "https://www.alphabetagamer.com/feed/";

const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”" };
export const decodeEntities = s => String(s ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16) || 32))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d) || 32))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);
const cdata = s => String(s ?? "").replace(/^\s*<!\[CDATA\[/, "").replace(/\]\]>\s*$/, "");
const tag = (xml, name) => { const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(xml); return m ? cdata(m[1]) : ""; };

/** The kind of post, from the end of its title ("Beta Demo", "Beta Sign Up", "Open Beta", "Alpha Demo"). Tolerates the site's typos. */
export function abgKind(type) {
    const t = String(type ?? "").toLowerCase();
    if (/sign\s*-?\s*up/.test(t)) return "signup";
    if (/playtest|play\s*test/.test(t)) return "playtest";
    if (/alpha/.test(t)) return "alpha";
    if (/dem[o0]/.test(t)) return "demo";
    if (/be+ta/.test(t)) return "beta";
    return "beta";
}

export function parseAbgFeed(xml) {
    const out = [];
    for (const m of String(xml ?? "").matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
        const it = m[1];
        const title = decodeEntities(tag(it, "title")).replace(/\s+/g, " ").trim();
        const url = tag(it, "link").trim(), guid = tag(it, "guid").trim() || url;
        const date = Date.parse(tag(it, "pubDate"));
        if (!title || !/^https:\/\//.test(url) || !Number.isFinite(date)) continue;
        const cut = title.lastIndexOf(" – ") >= 0 ? title.lastIndexOf(" – ") : title.lastIndexOf(" - ");
        const game = (cut > 0 ? title.slice(0, cut) : title).trim().slice(0, 100), type = cut > 0 ? title.slice(cut + 3).trim() : "";
        const html = tag(it, "description");
        const poster = /poster="(https:\/\/[^"]+)"/i.exec(html)?.[1] ?? /<img[^>]+src="(https:\/\/[^"]+)"/i.exec(html)?.[1] ?? null;
        const text = decodeEntities(html.replace(/<video[\s\S]*?<\/video>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
        const summary = text.split(/\bRead More\b|The post .* first appeared on/i)[0].trim().slice(0, 300);
        out.push({ id: guid, game, type, kind: abgKind(type), url, date, summary, image: poster});
    }
    return out.sort((a, b) => b.date - a.date);
}

export function createAbgFeed({ fetchImpl = globalThis.fetch, now = () => Date.now(), ttlMs = 30 * 60_000 } = {}) {
    let cache = null;
    /** The latest posts, remembered for half an hour. A failed fetch gives the last answer, or throws if there never was one. */
    async function latest() {
        if (cache && now() - cache.at < ttlMs) return cache.items;
        try {
            const res = await fetchImpl(ABG_FEED, { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "SteamValueChecker/1.0 (+https://steamvaluechecker.com)" } });
            if (!res.ok) throw new Error(`alphabetagamer ${res.status}`);
            cache = { at: now(), items: parseAbgFeed(await res.text()) };
        } catch (err) { if (!cache) throw err; cache.at = now() - ttlMs + 5 * 60_000; } // keep serving the old list, try again in 5 minutes
        return cache.items;
    }
    return { latest };
}

/** Lower-case letters and digits only, for comparing game names between sources. */
export const normName = s => String(s ?? "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");

/** The title without a subtitle: "Rock Band Simulator: Tour Edition" -> "Rock Band Simulator". A trailing number is part of the name. */
const baseTitle = t => String(t ?? "").split(/\s*[:\u2013\u2014]\s*|\s+-\s+/)[0];

/** True when the site's game name and a member's title are the same game: equal, or equal once a subtitle is dropped. "Dark Roll 2" is not "Dark Roll". */
export function sameGame(a, b) {
    const x = normName(a), y = normName(b);
    if (!x || !y) return false;
    if (x === y) return true;
    const bx = normName(baseTitle(a)), by = normName(baseTitle(b));
    return (bx.length >= 4 && bx === y) || (by.length >= 4 && by === x) || (bx.length >= 4 && bx === by);
}
