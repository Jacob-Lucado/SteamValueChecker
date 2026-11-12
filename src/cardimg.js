// The Steam account value picture, the yearly recap and the welcome card, drawn as SVG and turned into PNG. They match what the website shows.




import { libraryView } from "./library.js";
import { playStats, fetchProfileCard, fmtHours } from "./steamlib.js";
import { money } from "./render.js";

import { goalProgress } from "./steamstore.js";
import { svgToPng, fetchImageDataUri } from "./imgrender.js";

const W = 1200;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Rough text width for Inter, so chips fit their words. Good enough for pills; the text itself is never clipped.
const tw = (s, size, bold = false) => [...String(s)].reduce((t, c) => t + (c === " " ? 0.28 : /[A-Z0-9MW]/.test(c) ? 0.68 : /[il.,'|:]/.test(c) ? 0.28 : 0.55), 0) * size * (bold ? 1.06 : 1);
const cut = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + "…" : String(s));

const chip = (x, y, w, h, fill, stroke) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;

// Colors of the website's dark theme, so the picture looks like the page.
const C = { bg: "#0f1724", panel: "#162134", tile: "#1b2a40", line: "#27384f", text: "#f4f8fd", mute: "#a3b3c8", accent: "#4da3ff" };

/** The Steam account value page as a picture: the stat tiles and the "Estimated account value" panel. */
export function valueSvg({ stats, currency, link, card }, art = {}) {
    const cur = currency, v = stats.value ?? {};
    const o = [];
    const tile = (x, y, w, k, val, sub) => {
        o.push(`<rect x="${x}" y="${y}" width="${w}" height="118" rx="12" fill="${C.tile}" stroke="${C.line}"/>`);
        o.push(`<text x="${x + 18}" y="${y + 30}" font-size="15" font-weight="600" fill="${C.mute}">${esc(k)}</text>`);
        o.push(`<text x="${x + 18}" y="${y + 72}" font-size="34" font-weight="700" fill="${C.text}" textLength="${Math.min(tw(val, 34, true), w - 36).toFixed(0)}" lengthAdjust="spacingAndGlyphs">${esc(val)}</text>`);
        if (sub) o.push(`<text x="${x + 18}" y="${y + 100}" font-size="14" fill="${C.mute}">${esc(cut(sub, Math.floor(w / 8.2)))}</text>`);
    };
    const row = (y, items) => { const n = items.length, gap = 16, w = (1104 - gap * (n - 1)) / n; items.forEach(([k, val, sub], i) => tile(48 + i * (w + gap), y, w, k, val, sub)); };

    // Header: the Steam picture and name.
    let y = 40;
    if (art.avatar) o.push(`<clipPath id="av"><circle cx="86" cy="${y + 38}" r="38"/></clipPath><image href="${art.avatar}" x="48" y="${y}" width="76" height="76" clip-path="url(#av)" preserveAspectRatio="xMidYMid slice"/>`);
    else o.push(`<circle cx="86" cy="${y + 38}" r="38" fill="${C.tile}" stroke="${C.line}"/>`);
    o.push(`<text x="142" y="${y + 34}" font-size="30" font-weight="700" fill="${C.text}">${esc(cut(card?.name || "Your Steam library", 30))}</text>`);
    o.push(`<text x="142" y="${y + 62}" font-size="16" fill="${C.mute}">${esc((link?.games ?? stats.games) + " games" + (link?.synced_at ? "  ·  synced " + new Date(link.synced_at).toISOString().slice(0, 10) : ""))}</text>`);
    y += 100;

    const top = [["Games", String(stats.games), stats.playedGames + " played"], ["Hours played", fmtHours(stats.totalMinutes)]];
    if (v.achTotal) top.push(["Achievements", `${v.achDone.toLocaleString("en-US")} / ${v.achTotal.toLocaleString("en-US")}`, `${Math.round(v.achDone / v.achTotal * 100)}% unlocked, ${v.achGames} games`]);
    top.push(["Barely played", String(stats.unplayedCount), money(stats.unplayedMsrp, cur) + " at full price"]);
    row(y, top); y += 118 + 18;

    // The "Estimated account value" panel.
    const panelTop = y, tiles = [["At full price", money(v.msrp, cur), "list price today"], ["At today's cheapest", money(v.cheapest, cur), "best current deal"]];
    if (v.atl) tiles.push(["At all-time lows", money(v.atl, cur), "if bought at the lowest ever"]);
    const best = (v.top ?? []).slice(0, 5);
    const panelH = 28 + 24 + 22 + 118 + 22 + (best.length ? 28 + best.length * 30 + 6 : 0) + 22;
    o.push(`<rect x="32" y="${panelTop}" width="1136" height="${panelH}" rx="14" fill="${C.panel}" stroke="${C.line}"/>`);
    o.push(`<text x="52" y="${panelTop + 38}" font-size="15" font-weight="700" fill="${C.mute}" letter-spacing="1.5">ESTIMATED ACCOUNT VALUE</text>`);
    let py = panelTop + 58;
    const n = tiles.length, gap = 16, tWid = (1096 - gap * (n - 1)) / n;
    tiles.forEach(([k, val, sub], i) => tile(52 + i * (tWid + gap), py, tWid, k, val, sub));
    py += 118 + 22;
    if (best.length) {
        o.push(`<text x="52" y="${py + 6}" font-size="15" font-weight="600" fill="${C.mute}">Most valuable</text>`);
        py += 28;
        best.forEach((r, i) => {
            o.push(`<text x="52" y="${py + i * 30 + 14}" font-size="18" font-weight="600" fill="${C.text}">${esc(cut(r.title, 60))}</text>`);
            o.push(`<text x="1148" y="${py + i * 30 + 14}" font-size="18" text-anchor="end" fill="${C.mute}">${esc(money(r.msrp, cur))}</text>`);
        });
        py += best.length * 30 + 6;
    }
    o.push(`<text x="52" y="${py + 14}" font-size="14" fill="${C.mute}">${esc(`${v.priced ?? 0} of ${link?.games ?? stats.games} games priced. An estimate from current prices, not what was paid. Free, removed or unlisted games are not counted.`)}</text>`);
    const H = panelTop + panelH + 44;
    o.push(`<text x="48" y="${H - 14}" font-size="14" fill="#5c7080">Steam Value Checker</text>`);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${H}" viewBox="0 0 1200 ${H}"><rect width="1200" height="${H}" fill="${C.bg}"/>${o.join("\n")}</svg>`;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The year-in-review picture: hours this year, a bar per month, top games, the total since linking and the hours goal. */
export function recapSvg({ rec, allTime, goal, name }, art = {}) {
    const o = [];
    const peak = Math.max(1, ...rec.months);
    if (art.avatar) o.push(`<clipPath id="av"><circle cx="84" cy="84" r="34"/></clipPath><image href="${art.avatar}" x="50" y="50" width="68" height="68" clip-path="url(#av)" preserveAspectRatio="xMidYMid slice"/>`);
    o.push(`<text x="${art.avatar ? 136 : 56}" y="76" font-size="18" font-weight="700" fill="${C.accent}" letter-spacing="2">${esc(cut(String(name || "My").toUpperCase(), 24))} · HOURS PLAYED IN ${rec.year}</text>`);
    o.push(`<text x="${art.avatar ? 136 : 56}" y="132" font-size="64" font-weight="700" fill="${C.text}">${esc(fmtHours(rec.totalMinutes))}</text>`);
    o.push(`<text x="56" y="176" font-size="22" fill="${C.mute}">${esc(`${rec.games} game${rec.games === 1 ? "" : "s"} on ${rec.activeDays} day${rec.activeDays === 1 ? "" : "s"}` + (rec.busiestMonth !== null && rec.totalMinutes ? `, busiest in ${MON[rec.busiestMonth]}` : ""))}</text>`);
    o.push(`<text x="56" y="212" font-size="20" font-weight="600" fill="#a4d007">${esc(fmtHours(allTime.totalMinutes) + " in total since linking Steam")}</text>`);
    if (goal) {
        o.push(`<rect x="56" y="236" width="440" height="12" rx="6" fill="${C.tile}"/><rect x="56" y="236" width="${Math.max(6, Math.round(440 * goal.pct / 100))}" height="12" rx="6" fill="${goal.reached ? "#a4d007" : C.accent}"/>`);
        o.push(`<text x="56" y="272" font-size="16" fill="${C.mute}">${esc(`Goal: ${goal.done} of ${goal.goal} hours (${goal.pct}%)`)}</text>`);
    }
    // Month bars
    rec.months.forEach((m, n) => {
        const bh = Math.round(m / peak * 170), bx = 56 + n * 38;
        o.push(`<rect x="${bx}" y="${520 - bh}" width="28" height="${Math.max(bh, 3)}" rx="4" fill="${m === peak && m > 0 ? "#a4d007" : C.accent}"/>`);
        o.push(`<text x="${bx + 14}" y="546" font-size="13" text-anchor="middle" fill="${C.mute}">${MON[n]}</text>`);
    });
    // Top games
    o.push(`<rect x="640" y="48" width="512" height="500" rx="14" fill="${C.panel}" stroke="${C.line}"/>`);
    o.push(`<text x="664" y="86" font-size="15" font-weight="700" fill="${C.mute}" letter-spacing="1.5">TOP GAMES THIS YEAR</text>`);
    rec.top.slice(0, 7).forEach((t, i) => {
        const y = 128 + i * 56;
        o.push(`<text x="664" y="${y}" font-size="22" font-weight="600" fill="${C.text}">${i + 1}. ${esc(cut(t.title, 28))}</text>`);
        o.push(`<text x="1128" y="${y}" font-size="20" text-anchor="end" fill="${C.mute}">${esc(fmtHours(t.minutes))}</text>`);
        const share = Math.max(0.02, t.minutes / Math.max(1, rec.top[0].minutes));
        o.push(`<rect x="664" y="${y + 10}" width="464" height="6" rx="3" fill="${C.tile}"/><rect x="664" y="${y + 10}" width="${Math.round(464 * share)}" height="6" rx="3" fill="${C.accent}"/>`);
    });
    if (!rec.top.length) o.push(`<text x="664" y="130" font-size="20" fill="${C.mute}">Nothing tracked yet this year.</text>`);
    o.push(`<text x="56" y="596" font-size="14" fill="#5c7080">Counted from when I linked Steam  ·  Steam Value Checker</text>`);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="${C.bg}"/>${o.join("\n")}</svg>`;
}

/** The year-in-review picture as a PNG buffer, or null when Steam is not linked or nothing is tracked. */
export async function renderRecap({ db, userId, name, fetchImpl = fetch, now = Date.now() }) {
    const link = db.getSteamLink(userId);
    if (!link) return null;
    const year = new Date(now).getUTCFullYear(), rec = db.playRecap(userId, year), allTime = db.playRecapAll(userId);
    if (!allTime.totalMinutes) return null;
    const goalHours = db.getHourGoal(userId);
    const card = await fetchProfileCard(link.steamid, fetchImpl).catch(() => null);
    const avatar = card?.avatar ? await fetchImageDataUri(card.avatar, { fetchImpl }) : null;
    return svgToPng(recapSvg({ rec, allTime, goal: goalHours ? goalProgress(goalHours, rec.totalMinutes, now) : null, name: name || card?.name }, { avatar: avatar ?? undefined }));
}

/** Steam facts for the picture and the banner: the public profile card and the library stats. */
export async function steamSnapshot({ db, itad, userId, fetchImpl = fetch, withStats = true }) {
    const link = db.getSteamLink(userId);
    if (!link) return null;
    const card = await fetchProfileCard(link.steamid, fetchImpl).catch(() => null);
    let stats = null, currency = "USD";
    if (withStats) {
        const view = await libraryView(db, itad, db.getUser(userId), { snapshot: false });
        stats = playStats(view.rows.filter(r => r.appid)); currency = view.currency;
    } else stats = { mostPlayed: [] };
    return { link, card, stats, currency };
}

/** The Steam account value picture as a PNG buffer. Returns null when no Steam profile is linked or there is nothing priced. */
export async function renderSteamValue({ db, itad, userId, fetchImpl = fetch }) {
    const snap = await steamSnapshot({ db, itad, userId, fetchImpl });
    if (!snap) return null;
    const stats = snap.stats;
    if (!stats.games) return null;
    const avatar = snap.card?.avatar ? await fetchImageDataUri(snap.card.avatar, { fetchImpl }) : null;
    return svgToPng(valueSvg({ stats, currency: snap.currency, link: snap.link, card: snap.card }, { avatar: avatar ?? undefined }));
}

/** The picture under a welcome message: the new member's avatar, their name and which member they are. `avatar` is a data: URI or null. */
export function welcomeSvg({ name, server, count, avatar = null, accent = "#ff9800" }) {
    const n = cut(String(name ?? "friend"), 22), s = cut(String(server ?? "the server"), 34);
    const size = n.length > 16 ? 64 : n.length > 11 ? 78 : 92, ax = 190, ay = 210, R = 105;
    const lines = [];
    for (let x = -420; x < 1300; x += 44) lines.push(`<line x1="${x}" y1="420" x2="${x + 420}" y2="0" stroke="${accent}" stroke-opacity="0.09" stroke-width="2"/>`);
    const initial = esc([...n][0]?.toUpperCase() ?? "?");
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="420" viewBox="0 0 1200 420">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1b1f2a"/><stop offset="1" stop-color="#0b0d12"/></linearGradient>
<radialGradient id="glow" cx="170" cy="210" r="520" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${accent}" stop-opacity="0.28"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>
<clipPath id="av"><circle cx="${ax}" cy="${ay}" r="${R}"/></clipPath>
</defs>
<rect width="1200" height="420" rx="0" fill="url(#bg)"/><rect width="1200" height="420" fill="url(#glow)"/>${lines.join("")}
<rect x="0" y="0" width="10" height="420" fill="${accent}"/><rect x="0" y="414" width="1200" height="6" fill="${accent}" fill-opacity="0.8"/>
<circle cx="${ax}" cy="${ay}" r="${R + 12}" fill="#0b0d12"/><circle cx="${ax}" cy="${ay}" r="${R + 7}" fill="${accent}"/>
${avatar ? `<image href="${avatar}" x="${ax - R}" y="${ay - R}" width="${R * 2}" height="${R * 2}" clip-path="url(#av)" preserveAspectRatio="xMidYMid slice"/>`
        : `<circle cx="${ax}" cy="${ay}" r="${R}" fill="#262b38"/><text x="${ax}" y="${ay + 34}" text-anchor="middle" font-size="96" font-weight="700" fill="${accent}">${initial}</text>`}
<text x="360" y="130" font-size="30" font-weight="600" fill="${accent}" letter-spacing="8">WELCOME</text>
<text x="358" y="${130 + size + 12}" font-size="${size}" font-weight="700" fill="#ffffff">${esc(n)}</text>
<text x="360" y="${130 + size + 70}" font-size="36" fill="#c8cedb">to <tspan font-weight="600" fill="#ffffff">${esc(s)}</tspan></text>
<rect x="360" y="${130 + size + 108}" width="${Math.round(tw("Member #" + count, 28, true)) + 48}" height="52" rx="26" fill="${accent}" fill-opacity="0.16" stroke="${accent}" stroke-width="2"/>
<text x="${360 + 24}" y="${130 + size + 143}" font-size="28" font-weight="600" fill="#ffffff">Member #${esc(count)}</text>
</svg>`;
}

/** The welcome picture as PNG. Falls back to a letter when the avatar can't be fetched. */
export async function renderWelcomeCard({ name, server, count, avatarUrl = null, fetchImpl = fetch }) {
    const avatar = avatarUrl ? await fetchImageDataUri(avatarUrl, { fetchImpl }).catch(() => null) : null;
    return svgToPng(welcomeSvg({ name, server, count, avatar: avatar?.uri ?? avatar ?? null }), 1000);
}

// ---------------------------------------------------------------- profile share picture
// The 1200x630 picture chat apps and social sites show when a /u/name link is posted. It is drawn from what the page
// shows to anyone (name, bio, look, favorite games), never from private sections.
const wrapText = (text, size, maxW, maxLines) => {
    const lines = []; let cur = "";
    for (const word of String(text).split(/\s+/).filter(Boolean)) {
        const next = cur ? cur + " " + word : word;
        if (tw(next, size) <= maxW || !cur) cur = next; else { lines.push(cur); cur = word; }
        if (lines.length === maxLines) break;
    }
    if (cur && lines.length < maxLines) lines.push(cur);
    if (lines.join(" ").length < String(text).replace(/\s+/g, " ").trim().length && lines.length) lines[lines.length - 1] = lines[lines.length - 1].replace(/[.,;:\s]+$/, "") + "…";
    return lines;
};

export function profileShareSvg({ name, bio, accent = "#ff9800", bg = "#0f1117", light = false, avatar = null, art = [], facts = [], slug = "" }) {
    const ink = light ? "#161a24" : "#ffffff", sub = light ? "#4a5163" : "#c8cedb";
    const n = cut(String(name ?? "Player"), 24), nameSize = Math.max(34, Math.min(64, Math.floor(430 / (tw(n, 1, true) || 1))));
    const lines = wrapText(bio || "Favorite games, wishlist and more, all in one place.", 32, 560, 3);
    const initial = esc([...n][0]?.toUpperCase() ?? "?");
    const ax = 150, ay = 190, R = 82;
    const tiles = art.slice(0, 3).map((uri, i) => {
        const y = 52 + i * 176;
        return `<rect x="780" y="${y}" width="368" height="164" rx="14" fill="${accent}" fill-opacity="0.25"/><image href="${uri}" x="780" y="${y}" width="368" height="164" clip-path="url(#t${i})" preserveAspectRatio="xMidYMid slice"/><rect x="780" y="${y}" width="368" height="164" rx="14" fill="none" stroke="${accent}" stroke-opacity="0.55" stroke-width="2"/>`;
    }).join("");
    const clips = [0, 1, 2].map(i => `<clipPath id="t${i}"><rect x="780" y="${52 + i * 176}" width="368" height="164" rx="14"/></clipPath>`).join("");
    let cx = 70;
    const chips = facts.slice(0, 3).map(f => {
        const w = Math.round(tw(f, 24, true)) + 40, out = `<rect x="${cx}" y="500" width="${w}" height="46" rx="23" fill="${accent}" fill-opacity="0.18" stroke="${accent}" stroke-width="2"/><text x="${cx + 20}" y="531" font-size="24" font-weight="600" fill="${ink}">${esc(f)}</text>`;
        cx += w + 14; return out;
    }).join("");
    const top = 300;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="${light ? "#dfe5f2" : "#07080c"}"/></linearGradient>
<radialGradient id="glow" cx="200" cy="120" r="700" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${accent}" stop-opacity="0.3"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>
<clipPath id="av"><circle cx="${ax}" cy="${ay}" r="${R}"/></clipPath>${clips}</defs>
<rect width="1200" height="630" fill="url(#bg)"/><rect width="1200" height="630" fill="url(#glow)"/>
<rect x="0" y="0" width="12" height="630" fill="${accent}"/><rect x="0" y="622" width="1200" height="8" fill="${accent}" fill-opacity="0.8"/>
${tiles}
<circle cx="${ax}" cy="${ay}" r="${R + 8}" fill="${accent}"/>
${avatar ? `<image href="${avatar}" x="${ax - R}" y="${ay - R}" width="${R * 2}" height="${R * 2}" clip-path="url(#av)" preserveAspectRatio="xMidYMid slice"/>`
        : `<circle cx="${ax}" cy="${ay}" r="${R}" fill="${light ? "#e9edf6" : "#262b38"}"/><text x="${ax}" y="${ay + 30}" text-anchor="middle" font-size="84" font-weight="700" fill="${accent}">${initial}</text>`}
<text x="${ax + R + 40}" y="${ay - 18}" font-size="26" font-weight="600" fill="${accent}" letter-spacing="6">GAME PROFILE</text>
<text x="${ax + R + 38}" y="${ay + 44}" font-size="${nameSize}" font-weight="700" fill="${ink}">${esc(n)}</text>
${lines.map((l, i) => `<text x="70" y="${top + i * 46}" font-size="32" fill="${sub}">${esc(l)}</text>`).join("")}
${chips}
<text x="70" y="596" font-size="26" font-weight="600" fill="${sub}">steamvaluechecker.com/u/${esc(slug)}</text>
</svg>`;
}

/** The little chips on the share picture. The library's worth goes first when the person shows it publicly, since it's the thing people tap for. */
export function shareFacts(profile) {
    const get = k => profile.sections.find(s => s.key === k);
    const facts = [], v = get("value"), favs = get("favorites")?.games ?? [], wish = get("wishlist")?.games ?? [], tr = get("trophies");
    if (v?.worth > 0) facts.push(`$${Number(v.worth).toLocaleString("en-US")} library`);
    if (favs.length) facts.push(`${favs.length} favorite${favs.length === 1 ? "" : "s"}`);
    if (wish.length) facts.push(`${wish.length} on wishlist`);
    if (tr?.earned) facts.push(`${tr.earned} trophies`);
    return facts;
}

/** The share picture as PNG. `profile` is what buildProfile returns for an anonymous viewer. */
export async function renderProfileShare({ profile, fetchImpl = fetch }) {
    const favs = profile.sections.find(s => s.key === "favorites")?.games ?? [];
    const wish = profile.sections.find(s => s.key === "wishlist")?.games ?? [];
    const pool = [...favs, ...wish].map(g => g.art).filter(Boolean);
    if (profile.banner?.art) pool.unshift(profile.banner.art);
    const urls = [...new Set(pool)].slice(0, 3);
    const [avatar, ...art] = await Promise.all([profile.avatar ? fetchImageDataUri(profile.avatar, { fetchImpl }) : null, ...urls.map(u => fetchImageDataUri(u, { fetchImpl }))]);
    const facts = shareFacts(profile);
    return svgToPng(profileShareSvg({ name: profile.name, bio: profile.bio, accent: profile.theme.accent, bg: profile.theme.bg, light: profile.theme.light, avatar, art: art.filter(Boolean), facts, slug: profile.slug }), 1200);
}
