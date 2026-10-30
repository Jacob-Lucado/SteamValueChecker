// Picture cards for the commands that used to be plain text embeds: challenge, spend, trend, compare, badges, status, server stats.
// One layout (header, big number, stat tiles, optional bars, lists) fed by small per-command mappers. No emoji are drawn.
import { money } from "./render.js";
import { toPng } from "./communitycards.js";
export { toPng };

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cut = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + "…" : String(s));
const num = n => Number(n ?? 0).toLocaleString("en-US");
const GOOD = "#57f287", BAD = "#f2706b", WARN = "#f2b84b", MUTED = "#7f93ba";

/**
 * spec: { title, subtitle, accent, accent2, hero: { label, value }, progress: { pct, left, right },
 *         tiles: [{ label, value, tone }], bars: { title, values: [n], labels: [s] },
 *         sections: [{ heading, rows: [{ left, right, tone, pct, dot }] }], note }
 */
export function panelSvg(spec) {
    const W = 1000, a = spec.accent ?? "#70a6d8", b = spec.accent2 ?? "#8b7cf6";
    let y = 0, body = "";
    // header
    body += `<text x="48" y="72" font-size="40" font-weight="700" fill="#f3f6fc">${esc(cut(spec.title, 30))}</text>`;
    if (spec.subtitle) body += `<text x="48" y="104" font-size="20" font-weight="600" fill="${MUTED}">${esc(cut(spec.subtitle, 56))}</text>`;
    body += `<rect x="48" y="118" width="120" height="4" rx="2" fill="url(#acc)"/>`;
    if (spec.hero) body += `<text x="952" y="60" font-size="18" font-weight="600" fill="${MUTED}" text-anchor="end" letter-spacing="3">${esc(spec.hero.label.toUpperCase())}</text>
  <text x="952" y="128" font-size="${String(spec.hero.value).length > 9 ? 56 : 76}" font-weight="700" fill="url(#acc)" text-anchor="end">${esc(spec.hero.value)}</text>`;
    y = 150;
    if (spec.progress) {
        const p = Math.min(1, Math.max(0, spec.progress.pct));
        body += `<rect x="48" y="${y}" width="904" height="26" rx="13" fill="#1c2740"/><rect x="48" y="${y}" width="${Math.max(26, Math.round(904 * p))}" height="26" rx="13" fill="url(#acc)"/>
  <text x="48" y="${y + 56}" font-size="21" font-weight="700" fill="#f3f6fc">${esc(spec.progress.left ?? "")}</text><text x="952" y="${y + 56}" font-size="20" font-weight="600" fill="${MUTED}" text-anchor="end">${esc(spec.progress.right ?? "")}</text>`;
        y += 84;
    }
    if (spec.tiles?.length) {
        const n = Math.min(4, spec.tiles.length), gap = 16, tw = Math.floor((904 - gap * (n - 1)) / n);
        spec.tiles.slice(0, 4).forEach((t, k) => {
            const x = 48 + k * (tw + gap), col = t.tone === "good" ? GOOD : t.tone === "bad" ? BAD : "#f3f6fc";
            body += `<rect x="${x}" y="${y}" width="${tw}" height="92" rx="16" fill="#162036" stroke="#23314f" stroke-width="1.5"/>
  <text x="${x + 20}" y="${y + 32}" font-size="15" font-weight="600" fill="${MUTED}" letter-spacing="1.5">${esc(cut(t.label.toUpperCase(), Math.floor(tw / 11)))}</text>
  <text x="${x + 20}" y="${y + 70}" font-size="${String(t.value).length > 11 ? 24 : 32}" font-weight="700" fill="${col}">${esc(cut(t.value, 16))}</text>`;
        });
        y += 120;
    }
    if (spec.bars?.values?.length) {
        const v = spec.bars.values, peak = Math.max(...v, 1), bw = Math.floor(904 / v.length), H = 90;
        body += `<text x="48" y="${y + 14}" font-size="16" font-weight="600" fill="${MUTED}" letter-spacing="1.5">${esc((spec.bars.title ?? "").toUpperCase())}</text>`;
        v.forEach((n, k) => { const h = Math.max(4, Math.round(n / peak * H)); body += `<rect x="${48 + k * bw + 4}" y="${y + 28 + H - h}" width="${bw - 8}" height="${h}" rx="6" fill="url(#acc)" fill-opacity="${n ? 1 : 0.25}"/>`; });
        if (spec.bars.labels) v.forEach((_, k) => { body += `<text x="${48 + k * bw + bw / 2}" y="${y + 28 + H + 22}" font-size="14" fill="${MUTED}" text-anchor="middle">${esc(spec.bars.labels[k] ?? "")}</text>`; });
        y += 28 + H + 40;
    }
    for (const sec of spec.sections ?? []) {
        if (!sec.rows?.length) continue;
        body += `<text x="48" y="${y + 14}" font-size="16" font-weight="600" fill="${MUTED}" letter-spacing="1.5">${esc(sec.heading.toUpperCase())}</text>`;
        y += 26;
        for (const r of sec.rows) {
            const col = r.tone === "good" ? GOOD : r.tone === "bad" ? BAD : r.tone === "warn" ? WARN : "#9fb2d6";
            body += `<rect x="48" y="${y}" width="904" height="${r.pct !== undefined ? 50 : 38}" rx="12" fill="#131c31"/>`;
            if (r.dot) body += `<circle cx="74" cy="${y + 19}" r="9" fill="${r.dot}"/>`;
            body += `<text x="${r.dot ? 96 : 68}" y="${y + 26}" font-size="20" font-weight="600" fill="#f3f6fc">${esc(cut(r.left, 46))}</text>
  <text x="936" y="${y + 26}" font-size="20" font-weight="600" fill="${col}" text-anchor="end">${esc(cut(r.right ?? "", 40))}</text>`;
            if (r.pct !== undefined) body += `<rect x="68" y="${y + 38}" width="864" height="6" rx="3" fill="#1c2740"/><rect x="68" y="${y + 38}" width="${Math.max(6, Math.round(864 * Math.min(1, Math.max(0, r.pct))))}" height="6" rx="3" fill="url(#acc)"/>`;
            y += (r.pct !== undefined ? 50 : 38) + 8;
        }
        y += 14;
    }
    if (spec.note) { body += `<text x="48" y="${y + 14}" font-size="16" fill="${MUTED}">${esc(cut(spec.note, 110))}</text>`; y += 34; }
    const H = y + 28;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Inter"><defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#101827"/><stop offset="1" stop-color="#0b1020"/></linearGradient>
  <linearGradient id="acc" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>
  <radialGradient id="glow" cx="0.1" cy="0.05" r="0.9"><stop offset="0" stop-color="${a}" stop-opacity="0.26"/><stop offset="1" stop-color="${a}" stop-opacity="0"/></radialGradient></defs>
  <rect width="${W}" height="${H}" rx="28" fill="url(#bg)"/><rect width="${W}" height="${H}" rx="28" fill="url(#glow)"/><rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="27" fill="none" stroke="#26324d" stroke-width="2"/>${body}</svg>`;
}

const delta = (n, f) => (n === null || n === undefined || n === 0 ? null : { text: `${n > 0 ? "+" : "-"}${f(Math.abs(n))}`, up: n > 0 });

export function challengeSpec(c) {
    if (!c.goal) return { title: "Backlog challenge", subtitle: c.month, accent: "#a4d007", accent2: "#57f287", hero: { label: "Streak", value: `${c.streak ?? 0}` },
        sections: [{ heading: "Get started", rows: [{ left: "No goal set for this month", right: "/library challenge goal:3" }] }], note: "Finish that many games this month to keep a streak." };
    const met = c.done >= c.goal;
    return { title: "Backlog challenge", subtitle: c.month, accent: "#a4d007", accent2: "#57f287", hero: { label: met ? "Goal met" : "Finished", value: `${c.done}/${c.goal}` },
        progress: { pct: c.done / c.goal, left: `${c.done} of ${c.goal} finished`, right: met ? "Goal met" : `${c.daysLeft} day${c.daysLeft === 1 ? "" : "s"} left` },
        tiles: [{ label: "Streak", value: `${c.streak} month${c.streak === 1 ? "" : "s"}`, tone: c.streak ? "good" : undefined }, { label: "Best streak", value: `${c.best} month${c.best === 1 ? "" : "s"}` }, { label: "Days left", value: String(c.daysLeft) }],
        sections: [{ heading: "Finished this month", rows: c.titles.slice(0, 6).map(t => ({ left: t, dot: GOOD })) },
            { heading: "Earlier months", rows: c.history.filter(h => h.month !== c.month).slice(0, 4).map(h => ({ left: h.month, right: `${h.done}/${h.goal}`, dot: h.done >= h.goal ? GOOD : "#2a3a5e", tone: h.done >= h.goal ? "good" : undefined })) }],
        note: "A game counts when you mark it finished. Months are in UTC." };
}

export function spendSpec(sp) {
    const c = sp.currency;
    if (!sp.games) return { title: "What you have spent", accent: "#f0883e", accent2: "#f5c542", sections: [{ heading: "Nothing recorded yet", rows: [{ left: "Add what you paid with /library add", right: "" }, { left: "Or press Send what I paid in the extension", right: "" }] }] };
    const line = g => ({ left: g.title, right: `${money(g.paid, c)} · ${money(g.perHour, c)}/h` });
    return { title: "What you have spent", subtitle: `${sp.games} game${sp.games === 1 ? "" : "s"}, about ${money(sp.avg, c)} each`, accent: "#f0883e", accent2: "#f5c542", hero: { label: "Total", value: money(sp.total, c) },
        tiles: [{ label: String(sp.year.year), value: money(sp.year.total, c) }, { label: "Games", value: num(sp.games) }, { label: "Unplayed", value: sp.unplayed.count ? money(sp.unplayed.total, c) : "None", tone: sp.unplayed.count ? "bad" : "good" }],
        bars: { title: "Last 12 months", values: sp.months.map(m => m.total) },
        sections: [{ heading: "Best value per hour", rows: sp.bestValue.map(line).map(r => ({ ...r, tone: "good" })) }, { heading: "Most expensive per hour", rows: sp.worstValue.map(line).map(r => ({ ...r, tone: "bad" })) }],
        note: "Games without an amount are not counted." };
}

export function trendSpec(tr, currency, backlogNow) {
    const m = d => [
        [delta(d.cheapest, v => money(v, currency)), "Cheapest-price value"], [delta(d.msrp, v => money(v, currency)), "Full-price value"], [delta(d.games, String), "Games"], [delta(d.backlog, String), "Backlog"], [delta(d.finished, String), "Finished"]
    ].filter(([x]) => x).map(([x, label]) => ({ left: label, right: x.text, tone: label === "Backlog" ? (x.up ? "bad" : "good") : (x.up ? "good" : "bad") }));
    const sections = [];
    if (tr.month) sections.push({ heading: `Last ${tr.month.days} days`, rows: m(tr.month).length ? m(tr.month) : [{ left: "Nothing changed", right: "" }] });
    sections.push({ heading: `Since ${tr.first.days} days ago`, rows: m(tr.first).length ? m(tr.first) : [{ left: "Nothing changed", right: "" }] });
    return { title: "Your library trend", subtitle: "How your collection is changing", accent: "#4dc0b5", accent2: "#70a6d8", hero: { label: "Worth today", value: money(tr.last.cheapest, currency) },
        tiles: [{ label: "Full price", value: money(tr.last.msrp, currency) }, { label: "Games", value: num(tr.last.games) }, ...(backlogNow !== undefined ? [{ label: "Backlog", value: num(backlogNow) }] : [])], sections };
}

const hrs = m => (m >= 60 ? `${Math.round(m / 60).toLocaleString("en-US")}h` : "0h");
export function compareSpec(r, meName, themName) {
    const row = x => ({ left: x.title, right: x.aMinutes || x.bMinutes ? `${hrs(x.aMinutes)} / ${hrs(x.bMinutes)}` : "" });
    return { title: `${cut(meName, 14)} vs ${cut(themName, 14)}`, subtitle: "Library comparison", accent: "#70a6d8", accent2: "#eb459e", hero: { label: "Overlap", value: `${r.overlapPct}%` },
        tiles: [{ label: meName, value: `${num(r.a.games)} games` }, { label: themName, value: `${num(r.b.games)} games` }, { label: "In common", value: num(r.shared.length) }, ...(r.a.minutes || r.b.minutes ? [{ label: "Hours", value: `${hrs(r.a.minutes)} / ${hrs(r.b.minutes)}` }] : [])],
        sections: [{ heading: "You both own", rows: r.shared.slice(0, 6).map(row) }, { heading: `Only ${meName}`, rows: r.onlyA.slice(0, 4).map(x => ({ left: x.title })) }, { heading: `Only ${themName}`, rows: r.onlyB.slice(0, 4).map(x => ({ left: x.title })) }],
        note: "Only members who opted in with /alerts share can be compared." };
}

const TIER = { bronze: "#d08a4e", silver: "#c0c8d4", gold: "#f5c542", platinum: "#7fe0e8", diamond: "#8bb8ff" };
export function badgesSpec(tc) {
    return { title: "Trophy case", subtitle: "Worked out from your library and monthly challenge", accent: "#f5c542", accent2: "#f0883e", hero: { label: "Earned", value: `${tc.earned}/${tc.total}` },
        sections: [{ heading: "Badges", rows: tc.badges.slice(0, 12).map(b => ({ left: `${b.name}${b.tier ? ` · ${b.tier}` : ""}`, right: `${b.value} ${b.unit}${b.next ? ` · next ${b.next}` : ""}`, dot: b.tier ? (TIER[String(b.tier).toLowerCase()] ?? GOOD) : "#2a3a5e", tone: b.tier ? undefined : undefined, pct: b.next ? Math.min(1, b.value / b.next) : (b.tier ? 1 : 0) })) }] };
}

const STATE = { operational: GOOD, degraded: WARN, down: BAD, unknown: "#5b6b8c" };
export function statusSpec(snap, about) {
    const head = { operational: "All systems operational", degraded: "Some systems are degraded", down: "Major outage" }[snap.overall] ?? "Checking";
    const up = snap.uptime;
    return { title: head, subtitle: [about?.uptime ? `Running for ${about.uptime}` : null, about?.pingMs != null ? `${about.pingMs} ms latency` : null].filter(Boolean).join("  ·  "),
        accent: STATE[snap.overall] ?? "#70a6d8", accent2: "#70a6d8", hero: up.pct90 !== null ? { label: "90-day uptime", value: `${up.pct90}%` } : undefined,
        sections: [{ heading: "Systems", rows: snap.components.map(c => ({ left: c.name, right: c.detail ? `${c.state}: ${c.detail}` : c.state, dot: STATE[c.state] ?? STATE.unknown, tone: c.state === "operational" ? "good" : c.state === "degraded" ? "warn" : c.state === "down" ? "bad" : undefined })) }] };
}

export function serverStatsSpec(s, serverName = "") {
    if (!s.members) return { title: "Server stats", subtitle: serverName, accent: "#70a6d8", sections: [{ heading: "Nothing yet", rows: [{ left: "Nobody here has opted in yet", right: "" }, { left: "Members turn it on with /alerts share", right: "" }] }] };
    return { title: "Server stats", subtitle: serverName || "Members who opted in with /alerts share", accent: "#70a6d8", accent2: "#8b7cf6", hero: { label: "Members counted", value: num(s.members) },
        tiles: [{ label: "Games in libraries", value: num(s.games) }, { label: "Saved vs MSRP", value: s.saved > 0 ? money(s.saved, "USD") : "-", tone: s.saved > 0 ? "good" : undefined }, { label: "Sale alerts, 30d", value: num(s.alerts30d) }],
        sections: [{ heading: "Most wanted", rows: s.mostWanted.slice(0, 5).map((g, n) => ({ left: `${n + 1}. ${g.title}`, right: `${g.watchers} watching` })) }, { heading: "Top of the server list", rows: s.sharedList.slice(0, 4).map(g => ({ left: g.title, right: `${g.votes} votes` })) }],
        note: "Counts only. Nobody is named for what they want." };
}
