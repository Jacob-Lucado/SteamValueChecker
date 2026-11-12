// Video and image files for giveaways: what is allowed, and a safe download from Discord's own servers.
import { UserError } from "./errors.js";

export const MEDIA_MAX_BYTES = 10 * 1024 * 1024;
export const VIDEO_TYPES = { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" };
export const IMAGE_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
export const isVideoType = t => Object.hasOwn(VIDEO_TYPES, String(t ?? "").split(";")[0].toLowerCase());

const HOSTS = ["cdn.discordapp.com", "media.discordapp.net"];

/** Downloads a Discord attachment. Only Discord's CDN, only up to the size limit. */
export async function fetchDiscordFile(a, { types, what = "file" }) {
    const type = String(a.contentType ?? "").split(";")[0].toLowerCase();
    if (!Object.hasOwn(types, type)) throw new UserError(`That ${what} isn't a type I can use.`);
    if (a.size > MEDIA_MAX_BYTES) throw new UserError(`That ${what} is too big. Keep it under 10 MB.`);
    let u;
    try { u = new URL(a.url); } catch { throw new UserError(`I couldn't read that ${what}.`); }
    if (u.protocol !== "https:" || !HOSTS.includes(u.hostname)) throw new UserError(`Send the ${what} as an attachment.`);
    const res = await fetch(u, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new UserError(`I couldn't download that ${what}. Try sending it again.`);
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > MEDIA_MAX_BYTES) throw new UserError(`That ${what} is too big. Keep it under 10 MB.`);
    return { buffer, type, name: a.name };
}

/** Checks a video that arrived as base64 from the dashboard. Returns { buffer, type, name } or null when there is none. */
export function videoFromBody(body) {
    if (!body?.video_b64) return null;
    const type = String(body.video_type ?? "").split(";")[0].toLowerCase();
    if (!Object.hasOwn(VIDEO_TYPES, type)) throw new UserError("Use an MP4, WebM or MOV video.");
    const b64 = String(body.video_b64);
    if (b64.length > MEDIA_MAX_BYTES * 1.4) throw new UserError("That video is too big. Keep it under 10 MB.");
    const buffer = Buffer.from(b64, "base64");
    if (!buffer.length || buffer.length > MEDIA_MAX_BYTES) throw new UserError("That video is too big. Keep it under 10 MB.");
    return { buffer, type, name: String(body.video_name ?? "video").slice(0, 100) };
}
