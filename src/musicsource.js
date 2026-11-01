// SoundCloud for the music feature. It leans on yt-dlp to search and find the real audio address (SoundCloud has no
// open API for new apps) and ffmpeg to turn that into raw sound Discord can play. Only SoundCloud links are accepted.
import { spawn } from "node:child_process";

export const YTDLP = process.env.YTDLP_PATH || "yt-dlp";
export const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";

const SC_HOST = /^(?:www\.|m\.|on\.)?soundcloud\.com$|^snd\.sc$/i;
/** True for a SoundCloud page link (track, set, profile or a short link). Anything else is treated as search words. */
export function isSoundcloudUrl(text) {
    try { const u = new URL(String(text).trim()); return u.protocol === "https:" && SC_HOST.test(u.hostname); } catch { return false; }
}

/** yt-dlp lists some playlist tracks by their API address instead of a page link. Those only ever come from SoundCloud itself, never from a user. */
const isSoundcloudApiUrl = text => { try { const u = new URL(String(text)); return u.protocol === "https:" && /^api(-v2)?\.soundcloud\.com$/i.test(u.hostname) && /^\/tracks\/\d+$/.test(u.pathname); } catch { return false; } };

export const cleanQuery = text => String(text ?? "").replace(/[\r\n\0]+/g, " ").trim().slice(0, 120);

/** "world-on-fire-1" -> "World on fire 1". Playlist listings only carry links, so this stands in until the real title is fetched. */
export function titleFromUrl(url) {
    try {
        const slug = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() ?? "");
        if (/^\d+$/.test(slug)) return "SoundCloud track";
        const words = slug.replace(/[-_]+/g, " ").trim();
        return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Unknown track";
    } catch { return "Unknown track"; }
}

/** One yt-dlp entry as the bot stores it. Returns null for anything that isn't a playable SoundCloud track. */
export function parseEntry(e) {
    const url = e?.webpage_url ?? e?.url;
    if (!url || !(isSoundcloudUrl(url) || isSoundcloudApiUrl(url))) return null;
    const dur = Number(e.duration);
    return {
        url: String(url).split("?")[0], title: String(e.title ?? e.track ?? titleFromUrl(url)).slice(0, 150),
        artist: String(e.uploader ?? e.artist ?? "").slice(0, 80),
        duration: Number.isFinite(dur) && dur > 0 ? Math.round(dur) : null,
        thumb: typeof e.thumbnail === "string" && e.thumbnail.startsWith("https://") ? e.thumbnail : (Array.isArray(e.thumbnails) ? e.thumbnails.map(t => t?.url).filter(x => typeof x === "string" && x.startsWith("https://")).pop() ?? null : null)
    };
}

/** Runs a program and gives back its output, with a time limit so a stuck lookup can't hang the bot. */
export function run(cmd, args, { timeoutMs = 30_000, spawnImpl = spawn } = {}) {
    return new Promise((resolve, reject) => {
        let out = "", err = "", done = false;
        const p = spawnImpl(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
        const finish = (fn, v) => { if (!done) { done = true; clearTimeout(t); fn(v); } };
        const t = setTimeout(() => { try { p.kill("SIGKILL"); } catch { /* gone already */ } finish(reject, new Error("SoundCloud took too long to answer.")); }, timeoutMs);
        p.stdout.on("data", d => { out += d; if (out.length > 20_000_000) { try { p.kill("SIGKILL"); } catch { /* */ } } });
        p.stderr.on("data", d => { err = (err + d).slice(-2000); });
        p.on("error", e => finish(reject, e.code === "ENOENT" ? Object.assign(new Error("The music tools (yt-dlp) aren't installed on this bot."), { missing: true }) : e));
        p.on("close", code => (code === 0 ? finish(resolve, out) : finish(reject, Object.assign(new Error(err.trim().split("\n").pop() || `exit ${code}`), { code }))));
    });
}

export function createSource({ exec = run, spawnImpl = spawn } = {}) {
    const json = async args => JSON.parse(await exec(YTDLP, ["--no-warnings", "--no-call-home", "--ignore-config", ...args]));

    return {
        /** Search SoundCloud. Returns up to `limit` tracks. */
        async search(query, limit = 5) {
            const q = cleanQuery(query);
            if (!q) return [];
            const data = await json(["--flat-playlist", "-J", `scsearch${Math.min(10, Math.max(1, limit))}:${q}`]);
            return (data.entries ?? []).map(parseEntry).filter(Boolean);
        },

        /** A SoundCloud link: one track, or a set/profile with many. */
        async resolve(url) {
            if (!isSoundcloudUrl(url)) throw new Error("That isn't a SoundCloud link.");
            const data = await json(["--flat-playlist", "-J", "--playlist-end", "100", "--", String(url).trim()]);
            if (data._type === "playlist" || Array.isArray(data.entries)) {
                const tracks = (data.entries ?? []).map(parseEntry).filter(Boolean);
                return { kind: "playlist", title: String(data.title ?? "Playlist").slice(0, 120), tracks };
            }
            const t = parseEntry(data);
            return { kind: "track", title: t?.title ?? "", tracks: t ? [t] : [] };
        },

        /** Fills in the length and picture when a track came from a flat list without them. */
        async details(track) {
            if (track.duration && track.thumb) return track;
            try { const t = parseEntry(await json(["--no-playlist", "-J", "--", track.url])); return t ? { ...track, ...Object.fromEntries(Object.entries(t).filter(([, v]) => v)) } : track; }
            catch { return track; }
        },

        /** The raw audio stream for a track, starting `seek` seconds in. Call `.kill()` to stop it. */
        async stream(track, { seek = 0 } = {}) {
            let raw;
            try { raw = await exec(YTDLP, ["--no-warnings", "--ignore-config", "--no-playlist", "-g", "-f", "bestaudio/best", "--", track.url]); }
            catch (err) {
                const msg = String(err?.message ?? "");
                if (/DRM|premium|subscription|Go\+/i.test(msg)) throw new Error("That track is protected (SoundCloud Go+) and can't be streamed.");
                if (/404|not found|private|unavailable|blocked/i.test(msg)) throw new Error("That track is private, removed or blocked in this country.");
                throw err;
            }
            const out = raw.split("\n").map(s => s.trim()).filter(Boolean)[0];
            if (!out || !/^https:\/\//i.test(out)) throw new Error("Couldn't get audio for that track. It may be private or blocked in some countries.");
            const args = ["-hide_banner", "-loglevel", "error", ...(process.env.MUSIC_HTTP_PROXY ? ["-http_proxy", process.env.MUSIC_HTTP_PROXY] : []), "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5", "-reconnect_on_network_error", "1", "-reconnect_on_http_error", "4xx,5xx", "-rw_timeout", "15000000",
                "-i", out, ...(seek > 0 ? ["-ss", String(Math.floor(seek))] : []), "-vn", "-f", "s16le", "-ar", "48000", "-ac", "2", "pipe:1"];
            const p = spawnImpl(FFMPEG, args, { stdio: ["ignore", "pipe", "pipe"] });
            let err = "";
            p.stderr.on("data", d => { err = (err + d).slice(-500); });
            p.on("error", () => {});
            return { stream: p.stdout, process: p, lastError: () => err.trim(), kill: () => { try { p.kill("SIGKILL"); } catch { /* already gone */ } } };
        }
    };
}
