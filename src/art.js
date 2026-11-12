// Steam game art, found once and kept. Newer games are not on the old header address, so the right file is looked up, saved on disk
// and served from our own address; Discord embeds and the dashboard both use that address, so a picture is only ever fetched once.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const KINDS = { header: ["header.jpg", "capsule_616x353.jpg", "capsule_231x87.jpg"], hero: ["library_hero.jpg", "header.jpg"], portrait: ["library_600x900.jpg", "header.jpg"] };
export const ART_KINDS = Object.keys(KINDS);
const HOSTS = id => [`https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${id}/`, `https://cdn.akamai.steamstatic.com/steam/apps/${id}/`];
const MISS_MS = 60 * 60_000, MEM_MAX = 400, MAX_BYTES = 3_000_000;

const state = { base: null, dir: null };
const mem = new Map();      // "kind:id" -> { buf, type }
const misses = new Map();   // "kind:id" -> when it was last not found
const noteMiss = key => { if (misses.size >= 3000) { const cut = Date.now() - MISS_MS; for (const [k, t] of misses) if (t < cut) misses.delete(k); if (misses.size >= 3000) misses.clear(); } misses.set(key, Date.now()); }
const inflight = new Map();

export function configureArt({ base = null, dir = null } = {}) {
    state.base = base ? String(base).replace(/\/$/, "") : null;
    state.dir = dir;
    if (dir) { try { mkdirSync(dir, { recursive: true }); } catch { state.dir = null; } }
}
export const directArt = (appid, kind = "header") => `https://cdn.akamai.steamstatic.com/steam/apps/${encodeURIComponent(appid)}/${KINDS[kind]?.[0] ?? "header.jpg"}`;
/** The address to put in an embed or an <img>: ours when the site address is known, Steam's own otherwise. */
export const steamArt = (appid, kind = "header") => (state.base && /^\d{1,10}$/.test(String(appid)) && KINDS[kind] ? `${state.base}/art/${kind}/${appid}.jpg` : directArt(appid, kind));

const typeOf = buf => (buf[0] === 0x89 && buf[1] === 0x50 ? "image/png" : buf[0] === 0x47 ? "image/gif" : buf[0] === 0x52 ? "image/webp" : "image/jpeg");
const remember = (key, val) => { mem.set(key, val); if (mem.size > MEM_MAX) mem.delete(mem.keys().next().value); return val; };

async function grab(fetchImpl, url) {
    try {
        const res = await fetchImpl(url, { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "Mozilla/5.0 (compatible; SteamValueChecker)" } });
        if (!res.ok || !/^image\//i.test(res.headers?.get?.("content-type") ?? "image/jpeg")) return null;
        const buf = Buffer.from(await res.arrayBuffer());
        return buf.length > 200 && buf.length <= MAX_BYTES ? buf : null;
    } catch { return null; }
}
async function find(appid, kind, fetchImpl) {
    for (const name of KINDS[kind]) for (const host of HOSTS(appid)) { const b = await grab(fetchImpl, host + name); if (b) return b; }
    try { // the store's own record names the current header, hashed path and all
        const res = await fetchImpl(`https://store.steampowered.com/api/appdetails?appids=${appid}&filters=basic`, { signal: AbortSignal.timeout(8000) });
        const url = res.ok ? (await res.json())?.[appid]?.data?.header_image : null;
        if (typeof url === "string" && /^https:\/\//.test(url)) return await grab(fetchImpl, url);
    } catch { /* nothing more to try */ }
    return null;
}
/** { buf, type } for a game's art, from memory, from disk, or fetched (and then kept). null when Steam has none. */
export async function resolveArt(appid, kind = "header", { fetchImpl = globalThis.fetch } = {}) {
    if (!/^\d{1,10}$/.test(String(appid)) || !KINDS[kind]) return null;
    const key = `${kind}:${appid}`;
    if (mem.has(key)) return mem.get(key);
    const file = state.dir ? join(state.dir, `${kind}-${appid}.img`) : null;
    if (file && existsSync(file)) { try { const buf = readFileSync(file); return remember(key, { buf, type: typeOf(buf) }); } catch { /* refetch */ } }
    if (Date.now() - (misses.get(key) ?? 0) < MISS_MS) return null;
    if (!inflight.has(key)) inflight.set(key, (async () => {
        const buf = await find(appid, kind, fetchImpl);
        if (!buf) { noteMiss(key); return null; }
        if (file) { try { writeFileSync(file, buf); } catch { /* still served from memory */ } }
        return remember(key, { buf, type: typeOf(buf) });
    })().finally(() => inflight.delete(key)));
    return inflight.get(key);
}

const SAFE_HOSTS = ["steamstatic.com", "hb.imgix.net", "indiegalacdn.com", "indiegala.com", "isthereanydeal.com", "fanatical.com", "humblebundle.com", "steampowered.com"];
/** A picture some store gave us a link to (bundle covers), kept under our own key so the page never asks the store twice. */
export async function resolveUrlArt(key, url, { fetchImpl = globalThis.fetch } = {}) {
    if (!/^[a-z0-9:-]{1,60}$/i.test(String(key))) return null;
    let host;
    try { const u = new URL(url); if (u.protocol !== "https:") return null; host = u.hostname; } catch { return null; }
    if (!SAFE_HOSTS.some(h => host === h || host.endsWith("." + h))) return null;
    const memKey = `url:${key}`;
    if (mem.has(memKey)) return mem.get(memKey);
    const file = state.dir ? join(state.dir, `${key.replace(/:/g, "-")}.img`) : null;
    if (file && existsSync(file)) { try { const buf = readFileSync(file); return remember(memKey, { buf, type: typeOf(buf) }); } catch { /* refetch */ } }
    if (Date.now() - (misses.get(memKey) ?? 0) < MISS_MS) return null;
    if (!inflight.has(memKey)) inflight.set(memKey, (async () => {
        const buf = await grab(fetchImpl, url);
        if (!buf) { noteMiss(memKey); return null; }
        if (file) { try { writeFileSync(file, buf); } catch { /* memory only */ } }
        return remember(memKey, { buf, type: typeOf(buf) });
    })().finally(() => inflight.delete(memKey)));
    return inflight.get(memKey);
}
