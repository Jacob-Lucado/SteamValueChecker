// Tells Bing (and the engines that share its index: Yahoo, DuckDuckGo and others) when the site's pages change, using IndexNow,
// so new pages are crawled in hours instead of weeks. It runs once after a deploy that changed something, never on every restart.
import { createHash } from "node:crypto";
import { seoSlugs } from "./seopages.js";
import { LATEST } from "./changelog.js";

// The key only proves the file is ours; it is public by design. Derived from the site address so it stays the same across deploys.
export const indexNowKey = origin => createHash("sha256").update(`indexnow:${origin}`).digest("hex").slice(0, 32);
export const siteUrls = origin => ["/", "/grabber", "/ai", ...seoSlugs().map(s => `/${s}`)].map(p => origin + p);

export async function pingIndexNow({ origin, db, fetchImpl = fetch, log = console.log }) {
    const host = new URL(origin).hostname;
    if (!/^https:/.test(origin) || /^(localhost|127\.|10\.|192\.168\.)/.test(host) || !host.includes(".")) return { skipped: "not a public address" };
    const urls = siteUrls(origin);
    const sig = createHash("sha1").update(`${LATEST}|${urls.join(",")}`).digest("hex");
    if (db.getMeta("indexnow:sig") === sig) return { skipped: "already sent for this version" };
    const key = indexNowKey(origin);
    try {
        const res = await fetchImpl("https://api.indexnow.org/indexnow", {
            method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" },
            body: JSON.stringify({ host, key, keyLocation: `${origin}/${key}.txt`, urlList: urls }),
            signal: AbortSignal.timeout(15000)
        });
        // 200 and 202 both mean it was accepted (202 means the key file is still being checked).
        if (res.status === 200 || res.status === 202) { db.setMeta("indexnow:sig", sig); log(`[indexnow] sent ${urls.length} pages (${res.status})`); return { sent: urls.length, status: res.status }; }
        log(`[indexnow] not accepted (${res.status})`);
        return { error: res.status };
    } catch (e) { log(`[indexnow] could not send: ${e.message}`); return { error: e.message }; }
}
