// Turns an SVG into a PNG on the server (for /profilecard and /steam value) and fetches picture links safely.
import { Resvg } from "@resvg/resvg-js";
import { fileURLToPath } from "node:url";
import dns from "node:dns/promises";
import net from "node:net";

const FONTS = ["Inter-Regular.otf", "Inter-SemiBold.otf", "Inter-Bold.otf"].map(f => fileURLToPath(new URL("../assets/fonts/" + f, import.meta.url)));

export function svgToPng(svg, width = 1200) {
    const r = new Resvg(svg, { fitTo: { mode: "width", value: width }, font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: "Inter" } });
    return r.render().asPng();
}

/** True for addresses that are not on the public internet. Pictures from these are never fetched. */
export function isPrivateIp(ip) {
    if (net.isIPv4(ip)) {
        const [a, b] = ip.split(".").map(Number);
        return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
    }
    if (net.isIPv6(ip)) {
        const v = ip.toLowerCase();
        const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
        if (mapped) return isPrivateIp(mapped[1]);
        return v === "::" || v === "::1" || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith("ff");
    }
    return true;
}

const TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

/**
 * Download a picture and return it as a data: URI, or null if anything is off. https only, no redirects, a public address only,
 * images only, a few MB at most. The member gave us the link, so we are strict about where it may point.
 */
export async function fetchImageDataUri(url, { fetchImpl = fetch, resolve = h => dns.lookup(h, { all: true }), max = 4_000_000, timeoutMs = 7000 } = {}) {
    try {
        const u = new URL(url);
        if (u.protocol !== "https:" || u.username || u.password || net.isIP(u.hostname.replace(/^\[|\]$/g, ""))) return null;
        if (u.port && u.port !== "443") return null;
        const addrs = await resolve(u.hostname);
        if (!addrs.length || addrs.some(a => isPrivateIp(a.address))) return null;
        const res = await fetchImpl(u.href, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs), headers: { Accept: "image/*" } });
        if (!res.ok) return null;
        const type = String(res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
        if (!TYPES.has(type)) return null;
        if (Number(res.headers.get("content-length") ?? 0) > max) return null;
        const buf = Buffer.from(await res.arrayBuffer());
        if (!buf.length || buf.length > max) return null;
        return `data:${type};base64,${buf.toString("base64")}`;
    } catch { return null; }
}
