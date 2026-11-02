// Where emoji come from besides Discord: emoji.gg packs, and image links from any public website.
import https from "node:https";
import { isPrivateIp, safeLookup } from "./musicradio.js";

export const PACK_KEY_RE = /^\d{1,12}-[a-z0-9-]{1,80}$/;
const IMAGE_TYPE = /^image\/(png|gif|jpeg|webp)$/;
const EMOJIGG_CDN = /^cdn\d*\.emoji\.gg$/i;

export const isEmojiGgCdn = url => { try { const u = new URL(url); return u.protocol === "https:" && EMOJIGG_CDN.test(u.hostname); } catch { return false; } };

/**
 * Downloads an image from any public https address. Private and internal addresses are refused at the moment of connecting
 * (so a name that later points inward can't sneak through), redirects are checked one by one, and anything that isn't a
 * small PNG, GIF, JPG or WebP is rejected.
 */
export function safeFetchImage(address, { maxBytes = 512 * 1024, maxRedirects = 3, timeoutMs = 15_000, lookupImpl, mod = https } = {}) {
    return new Promise((resolve, reject) => {
        const go = (target, left) => {
            let u;
            try { u = new URL(target); } catch { return reject(new Error("that isn't a valid link")); }
            if (u.protocol !== "https:") return reject(new Error("only https links work"));
            if (u.username || u.password) return reject(new Error("links with a login in them aren't allowed"));
            if (u.port && u.port !== "443") return reject(new Error("that port isn't allowed"));
            const host = u.hostname.replace(/^\[|\]$/g, "");
            if (/^[\d.]+$/.test(host) || host.includes(":")) { if (isPrivateIp(host)) return reject(new Error("that address isn't allowed")); }
            if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) return reject(new Error("that address isn't allowed"));
            const req = mod.get(u, { lookup: safeLookup(false, lookupImpl), headers: { "user-agent": "SteamValueChecker/1.0 (+emoji import)", accept: "image/png,image/gif,image/webp,image/jpeg" }, timeout: timeoutMs }, res => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    res.resume();
                    if (left <= 0) return reject(new Error("too many redirects"));
                    return go(new URL(res.headers.location, u).toString(), left - 1);
                }
                if (res.statusCode !== 200) { res.resume(); return reject(new Error(`the site answered HTTP ${res.statusCode}`)); }
                const type = String(res.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
                if (!IMAGE_TYPE.test(type)) { res.resume(); return reject(new Error("that link isn't a PNG, GIF, JPG or WebP image")); }
                const parts = []; let size = 0;
                res.on("data", c => { size += c.length; if (size > maxBytes) { res.destroy(); reject(new Error("larger than 256 KB")); } else parts.push(c); });
                res.on("end", () => resolve({ buf: Buffer.concat(parts), type }));
                res.on("error", reject);
            });
            req.on("timeout", () => req.destroy(new Error("the site took too long")));
            req.on("error", e => reject(e.code === "EPRIVATE" ? new Error("that address isn't allowed") : e));
        };
        go(address, maxRedirects);
    });
}

// ---------- emoji.gg ----------
const decode = s => String(s).replace(/&amp;/g, "&").replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&#0?39;/g, "'");
const humanize = slug => slug.replace(/-+/g, " ").replace(/\b\w/g, c => c.toUpperCase()).trim();
const CDN_IMG = /https:\/\/cdn\d*\.emoji\.gg\/emojis\/(\d+)-([A-Za-z0-9_.-]+?)\.(png|gif|webp)/gi;

/** The packs on a listing page: [{ key, id, title, count, previews, url }]. Reads links and image addresses, not the page's layout. */
export function parsePackList(html) {
    const s = String(html ?? "");
    const hits = [...s.matchAll(/href="(?:https:\/\/emoji\.gg)?\/pack\/(\d+)-([a-z0-9-]+)"/gi)];
    const byId = new Map();
    hits.forEach((m, n) => {
        const id = m[1], slug = m[2].toLowerCase();
        if (!PACK_KEY_RE.test(`${id}-${slug}`)) return;
        const seg = s.slice(m.index, n + 1 < hits.length ? hits[n + 1].index : m.index + 4000);
        const cur = byId.get(id) ?? { key: `${id}-${slug}`, id, title: null, count: null, previews: [], url: `https://emoji.gg/pack/${id}-${slug}` };
        const text = /^[^>]*>([\s\S]*?)<\/a>/i.exec(seg)?.[1]?.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
        if (!cur.title && text && text.length > 1 && text.length <= 120 && !/^[\d.,]+[kKmM]?$/.test(text)) cur.title = decode(text);
        if (!cur.count) cur.count = />\s*(\d[\d,.]*[kKmM]?)\s*</.exec(seg)?.[1] ?? null;
        for (const im of seg.matchAll(CDN_IMG)) { const u = `https://cdn3.emoji.gg/emojis/${im[1]}-${im[2]}.${im[3]}`; if (!cur.previews.includes(u) && cur.previews.length < 4) cur.previews.push(u); }
        byId.set(id, cur);
    });
    return [...byId.values()].map(p => ({ ...p, title: p.title ?? humanize(p.key.replace(/^\d+-/, "")) }));
}

/** Every emoji image on a pack page: [{ id, name, animated, url }]. */
export function parsePackEmojis(html) {
    const seen = new Map();
    for (const m of String(html ?? "").matchAll(CDN_IMG)) {
        if (seen.has(m[1])) continue;
        const name = m[2].replace(/[^A-Za-z0-9_]/g, "_").replace(/^_+|_+$/g, "").slice(0, 32).padEnd(2, "_");
        seen.set(m[1], { id: m[1], name, animated: m[3].toLowerCase() === "gif", url: `https://cdn3.emoji.gg/emojis/${m[1]}-${m[2]}.${m[3].toLowerCase()}` });
    }
    return [...seen.values()];
}

export function createEmojiGg({ fetchImpl = globalThis.fetch, now = Date.now, ttlMs = 15 * 60_000 } = {}) {
    const cache = new Map();
    const page = async (url) => {
        const hit = cache.get(url);
        if (hit && hit.until > now()) return hit.html;
        const res = await fetchImpl(url, { headers: { "user-agent": "SteamValueChecker/1.0 (+emoji packs)", accept: "text/html" }, signal: AbortSignal.timeout(15_000) });
        if (!res.ok) throw new Error(`emoji.gg answered HTTP ${res.status}`);
        const html = await res.text();
        cache.set(url, { html, until: now() + ttlMs });
        if (cache.size > 60) cache.delete(cache.keys().next().value);
        return html;
    };
    return {
        async packs({ sort = "recent", pageNo = 1 } = {}) {
            const q = new URLSearchParams({ sort: ["recent", "downloads", "oldest"].includes(sort) ? sort : "recent", page: String(Math.max(0, Math.min(50, Math.trunc(pageNo) || 0))) });
            const list = parsePackList(await page(`https://emoji.gg/packs?${q}`));
            if (!list.length) throw new Error("I couldn't read emoji.gg's pack list. The site may have changed.");
            return list;
        },
        async pack(key) {
            if (!PACK_KEY_RE.test(String(key))) throw new Error("That isn't a pack.");
            const found = new Map();
            for (let n = 0; n < 5; n++) {
                const html = await page(`https://emoji.gg/pack/${key}${n ? `?page=${n + 1}` : ""}`).catch(e => { if (n === 0) throw e; return ""; });
                const before = found.size;
                for (const e of parsePackEmojis(html)) found.set(e.id, e);
                if (found.size === before) break; // nothing new: that was the last page (or the site ignores the page number)
            }
            if (!found.size) throw new Error("I couldn't find any emoji on that pack's page.");
            return [...found.values()];
        }
    };
}
