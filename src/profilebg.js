// The picture behind a profile page: a preset, an uploaded image, or the background the member has equipped on Steam.
// Uploads and Steam backgrounds are both kept as one small image per member and served from our own address.
export const PAGE_PRESETS = ["aurora", "nebula", "dusk", "ember", "forest", "ocean", "carbon", "paper"];
export const PAGE_BG_KINDS = ["none", "preset", "image"];
export const MAX_BG_BYTES = 1_200_000;
export const MAX_BG_STORED = 3;            // pictures one member can keep (uploads and a copied Steam background share this)
export const BG_INACTIVE_MS = 30 * 86400_000; // after this long without opening the bot or dashboard, stored pictures are cleared

export const defaultPageBg = () => ({ kind: "none", preset: "aurora", dim: 35, image: null });

export function cleanPageBg(input, prev = {}, fail = m => { throw new Error(m); }) {
    const out = { ...defaultPageBg(), ...(prev && typeof prev === "object" ? prev : {}) };
    if (!input || typeof input !== "object") return out;
    if (input.kind !== undefined) { if (!PAGE_BG_KINDS.includes(input.kind)) fail("Pick a page background from the list."); out.kind = input.kind; }
    if (input.preset !== undefined) { if (!PAGE_PRESETS.includes(input.preset)) fail("Pick a preset from the list."); out.preset = input.preset; }
    if (input.image !== undefined) out.image = Number.isInteger(input.image) && input.image > 0 ? input.image : null;
    if (input.dim !== undefined) out.dim = Math.max(0, Math.min(70, Math.round(Number(input.dim) || 0)));
    return out;
}

/** "image/jpeg" | "image/png" | "image/webp" from the first bytes, or null. The file's own claim is never trusted. */
export function sniffImage(buf) {
    if (!buf || buf.length < 12) return null;
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
    if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
    if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
    return null;
}

/** An uploaded picture sent as a data: address -> { buf, mime }. Throws a plain message when it is not an acceptable image. */
export function decodeUpload(data) {
    const m = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(data ?? ""));
    if (!m) throw new Error("Send a JPEG, PNG or WebP picture.");
    const buf = Buffer.from(m[1], "base64");
    if (buf.length > MAX_BG_BYTES) throw new Error("That picture is too big. Keep it under about 1 MB.");
    const mime = sniffImage(buf);
    if (!mime) throw new Error("That does not look like a JPEG, PNG or WebP picture.");
    return { buf, mime };
}

/** The address of the background a member has equipped on Steam, read from their public profile page. null when there is none. */
export function parseSteamBackground(html) {
    const m = /profile_background_image[^"']*["'][^>]*|has_profile_background[^>]*style="[^"]*url\(\s*&?quot?;?'?([^')"&]+)/i.exec(String(html ?? ""));
    const alt = /class="[^"]*has_profile_background[^"]*"[^>]*style="[^"]*background-image:\s*url\(\s*['"]?([^'")\s]+)/i.exec(String(html ?? ""))
        ?? /profile_background_image_content[^>]*src="([^"]+)"/i.exec(String(html ?? ""))
        ?? /background-image:\s*url\(\s*['"]?(https:\/\/[^'")\s]*(?:steamstatic|steamcommunity)[^'")\s]*items\/[^'")\s]+)/i.exec(String(html ?? ""));
    const url = (alt?.[1] ?? m?.[1] ?? "").replace(/&amp;/g, "&");
    return safeSteamUrl(url);
}
const STEAM_HOST = /^(?:[\w-]+\.)*(?:steamstatic\.com|steamcommunity\.com|akamaihd\.net)$/;
export function safeSteamUrl(url) {
    try { const u = new URL(url); return u.protocol === "https:" && STEAM_HOST.test(u.hostname) ? u.href : null; } catch { return null; }
}

/** Reads the equipped Steam background and returns { buf, mime } (null when there is none). Throws when Steam cannot be reached. */
export async function fetchSteamBackground(steamid, fetchImpl = globalThis.fetch) {
    const ua = { "User-Agent": "Mozilla/5.0 (compatible; SteamValueChecker)", "Accept-Language": "en" };
    const page = await fetchImpl(`https://steamcommunity.com/profiles/${encodeURIComponent(steamid)}?l=english`, { headers: ua, signal: AbortSignal.timeout(10000) });
    if (!page.ok) throw new Error("Steam would not show that profile right now.");
    const url = parseSteamBackground(await page.text());
    if (!url) return null;
    const img = await fetchImpl(url, { headers: ua, signal: AbortSignal.timeout(15000) });
    if (!img.ok) return null;
    const buf = Buffer.from(await img.arrayBuffer());
    const mime = sniffImage(buf);
    if (!mime) return null;
    if (buf.length > MAX_BG_BYTES * 2) throw new Error("Your Steam background is too large to copy.");
    return { buf, mime };
}
