// The picture behind a profile page: a preset, an uploaded image, or the background the member has equipped on Steam.
// Uploads and Steam backgrounds are both kept as one small image per member and served from our own address.
export const PAGE_PRESETS = ["aurora", "nebula", "dusk", "ember", "forest", "ocean", "carbon", "paper"];
export const PAGE_BG_KINDS = ["none", "preset", "image", "video"];
export const MAX_BG_BYTES = 1_200_000;
export const MAX_BG_STORED = 3;            // pictures one member can keep (uploads and a copied Steam background share this)
export const BG_INACTIVE_MS = 30 * 86400_000; // after this long without opening the bot or dashboard, stored pictures are cleared

export const defaultPageBg = () => ({ kind: "none", preset: "aurora", dim: 35, image: null, video: null });

export function cleanPageBg(input, prev = {}, fail = m => { throw new Error(m); }) {
    const out = { ...defaultPageBg(), ...(prev && typeof prev === "object" ? prev : {}) };
    if (!input || typeof input !== "object") return out;
    if (input.kind !== undefined) { if (!PAGE_BG_KINDS.includes(input.kind)) fail("Pick a page background from the list."); out.kind = input.kind; }
    if (input.preset !== undefined) { if (!PAGE_PRESETS.includes(input.preset)) fail("Pick a preset from the list."); out.preset = input.preset; }
    if (input.image !== undefined) out.image = Number.isInteger(input.image) && input.image > 0 ? input.image : null;
    if (input.video !== undefined) { const v = input.video === null ? null : safeSteamVideo(input.video); if (input.video !== null && !v) fail("That animated background is not from Steam."); out.video = v; }
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

const STEAM_HOST = /^(?:[\w-]+\.)*(?:steamstatic\.com|steamcommunity\.com|akamaihd\.net)$/;
export function safeSteamUrl(url) {
    try { const u = new URL(url); return u.protocol === "https:" && STEAM_HOST.test(u.hostname) ? u.href : null; } catch { return null; }
}
/** A Steam animated background (webm or mp4) on Steam's own servers, or null. */
export function safeSteamVideo(url) {
    const u = safeSteamUrl(url);
    return u && /\.(?:webm|mp4)(?:\?[\w=&.-]*)?$/i.test(new URL(u).pathname + new URL(u).search) ? u : null;
}

/** What a member has equipped on Steam, read from their public profile page: { image, video } (each an address or null). */
export function parseSteamBackgrounds(html) {
    const text = String(html ?? "").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
    const video = /https:\/\/[\w.-]+\/[^"'\s)<>]*\/items\/\d+\/[0-9a-f]{8,}\.(?:webm|mp4)/i.exec(text)?.[0] ?? null;
    const imageHit = /class="[^"]*has_profile_background[^"]*"[^>]*style="[^"]*background-image:\s*url\(\s*['"]?([^'")\s]+)/i.exec(text)
        ?? /profile_background_image_content[^>]*src="([^"]+)"/i.exec(text)
        ?? /background-image:\s*url\(\s*['"]?(https:\/\/[^'")\s]*\/items\/\d+\/[0-9a-f]{8,}\.(?:jpg|jpeg|png))/i.exec(text);
    return { image: safeSteamUrl(imageHit?.[1] ?? ""), video: video ? safeSteamVideo(video) : null };
}
export const parseSteamBackground = html => parseSteamBackgrounds(html).image;

/**
 * Reads the equipped Steam background. An animated one comes back as { video } (it stays on Steam's servers and nothing is stored);
 * a still one is copied and comes back as { buf, mime }. null when there is none. Throws when Steam cannot be reached.
 */
export async function fetchSteamBackground(steamid, fetchImpl = globalThis.fetch) {
    const ua = { "User-Agent": "Mozilla/5.0 (compatible; SteamValueChecker)", "Accept-Language": "en" };
    const page = await fetchImpl(`https://steamcommunity.com/profiles/${encodeURIComponent(steamid)}?l=english`, { headers: ua, signal: AbortSignal.timeout(10000) });
    if (!page.ok) throw new Error("Steam would not show that profile right now.");
    const { image, video } = parseSteamBackgrounds(await page.text());
    if (video) return { video };
    if (!image) return null;
    const img = await fetchImpl(image, { headers: ua, signal: AbortSignal.timeout(15000) });
    if (!img.ok) return null;
    const buf = Buffer.from(await img.arrayBuffer());
    const mime = sniffImage(buf);
    if (!mime) return null;
    if (buf.length > MAX_BG_BYTES * 2) throw new Error("Your Steam background is too large to copy.");
    return { buf, mime };
}
