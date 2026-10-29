// Builds the Discord embeds and the CSV download from report data.
// Embeds are plain API objects (no discord.js needed), which keeps this module testable.

import { protonLabel } from "./proton.js";
import { tr } from "./i18n.js";
export const ROWS_PER_PAGE = 15;
const COLOR = 0xff9800;

export function money(n, currency = "USD") {
    if (n === null || n === undefined || Number.isNaN(n)) return "-";
    try {
        return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
    } catch {
        return `${n.toFixed(2)} ${currency}`;
    }
}

const fit = (s, n) => { const t = String(s); return (t.length > n ? t.slice(0, n - 1) + "…" : t).padEnd(n); };
const left = (s, n) => String(s).padStart(n);
const fence = lines => "```\n" + lines.join("\n") + "\n```";

export function pageCount(rows) {
    return Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));
}

/** The table for one page. `~` marks an approximate title match. */
export function tableEmbed(rows, page, currency) {
    const showPaid = rows.some(r => r.paid !== null);
    const header = `${fit("Game", 24)} ${left("MSRP", 9)} ${left("Steam", 9)} ${left("Cheapest", 9)} ${fit("Store", 11)}` +
        (showPaid ? ` ${left("Paid", 9)}` : "");

    const slice = rows.slice(page * ROWS_PER_PAGE, (page + 1) * ROWS_PER_PAGE);
    const body = slice.map(r => {
        if (!r.found) return `${fit(r.title, 24)} not found`;
        const name = (r.approx ? "~" : "") + r.title;
        const store = r.best ? r.best.shop : "-";
        return `${fit(name, 24)} ${left(money(r.msrp, currency), 9)} ${left(money(r.steam, currency), 9)} ` +
            `${left(money(r.best?.price ?? null, currency), 9)} ${fit(store, 11)}` +
            (showPaid ? ` ${left(money(r.paid, currency), 9)}` : "");
    });

    const pages = pageCount(rows);
    return {
        color: COLOR,
        description: fence([header, ...body]),
        footer: { text: `Page ${page + 1}/${pages}  •  ~ = approximate title match  •  Prices by IsThereAnyDeal` }
    };
}

function signed(diff, pct, currency) {
    return diff >= 0
        ? `saved ${money(diff, currency)} (${Math.round(pct)}%)`
        : `extra ${money(-diff, currency)} (${Math.round(-pct)}% more)`;
}

/** Totals, plus the paid-vs-value block when the user gave an amount. */
export function summaryEmbed(t, savings, { region, majorOnly }) {
    const c = t.currency;
    const value = [
        `${"MSRP".padEnd(14)} ${left(money(t.msrp, c), 11)}`,
        `${"Steam now".padEnd(14)} ${left(money(t.steam, c), 11)}${t.steamCount < t.found ? `  (${t.steamCount} on Steam)` : ""}`,
        `${"Cheapest now".padEnd(14)} ${left(money(t.best, c), 11)}${majorOnly ? "  (major stores)" : ""}`
    ];
    if (t.atlCount > 0) value.push(`${"All-time low".padEnd(14)} ${left(money(t.atl, c), 11)}`);

    const fields = [{
        name: `Library value  (${t.found}/${t.count} games found, ${region})`,
        value: fence(value)
    }];

    if (savings) {
        const paidLine = `${"You paid".padEnd(16)} ${left(money(savings.paid, c), 10)}`;
        const lines = [paidLine];
        if (savings.perGame !== null) lines.push(`${"Per game".padEnd(16)} ${left(money(savings.perGame, c), 10)}`);
        for (const l of savings.lines) {
            lines.push(`vs ${l.label.padEnd(13)} ${signed(l.diff, l.pct, c)}`);
        }
        fields.push({ name: "Paid vs value", value: fence(lines) });
        if (savings.verdict) fields.push({ name: "Verdict", value: savings.verdict });

        if (savings.biggest.length) {
            fields.push({
                name: "Best deals",
                value: savings.biggest
                    .map(r => `**${r.title}**: paid ${money(r.paid, c)} (MSRP ${money(r.msrp, c)})`)
                    .join("\n").slice(0, 1000)
            });
        }
        if (savings.overpaid.length) {
            fields.push({
                name: "Cheaper elsewhere now",
                value: savings.overpaid.slice(0, 5)
                    .map(r => `**${r.title}**: paid ${money(r.paid, c)}, now ${money(r.best.price, c)} at ${r.best.shop}`)
                    .join("\n").slice(0, 1000)
            });
        }
    }

    return { color: COLOR, title: "Steam Value Checker", fields };
}

const csvCell = v => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stops spreadsheet formula injection from odd titles
    return `"${s.replace(/"/g, '""')}"`;
};

export function toCsv(rows, currency) {
    const head = ["Game", "Matched title", "Found", "Currency", "MSRP", "Steam price", "Steam discount %", "Cheapest price", "Cheapest store", "All-time low", "Paid"];
    const lines = rows.map(r => [
        r.title, r.approx ? r.matched : "", r.found ? "yes" : "no", currency,
        r.msrp, r.steam, r.cut || "", r.best?.price, r.best?.shop, r.atl, r.paid
    ].map(csvCell).join(","));
    return "﻿" + [head.map(csvCell).join(","), ...lines].join("\r\n") + "\r\n";
}

const GREEN = 0x57f287;
const safeUrl = u => (typeof u === "string" && /^https:\/\//i.test(u) ? u : undefined);

export const STOP_ID = "alert_stop";
export const SNOOZE_ID = "alert_snooze", BELOW_ID = "alert_below", BELOW_MODAL_ID = "alert_m_below";
export const steamArt = appid => `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/header.jpg`;
export const itadArt = id => `https://assets.isthereanydeal.com/${encodeURIComponent(id)}/banner400.jpg`;
/** Game art for an alert: Steam's header when the Steam id is known, otherwise IsThereAnyDeal's banner. */
export const artUrl = item => (Number.isInteger(item?.appid) ? steamArt(item.appid) : item?.itad_id ? itadArt(item.itad_id) : undefined);

const LEVEL = {
    great: { color: 0xfee75c, icon: "🏆" },
    good: { color: GREEN, icon: "👍" },
    wait: { color: 0xf0883e, icon: "⏳" },
    info: { color: GREEN, icon: "💸" }
};

/**
 * One sale alert. `now` comes from alerts.current(). `art` is "image" (large, for a single alert),
 * "thumbnail" (small, when several alerts share a message) or null.
 */
export function alertEmbed(item, now, { trigger, lower = false, verdict = null, art = null, insight = null, proton = null } = {}) {
    const c = now.currency ?? "USD";
    const pct = Math.round((now.discount ?? 0) * 100);
    const lvl = LEVEL[verdict?.level] ?? LEVEL.info;
    const saves = now.regular != null && now.price != null && now.regular > now.price ? ` (you save ${money(now.regular - now.price, c)})` : "";
    const lines = [`**${money(now.price, c)}**${now.shop ? ` at **${now.shop}**` : ""}${saves}`];
    if (verdict) lines.unshift(`${lvl.icon} **${verdict.text}**`);
    const fields = [
        { name: "Regular", value: money(now.regular, c), inline: true },
        { name: "Discount", value: pct > 0 ? `${pct}% off` : "-", inline: true }
    ];
    if (now.atl !== null) fields.push({ name: "All-time low", value: money(now.atl, c), inline: true });
    if (proton && protonLabel(proton)) lines.push(protonLabel(proton));
    if (insight) fields.push({ name: "Last 12 months", value: `\`${insight.spark}\`\n${insight.text}`.slice(0, 1000), inline: false });
    const art_ = art ? artUrl(item) : undefined;
    return {
        color: lvl.color,
        title: `${item.priority ? "⭐ " : ""}${lower ? `${item.title}: price dropped again` : pct > 0 ? `${item.title} is ${pct}% off` : `${item.title} is on sale`}`,
        url: safeUrl(now.url),
        description: lines.join("\n"),
        fields,
        image: art === "image" && art_ ? { url: art_ } : undefined,
        thumbnail: art === "thumbnail" && art_ ? { url: art_ } : undefined,
        footer: { text: `Your alert: ${trigger}  •  /alerts pause to stop  •  Prices by IsThereAnyDeal` }
    };
}

const linkButton = (label, url) => ({ type: 2, style: 5, label: String(label).slice(0, 80), url });
const short = (t, n) => (t.length > n ? t.slice(0, n - 1) + "…" : t);

/** The button row under one alert: view the deal, Steam page, price history, stop watching. */
export function alertButtons(item, now, { single = true, lang = "en" } = {}) {
    const row = [];
    const L = k => tr(lang, k);
    const deal = safeUrl(now.url);
    if (deal) row.push(linkButton(single ? `${L("View deal")}${now.shop ? " at " + short(now.shop, 30) : ""}` : `Deal: ${short(item.title, 30)}`, deal));
    if (single && Number.isInteger(item.appid)) row.push(linkButton(L("Steam page"), `https://store.steampowered.com/app/${item.appid}/`));
    if (single && now.slug) row.push(linkButton(L("Price history"), `https://isthereanydeal.com/game/${encodeURIComponent(now.slug)}/info/`));
    if (item.id != null) row.push({ type: 2, style: 2, label: single ? L("Stop watching") : `Stop: ${short(item.title, 30)}`, custom_id: `${STOP_ID}:${item.id}` });
    return row.length ? { type: 1, components: row } : null;
}

/** A whole alert message for one member: up to 5 games, each with its art and its own buttons. */
export function alertPayload(hits, { trigger, verdict, lang = "en" }) {
    const single = hits.length === 1;
    return {
        content: single ? undefined : `${hits.length} games on your wishlist hit your alert.`,
        embeds: hits.map(h => alertEmbed(h.item, h.now, { trigger: trigger(h.item), lower: h.reason === "lower", verdict: verdict(h.now), art: single ? "image" : "thumbnail", insight: h.insight ?? null, proton: h.proton ?? null })),
        components: [...hits.map(h => alertButtons(h.item, h.now, { single, lang })).filter(Boolean),
            ...(single && hits[0].item.id != null ? [{ type: 1, components: [
                { type: 2, style: 2, label: tr(lang, "Snooze 7 days"), custom_id: `${SNOOZE_ID}:${hits[0].item.id}` },
                { type: 2, style: 2, label: tr(lang, "Only below a price…"), custom_id: `${BELOW_ID}:${hits[0].item.id}` }] }] : [])]
    };
}

export const WISHLIST_PER_PAGE = 15;

/** Wishlist overview table: one line per game with current price and discount. */
export function wishlistEmbed(rows, page, currency) {
    const pages = Math.max(1, Math.ceil(rows.length / WISHLIST_PER_PAGE));
    const head = `${fit("Game", 26)} ${left("Now", 9)} ${left("Off", 5)} ${fit("Store", 11)} Alert`;
    const body = rows.slice(page * WISHLIST_PER_PAGE, (page + 1) * WISHLIST_PER_PAGE).map(r => {
        const price = r.best?.price ?? null;
        const off = r.discount > 0 ? `${Math.round(r.discount * 100)}%` : "-";
        return `${fit(r.title, 26)} ${left(money(price, currency), 9)} ${left(off, 5)} ${fit(r.best?.shop ?? "-", 11)} ${r.alert}`;
    });
    return {
        color: COLOR,
        description: fence([head, ...body]),
        footer: { text: `Page ${page + 1}/${pages}  •  ${rows.length} games  •  Prices by IsThereAnyDeal` }
    };
}

const PURPLE = 0x8b7bff;
const stamp = ms => `<t:${Math.floor(ms / 1000)}:R>`;

/** A watched game appeared in a bundle. `hit` is { item, bundle }. */
export function bundleEmbed({ item, bundle }) {
    const fields = [{ name: "Bundle", value: bundle.title.slice(0, 200), inline: true }];
    if (bundle.shop) fields.push({ name: "Store", value: bundle.shop, inline: true });
    if (bundle.price !== undefined) fields.push({ name: "From", value: money(bundle.price, bundle.currency ?? "USD"), inline: true });
    if (bundle.expiry) fields.push({ name: "Ends", value: stamp(bundle.expiry), inline: true });
    return { color: PURPLE, title: `${item.title} is in a bundle`, url: safeUrl(bundle.url), thumbnail: artUrl(item) ? { url: artUrl(item) } : undefined, fields, footer: { text: "Bundle alerts can be turned off with /alerts bundles  •  Data by IsThereAnyDeal" } };
}

/** A watched game is being given away. */
export function giveawayEmbed({ item, giveaway }) {
    const fields = [{ name: "Giveaway", value: giveaway.title.slice(0, 200), inline: true }];
    if (giveaway.shop) fields.push({ name: "Where", value: giveaway.shop, inline: true });
    if (giveaway.expiry) fields.push({ name: "Ends", value: stamp(giveaway.expiry), inline: true });
    return { color: GREEN, title: `${item.title} is free right now`, url: safeUrl(giveaway.url), thumbnail: artUrl(item) ? { url: artUrl(item) } : undefined, fields, footer: { text: "Giveaway alerts can be turned off with /alerts bundles  •  Data by IsThereAnyDeal" } };
}

/** Weekly digest: best sales on the wishlist. Returns null when nothing is on sale. */
export function digestEmbed(rows, currency, { limit = 10 } = {}) {
    const onSale = rows.filter(r => r.discount > 0 && r.best).sort((a, b) => b.discount - a.discount);
    if (!onSale.length) return null;
    const lines = onSale.slice(0, limit).map(r => {
        const tag = r.verdict && r.verdict.level === "great" ? " (all-time low)" : "";
        return `**${r.title}**: ${money(r.best.price, currency)} (-${Math.round(r.discount * 100)}%) at ${r.best.shop}${tag}`;
    });
    if (onSale.length > limit) lines.push(`…and ${onSale.length - limit} more. Open /wishlist view for the full list.`);
    return { color: COLOR, title: "Your weekly wishlist digest", description: `${onSale.length} of ${rows.length} games are on sale.\n\n${lines.join("\n")}`.slice(0, 4000), footer: { text: "Turn off with /alerts digest  •  Prices by IsThereAnyDeal" } };
}

/** Library overview for Discord. */
export function libraryEmbed(view, currency) {
    const t = view.totals;
    const lines = [
        `${"Games".padEnd(16)} ${left(String(t.games), 11)}`,
        `${"You paid".padEnd(16)} ${left(money(t.paid, currency), 11)}${t.paidGames < t.games ? `  (${t.paidGames} with a price)` : ""}`,
        `${"MSRP (all)".padEnd(16)} ${left(money(t.msrp, currency), 11)}`,
        `${"Cheapest now".padEnd(16)} ${left(money(t.cheapest, currency), 11)}`,
        `${"Saved vs MSRP".padEnd(16)} ${left(money(t.saved, currency), 11)}${t.msrpPaid > 0 ? `  (${Math.round(t.savedPct)}%)` : ""}`
    ];
    const top = [...view.rows].filter(r => r.saved !== null).sort((a, b) => b.saved - a.saved).slice(0, 5)
        .map(r => `**${r.title}**: paid ${money(r.paid, currency)}, MSRP ${money(r.msrp, currency)}`).join("\n");
    const fields = [{ name: "Your library", value: fence(lines) }];
    if (top) fields.push({ name: "Best deals", value: top.slice(0, 1000) });
    return { color: COLOR, title: "Library value", fields, footer: { text: "Prices by IsThereAnyDeal" } };
}

/** The /status card, the same data as the Status page. */
export function statusEmbed(snap, about, publicUrl = null) {
    const ICON = { operational: "🟢", degraded: "🟡", down: "🔴", unknown: "⚪" };
    const HEAD = { operational: "All systems operational", degraded: "Some systems are degraded", down: "Major outage" };
    const fields = snap.components.map(c => ({ name: `${ICON[c.state] ?? "⚪"} ${c.name}`, value: c.detail ? `${c.state}: ${c.detail}` : c.state, inline: true }));
    const up = snap.uptime;
    const bits = [up.pct90 !== null ? `**${up.pct90}%** uptime over 90 days` : null, about?.uptime ? `Running for **${about.uptime}**` : null, about?.pingMs != null ? `Latency **${about.pingMs} ms**` : null].filter(Boolean);
    return {
        color: snap.overall === "operational" ? GREEN : snap.overall === "degraded" ? 0xf2b84b : 0xed4245,
        title: `${ICON[snap.overall] ?? "⚪"} ${HEAD[snap.overall] ?? "Checking"}`, description: bits.join("  •  ") || undefined, fields,
        footer: { text: publicUrl ? `Full history: ${publicUrl}/#/status` : "Checked every minute" }
    };
}

/** The /serverstats card. Opted-in members only, and only counts: nobody is named for what they want. */
export function serverStatsEmbed(s) {
    if (!s.members) return { color: COLOR, title: "Server stats", description: "Nobody here has opted in yet. Members turn it on with `/alerts share`, then the numbers appear." };
    const fields = [
        { name: "Members counted", value: String(s.members), inline: true },
        { name: "Games in libraries", value: String(s.games), inline: true },
        { name: "Saved vs MSRP", value: s.saved > 0 ? money(s.saved, "USD") : "-", inline: true }
    ];
    if (s.mostWanted.length) fields.push({ name: "Most wanted", value: s.mostWanted.map((g, n) => `${n + 1}. **${g.title}** (${g.watchers})`).join("\n").slice(0, 1000) });
    if (s.sharedList.length) fields.push({ name: "Top of the server list", value: s.sharedList.map(g => `**${g.title}** (${g.votes} votes)`).join("\n").slice(0, 1000) });
    fields.push({ name: "Sale alerts, last 30 days", value: String(s.alerts30d), inline: true });
    return { color: COLOR, title: "Server stats", description: "Members who opted in with `/alerts share`.", fields, footer: { text: "Counts only. Nobody is named for what they want." } };
}

/** The backlog card: how much sits unplayed and what to play next. */
export function backlogEmbed(view, next) {
    const t = view.totals, c = view.currency;
    const fields = [
        { name: "Not started", value: `**${t.backlogGames}** game${t.backlogGames === 1 ? "" : "s"}${t.backlogPaid > 0 ? `\n${money(t.backlogPaid, c)} spent` : ""}`, inline: true },
        { name: "Playing", value: String(t.playing), inline: true },
        { name: "Finished", value: String(t.finished), inline: true }
    ];
    if (next) {
        fields.push({ name: "🎯 Play next", value: `**${next.pick.title}**\n${next.why}`.slice(0, 1000) });
        if (next.others.length) fields.push({ name: "Also in the running", value: next.others.map(o => o.title).join("\n").slice(0, 500) });
    }
    return { color: COLOR, title: "Your backlog", description: "Mark games with `/library status`. Games are in your backlog until you change them.", fields, footer: { text: "Prices by IsThereAnyDeal" } };
}

/** Several members of a server are watching the same game and it just hit their alert. */
export function groupEmbed(title, count, now) {
    const c = now.currency ?? "USD";
    const off = now.discount > 0 ? ` (-${Math.round(now.discount * 100)}%)` : "";
    return {
        color: GREEN,
        title: `${count} members are watching ${title}`,
        url: safeUrl(now.url),
        description: `It just dropped to **${money(now.price, c)}**${off}${now.shop ? ` at ${now.shop}` : ""}.`,
        footer: { text: "Only members who opted in are counted  •  /alerts share to join or leave" }
    };
}

/** One game's price and lows, for /wishlist check. */
export function checkEmbed(title, now, verdict, advice = null) {
    const c = now.currency ?? "USD";
    const fields = [
        { name: "Price now", value: money(now.price, c), inline: true },
        { name: "Regular", value: money(now.regular, c), inline: true },
        { name: "Store", value: now.shop ?? "-", inline: true },
        { name: "3-month low", value: money(now.low3m, c), inline: true },
        { name: "1-year low", value: money(now.low1y, c), inline: true },
        { name: "All-time low", value: money(now.atl, c), inline: true }
    ];
    if (advice) fields.push({ name: `${{ buy: "🟢", lean_buy: "🟢", lean_wait: "🟡", wait: "🟠" }[advice.verdict]} Buy now or wait? ${advice.label}`, value: advice.reasons.join(" ") });
    return {
        color: verdict && verdict.level === "great" ? GREEN : COLOR,
        title, url: safeUrl(now.url), fields,
        description: verdict ? `**${verdict.text}**` : undefined,
        footer: { text: "Prices by IsThereAnyDeal" }
    };
}

/** The server's shared list with votes and prices. */
export function serverListEmbed(rows, currency, limit = 15) {
    if (!rows.length) return { color: COLOR, title: "Server wishlist", description: "Nothing here yet. Add a game with `/serverlist add`." };
    const lines = rows.slice(0, limit).map(r => {
        const price = r.best ? `${money(r.best.price, currency)}${r.discount > 0 ? ` (-${Math.round(r.discount * 100)}%)` : ""}` : "no price";
        return `**${r.votes}** ${r.votes === 1 ? "vote" : "votes"}  •  **${r.title}**: ${price}${r.verdict && r.verdict.level === "great" ? " (all-time low)" : ""}`;
    });
    if (rows.length > limit) lines.push(`…and ${rows.length - limit} more.`);
    return { color: COLOR, title: "Server wishlist", description: lines.join("\n").slice(0, 4000), footer: { text: "Vote with /serverlist vote  •  Prices by IsThereAnyDeal" } };
}

/** Opt-in leaderboard. Members are mentioned, which shows their name without pinging anyone. */
export function leaderboardEmbed(entries) {
    if (!entries.length) {
        return { color: COLOR, title: "Savings leaderboard", description: "Nobody has joined yet. Members can opt in with `/alerts share`, then add games with prices using `/library`." };
    }
    const medal = ["1.", "2.", "3."];
    const lines = entries.map((e, i) => `${medal[i] ?? `${i + 1}.`} <@${e.discord_id}>: **${e.savedPct.toFixed(0)}%** saved across ${e.games} games`);
    return { color: COLOR, title: "Savings leaderboard", description: lines.join("\n"), footer: { text: "Only members who opted in. Ranked by percent saved vs MSRP." } };
}

export function leagueEmbed(entries) {
    if (!entries.length) return { color: COLOR, title: "Backlog league", description: "Nobody has finished a game this month yet. Members opt in with `/alerts share`, then mark games finished with `/library`." };
    const lines = entries.map((e, i) => `${i + 1}. <@${e.discord_id}>: **${e.done}** finished`);
    return { color: COLOR, title: "Backlog league: finished this month", description: lines.join("\n"), footer: { text: "Only members who opted in. Resets on the 1st (UTC)." } };
}

export function bundlesEmbed(v) {
    if (!v.bundles.length) return { color: COLOR, title: "Your bundles", description: "No bundles yet. Add one with `/library bundle` (name, what you paid and the games)." };
    const lines = v.bundles.slice(0, 10).map(b => `**#${b.id} ${b.name}**: paid ${money(b.paid, v.currency)} for ${b.games} games worth ${money(b.msrp, v.currency)} (${money(b.perGame, v.currency)} each). ${b.verdict ? b.verdict.text + "." : ""} Played ${b.played} of ${b.games}, ${b.hours} hours.`);
    return { color: COLOR, title: "Your bundles", description: lines.join("\n"), footer: { text: `Total paid ${money(v.totals.paid, v.currency)} for games worth ${money(v.totals.msrp, v.currency)} at full price.` } };
}

export function boardEmbed(title, entries, footer) {
    if (!entries.length) return { color: COLOR, title, description: "Nobody has joined yet. Members can opt in with `/alerts share`.", footer: { text: footer } };
    return { color: COLOR, title, description: entries.map((e, i) => `${i + 1}. <@${e.discord_id}>: **${e.label}**`).join("\n"), footer: { text: footer } };
}

export function badgesEmbed(tc) {
    const lines = tc.badges.map(b => `${b.icon} **${b.name}** ${b.tier ? `· ${b.tier}` : "· not yet"} (${b.value} ${b.unit}${b.next ? `, next at ${b.next}` : ""})`);
    return { color: COLOR, title: `Trophy case: ${tc.earned} of ${tc.total}`, description: lines.join("\n"), footer: { text: "Worked out from your library and monthly challenge." } };
}

/** The member's recent alerts. */
export function alertHistoryEmbed(entries) {
    if (!entries.length) return { color: COLOR, title: "Recent alerts", description: "No alerts yet." };
    const label = { sale: "sale", bundle: "bundle", giveaway: "free", digest: "digest", group: "group", release: "release", friend: "friend" };
    const lines = entries.slice(0, 15).map(e => {
        const when = `<t:${Math.floor(e.at / 1000)}:d>`;
        const price = Number.isFinite(e.price) ? ` at ${e.price.toFixed(2)}` : "";
        return `${when}  ${label[e.kind] ?? e.kind}  **${e.title}**${price}${e.shop ? ` (${e.shop})` : ""}`;
    });
    return { color: COLOR, title: "Recent alerts", description: lines.join("\n").slice(0, 4000) };
}

export const FREE_CLAIM_ALL_ID = "free_claim_all";
const MAX_FREE_PER_MESSAGE = 10;

/**
 * Free games on one platform, as one message. Each game has a link embed. One game gets a "Claim game" link button;
 * several get "Claim all" (which replies with every link) plus link buttons for the first few.
 */
/** Art for a free game: Steam's header when the link is a Steam store page, otherwise IsThereAnyDeal's banner. */
export function freeArt(g) {
    const app = /store\.steampowered\.com\/app\/(\d+)/i.exec(g?.url ?? "");
    if (app) return steamArt(app[1]);
    return g?.gameIds?.[0] ? itadArt(g.gameIds[0]) : undefined;
}

const SHOP_ICON = { steam: "🎮", epic: "🛒", gog: "🟣", itch: "🎲", humble: "💚", ubisoft: "🔷", amazon: "📦", prime: "📦" };
export const shopIcon = shop => SHOP_ICON[Object.keys(SHOP_ICON).find(k => String(shop).toLowerCase().includes(k))] ?? "🎁";

/** The same cards as a free-game alert, headed as a reminder that the offer is about to end. */
export function lastChancePayload(shop, games) {
    const p = freeGamesPayload(shop, games);
    if (!p) return null;
    p.content = `⏰ Last chance: ${games.length === 1 ? "a free game" : `${games.length} free games`} on ${shop} ending soon`;
    return p;
}

export function freeGamesPayload(shop, games) {
    const list = games.filter(g => safeUrl(g.url)).slice(0, MAX_FREE_PER_MESSAGE);
    if (!list.length) return null;
    const big = list.length <= 3; // full-width pictures for a few games, small ones when there are many
    const embeds = list.map((g, n) => {
        const art = freeArt(g);
        return {
            color: GREEN, title: `🎁 ${g.title}`.slice(0, 256), url: safeUrl(g.url),
            description: `## FREE  •  ${shopIcon(shop)} ${shop}\n${g.expiry ? `Claim it ${stamp(g.expiry)} or it's gone.` : "Free to keep while the offer lasts."}`,
            fields: [
                { name: "Store", value: `${shopIcon(shop)} ${shop}`, inline: true },
                { name: g.expiry ? "Ends" : "Status", value: g.expiry ? `${stamp(g.expiry)}\n<t:${Math.floor(g.expiry / 1000)}:f>` : "Limited time", inline: true },
                { name: "Price", value: "~~Paid~~ **$0.00**", inline: true }
            ],
            image: big && art ? { url: art } : undefined,
            thumbnail: !big && art ? { url: art } : undefined,
            footer: n === list.length - 1 ? { text: "Claiming needs you to be signed in to the store  •  Data by IsThereAnyDeal" } : undefined
        };
    });
    const link = (label, url) => ({ type: 2, style: 5, label: label.slice(0, 80), url: safeUrl(url) });
    const row = list.length === 1
        ? [link("Claim game", list[0].url)]
        : [{ type: 2, style: 1, label: `Claim all (${list.length})`, custom_id: FREE_CLAIM_ALL_ID }, ...list.slice(0, 4).map(g => link(`Claim ${g.title}`, g.url))];
    return {
        content: list.length === 1 ? `Free game on ${shop}` : `${list.length} free games on ${shop}`,
        embeds, components: [{ type: 1, components: row }]
    };
}

/** Link buttons under bundle and giveaway alerts, one per card. */
export function extrasButtons(hits) {
    return hits.map(h => {
        const url = safeUrl((h.bundle ?? h.giveaway)?.url);
        if (!url) return null;
        const label = h.kind === "bundle" ? "View bundle" : "Claim it";
        return { type: 1, components: [linkButton(hits.length > 1 ? `${label}: ${short(h.item.title, 28)}` : label, url)] };
    }).filter(Boolean);
}

const num = n => (n === null || n === undefined ? "-" : Number(n).toLocaleString("en-US"));

/** The /about card: creator credit with logo, live numbers, banner and link buttons. */
export function aboutPayload(info, { about, fanaticalUrl = null } = {}) {
    const c = info.creator;
    const stat = (icon, name, value) => ({ name: `${icon} ${name}`, value: `**${value}**`, inline: true });
    const fields = [
        stat("🟢", "Uptime", info.uptime),
        stat("🌐", "Servers", num(info.servers)),
        stat("👥", "Members reached", num(info.members)),
        stat("📡", "Latency", info.pingMs === null ? "-" : `${info.pingMs} ms`),
        stat("🎮", "Games watched", num(info.gamesWatched)),
        stat("🔔", "Alerts, last 24h", num(info.alerts24h)),
        stat("🎁", "Giveaways run", num(info.giveaways)),
        stat("✅", "Keys redeemed", num(info.redeemed)),
        stat("⚙️", "Version", `v${info.version}`)
    ];
    const embed = {
        color: 0xff9800,
        author: { name: `Created by ${c.name}`, url: safeUrl(c.url), icon_url: safeUrl(c.logo) },
        title: "Steam Value Checker",
        description: `${about ?? ""}\n\nOnline since ${stamp(info.startedAt)}`.trim().slice(0, 2000),
        thumbnail: safeUrl(info.logo) ? { url: info.logo } : undefined,
        fields,
        image: safeUrl(info.banner) ? { url: info.banner } : undefined,
        footer: { text: `Prices by IsThereAnyDeal  •  Node ${info.node}`, icon_url: safeUrl(c.logo) }
    };
    const row = [];
    if (safeUrl(c.url)) row.push(linkButton(`Created by ${c.name}`, c.url));
    if (safeUrl(info.dashboardUrl)) row.push(linkButton("Dashboard", info.dashboardUrl));
    if (safeUrl(info.userInstallUrl)) row.push(linkButton("Add to your account", info.userInstallUrl));
    if (safeUrl(fanaticalUrl)) row.push(linkButton("FanaticalGrabber", fanaticalUrl));
    return { embeds: [embed], components: row.length ? [{ type: 1, components: row }] : [] };
}


/** "Now out" card for a wishlisted game that has just launched. */
export function releaseEmbed({ title, releaseAt, best, currency, url }) {
    const lines = [`Released <t:${Math.floor(releaseAt / 1000)}:D>.`];
    lines.push(best ? `Cheapest right now: **${money(best.price, currency)}** at ${best.shop}.` : "No prices are listed yet. Your sale alerts will tell you when one appears.");
    return { color: COLOR, title: `🎉 Now out: ${title}`, description: lines.join("\n"), url: url || undefined };
}


const sign = (n, f) => (n === null || n === undefined ? null : `${n > 0 ? "+" : n < 0 ? "-" : ""}${f(Math.abs(n))}`);
/** "Library trend" card from trendSummary(). */
export function trendEmbed(tr, currency, backlogNow) {
    const part = d => [
        sign(d.cheapest, v => money(v, currency)) && `Cheapest-price value **${sign(d.cheapest, v => money(v, currency))}**`,
        sign(d.msrp, v => money(v, currency)) && `Full-price value **${sign(d.msrp, v => money(v, currency))}**`,
        sign(d.games, v => String(v)) && `Games **${sign(d.games, v => String(v))}**`,
        sign(d.backlog, v => String(v)) && `Backlog **${sign(d.backlog, v => String(v))}**`,
        sign(d.finished, v => String(v)) && `Finished **${sign(d.finished, v => String(v))}**`
    ].filter(Boolean).join("\n") || "Nothing changed.";
    const fields = [];
    if (tr.month) fields.push({ name: `Last ${tr.month.days} days`, value: part(tr.month), inline: true });
    fields.push({ name: `Since ${tr.first.days} days ago`, value: part(tr.first), inline: true });
    return { color: COLOR, title: "Your library trend", description: `Now: **${money(tr.last.cheapest, currency)}** at cheapest prices, **${money(tr.last.msrp, currency)}** at full price, **${tr.last.games}** games${backlogNow !== undefined ? `, **${backlogNow}** in the backlog` : ""}.`, fields, footer: { text: "From daily snapshots. The dashboard's Library page shows the charts." } };
}


const hrs = m => (m >= 60 ? `${Math.round(m / 60).toLocaleString("en-US")}h` : "0h");
const top = (list, n, f) => (list.length ? list.slice(0, n).map(f).join("\n") + (list.length > n ? `\n…and ${list.length - n} more` : "") : "Nothing.");
/** "You vs a friend" card from compareLibraries(). */
export function compareEmbed(r, meName, themName) {
    return {
        color: COLOR, title: `${meName} vs ${themName}`,
        description: `**${r.shared.length}** games in common (${r.overlapPct}% overlap). ${meName} owns **${r.a.games}**, ${themName} owns **${r.b.games}**.${r.a.minutes || r.b.minutes ? ` Hours on record: **${hrs(r.a.minutes)}** vs **${hrs(r.b.minutes)}**.` : ""}`,
        fields: [
            { name: "You both own", value: top(r.shared, 10, x => `• ${x.title}${x.aMinutes || x.bMinutes ? ` (${hrs(x.aMinutes)} / ${hrs(x.bMinutes)})` : ""}`).slice(0, 1020) },
            { name: `Only ${meName}`, value: top(r.onlyA, 8, x => `• ${x.title}`).slice(0, 1020), inline: true },
            { name: `Only ${themName}`, value: top(r.onlyB, 8, x => `• ${x.title}`).slice(0, 1020), inline: true }
        ],
        footer: { text: "Only members who opted in with /alerts share can be compared." }
    };
}


/** Region price ranking from regionPrices(). */
export function regionsEmbed(game, rows) {
    const ranked = rows.some(r => r.usd !== null);
    const lines = rows.map((r, i) => `${ranked ? `${i + 1}. ` : "• "}**${r.name}** ${money(r.price, r.currency)}${r.usd !== null && r.currency !== "USD" ? ` (about ${money(r.usd, "USD")})` : ""} at ${r.shop}${r.home ? " ← your region" : ""}`);
    return {
        color: COLOR, title: `${game}: price by region`,
        description: (lines.join("\n") || "No prices found.").slice(0, 3900),
        footer: { text: ranked ? "Converted at recent exchange rates. Keys and accounts are usually locked to the region they were sold in, so use this for information." : "Shown in each region's own currency. Keys and accounts are usually region-locked." }
    };
}

export function challengeEmbed(c) {
    const bar = (done, goal) => { const n = Math.min(10, Math.round(done / goal * 10)); return "▰".repeat(n) + "▱".repeat(10 - n); };
    if (!c.goal) {
        return { color: 0xa4d007, title: "Backlog challenge", description: `No goal for ${c.month} yet. Set one with \`/library challenge goal:3\` and finish that many games this month.` +
            (c.streak ? `\n🔥 Streak: **${c.streak}** month${c.streak === 1 ? "" : "s"}` : "") };
    }
    const met = c.done >= c.goal;
    const hist = c.history.filter(h => h.month !== c.month).map(h => `${h.done >= h.goal ? "✅" : "▫️"} ${h.month}: ${h.done}/${h.goal}`);
    return {
        color: 0xa4d007, title: `Backlog challenge, ${c.month}`,
        description: `${bar(c.done, c.goal)} **${c.done}** of **${c.goal}** finished` + (met ? " 🎉 Goal met!" : ` · ${c.daysLeft} day${c.daysLeft === 1 ? "" : "s"} left`),
        fields: [
            { name: "Streak", value: `🔥 **${c.streak}** month${c.streak === 1 ? "" : "s"} (best ${c.best})`, inline: true },
            ...(c.titles.length ? [{ name: "Finished this month", value: c.titles.map(t => `• ${t}`).join("\n").slice(0, 1000) }] : []),
            ...(hist.length ? [{ name: "Earlier months", value: hist.join("\n") }] : [])
        ],
        footer: { text: "A game counts when you mark it finished (or reach 100% achievements). Months are counted in UTC." }
    };
}

export function spendEmbed(sp) {
    if (!sp.games) return { color: 0xf0883e, title: "What you have spent", description: "No amounts recorded yet. Add what you paid with `/library add`, import a FanaticalGrabber export that has prices, or press **Send what I paid** on your Steam purchase history with the extension, and I will add it up." };
    const c = sp.currency, peak = Math.max(...sp.months.map(m => m.total), 1), bars = " ▁▂▃▄▅▆▇█";
    const spark = sp.months.map(m => bars[Math.round(m.total / peak * 8)]).join("");
    const line = g => `• **${g.title}** ${money(g.paid, c)} for ${g.hours} h (${money(g.perHour, c)}/h)`;
    return {
        color: 0xf0883e, title: "What you have spent",
        description: `**${money(sp.total, c)}** on **${sp.games}** game${sp.games === 1 ? "" : "s"} (about ${money(sp.avg, c)} each). **${money(sp.year.total, c)}** in ${sp.year.year}.\n\`${spark}\` last 12 months`,
        fields: [
            ...(sp.bestValue.length ? [{ name: "Best value per hour", value: sp.bestValue.map(line).join("\n") }] : []),
            ...(sp.worstValue.length ? [{ name: "Most expensive per hour", value: sp.worstValue.map(line).join("\n") }] : []),
            ...(sp.unplayed.count ? [{ name: "Bought and not played", value: `**${sp.unplayed.count}** game${sp.unplayed.count === 1 ? "" : "s"}, **${money(sp.unplayed.total, c)}**` }] : [])
        ],
        footer: { text: "Months follow when a game was added to your library. Games without an amount are not counted." }
    };
}
