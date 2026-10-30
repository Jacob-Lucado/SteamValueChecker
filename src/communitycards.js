// Picture cards for /rank, /levels and /invites, drawn as SVG and turned into PNG like the profile card.
// No emoji are drawn (the bundled font has none); medals, rings and bars are shapes.
import { svgToPng, fetchImageDataUri } from "./imgrender.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cut = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + "…" : String(s));
const num = n => Number(n ?? 0).toLocaleString("en-US");
const GOLD = "#f5c542", SILVER = "#c0c8d4", BRONZE = "#d08a4e";
const MEDAL = [GOLD, SILVER, BRONZE];

const defs = (a, b) => `<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#101827"/><stop offset="1" stop-color="#0b1020"/></linearGradient>
  <linearGradient id="acc" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>
  <radialGradient id="glow" cx="0.15" cy="0.1" r="0.9"><stop offset="0" stop-color="${a}" stop-opacity="0.28"/><stop offset="1" stop-color="${a}" stop-opacity="0"/></radialGradient>
  <clipPath id="c"><circle cx="0" cy="0" r="1"/></clipPath>
</defs>`;

/** A round picture at (cx, cy) with a ring; a lettered circle when there is no picture. */
function avatar(cx, cy, r, art, name, ring) {
    const id = `a${Math.round(cx)}_${Math.round(cy)}`;
    const letter = esc([...String(name || "?")][0]?.toUpperCase() ?? "?");
    const body = art
        ? `<clipPath id="${id}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath><image href="${art}" x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}" clip-path="url(#${id})" preserveAspectRatio="xMidYMid slice"/>`
        : `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#243049"/><text x="${cx}" y="${cy + r * 0.36}" font-size="${r * 1.1}" font-weight="700" fill="#9fb2d6" text-anchor="middle">${letter}</text>`;
    return `${body}<circle cx="${cx}" cy="${cy}" r="${r + 3}" fill="none" stroke="${ring}" stroke-width="4"/>`;
}

const bar = (x, y, w, h, pct, id = "acc") => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="#1c2740"/><rect x="${x}" y="${y}" width="${Math.max(h, Math.round(w * Math.min(1, Math.max(0, pct))))}" height="${h}" rx="${h / 2}" fill="url(#${id})"/>`;
const stat = (x, y, w, label, value) => `<rect x="${x}" y="${y}" width="${w}" height="92" rx="16" fill="#162036" stroke="#23314f" stroke-width="1.5"/>
  <text x="${x + 20}" y="${y + 32}" font-size="15" font-weight="600" fill="#7f93ba" letter-spacing="1.5">${esc(label.toUpperCase())}</text>
  <text x="${x + 20}" y="${y + 70}" font-size="32" font-weight="700" fill="#f3f6fc">${esc(value)}</text>`;

const frame = (w, h, body, a, b) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Inter">${defs(a, b)}
  <rect width="${w}" height="${h}" rx="28" fill="url(#bg)"/><rect width="${w}" height="${h}" rx="28" fill="url(#glow)"/>
  <rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="27" fill="none" stroke="#26324d" stroke-width="2"/>${body}</svg>`;

/** The /rank card. d: { name, art, server, level, into, need, rank, members, xp, messages, invited } */
export function rankCardSvg(d) {
    const top = d.rank && d.rank <= 3, accent = top ? MEDAL[d.rank - 1] : "#70a6d8", accent2 = top ? "#ffffff" : "#8b7cf6";
    const pct = d.need ? d.into / d.need : 0;
    const pill = d.rank ? `RANK #${d.rank} OF ${d.members}` : "NOT RANKED YET";
    const pw = Math.round(tw(pill, 20) + 44);
    return frame(1000, 420, `
  ${avatar(120, 118, 70, d.art, d.name, accent)}
  <text x="226" y="92" font-size="40" font-weight="700" fill="#f3f6fc">${esc(cut(d.name, 22))}</text>
  <text x="226" y="122" font-size="19" font-weight="600" fill="#7f93ba">${esc(cut(d.server ?? "", 36))}</text>
  <rect x="226" y="138" width="${pw}" height="40" rx="20" fill="url(#acc)"/>
  <text x="${226 + pw / 2}" y="165" font-size="20" font-weight="700" fill="#0b1020" text-anchor="middle">${esc(pill)}</text>
  <text x="952" y="82" font-size="20" font-weight="600" fill="#7f93ba" text-anchor="end" letter-spacing="3">LEVEL</text>
  <text x="952" y="162" font-size="84" font-weight="700" fill="url(#acc)" text-anchor="end">${d.level}</text>
  ${bar(48, 222, 904, 26, pct)}
  <text x="48" y="282" font-size="22" font-weight="700" fill="#f3f6fc">${num(d.into)} <tspan font-weight="500" fill="#7f93ba">/ ${num(d.need)} XP to level ${d.level + 1}</tspan></text>
  <text x="952" y="282" font-size="20" font-weight="600" fill="#7f93ba" text-anchor="end">${Math.round(pct * 100)}%</text>
  ${stat(48, 306, 214, "Total XP", num(d.xp))}${stat(282, 306, 214, "Messages", num(d.messages))}${stat(516, 306, 214, "Voice", `${num(d.voice ?? 0)} min`)}${stat(750, 306, 202, "Invited", num(d.invited))}`, accent, accent2);
}

/** A ranked list with pictures: the /levels board and the top inviters. rows: [{ name, art, big, small }] */
export function boardSvg({ title, subtitle, rows, empty = "Nobody here yet.", accent = "#70a6d8", accent2 = "#8b7cf6" }) {
    const RH = 74, head = 118, h = head + Math.max(1, rows.length) * RH + 28;
    const list = rows.length ? rows.map((r, n) => {
        const y = head + n * RH, med = MEDAL[n], cy = y + 33;
        return `<rect x="36" y="${y}" width="928" height="${RH - 8}" rx="18" fill="${n < 3 ? "#182440" : "#131c31"}" stroke="${n < 3 ? med : "#1f2b46"}" stroke-opacity="${n < 3 ? 0.55 : 1}" stroke-width="1.5"/>
  <circle cx="82" cy="${cy}" r="21" fill="${med ?? "#223050"}"/><text x="82" y="${cy + 8}" font-size="22" font-weight="700" fill="${med ? "#0b1020" : "#9fb2d6"}" text-anchor="middle">${n + 1}</text>
  ${avatar(150, cy, 25, r.art, r.name, n < 3 ? med : "#2a3a5e")}
  <text x="198" y="${cy + 9}" font-size="26" font-weight="600" fill="#f3f6fc">${esc(cut(r.name, 24))}</text>
  <text x="936" y="${cy - 2}" font-size="26" font-weight="700" fill="#f3f6fc" text-anchor="end">${esc(r.big)}</text>
  <text x="936" y="${cy + 21}" font-size="16" font-weight="500" fill="#7f93ba" text-anchor="end">${esc(r.small ?? "")}</text>`;
    }).join("\n") : `<text x="500" y="${head + 44}" font-size="24" fill="#7f93ba" text-anchor="middle">${esc(empty)}</text>`;
    return frame(1000, h, `
  <text x="48" y="64" font-size="38" font-weight="700" fill="#f3f6fc">${esc(cut(title, 34))}</text>
  <text x="48" y="94" font-size="19" font-weight="600" fill="#7f93ba">${esc(cut(subtitle ?? "", 60))}</text>
  <rect x="48" y="104" width="120" height="4" rx="2" fill="url(#acc)"/>
  ${list}`, accent, accent2);
}

/** One member's invites. d: { name, art, server, active, total, left, rewards: [{ count, done, role }], by } */
export function inviteCardSvg(d) {
    const rw = (d.rewards ?? []).slice(0, 4), h = 330 + (rw.length ? 40 + rw.length * 44 : 0);
    const rewards = rw.length ? `<text x="48" y="352" font-size="16" font-weight="600" fill="#7f93ba" letter-spacing="1.5">REWARDS</text>` + rw.map((r, n) => {
        const y = 366 + n * 44;
        return `<rect x="48" y="${y}" width="904" height="36" rx="12" fill="#131c31"/><circle cx="74" cy="${y + 18}" r="9" fill="${r.done ? "#57f287" : "#2a3a5e"}"/>
  <text x="96" y="${y + 25}" font-size="19" font-weight="600" fill="${r.done ? "#f3f6fc" : "#9fb2d6"}">${r.count} invited</text><text x="936" y="${y + 25}" font-size="19" font-weight="600" fill="#7f93ba" text-anchor="end">${esc(cut(r.role ?? "", 30))}</text>`;
    }).join("\n") : "";
    return frame(1000, h, `
  ${avatar(120, 118, 70, d.art, d.name, "#57f287")}
  <text x="226" y="92" font-size="40" font-weight="700" fill="#f3f6fc">${esc(cut(d.name, 22))}</text>
  <text x="226" y="122" font-size="19" font-weight="600" fill="#7f93ba">${esc(cut(d.server ?? "", 36))}</text>
  <text x="226" y="164" font-size="20" font-weight="600" fill="#57f287">${d.by ? esc("Joined through " + cut(d.by, 24)) : "Invite tracking"}</text>
  <text x="952" y="82" font-size="20" font-weight="600" fill="#7f93ba" text-anchor="end" letter-spacing="3">INVITED</text>
  <text x="952" y="162" font-size="84" font-weight="700" fill="url(#acc)" text-anchor="end">${num(d.active)}</text>
  ${stat(48, 206, 290, "Still here", num(d.active))}${stat(355, 206, 290, "Joined in total", num(d.total))}${stat(662, 206, 290, "Left", num(d.left))}
  ${rewards}`, "#57f287", "#70a6d8");
}

/** Rough text width in px for pills. */
function tw(s, size) { return [...String(s)].reduce((t, c) => t + (c === " " ? 0.28 : /[A-Z0-9MW#]/.test(c) ? 0.7 : /[il.,'|:]/.test(c) ? 0.28 : 0.56), 0) * size; }

export const toPng = svg => svgToPng(svg, 1000);

/** Fetches pictures once each, in parallel, and never throws: a missing picture just becomes a lettered circle. */
export async function artFor(urls, fetchImpl = fetch) {
    const out = new Map();
    await Promise.all([...new Set(urls.filter(Boolean))].map(async u => { out.set(u, await fetchImageDataUri(u, { fetchImpl }).catch(() => null)); }));
    return u => out.get(u) ?? null;
}
