// "Why didn't I get an alert for this game?" Walks through the same checks the hourly alert run makes, in the same order, and says
// which one is stopping it (or that nothing is, and the next run will send it). Pure: it is handed the member, the wishlist entry
// and the game's current price, and returns plain sentences.
import { current, meetsTrigger, meaningfulDrop, describeTrigger } from "./alerts.js";
import { isQuiet } from "./timeutil.js";
import { hiddenFacts } from "./prefs.js";
import { reachNotice } from "./reach.js";
import { summarize } from "./report.js";

const pct = d => `${Math.round((d ?? 0) * 100)}%`;

/**
 * `summary` is the report.js summary of the game's prices (null when there are none). `store` is the game's Steam store facts, if known.
 * Returns { verdict: "would" | "blocked", headline, checks: [{ ok, text }] } (the first not-ok check is the reason).
 */
export function whyNoAlert({ user, item, summary, owned = false, guild = null, store = null, now = Date.now(), money = n => n.toFixed(2) }) {
    const checks = [], ok = text => checks.push({ ok: true, text }), no = (code, text) => checks.push({ ok: false, code, text });
    const px = current(summary);

    if (owned) no("owned", "You own it (it's in your library), so I never alert for it.");
    if (user.paused) no("paused", "Your alerts are paused. Nothing is sent until you resume them in `/alerts status`.");
    else ok("Your alerts are on.");
    if (item.snooze_until && item.snooze_until > now) no("snoozed", `This game is snoozed until <t:${Math.floor(item.snooze_until / 1000)}:f>.`);

    if (px.price === null) {
        no("noprice", `I can't find a current price for it in your region (${user.region})${user.stores === "major" ? " at the major stores" : ""}, so there's nothing to compare.`);
    } else if (!(px.discount > 0.0001)) {
        no("nosale", `It isn't on sale right now: ${money(px.price)}, its regular price.`);
    } else {
        ok(`It's on sale: ${pct(px.discount)} off, ${money(px.price)}${px.shop ? ` at ${px.shop}` : ""}.`);
        const trig = { trigger_type: item.trigger_type, trigger_value: item.trigger_value };
        if (meetsTrigger(item, px)) ok(`That meets your trigger (${describeTrigger(trig)}).`);
        else if (item.trigger_type === "percent") no("trigger", `Your trigger for it is ${item.trigger_value}% off or more, and it's ${pct(px.discount)} off.`);
        else if (item.trigger_type === "price") no("trigger", `Your trigger for it is a price at or under ${money(item.trigger_value ?? 0)}, and it's ${money(px.price)}.`);
        else if (item.trigger_type === "atl") no("trigger", `Your trigger for it is the all-time low${px.atl !== null ? ` (${money(px.atl)})` : ""}, and it's ${money(px.price)}.`);
        else no("trigger", "It doesn't meet your trigger for it.");

        if (!item.priority) {
            if (user.min_discount > 0 && px.discount * 100 < user.min_discount - 0.001) no("mindiscount", `You only want sales of at least ${user.min_discount}% off (in \`/alerts status\`), and this is ${pct(px.discount)}. Starring a game lets it through anyway.`);
            if (user.max_price > 0 && px.price > user.max_price + 0.005) no("maxprice", `You set a price ceiling of ${money(user.max_price)}, and it costs ${money(px.price)}. Starring a game lets it through anyway.`);
            if (user.lows_only && !(px.atl !== null && px.price <= px.atl + 0.005)) no("lowsonly", "You asked for record lows only, and this isn't the lowest price it has ever had. Starring a game lets it through anyway.");
        }
        if (item.last_alert_price != null && meetsTrigger(item, px) && !meaningfulDrop(item.last_alert_price, px.price)) {
            no("already", `I already told you about it at ${money(item.last_alert_price)}. I alert again if it drops at least 3% and 25 cents lower, or after the sale ends and comes back.`);
        }
    }

    if (!item.priority && isQuiet(user, now)) no("quiet", "It's your quiet hours right now, so alerts are held and sent when they end. Starred games come through anyway.");
    const hide = hiddenFacts(user);
    if (hide.includes("alertvr") && store?.vr === "only") no("vr", "You turned off alerts for VR-only games, and this is one.");
    if (hide.includes("alertearly") && store?.earlyAccess) no("early", "You turned off alerts for Early Access games, and this is one.");
    const reach = reachNotice(user, guild);
    if (reach) no("dm", `${reach.what} ${reach.meanwhile}`);

    const first = checks.find(c => !c.ok);
    return first
        ? { verdict: "blocked", code: first.code, headline: first.text, checks }
        : { verdict: "would", headline: "Nothing is stopping it. If it's on sale at the next hourly check, you'll get the alert.", checks };
}

export function whyEmbed(title, res, target = null) {
    const lines = res.checks.map(c => `${c.ok ? "✅" : "❌"} ${c.text}`);
    return {
        fields: target ? [{ name: "💡 A price worth waiting for", value: `${target.text}\nSet it with \`/games wishlist alert\`, or tap *Alert me at* in Price history on the Wishlist page.`.slice(0, 1000) }] : undefined,
        color: res.verdict === "would" ? 0x57f287 : 0xfaa61a,
        title: `Why no alert for ${title}?`,
        description: [res.verdict === "would" ? `**${res.headline}**` : `**Not sent: ${res.headline}**`, "", ...lines].join("\n").slice(0, 3900),
        footer: { text: "Alerts are checked every hour with the same rules" }
    };
}

const GROUPS = {
    nosale: "not on sale right now", trigger: "on sale, but short of your trigger", mindiscount: "under your minimum discount", maxprice: "over your price ceiling",
    lowsonly: "not at a record low (you asked for record lows only)", already: "already alerted at this price", quiet: "held for your quiet hours", snoozed: "snoozed",
    owned: "already in your library", noprice: "no price found in your region", vr: "VR games you skip", early: "Early Access games you skip", paused: "alerts paused", dm: "DMs closed"
};

/** The whole wishlist at once: which games would alert on the next run, and how many are held back by each rule. `results` is [{ title, res }]. */
export function overview(results) {
    const game = r => ({ id: r.id ?? null, title: r.title });
    const would = results.filter(r => r.res.verdict === "would").map(r => r.title);
    const groups = new Map();
    for (const r of results) if (r.res.verdict === "blocked") (groups.get(r.res.code) ?? groups.set(r.res.code, []).get(r.res.code)).push(r);
    const blocked = [...groups].map(([code, rs]) => ({ code, label: GROUPS[code] ?? code, titles: rs.map(r => r.title), games: rs.map(game) })).sort((a, b) => b.titles.length - a.titles.length);
    return { total: results.length, would, wouldGames: results.filter(r => r.res.verdict === "would").map(game), blocked };
}

export function overviewEmbed(o) {
    const list = (t, n = 6) => t.slice(0, n).join(", ") + (t.length > n ? `, +${t.length - n} more` : "");
    const fields = [
        { name: o.would.length ? `✅ Would alert on the next run (${o.would.length})` : "✅ Would alert on the next run", value: o.would.length ? list(o.would, 10).slice(0, 1000) : "Nothing right now." },
        ...o.blocked.slice(0, 8).map(g => ({ name: `❌ ${g.titles.length} ${g.label}`, value: list(g.titles).slice(0, 1000) }))
    ];
    return {
        color: o.would.length ? 0x57f287 : 0x5865f2, title: "Your alerts, right now",
        description: o.total ? `I checked all ${o.total} game${o.total === 1 ? "" : "s"} on your list against your alert rules.` : "Your list is empty, so there is nothing to alert on.",
        fields, footer: { text: "Pick a game with /alerts why to see exactly what's in its way" }
    };
}

/** Runs every wishlist game of one member through the rules with a single price lookup. VR/Early Access skips need a store lookup per game, so they are left to the one-game check. */
export async function whyEverything({ db, itad, user, now = Date.now(), money, prices = null }) {
    const items = db.listItems(user.discord_id).slice(0, 300);
    if (!items.length) return overview([]);
    prices ??= await itad.getPrices(items.map(i => i.itad_id), user.region);
    const owned = new Set(db.listLibrary(user.discord_id).map(g => g.itad_id)), guild = db.getGuild(user.guild_id);
    return overview(items.map(item => {
        const summary = summarize(prices.get(item.itad_id), { majorOnly: user.stores === "major" });
        return { id: item.itad_id, title: item.title, res: whyNoAlert({ user, item, summary, owned: owned.has(item.itad_id), guild, now, money: money ?? (n => n.toFixed(2)) }) };
    }));
}

const num = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));

/**
 * What changing the alert filters would do, before saving them: how many games would alert now with the saved settings and with the
 * new ones, and which games the change lets through or holds back. `change` may hold min_discount, max_price and lows_only.
 */
export async function previewFilters({ db, itad, user, change, now = Date.now() }) {
    const items = db.listItems(user.discord_id).slice(0, 300);
    if (!items.length) return { total: 0, now: 0, preview: 0, lets: [], holds: [] };
    const prices = await itad.getPrices(items.map(i => i.itad_id), user.region);
    const next = { ...user, min_discount: num(change.min_discount ?? user.min_discount, 0, 90), max_price: num(change.max_price ?? user.max_price, 0, 1000), lows_only: change.lows_only ?? user.lows_only ? 1 : 0 };
    const [a, b] = await Promise.all([whyEverything({ db, itad, user, now, prices }), whyEverything({ db, itad, user: next, now, prices })]);
    const was = new Set(a.would), will = new Set(b.would);
    return { total: b.total, now: a.would.length, preview: b.would.length, lets: b.would.filter(t => !was.has(t)), holds: a.would.filter(t => !will.has(t)) };
}
