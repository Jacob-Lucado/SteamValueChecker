// Live radio for the music player: a plain http(s) audio stream such as an Icecast or Shoutcast station.
// Anyone in a server can paste an address, so the connection is locked down: only public addresses, and every hop of a redirect is checked.
import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import net from "node:net";
import { UserError } from "./errors.js";

/** True for loopback, private, link-local and other addresses a station would never use (and a server must never reach for someone). */
export function isPrivateIp(ip) {
    const v = net.isIP(ip);
    if (v === 4) {
        const [a, b] = ip.split(".").map(Number);
        return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || (b === 0 && ip.startsWith("192.0.0.")))) || (a === 198 && (b === 18 || b === 19));
    }
    if (v === 6) {
        const x = ip.toLowerCase();
        const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
        if (mapped) return isPrivateIp(mapped[1]);
        return x === "::" || x === "::1" || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || x.startsWith("ff") || x.startsWith("64:ff9b");
    }
    return true;
}

/** The address as a URL object when it could be a radio stream, otherwise null. */
export function parseRadioUrl(text) {
    let u;
    try { u = new URL(String(text ?? "").trim()); } catch { return null; }
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (u.username || u.password) return null;
    const host = u.hostname.toLowerCase();
    if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return null;
    if (net.isIP(host.replace(/^\[|\]$/g, "")) && isPrivateIp(host.replace(/^\[|\]$/g, ""))) return null;
    return u;
}

/** A DNS lookup that refuses private answers, so the address that is really connected to is the one that was checked. */
export function safeLookup(allowPrivate = false, lookupImpl = dns.lookup) {
    return (hostname, options, cb) => {
        if (typeof options === "function") { cb = options; options = {}; }
        lookupImpl(hostname, { ...options, all: true }, (err, addrs) => {
            if (err) return cb(err);
            const ok = addrs.filter(a => allowPrivate || !isPrivateIp(a.address));
            if (!ok.length) return cb(Object.assign(new Error("private address"), { code: "EPRIVATE" }));
            if (options?.all) return cb(null, ok);
            cb(null, ok[0].address, ok[0].family);
        });
    };
}

const PLAYLIST_TYPES = /mpegurl|x-scpls|pls\b/i;
const OK_TYPES = /^(audio\/|application\/ogg|application\/octet-stream|video\/(mp4|ogg)|binary\/octet-stream)/i;

/**
 * Opens the stream and returns its response so the caller can read audio from it.
 * Rejects (with a plain sentence) when it isn't reachable, isn't audio, or points somewhere it shouldn't.
 */
export function openRadio(address, { allowPrivate = false, maxRedirects = 3, timeoutMs = 10_000, mods = { "http:": http, "https:": https }, lookupImpl = dns.lookup } = {}) {
    return new Promise((resolve, reject) => {
        const fail = msg => reject(new UserError(msg));
        const go = (target, left) => {
            const u = allowPrivate ? (() => { try { return new URL(target); } catch { return null; } })() : parseRadioUrl(target);
            if (!u || !(u.protocol === "http:" || u.protocol === "https:")) return fail("That doesn't look like a stream address I can open.");
            const req = mods[u.protocol].get(u, { headers: { "User-Agent": "Mozilla/5.0 (music bot)", Accept: "*/*", Connection: "close" }, lookup: safeLookup(allowPrivate, lookupImpl), timeout: timeoutMs }, res => {
                const code = res.statusCode ?? 0;
                if (code >= 300 && code < 400 && res.headers.location) {
                    res.resume(); req.destroy();
                    if (left <= 0) return fail("That address redirects too many times.");
                    let next; try { next = new URL(res.headers.location, u).toString(); } catch { return fail("That address redirects somewhere I can't use."); }
                    return go(next, left - 1);
                }
                if (code !== 200) { res.resume(); req.destroy(); return fail(code === 404 ? "That stream address doesn't exist." : `The stream answered with an error (${code}).`); }
                const type = String(res.headers["content-type"] ?? "");
                if (PLAYLIST_TYPES.test(type) || /\.(m3u8?|pls)(\?|$)/i.test(u.pathname)) { res.resume(); req.destroy(); return fail("That's a playlist file, not the stream itself. Paste the direct stream address (the one the playlist points to)."); }
                if (type && !OK_TYPES.test(type)) { res.resume(); req.destroy(); return fail("That link isn't an audio stream."); }
                const name = String(res.headers["icy-name"] ?? "").trim().slice(0, 100);
                resolve({ res, name, genre: String(res.headers["icy-genre"] ?? "").slice(0, 60), bitrate: Number(res.headers["icy-br"]) || null, url: u.toString(), close: () => { try { res.destroy(); req.destroy(); } catch { /* gone */ } } });
            });
            req.on("timeout", () => { req.destroy(); fail("The stream didn't answer in time."); });
            req.on("error", e => fail(e?.code === "EPRIVATE" ? "That address isn't a public stream." : "I couldn't reach that stream."));
        };
        go(address, maxRedirects);
    });
}

/** Checks a pasted address is a working audio stream and describes it as a queue entry. */
export async function probeRadio(address, opts = {}) {
    const r = await openRadio(address, opts);
    r.close();
    let host = ""; try { host = new URL(r.url).hostname.replace(/^www\./, ""); } catch { /* */ }
    return { url: r.url, title: r.name || host || "Live radio", artist: r.genre ? `Live radio · ${r.genre}` : "Live radio", duration: null, thumb: null, live: true, radio: true };
}
