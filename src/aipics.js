// Pictures the AI companion sends instead of a wall of text: a dark panel with big numbers, a bar per row and small game
// or achievement icons. One drawing routine for all of them, so every answer looks like it belongs to the same bot.
import { svgToPng, fetchImageDataUri } from "./imgrender.js";

const W = 960, PAD = 40, BG = "#12151d", PANEL = "#1b2030", INK = "#ffffff", SUB = "#9aa6bd", ACCENT = "#66c0f4";
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const tw = (s, size, bold = false) => [...String(s)].reduce((t, c) => t + (c === " " ? 0.28 : /[A-Z0-9MW]/.test(c) ? 0.68 : /[il.,'|:]/.test(c) ? 0.28 : 0.55), 0) * size * (bold ? 1.06 : 1);
const fit = (s, size, maxW, bold = false) => { let t = String(s ?? ""); if (tw(t, size, bold) <= maxW) return t; while (t.length > 1 && tw(t + "…", size, bold) > maxW) t = t.slice(0, -1); return t.replace(/\s+$/, "") + "…"; };

/**
 * panel = { title, sub, tiles: [{label, value}], rows: [{label, sub, icon, value, note, pct}], colors? }
 * `pct` (0 to 100) draws the bar. `icon` is an https address, fetched once and put in as data.
 */
export function panelSvg(panel, pics = {}) {
    const accent = panel.accent ?? ACCENT, tiles = (panel.tiles ?? []).slice(0, 4), rows = (panel.rows ?? []).slice(0, 8);
    const defs = [], body = [];
    let y = PAD;
    body.push(`<text x="${PAD}" y="${y + 30}" font-size="34" font-weight="700" fill="${INK}">${esc(fit(panel.title, 34, W - PAD * 2 - 120, true))}</text>`);
    body.push(`<rect x="${W - PAD - 90}" y="${y + 6}" width="90" height="8" rx="4" fill="${accent}"/>`);
    if (panel.sub) body.push(`<text x="${PAD}" y="${y + 62}" font-size="19" fill="${SUB}">${esc(fit(panel.sub, 19, W - PAD * 2))}</text>`);
    y += panel.sub ? 92 : 64;
    if (tiles.length) {
        const gap = 16, tw_ = (W - PAD * 2 - gap * (tiles.length - 1)) / tiles.length;
        tiles.forEach((t, n) => {
            const x = PAD + n * (tw_ + gap);
            body.push(`<rect x="${x}" y="${y}" width="${tw_}" height="104" rx="16" fill="${PANEL}"/><rect x="${x}" y="${y + 20}" width="5" height="64" rx="2.5" fill="${accent}"/>`);
            body.push(`<text x="${x + 24}" y="${y + 58}" font-size="${tiles.length > 3 ? 34 : 40}" font-weight="700" fill="${INK}">${esc(fit(t.value, tiles.length > 3 ? 34 : 40, tw_ - 40, true))}</text>`);
            body.push(`<text x="${x + 24}" y="${y + 88}" font-size="16" font-weight="600" fill="${SUB}">${esc(String(t.label).toUpperCase())}</text>`);
        });
        y += 104 + 24;
    }
    rows.forEach((r, n) => {
        const both = r.sub && r.pct !== undefined, h = both ? 90 : 76, cx = PAD, iconS = 52, textX = cx + 20 + (r.icon !== undefined ? iconS + 16 : 0);
        body.push(`<rect x="${cx}" y="${y}" width="${W - PAD * 2}" height="${h}" rx="14" fill="${PANEL}"/>`);
        if (r.icon !== undefined) {
            const id = "i" + n, ix = cx + 14, iy = y + (h - iconS) / 2;
            defs.push(`<clipPath id="${id}"><rect x="${ix}" y="${iy}" width="${iconS}" height="${iconS}" rx="10"/></clipPath>`);
            body.push(pics[r.icon] ? `<image href="${pics[r.icon]}" x="${ix}" y="${iy}" width="${iconS}" height="${iconS}" clip-path="url(#${id})" preserveAspectRatio="xMidYMid slice"/>` : `<rect x="${ix}" y="${iy}" width="${iconS}" height="${iconS}" rx="10" fill="${accent}" fill-opacity="0.25"/>`);
        }
        const right = r.value ? tw(r.value, 22, true) + 8 : 0, maxW = W - PAD - 24 - textX - right - (r.pct !== undefined ? 0 : 0);
        body.push(`<text x="${textX}" y="${y + (r.sub || r.pct !== undefined ? 31 : 45)}" font-size="21" font-weight="700" fill="${INK}">${esc(fit(r.label, 21, maxW, true))}</text>`);
        if (r.value) body.push(`<text x="${W - PAD - 22}" y="${y + 33}" font-size="22" font-weight="700" text-anchor="end" fill="${accent}">${esc(r.value)}</text>`);
        if (r.sub) body.push(`<text x="${textX}" y="${y + 56}" font-size="16" fill="${SUB}">${esc(fit(r.sub, 16, maxW))}</text>`);
        if (r.pct !== undefined) {
            const bx = textX, bw = W - PAD - 24 - bx, fill = Math.max(4, Math.min(100, r.pct)) / 100 * bw;
            body.push(`<rect x="${bx}" y="${y + (both ? 68 : 54)}" width="${bw}" height="8" rx="4" fill="#ffffff" fill-opacity="0.08"/><rect x="${bx}" y="${y + (both ? 68 : 54)}" width="${fill}" height="8" rx="4" fill="${accent}"/>`);
        }
        y += h + 10;
    });
    const H = y + PAD - 10 + (panel.foot ? 26 : 0);
    if (panel.foot) body.push(`<text x="${PAD}" y="${H - PAD + 14}" font-size="15" fill="${SUB}">${esc(fit(panel.foot, 15, W - PAD * 2))}</text>`);
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${defs.join("")}</defs><rect width="${W}" height="${H}" rx="0" fill="${BG}"/><rect width="${W}" height="6" fill="${accent}"/>${body.join("")}</svg>`;
}

/** The panel as a PNG buffer. A picture that cannot be fetched is drawn as a plain tile. */
export async function renderPanel(panel, { fetchImpl = fetch } = {}) {
    // A row's icon may be a list of addresses to try in order (the achievement icon, then the game's own picture).
    const rows = (panel.rows ?? []).slice(0, 8).map(r => (Array.isArray(r.icon) ? { ...r, icons: r.icon.filter(u => typeof u === "string" && /^https:\/\//i.test(u)) } : { ...r, icons: typeof r.icon === "string" ? [r.icon] : [] }));
    const pics = {};
    await Promise.all(rows.map(async r => { for (const u of r.icons) { if (!pics[u]) { const d = await fetchImageDataUri(u, { fetchImpl }).catch(() => null); if (d) pics[u] = d; } if (pics[u]) { r.icon = u; return; } } r.icon = r.icon === undefined || r.icon === null ? r.icon : null; }));
    panel = { ...panel, rows };
    return svgToPng(panelSvg(panel, pics), W * 2 > 1920 ? 1920 : W * 2);
}

/** Numbered steps as a picture: a circle with the number, the instruction, and the command in a pill under it. */
export function stepsSvg({ title, sub, steps, accent = ACCENT, foot }) {
    const list = steps.slice(0, 7), body = [];
    const TXT = W - PAD * 2 - 120;
    const wrapLines = (text, size) => { const out = []; let cur = ""; for (const w of String(text).split(/\s+/)) { const n = cur ? cur + " " + w : w; if (tw(n, size) <= TXT || !cur) cur = n; else { out.push(cur); cur = w; } } if (cur) out.push(cur); return out.slice(0, 3); };
    let y = PAD;
    body.push(`<text x="${PAD}" y="${y + 30}" font-size="34" font-weight="700" fill="${INK}">${esc(fit(title, 34, W - PAD * 2 - 120, true))}</text><rect x="${W - PAD - 90}" y="${y + 6}" width="90" height="8" rx="4" fill="${accent}"/>`);
    if (sub) body.push(`<text x="${PAD}" y="${y + 62}" font-size="19" fill="${SUB}">${esc(fit(sub, 19, W - PAD * 2))}</text>`);
    y += sub ? 96 : 66;
    list.forEach((s, n) => {
        const lines = wrapLines(s.text, 21), cmd = s.cmd ? fit(s.cmd, 19, TXT - 30, true) : null;
        const h = cmd ? 30 + lines.length * 28 - 6 + 38 + 20 : Math.max(84, 42 + lines.length * 28 + 14);
        body.push(`<rect x="${PAD}" y="${y}" width="${W - PAD * 2}" height="${h}" rx="16" fill="${PANEL}"/>`);
        body.push(`<circle cx="${PAD + 44}" cy="${y + 42}" r="24" fill="${accent}"/><text x="${PAD + 44}" y="${y + 51}" font-size="26" font-weight="700" text-anchor="middle" fill="#0b1220">${n + 1}</text>`);
        lines.forEach((l, k) => body.push(`<text x="${PAD + 92}" y="${y + 40 + k * 28}" font-size="21" font-weight="${k === 0 ? 600 : 400}" fill="${INK}">${esc(l)}</text>`));
        if (cmd) { const cw = tw(cmd, 19, true) + 34, cy = y + 30 + lines.length * 28 - 6; body.push(`<rect x="${PAD + 92}" y="${cy}" width="${cw}" height="38" rx="10" fill="#0b0f18" stroke="${accent}" stroke-opacity="0.6"/><text x="${PAD + 109}" y="${cy + 26}" font-size="19" font-weight="700" fill="${accent}">${esc(cmd)}</text>`); }
        y += h + 12;
    });
    const H = y + PAD - 12 + (foot ? 24 : 0);
    if (foot) body.push(`<text x="${PAD}" y="${H - PAD + 12}" font-size="15" fill="${SUB}">${esc(fit(foot, 15, W - PAD * 2))}</text>`);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${BG}"/><rect width="${W}" height="6" fill="${accent}"/>${body.join("")}</svg>`;
}
export const renderSteps = guide => svgToPng(stepsSvg(guide), 1920);
