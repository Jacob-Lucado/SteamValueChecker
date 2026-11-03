// A price history picture for Discord: the last year of prices as a step line, with the lowest price and today's price marked.
import { svgToPng } from "./imgrender.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cut = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + "…" : String(s));
const fmt = (n, cur) => { try { return new Intl.NumberFormat("en-US", { style: "currency", currency: cur || "USD" }).format(n); } catch { return `${Number(n).toFixed(2)} ${cur}`; } };

/**
 * points: [{ t (ms), price }] oldest first. Returns SVG text, or null when there is not enough history to draw.
 * now: today's price (drawn as a dashed line), or null.
 */
export function historySvg({ title, points, currency = "USD", now = null, accent = "#ff9800", at = Date.now() }) {
    const pts = (points ?? []).filter(p => Number.isFinite(p?.t) && Number.isFinite(p?.price));
    if (pts.length < 2) return null;
    const W = 1000, H = 420, L = 86, R = 34, T = 108, B = 56, cw = W - L - R, ch = H - T - B;
    const t0 = pts[0].t, t1 = Math.max(at, pts.at(-1).t), span = Math.max(1, t1 - t0);
    const prices = pts.map(p => p.price).concat(now != null ? [now] : []);
    const lo = Math.min(...prices), hi = Math.max(...prices), pad = Math.max((hi - lo) * 0.12, 0.5);
    const yMin = Math.max(0, lo - pad), yMax = hi + pad;
    const x = t => L + ((t - t0) / span) * cw, y = v => T + (1 - (v - yMin) / (yMax - yMin)) * ch;
    // Prices hold until the next change, so the line steps rather than slopes.
    let d = `M${x(pts[0].t).toFixed(1)} ${y(pts[0].price).toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) d += ` H${x(pts[i].t).toFixed(1)} V${y(pts[i].price).toFixed(1)}`;
    d += ` H${x(t1).toFixed(1)}`;
    const area = `${d} V${T + ch} H${x(pts[0].t).toFixed(1)} Z`;
    const low = pts.reduce((m, p) => (p.price < m.price ? p : m), pts[0]);
    const o = [];
    o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
    o.push(`<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#171b26"/><stop offset="1" stop-color="#0d1017"/></linearGradient><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${accent}" stop-opacity="0.35"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></linearGradient></defs>`);
    o.push(`<rect width="${W}" height="${H}" rx="26" fill="url(#bg)"/>`);
    o.push(`<text x="${L}" y="52" font-size="30" font-weight="700" fill="#fff">${esc(cut(title, 38))}</text>`);
    o.push(`<text x="${L}" y="82" font-size="18" fill="#9fb3c4">Price over the last year${now != null ? `  •  now ${esc(fmt(now, currency))}` : ""}  •  lowest ${esc(fmt(low.price, currency))}</text>`);
    for (let g = 0; g <= 3; g++) { // grid lines with the price at each
        const v = yMin + ((yMax - yMin) * g) / 3, gy = y(v);
        o.push(`<line x1="${L}" y1="${gy.toFixed(1)}" x2="${W - R}" y2="${gy.toFixed(1)}" stroke="#fff" stroke-opacity="0.08"/>`);
        o.push(`<text x="${L - 12}" y="${(gy + 6).toFixed(1)}" font-size="16" text-anchor="end" fill="#9fb3c4">${esc(fmt(v, currency).replace(/\.00$/, ""))}</text>`);
    }
    for (let m = 0; m <= 4; m++) { // a handful of dates along the bottom
        const tt = t0 + (span * m) / 4, label = new Date(tt).toLocaleDateString("en-US", { month: "short", year: m === 0 || m === 4 ? "2-digit" : undefined, timeZone: "UTC" });
        o.push(`<text x="${x(tt).toFixed(1)}" y="${H - 20}" font-size="16" text-anchor="${m === 0 ? "start" : m === 4 ? "end" : "middle"}" fill="#9fb3c4">${esc(label)}</text>`);
    }
    o.push(`<path d="${area}" fill="url(#fill)"/>`);
    o.push(`<path d="${d}" fill="none" stroke="${accent}" stroke-width="3.5" stroke-linejoin="round"/>`);
    if (now != null) {
        const ny = y(now);
        o.push(`<line x1="${L}" y1="${ny.toFixed(1)}" x2="${W - R}" y2="${ny.toFixed(1)}" stroke="#57f287" stroke-width="2" stroke-dasharray="8 6"/>`);
    }
    const lx = x(low.t), ly = y(low.price);
    o.push(`<circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="8" fill="#0d1017" stroke="#57f287" stroke-width="3.5"/>`);
    o.push(`</svg>`);
    return o.join("\n");
}

export function renderHistoryChart(args) {
    const svg = historySvg(args);
    return svg ? Buffer.from(svgToPng(svg, 1000)) : null;
}
