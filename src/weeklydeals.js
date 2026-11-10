// The weekly roundup: the five best Steam sales of the week, posted once on Friday midday (Eastern) as an X post and, if a channel is set,
// as an embed in Discord. Both link to one page on the site, so the visits show up on the Link traffic page.
import { localParts } from "./timeutil.js";
import { UserError } from "./errors.js";
import { money, steamArt } from "./render.js";
import { dealUrl } from "./deallinks.js";
import { hashtagsFor, xLength } from "./xposter.js";

const HOUR = 12, FRIDAY = 5, MIN_CUT = 50, MIN_REGULAR = 10;

/** The deals worth a post: a real discount on a game that isn't cheap to begin with. Biggest saving in dollars first, one per game. */
export function pickDeals(pool, n = 5) {
    const seen = new Set();
    return [...(pool ?? [])]
        .filter(d => d && d.cut >= MIN_CUT && d.regular >= MIN_REGULAR && d.price >= 0 && d.title && /^https:\/\//.test(d.url ?? ""))
        .sort((a, b) => (b.regular - b.price) - (a.regular - a.price))
        .filter(d => { const k = d.title.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
        .slice(0, n);
}

const line = d => `${d.title}: -${Math.round(d.cut)}%, ${money(d.price, d.currency)}`;

/** The page every roundup link goes through: it lists the picks, shows the top one's picture and sends people on to the site's deals feed. */
export function roundupLink(picks, { base, now = Date.now() } = {}) {
    if (!picks.length || !base) return null;
    return dealUrl({ key: `weekly:${localParts(now).ymd}`, kind: "deal", title: "This week's best Steam deals", shop: "Steam", url: `${String(base).replace(/\/+$/, "")}/feed`,
        image: picks[0].appid ? steamArt(picks[0].appid) : null, price: `Up to ${Math.round(Math.max(...picks.map(p => p.cut)))}% off`, games: picks.map(line), blurb: "The five biggest Steam savings this week, picked by the bot." });
}

export function weeklyXText(picks, link, tags) {
    const shown = [...picks];
    const build = () => `🔥 This week's best Steam deals\n\n${shown.map(line).join("\n")}\n\n${link ?? "Link in bio."}\n\n${hashtagsFor("Steam", "", tags.filter(t => !/^#(free\w*|giveaway)$/i.test(t)))}`;
    let text = build();
    while (xLength(text) > 280 && shown.length > 1) { shown.pop(); text = build(); }
    return text;
}

/** The Discord post: fancy and clean, each game a line with its price, one button to the full list. */
export function weeklyEmbed(picks, { link, inviteUrl = null } = {}) {
    const [top, ...rest] = picks;
    const row = d => `**${d.title}**\n~~${money(d.regular, d.currency)}~~ **${money(d.price, d.currency)}**  ·  -${Math.round(d.cut)}%  ·  saves ${money(d.regular - d.price, d.currency)}`;
    const embed = {
        color: 0xff7a18, title: "🔥 This week's best Steam deals", url: link ?? undefined,
        description: `The biggest savings on Steam right now, picked by the bot.\n\n${[top, ...rest].map((d, i) => `${["🥇", "🥈", "🥉", "4️⃣", "5️⃣"][i] ?? "▫️"} ${row(d)}`).join("\n\n")}`,
        footer: { text: "Posted every Friday · Prices from IsThereAnyDeal" }
    };
    if (top.appid) embed.image = { url: steamArt(top.appid) };
    const row2 = [];
    if (link) row2.push({ type: 2, style: 5, label: "See all the deals", url: link });
    if (inviteUrl) row2.push({ type: 2, style: 5, label: "Add the bot to your server", url: inviteUrl });
    return { embeds: [embed], components: row2.length ? [{ type: 1, components: row2 }] : [] };
}

/** `tick()` is called every few minutes and does something at most once a week. `postDiscord(channelId, payload)` may be left out. */
export function createWeekly({ db, itad, xposter = null, postDiscord = null, inviteUrl = () => null, base = null, now = () => Date.now(), log = () => {} }) {
    const weekKey = ms => { const p = localParts(ms); const d = new Date(`${p.ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7)); const y = d.getUTCFullYear(); return `${y}-W${Math.ceil(((d - new Date(Date.UTC(y, 0, 1))) / 86400000 + 1) / 7)}`; };
    const on = () => db.getMeta("weekly:on") !== "0";
    const channel = () => db.getMeta("weekly:channel") || "";
    const due = ms => on() && localParts(ms).weekday === FRIDAY && localParts(ms).minutes >= HOUR * 60 && db.getMeta("weekly:week") !== weekKey(ms);

    async function picks() { return pickDeals(await itad.getDealsPool({ country: "US", pages: 3 })); }

    /** Posts the roundup. `force` skips the day and the once-a-week check, for the admin's Post now button. */
    async function run({ force = false } = {}) {
        const ms = now();
        if (!force && !due(ms)) return { skipped: "not due" };
        const list = await picks();
        if (list.length < 3) return { skipped: "not enough good deals" };
        if (!force) db.setMeta("weekly:week", weekKey(ms)); // marked first, so a failure can never make it post twice
        const link = roundupLink(list, { base, now: ms });
        const out = { picks: list.length, x: null, discord: null };
        if (xposter?.configured?.() && (force || xposter.status().enabled)) {
            try { out.x = (await xposter.manual({ text: weeklyXText(list, link, xposter.tags()), kind: "auto" })).id ?? true; } catch (e) { out.x = `failed: ${e.message}`; log(`weekly deals on X: ${e.message}`); }
        }
        if (postDiscord && channel()) {
            try { await postDiscord(channel(), weeklyEmbed(list, { link, inviteUrl: inviteUrl() })); out.discord = true; } catch (e) { out.discord = `failed: ${e.message}`; log(`weekly deals in Discord: ${e.message}`); }
        }
        db.setMeta("weekly:last", JSON.stringify({ at: ms, ...out }));
        return out;
    }

    async function status() {
        let list = []; try { list = await picks(); } catch { /* shown as empty */ }
        let last = null; try { last = JSON.parse(db.getMeta("weekly:last") || "null"); } catch { /* none yet */ }
        const link = roundupLink(list, { base, now: now() });
        return { on: on(), channel: channel(), last, picks: list.map(d => ({ title: d.title, cut: Math.round(d.cut), price: money(d.price, d.currency), regular: money(d.regular, d.currency) })),
            xText: list.length ? weeklyXText(list, link, xposter?.tags?.() ?? []) : "", nextDue: due(now()) };
    }
    function set({ on: o, channel: c }) {
        if (o !== undefined) db.setMeta("weekly:on", o ? "1" : "0");
        if (c !== undefined) { const v = String(c).trim(); if (v && !/^\d{15,22}$/.test(v)) throw new UserError("That doesn't look like a channel ID. In Discord, right-click the channel and choose Copy Channel ID."); db.setMeta("weekly:channel", v); }
    }
    return { tick: () => run().catch(e => { log(`weekly deals: ${e.message}`); return { error: e.message }; }), run, status, set, due };
}
