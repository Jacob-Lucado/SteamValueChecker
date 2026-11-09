// A sale alert as a tall picture made for sharing (stories, posts, a quick send to a friend). It is built from the alert message itself,
// so it shows exactly the deal the person was just told about and nothing private.
import { svgToPng, fetchImageDataUri } from "./imgrender.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cut = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + "…" : String(s));

/** Pulls the deal back out of an alert embed. Returns null when it does not look like one. */
export function dealFromEmbed(e) {
    if (!e) return null;
    const title = String(e.title ?? "").replace(/^⭐\s*/, "");
    const m = /^(.*?) (?:is (\d+)% off|is on sale|: price dropped again)$/.exec(title);
    const game = (m ? m[1] : title).trim();
    const price = /\*\*([^*]+)\*\*/.exec(String(e.description ?? ""))?.[1] ?? null;
    if (!game || !price) return null;
    const shop = /at \*\*([^*]+)\*\*/.exec(String(e.description ?? ""))?.[1] ?? null;
    const field = k => (e.fields ?? []).find(f => f.name === k)?.value ?? null;
    const pct = m?.[2] ? Number(m[2]) : Number(/(\d+)%/.exec(field("Discount") ?? "")?.[1] ?? 0);
    return { game, price, shop, regular: field("Regular"), atl: field("All-time low"), pct, art: e.image?.url ?? e.thumbnail?.url ?? null };
}

export function storySvg(d, art = null) {
    const W = 1080, H = 1920, title = cut(d.game, 44);
    const words = title.split(" "), lines = [""];
    for (const w of words) { if ((lines.at(-1) + " " + w).trim().length > 20 && lines.length < 3) lines.push(w); else lines[lines.length - 1] = (lines.at(-1) + " " + w).trim(); }
    const size = lines.length > 2 ? 78 : lines.length > 1 ? 92 : 112;
    const o = [];
    o.push(`<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#101a2b"/><stop offset="1" stop-color="#0a0f1a"/></linearGradient><linearGradient id="hot" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff9800"/><stop offset="1" stop-color="#ff5a36"/></linearGradient><clipPath id="c"><rect x="60" y="120" width="960" height="450" rx="28"/></clipPath></defs>`);
    o.push(`<rect width="${W}" height="${H}" fill="url(#bg)"/>`);
    o.push(`<text x="60" y="84" font-size="34" font-weight="700" fill="#a3b3c8" letter-spacing="3">PRICE DROP</text>`);
    if (art) o.push(`<image href="${art}" x="60" y="120" width="960" height="450" preserveAspectRatio="xMidYMid slice" clip-path="url(#c)"/>`);
    else o.push(`<rect x="60" y="120" width="960" height="450" rx="28" fill="#162134"/>`);
    o.push(`<rect x="60" y="120" width="960" height="450" rx="28" fill="none" stroke="#27384f" stroke-width="2"/>`);
    lines.forEach((l, i) => o.push(`<text x="60" y="${680 + size + i * (size + 14)}" font-size="${size}" font-weight="800" fill="#f4f8fd">${esc(l)}</text>`));
    const y0 = 680 + size + lines.length * (size + 14) + 40;
    if (d.pct > 0) {
        o.push(`<rect x="60" y="${y0}" width="360" height="190" rx="28" fill="url(#hot)"/>`);
        o.push(`<text x="240" y="${y0 + 135}" font-size="120" font-weight="800" fill="#fff" text-anchor="middle">-${d.pct}%</text>`);
    }
    const x1 = d.pct > 0 ? 460 : 60;
    o.push(`<text x="${x1}" y="${y0 + 118}" font-size="128" font-weight="800" fill="#57f287">${esc(d.price)}</text>`);
    if (d.regular && d.regular !== "-") o.push(`<text x="${x1}" y="${y0 + 176}" font-size="44" fill="#a3b3c8" text-decoration="line-through">${esc(d.regular)}</text>`);
    let y = y0 + 270;
    const pill = (txt, fill) => { const w = Math.min(960, 56 + txt.length * 25); o.push(`<rect x="60" y="${y}" width="${w}" height="84" rx="42" fill="${fill}"/><text x="${60 + w / 2}" y="${y + 56}" font-size="38" font-weight="700" fill="#f4f8fd" text-anchor="middle">${esc(txt)}</text>`); y += 108; };
    if (d.shop) pill(`at ${cut(d.shop, 28)}`, "#1b2a40");
    if (d.atl && d.price === d.atl) pill("Matches the all-time low", "#1f6f43"); else if (d.atl) pill(`All-time low ${d.atl}`, "#1b2a40");
    o.push(`<text x="${W / 2}" y="${H - 120}" font-size="40" font-weight="700" fill="#f4f8fd" text-anchor="middle">Steam Value Checker</text>`);
    o.push(`<text x="${W / 2}" y="${H - 66}" font-size="30" fill="#a3b3c8" text-anchor="middle">steamvaluechecker.com</text>`);
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Inter, sans-serif">${o.join("")}</svg>`;
}

export async function renderStory(deal, { fetchImpl = fetch } = {}) {
    const art = deal.art ? await fetchImageDataUri(deal.art, { fetchImpl }).catch(() => null) : null;
    return svgToPng(storySvg(deal, art), 1080);
}
