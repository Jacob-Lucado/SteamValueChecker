// The weekly indie spotlight: every Wednesday at noon Eastern one approved game goes out on the project's X account and, if a channel is
// set, in Discord. It picks whoever was spotlighted longest ago, so every game gets a turn. The game also gets the "Featured" mark for the week.
import { localParts } from "./timeutil.js";
import { UserError } from "./errors.js";
import { indieSpotlightText } from "./indiemeta.js";

const WEDNESDAY = 3, HOUR = 12;

export function spotlightEmbed(game, url, { inviteUrl = null } = {}) {
    const embed = {
        color: 0xff8a4c, title: `⭐ Indie spotlight: ${game.title}`, url,
        description: [game.studio ? `**${game.studio}**${game.verified ? " ✓" : ""}` : null, game.pitch || game.blurb, game.genres?.length ? `*${game.genres.slice(0, 3).join(" · ")}*` : null, game.price ? `**${game.price}**` : null].filter(Boolean).join("\n\n").slice(0, 1800),
        footer: { text: "Indie showcase · a new game every Wednesday" }
    };
    if (/^https:\/\//.test(game.image ?? "")) embed.image = { url: game.image };
    const row = [{ type: 2, style: 5, label: "See the game", url }, { type: 2, style: 5, label: "More indie games", url: url.replace(/\/game\/\d+$/, "") }];
    if (inviteUrl) row.push({ type: 2, style: 5, label: "Add the bot to your server", url: inviteUrl });
    return { embeds: [embed], components: [{ type: 1, components: row }] };
}

export function createSpotlight({ db, xposter = null, postDiscord = null, inviteUrl = () => null, base = null, now = () => Date.now(), log = () => {} }) {
    const on = () => db.getMeta("indiespot:on") !== "0";
    const channel = () => db.getMeta("indiespot:channel") || "";
    const dayKey = ms => localParts(ms).ymd;
    const due = ms => on() && localParts(ms).weekday === WEDNESDAY && localParts(ms).minutes >= HOUR * 60 && db.getMeta("indiespot:day") !== dayKey(ms);

    async function run({ force = false, gameId = null } = {}) {
        const ms = now();
        if (!force && !due(ms)) return { skipped: "not due" };
        const game = gameId ? db.indieGet(gameId) : db.indieSpotlightPick();
        if (!game || game.status !== "approved") return { skipped: "no game to spotlight" };
        if (!force) db.setMeta("indiespot:day", dayKey(ms)); // marked first, so a failure can never post it twice
        const url = `${base ?? ""}/indie/game/${game.id}`, out = { game: game.title, x: null, discord: null };
        const shaped = db.indieGet(game.id);
        if (xposter?.configured?.() && (force || xposter.status().enabled)) {
            try { out.x = (await xposter.manual({ text: indieSpotlightText(shaped, url, { wednesday: true }), kind: "auto" })).id ?? true; } catch (e) { out.x = `failed: ${e.message}`; log(`indie spotlight on X: ${e.message}`); }
        }
        if (postDiscord && channel()) {
            try { await postDiscord(channel(), spotlightEmbed(shaped, url, { inviteUrl: inviteUrl() })); out.discord = true; } catch (e) { out.discord = `failed: ${e.message}`; log(`indie spotlight in Discord: ${e.message}`); }
        }
        // this week's pick wears the Featured mark; last week's loses it (only if the spotlight gave it, never one the owner featured by hand)
        const prev = Number(db.getMeta("indiespot:featured")) || 0;
        if (prev && prev !== game.id && db.getMeta("indiespot:auto") === "1") db.indieFeature(prev, false);
        const had = shaped.featured;
        db.indieFeature(game.id, true); db.setMeta("indiespot:featured", String(game.id)); db.setMeta("indiespot:auto", had ? "0" : "1");
        db.indieMarkSpotlit(game.id);
        db.setMeta("indiespot:last", JSON.stringify({ at: ms, ...out }));
        return out;
    }
    function status() {
        let last = null; try { last = JSON.parse(db.getMeta("indiespot:last") || "null"); } catch { /* none yet */ }
        const next = db.indieSpotlightPick();
        return { on: on(), channel: channel(), last, next: next ? { id: next.id, title: next.title, studio: next.studio } : null, due: due(now()) };
    }
    function set({ on: o, channel: c }) {
        if (o !== undefined) db.setMeta("indiespot:on", o ? "1" : "0");
        if (c !== undefined) { const v = String(c).trim(); if (v && !/^\d{15,22}$/.test(v)) throw new UserError("That doesn't look like a channel ID. In Discord, right-click the channel and choose Copy Channel ID."); db.setMeta("indiespot:channel", v); }
        return status();
    }
    return { tick: () => run().catch(e => { log(`indie spotlight: ${e.message}`); return { error: e.message }; }), run, status, set, due };
}
