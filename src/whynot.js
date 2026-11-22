// "Why didn't I get an alert for this game?" Walks through the same checks the hourly alert run makes, in the same order, and says
// which one is stopping it (or that nothing is, and the next run will send it). Pure: it is handed the member, the wishlist entry
// and the game's current price, and returns plain sentences.
import { current, meetsTrigger, meaningfulDrop, describeTrigger } from "./alerts.js";
import { isQuiet } from "./timeutil.js";
import { hiddenFacts } from "./prefs.js";
import { reachNotice } from "./reach.js";

const pct = d => `${Math.round((d ?? 0) * 100)}%`;

/**
 * `summary` is the report.js summary of the game's prices (null when there are none). `store` is the game's Steam store facts, if known.
 * Returns { verdict: "would" | "blocked", headline, checks: [{ ok, text }] } (the first not-ok check is the reason).
 */
export function whyNoAlert({ user, item, summary, owned = false, guild = null, store = null, now = Date.now(), money = n => n.toFixed(2) }) {
    const checks = [], ok = text => checks.push({ ok: true, text }), no = text => checks.push({ ok: false, text });
    const px = current(summary);

    if (owned) no("You own it (it's in your library), so I never alert for it.");
    if (user.paused) no("Your alerts are paused. Nothing is sent until you resume them in `/alerts status`.");
    else ok("Your alerts are on.");
    if (item.snooze_until && item.snooze_until > now) no(`This game is snoozed until <t:${Math.floor(item.snooze_until / 1000)}:f>.`);

    if (px.price === null) {
        no(`I can't find a current price for it in your region (${user.region})${user.stores === "major" ? " at the major stores" : ""}, so there's nothing to compare.`);
    } else if (!(px.discount > 0.0001)) {
        no(`It isn't on sale right now: ${money(px.price)}, its regular price.`);
    } else {
        ok(`It's on sale: ${pct(px.discount)} off, ${money(px.price)}${px.shop ? ` at ${px.shop}` : ""}.`);
        const trig = { trigger_type: item.trigger_type, trigger_value: item.trigger_value };
        if (meetsTrigger(item, px)) ok(`That meets your trigger (${describeTrigger(trig)}).`);
        else if (item.trigger_type === "percent") no(`Your trigger for it is ${item.trigger_value}% off or more, and it's ${pct(px.discount)} off.`);
        else if (item.trigger_type === "price") no(`Your trigger for it is a price at or under ${money(item.trigger_value ?? 0)}, and it's ${money(px.price)}.`);
        else if (item.trigger_type === "atl") no(`Your trigger for it is the all-time low${px.atl !== null ? ` (${money(px.atl)})` : ""}, and it's ${money(px.price)}.`);
        else no("It doesn't meet your trigger for it.");

        if (!item.priority) {
            if (user.min_discount > 0 && px.discount * 100 < user.min_discount - 0.001) no(`You only want sales of at least ${user.min_discount}% off (in \`/alerts status\`), and this is ${pct(px.discount)}. Starring a game lets it through anyway.`);
            if (user.max_price > 0 && px.price > user.max_price + 0.005) no(`You set a price ceiling of ${money(user.max_price)}, and it costs ${money(px.price)}. Starring a game lets it through anyway.`);
            if (user.lows_only && !(px.atl !== null && px.price <= px.atl + 0.005)) no("You asked for record lows only, and this isn't the lowest price it has ever had. Starring a game lets it through anyway.");
        }
        if (item.last_alert_price != null && meetsTrigger(item, px) && !meaningfulDrop(item.last_alert_price, px.price)) {
            no(`I already told you about it at ${money(item.last_alert_price)}. I alert again if it drops at least 3% and 25 cents lower, or after the sale ends and comes back.`);
        }
    }

    if (!item.priority && isQuiet(user, now)) no("It's your quiet hours right now, so alerts are held and sent when they end. Starred games come through anyway.");
    const hide = hiddenFacts(user);
    if (hide.includes("alertvr") && store?.vr === "only") no("You turned off alerts for VR-only games, and this is one.");
    if (hide.includes("alertearly") && store?.earlyAccess) no("You turned off alerts for Early Access games, and this is one.");
    const reach = reachNotice(user, guild);
    if (reach) no(`${reach.what} ${reach.meanwhile}`);

    const first = checks.find(c => !c.ok);
    return first
        ? { verdict: "blocked", headline: first.text, checks }
        : { verdict: "would", headline: "Nothing is stopping it. If it's on sale at the next hourly check, you'll get the alert.", checks };
}

export function whyEmbed(title, res) {
    const lines = res.checks.map(c => `${c.ok ? "✅" : "❌"} ${c.text}`);
    return {
        color: res.verdict === "would" ? 0x57f287 : 0xfaa61a,
        title: `Why no alert for ${title}?`,
        description: [res.verdict === "would" ? `**${res.headline}**` : `**Not sent: ${res.headline}**`, "", ...lines].join("\n").slice(0, 3900),
        footer: { text: "Alerts are checked every hour with the same rules" }
    };
}
