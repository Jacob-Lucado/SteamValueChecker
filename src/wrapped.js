// Steam Wrapped: a member's year in games as five shareable pictures. Everything comes from what the bot already keeps for them
// (hours tracked since they linked Steam, their library and what they marked finished), so nothing new is stored.

import { svgToPng, fetchImageDataUri } from "./imgrender.js";
import { fetchProfileCard, fmtHours } from "./steamlib.js";

const DAY = 86400_000;
export const SLIDES = 5;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Longest run of days in a row, from "YYYY-MM-DD" strings. */
export function longestStreak(days) {
    const t = [...new Set(days)].map(d => Date.parse(d + "T00:00:00Z")).filter(Number.isFinite).sort((a, b) => a - b);
    let best = 0, run = 0, prev = null;
    for (const x of t) { run = prev !== null && x - prev === DAY ? run + 1 : 1; if (run > best) best = run; prev = x; }
    return best;
}

/** One line of personality from how the year went. The first rule that fits wins, so the order is the priority. */
export function archetype(d) {
    const share = d.top[0] && d.totalMinutes ? d.top[0].minutes / d.totalMinutes : 0;
    if (!d.totalMinutes) return { name: "The Fresh Start", line: "Nothing tracked yet. Your year is still a blank save slot." };
    if (d.finished.length >= 6) return { name: "The Completionist", line: `${d.finished.length} games finished. You don't leave a credits screen unseen.` };
    if (share >= 0.45 && d.top[0].minutes >= 600) return { name: "The Marathoner", line: `${Math.round(share * 100)}% of your hours went to ${d.top[0].title}. When you commit, you commit.` };
    if (d.activeDays >= 200) return { name: "The Daily Grinder", line: `You played on ${d.activeDays} different days. Steam is basically a routine.` };
    if (d.games >= 25 && share < 0.25) return { name: "The Explorer", line: `${d.games} different games and no single one took over. You like trying things.` };
    if (d.weekendShare >= 0.6) return { name: "The Weekend Warrior", line: `${Math.round(d.weekendShare * 100)}% of your hours landed on a Saturday or Sunday.` };
    if (d.added > d.games && d.added >= 10) return { name: "The Collector", line: `${d.added} new games in your library and ${d.games} actually played. The backlog respects you.` };
    if (d.longestStreak >= 14) return { name: "The Streak Keeper", line: `${d.longestStreak} days in a row at your best. That's dedication.` };
    return { name: "The Steady Player", line: "A little here, a little there, all year. That's a healthy kind of gaming." };
}

/**
 * Everything the five pictures need. `year` is a calendar year; `partial` is true while that year is still going.
 * Returns null when there is nothing tracked for the year.
 */
export function wrappedData({ db, userId, year, now = Date.now() }) {
    const rows = db.playtimeLog(userId).filter(r => String(r.day).startsWith(String(year)));
    if (!rows.length) return null;
    const months = Array(12).fill(0), per = new Map(), days = new Set(), byItad = new Map();
    let total = 0, weekend = 0;
    for (const r of rows) {
        const m = Number(String(r.day).slice(5, 7)) - 1;
        if (!(m >= 0 && m < 12)) continue;
        months[m] += r.minutes; total += r.minutes; days.add(r.day);
        const dow = new Date(r.day + "T00:00:00Z").getUTCDay();
        if (dow === 0 || dow === 6) weekend += r.minutes;
        const g = per.get(r.title) ?? { title: r.title, minutes: 0 };
        g.minutes += r.minutes; per.set(r.title, g);
        byItad.set(r.itad_id, (byItad.get(r.itad_id) ?? 0) + r.minutes);
    }
    const top = [...per.values()].sort((a, b) => b.minutes - a.minutes || a.title.localeCompare(b.title)).slice(0, 5);
    const library = db.listLibrary(userId);
    // Genres, weighted by the hours played in each game this year.
    const appOf = new Map(library.filter(g => g.appid).map(g => [g.itad_id, g.appid]));
    const tags = db.getAppTags([...new Set([...byItad.keys()].map(k => appOf.get(k)).filter(Boolean))]);
    const genreMin = new Map();
    for (const [itad, minutes] of byItad) for (const g of (tags.get(appOf.get(itad))?.genres ?? []).slice(0, 3)) genreMin.set(g, (genreMin.get(g) ?? 0) + minutes);
    const genres = [...genreMin].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name, minutes]) => ({ name, minutes }));
    const from = Date.UTC(year, 0, 1), to = Date.UTC(year + 1, 0, 1);
    const finished = db.finishedBetween(userId, from, to);
    const added = library.filter(g => g.added_at >= from && g.added_at < to);
    const spent = added.reduce((t, g) => t + (Number.isFinite(g.paid) ? g.paid : 0), 0);
    const busiest = months.indexOf(Math.max(...months));
    const d = {
        year, partial: new Date(now).getUTCFullYear() === year,
        totalMinutes: total, hours: Math.round(total / 60), games: per.size, activeDays: days.size,
        longestStreak: longestStreak([...days]), months, busiest, busiestName: MONTH_NAMES[busiest], busiestMinutes: months[busiest],
        weekendShare: total ? weekend / total : 0, top, genres, finished, added: added.length, spent: Math.round(spent * 100) / 100,
        paidCount: added.filter(g => Number.isFinite(g.paid)).length
    };
    d.archetype = archetype(d);
    return d;
}

// ---------------------------------------------------------------- pictures
const C = { bg: "#0b1220", panel: "#141f33", tile: "#1b2a40", line: "#27384f", text: "#f4f8fd", mute: "#a3b3c8", accent: "#4da3ff", warm: "#ffb454", good: "#5fd39a" };
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cut = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + "…" : String(s));
const W = 1080, H = 1350;

function frame(n, d, body, art = {}) {
    const label = d.partial ? `${d.year} SO FAR` : String(d.year);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#101a2e"/><stop offset="1" stop-color="${C.bg}"/></linearGradient>
<radialGradient id="glow" cx="900" cy="140" r="760" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${C.accent}" stop-opacity="0.28"/><stop offset="1" stop-color="${C.accent}" stop-opacity="0"/></radialGradient>
<clipPath id="av"><circle cx="112" cy="108" r="40"/></clipPath></defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/><rect width="${W}" height="${H}" fill="url(#glow)"/>
<rect x="0" y="0" width="${W}" height="10" fill="${C.accent}"/>
${art.avatar ? `<image href="${art.avatar}" x="72" y="68" width="80" height="80" clip-path="url(#av)" preserveAspectRatio="xMidYMid slice"/>` : `<circle cx="112" cy="108" r="40" fill="${C.tile}" stroke="${C.line}"/>`}
<text x="172" y="102" font-size="30" font-weight="700" fill="${C.text}">${esc(cut(art.name || "Your year in games", 24))}</text>
<text x="172" y="136" font-size="20" font-weight="600" fill="${C.accent}" letter-spacing="4">YOUR YEAR IN GAMES · ${label}</text>
${body}
<text x="72" y="${H - 52}" font-size="20" fill="#6f829a">Steam Value Checker</text>
<text x="${W - 72}" y="${H - 52}" font-size="20" text-anchor="end" fill="#6f829a">${n} / ${SLIDES}</text>
</svg>`;
}

const big = (x, y, text, size, fill = C.text, anchor = "start") => `<text x="${x}" y="${y}" font-size="${size}" font-weight="800" fill="${fill}" text-anchor="${anchor}">${esc(text)}</text>`;
const small = (x, y, text, size = 28, fill = C.mute, anchor = "start", weight = 500) => `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(text)}</text>`;
const tile = (x, y, w, h, k, v, sub) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="20" fill="${C.tile}" stroke="${C.line}"/>${small(x + 28, y + 46, k, 22, C.mute, "start", 600)}${big(x + 28, y + 108, v, 52)}${sub ? small(x + 28, y + 144, cut(sub, 30), 22) : ""}`;

/** One of the five pictures (1 to 5) as an SVG string. */
export function wrappedSvg(n, d, art = {}) {
    let b = "";
    if (n === 1) {
        b += small(72, 330, "This year you played", 38, C.mute);
        b += big(72, 560, d.hours.toLocaleString("en-US"), d.hours >= 10000 ? 200 : 250, C.accent);
        b += small(72, 680, d.hours === 1 ? "hour" : "hours", 64, C.text, "start", 700);
        b += small(72, 740, `about ${Math.max(1, Math.round(d.totalMinutes / 1440 * 10) / 10)} full days of playing`, 30);
        b += tile(72, 810, 456, 190, "GAMES PLAYED", String(d.games), "different games");
        b += tile(552, 810, 456, 190, "DAYS PLAYED", String(d.activeDays), `of ${d.partial ? "the year so far" : "the year"}`);
        b += tile(72, 1030, 936, 190, "THE ONE YOU CAME BACK TO", cut(d.top[0].title, 26), fmtHours(d.top[0].minutes));
    } else if (n === 2) {
        b += small(72, 290, "Your top games", 54, C.text, "start", 800);
        d.top.forEach((t, i) => {
            const y = 400 + i * 164, share = Math.max(0.03, t.minutes / d.top[0].minutes);
            b += `<rect x="72" y="${y - 54}" width="936" height="132" rx="20" fill="${i === 0 ? C.panel : C.tile}" stroke="${i === 0 ? C.accent : C.line}" stroke-width="${i === 0 ? 3 : 1}"/>`;
            b += big(104, y + 4, String(i + 1), 56, i === 0 ? C.warm : C.mute);
            b += small(180, y - 6, cut(t.title, 30), 34, C.text, "start", 700);
            b += small(976, y - 6, fmtHours(t.minutes), 30, C.mute, "end", 600);
            b += `<rect x="180" y="${y + 20}" width="796" height="12" rx="6" fill="#0b1220"/><rect x="180" y="${y + 20}" width="${Math.round(796 * share)}" height="12" rx="6" fill="${i === 0 ? C.warm : C.accent}"/>`;
        });
    } else if (n === 3) {
        const max = Math.max(...d.months, 1), left = 90, base = 760, ch = 300, bw = 56, gap = (W - 2 * left - 12 * bw) / 11;
        b += small(72, 290, `${d.busiestName} was your month`, 54, C.text, "start", 800);
        b += small(72, 346, `${fmtHours(d.busiestMinutes)} that month`, 30);
        d.months.forEach((m, i) => {
            const x = left + i * (bw + gap), h = Math.max(m ? 8 : 3, Math.round(ch * m / max));
            b += `<rect x="${x}" y="${base - h}" width="${bw}" height="${h}" rx="10" fill="${i === d.busiest ? C.warm : C.accent}" fill-opacity="${m ? 1 : 0.25}"/>`;
            b += small(x + bw / 2, base + 36, MONTHS[i], 20, C.mute, "middle");
        });
        b += tile(72, 880, 456, 190, "LONGEST STREAK", `${d.longestStreak} ${d.longestStreak === 1 ? "day" : "days"}`, "in a row");
        b += tile(552, 880, 456, 190, "WEEKENDS", `${Math.round(d.weekendShare * 100)}%`, "of your hours");
        b += tile(72, 1100, 936, 170, "ON AVERAGE", d.activeDays ? fmtHours(Math.round(d.totalMinutes / d.activeDays)) : "0", "every day you played");
    } else if (n === 4) {
        b += small(72, 290, "Your collection", 54, C.text, "start", 800);
        b += tile(72, 350, 456, 190, "NEW GAMES", String(d.added), "added to your library");
        b += tile(552, 350, 456, 190, "FINISHED", String(d.finished.length), d.finished.length === 1 ? "game beaten" : "games beaten");
        if (d.paidCount) b += tile(72, 570, 936, 170, "SPENT ON THEM", d.spent.toLocaleString("en-US", { style: "currency", currency: "USD" }), `${d.paidCount} with a price you entered`);
        let y = d.paidCount ? 800 : 600;
        if (d.finished.length) {
            b += small(72, y, "Finished this year", 26, C.mute, "start", 700); y += 24;
            d.finished.slice(0, 4).forEach((t, i) => { b += `<rect x="72" y="${y + i * 62}" width="936" height="50" rx="14" fill="${C.tile}"/>` + small(98, y + i * 62 + 34, "✓  " + cut(t, 44), 26, C.text, "start", 600); });
            y += Math.min(4, d.finished.length) * 62 + 40;
        }
        if (d.genres.length) {
            b += small(72, y + 10, "Your genres", 26, C.mute, "start", 700); y += 40;
            let x = 72;
            d.genres.forEach(g => { const w = Math.round(g.name.length * 15 + 56); if (x + w > 1008) return; b += `<rect x="${x}" y="${y}" width="${w}" height="56" rx="28" fill="${C.accent}" fill-opacity="0.18" stroke="${C.accent}" stroke-width="2"/>` + small(x + w / 2, y + 37, g.name, 26, C.text, "middle", 700); x += w + 14; });
        }
    } else {
        b += small(72, 330, "You are", 40, C.mute);
        b += big(72, 470, d.archetype.name.replace(/^The /, "The "), d.archetype.name.length > 18 ? 84 : 104, C.warm);
        const words = d.archetype.line.split(" "), lines = []; let cur = "";
        for (const w of words) { if ((cur + " " + w).trim().length > 38) { lines.push(cur); cur = w; } else cur = (cur + " " + w).trim(); }
        if (cur) lines.push(cur);
        lines.slice(0, 4).forEach((l, i) => { b += small(72, 570 + i * 54, l, 38, C.text, "start", 600); });
        b += tile(72, 800, 300, 190, "HOURS", d.hours.toLocaleString("en-US"));
        b += tile(390, 800, 300, 190, "GAMES", String(d.games));
        b += tile(708, 800, 300, 190, "FINISHED", String(d.finished.length));
        b += small(72, 1100, "Get yours with /me steam wrapped", 28, C.accent, "start", 700);
    }
    return frame(n, d, b, art);
}

/** The pictures as PNG buffers (`slides` is a list of numbers 1 to 5), or null when there is nothing to show (Steam not linked, or no hours tracked that year). */
export async function renderWrapped({ db, userId, slides = [1, 2, 3, 4, 5], year, name, fetchImpl = fetch, now = Date.now() }) {
    const link = db.getSteamLink(userId);
    if (!link) return null;
    const y = Number.isInteger(year) ? year : new Date(now).getUTCFullYear();
    const d = wrappedData({ db, userId, year: y, now });
    if (!d) return null;
    const card = await fetchProfileCard(link.steamid, fetchImpl).catch(() => null);
    const av = card?.avatar ? await fetchImageDataUri(card.avatar, { fetchImpl }).catch(() => null) : null;
    const art = { avatar: av?.uri ?? av ?? undefined, name: name || card?.name };
    return slides.map(n => svgToPng(wrappedSvg(Math.min(SLIDES, Math.max(1, Number(n) || 1)), d, art), W));
}
