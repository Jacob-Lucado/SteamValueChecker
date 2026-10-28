// The shareable profile card and the Steam account value picture, drawn as SVG and turned into PNG. They match what the website shows.
import { trophyCase } from "./badges.js";
import { challengeView } from "./challenge.js";
import { tasteProfile } from "./taste.js";
import { libraryView } from "./library.js";
import { playStats, fetchProfileCard, fmtHours } from "./steamlib.js";
import { money } from "./render.js";
import { THEMES, PLATFORM_LABEL, viewPrefs } from "./cardprefs.js";
import { svgToPng, fetchImageDataUri } from "./imgrender.js";

const W = 1200;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Rough text width for Inter, so chips fit their words. Good enough for pills; the text itself is never clipped.
const tw = (s, size, bold = false) => [...String(s)].reduce((t, c) => t + (c === " " ? 0.28 : /[A-Z0-9MW]/.test(c) ? 0.68 : /[il.,'|:]/.test(c) ? 0.28 : 0.55), 0) * size * (bold ? 1.06 : 1);
const cut = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + "…" : String(s));

/** Everything the card shows, from stored data only (no price lookups). */
export function profileCardData(db, userId, name) {
    const lib = db.listLibrary(userId);
    const tc = trophyCase(db, userId);
    const ch = challengeView(db, userId);
    const snaps = db.listSnapshots(userId, 1);
    const last = snaps[snaps.length - 1] ?? snaps[0] ?? null;
    return {
        name, games: lib.length, finished: lib.filter(g => g.status === "finished").length,
        backlog: lib.filter(g => g.status === "backlog").length,
        hours: Math.round(lib.reduce((t, g) => t + (g.minutes ?? 0), 0) / 60),
        savedPct: last && last.msrp_paid > 0 ? Math.round((last.msrp_paid - last.paid) / last.msrp_paid * 100) : null,
        streak: ch.streak, bestStreak: ch.best,
        badges: tc.badges.filter(b => b.tier).map(b => ({ icon: b.icon, name: b.name, tier: b.tier })),
        genres: tasteProfile(db, userId).genres.slice(0, 3).map(g => g.name)
    };
}

const chip = (x, y, w, h, fill, stroke) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;

/** The profile card as SVG. `art` holds data: URIs for the picture and banner when there are any. */
export function profileCardSvg(d, prefsIn = {}, art = {}) {
    const prefs = viewPrefs(prefsIn), show = prefs.show;
    const [bg, ac] = THEMES[prefs.theme], BH = 230, ax = 140, ay = BH + 6, R = 72;
    const o = [];
    o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">`);
    o.push(`<defs>
<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="#0b0d12"/></linearGradient>
<radialGradient id="glow" cx="1100" cy="80" r="520" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${ac}" stop-opacity="0.2"/><stop offset="1" stop-color="${ac}" stop-opacity="0"/></radialGradient>
<linearGradient id="ban" x1="0" y1="0" x2="1200" y2="${BH}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${ac}" stop-opacity="0.33"/><stop offset="1" stop-color="${ac}" stop-opacity="0.07"/></linearGradient>
<linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.10"/><stop offset="1" stop-color="#0b0d12" stop-opacity="0.92"/></linearGradient>
<clipPath id="bc"><rect x="0" y="0" width="1200" height="${BH}"/></clipPath>
<clipPath id="ac"><circle cx="${ax}" cy="${ay}" r="${R}"/></clipPath>
</defs>`);
    o.push(`<rect width="1200" height="630" fill="url(#bg)"/><rect width="1200" height="630" fill="url(#glow)"/>`);
    o.push(`<g clip-path="url(#bc)">`);
    if (art.banner) o.push(`<image href="${art.banner}" x="0" y="0" width="1200" height="${BH}" preserveAspectRatio="xMidYMid slice"/>`);
    else {
        o.push(`<rect width="1200" height="${BH}" fill="url(#ban)"/>`);
        for (let n = -BH; n < 1300; n += 36) o.push(`<line x1="${n}" y1="${BH}" x2="${n + BH}" y2="0" stroke="${ac}" stroke-opacity="0.13" stroke-width="2"/>`);
    }
    o.push(`<rect width="1200" height="${BH}" fill="url(#fade)"/></g><rect x="0" y="${BH - 3}" width="1200" height="3" fill="${ac}"/>`);
    o.push(`<circle cx="${ax}" cy="${ay}" r="${R + 8}" fill="#0b0d12"/><circle cx="${ax}" cy="${ay}" r="${R + 4}" fill="${ac}"/>`);
    if (art.avatar) o.push(`<image href="${art.avatar}" x="${ax - R}" y="${ay - R}" width="${R * 2}" height="${R * 2}" preserveAspectRatio="xMidYMid slice" clip-path="url(#ac)"/>`);
    else o.push(`<circle cx="${ax}" cy="${ay}" r="${R}" fill="${bg}"/><text x="${ax}" y="${ay + 26}" text-anchor="middle" font-size="72" font-weight="700" fill="${ac}">${esc(([...(d.name || "?")][0] || "?").toUpperCase())}</text>`);
    o.push(`<text x="250" y="${ay + 36}" font-size="52" font-weight="700" fill="#fff">${esc(cut(d.name || "Gamer", 24))}</text>`);
    o.push(`<text x="252" y="${ay + 70}" font-size="22" font-weight="600" fill="${ac}" letter-spacing="1">GAME LIBRARY</text>`);

    const stats = [];
    if (show.games) stats.push([String(d.games), "games"]);
    if (show.finished) stats.push([String(d.finished), "finished"]);
    if (show.hours && d.hours) stats.push([d.hours.toLocaleString("en-US") + " h", "played"]);
    if (show.saved && d.savedPct !== null && d.savedPct !== undefined) stats.push([d.savedPct + "%", "saved vs full price"]);
    if (show.streak && d.bestStreak) stats.push([d.streak + " / " + d.bestStreak, "month streak / best"]);
    const n = stats.length, gap = 18, left = 60, tileW = n ? (1080 - gap * (n - 1)) / n : 0, ty = 330, th = 136;
    stats.forEach(([v, k], i) => {
        const tx = left + i * (tileW + gap), vs = n > 4 ? 44 : 54;
        o.push(`<rect x="${tx}" y="${ty}" width="${tileW}" height="${th}" rx="18" fill="#fff" fill-opacity="0.06" stroke="#fff" stroke-opacity="0.10" stroke-width="1.5"/>`);
        o.push(`<rect x="${tx + 22}" y="${ty + 18}" width="34" height="5" rx="2.5" fill="${ac}"/>`);
        o.push(`<text x="${tx + 22}" y="${ty + 82}" font-size="${vs}" font-weight="700" fill="#fff" textLength="${Math.min(tw(v, vs, true), tileW - 40).toFixed(0)}" lengthAdjust="spacingAndGlyphs">${esc(v)}</text>`);
        o.push(`<text x="${tx + 22}" y="${ty + 114}" font-size="21" fill="#9fb3c4">${esc(cut(k, 22))}</text>`);
    });

    // Trophies (their names; the website shows the icons) on the left, top genres on the right.
    const by = 484;
    let bx = 60;
    if (show.badges && d.badges?.length) {
        for (const b of d.badges.slice(0, 4)) {
            const label = cut(b.name, 16), w = tw(label, 20, true) + 36;
            if (bx + w > 700) break;
            o.push(chip(bx, by + 8, w, 40, "#fff", "#fff").replace('fill="#fff" stroke="#fff"', 'fill="#fff" fill-opacity="0.06" stroke="#fff" stroke-opacity="0.10"'));
            o.push(`<text x="${bx + 18}" y="${by + 35}" font-size="20" font-weight="600" fill="#fff">${esc(label)}</text>`);
            bx += w + 10;
        }
    }
    if (show.genres && d.genres?.length) {
        let gx = 1140;
        for (const g of [...d.genres].slice(0, 3).reverse()) {
            const w = tw(g, 21, true) + 34; gx -= w;
            o.push(chip(gx, by + 8, w, 40, ac, ac).replace(`fill="${ac}" stroke="${ac}"`, `fill="${ac}" fill-opacity="0.15" stroke="${ac}" stroke-opacity="0.4"`));
            o.push(`<text x="${gx + 17}" y="${by + 35}" font-size="21" font-weight="600" fill="${ac}">${esc(g)}</text>`);
            gx -= 12;
        }
    }

    // The gaming names they chose to show.
    const plats = prefs.platforms.filter(p => PLATFORM_LABEL.has(p.id));
    let px = 60, drawn = 0;
    const py = 548;
    for (const p of plats) {
        const label = PLATFORM_LABEL.get(p.id), name = cut(p.name, 22), w = tw(label, 18) + tw(name, 18, true) + 40;
        const more = plats.length - drawn - 1;
        if (px + w > 1140 - (more > 0 ? 90 : 0)) {
            const left2 = plats.length - drawn, t = `+${left2} more`, w2 = tw(t, 18, true) + 28;
            o.push(chip(px, py, w2, 36, "#fff", "#fff").replace('fill="#fff" stroke="#fff"', 'fill="#fff" fill-opacity="0.04" stroke="#fff" stroke-opacity="0.10"'));
            o.push(`<text x="${px + 14}" y="${py + 25}" font-size="18" font-weight="600" fill="#9fb3c4">${esc(t)}</text>`);
            drawn = -1; break;
        }
        o.push(chip(px, py, w, 36, ac, ac).replace(`fill="${ac}" stroke="${ac}"`, `fill="#fff" fill-opacity="0.06" stroke="#fff" stroke-opacity="0.10"`));
        o.push(`<text x="${px + 18}" y="${py + 25}" font-size="18" fill="#9fb3c4">${esc(label)}<tspan dx="8" font-weight="700" fill="#fff">${esc(name)}</tspan></text>`);
        px += w + 10; drawn++;
    }
    o.push(`<text x="60" y="616" font-size="16" fill="#5c7080">Steam Value Checker</text></svg>`);
    return o.join("\n");
}

// Colours of the website's dark theme, so the picture looks like the page.
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

// Pictures for a card: the member's own links first, then what Steam has for their linked profile.
async function pictures(prefs, steam, fetchImpl) {
    const get = u => fetchImageDataUri(u, { fetchImpl });
    const avatarUrl = prefs.avatar || steam?.card?.avatar || "";
    const top = steam?.stats?.mostPlayed?.[0]?.appid;
    const bannerUrls = [prefs.banner, top && `https://cdn.akamai.steamstatic.com/steam/apps/${Number(top)}/library_hero.jpg`, top && `https://cdn.akamai.steamstatic.com/steam/apps/${Number(top)}/header.jpg`].filter(Boolean);
    const [avatar, banner] = await Promise.all([avatarUrl ? get(avatarUrl) : null, (async () => { for (const u of bannerUrls) { const r = await get(u); if (r) return r; } return null; })()]);
    return { avatar: avatar ?? undefined, banner: banner ?? undefined };
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

/** The finished profile card as a PNG buffer. */
export async function renderProfileCard({ db, userId, name, fetchImpl = fetch, itad = null }) {
    const d = profileCardData(db, userId, name), prefs = viewPrefs(db.getCardPrefs(userId));
    let steam = null;
    if (!prefs.avatar || !prefs.banner) {
        try {
            const link = db.getSteamLink(userId);
            if (link) {
                const card = await fetchProfileCard(link.steamid, fetchImpl).catch(() => null);
                const lib = db.listLibrary(userId).filter(g => g.appid).sort((a, b) => (b.minutes ?? 0) - (a.minutes ?? 0));
                steam = { card, stats: { mostPlayed: lib.slice(0, 1).map(g => ({ appid: g.appid })) } };
            }
        } catch { /* the card still draws without them */ }
    }
    const art = await pictures(prefs, steam, fetchImpl);
    return svgToPng(profileCardSvg(d, prefs, art));
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
