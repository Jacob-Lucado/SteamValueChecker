// A giveaway tied to a stream: the streamer hands over one key while live, the giveaway runs in the live channel, and it draws by itself
// when the stream ends (or when the time runs out, whichever comes first). It is the normal giveaway system underneath.
import { UserError } from "./errors.js";

const MAX_MIN = 720;

export function createStreamGiveaways({ db, giveaways, now = () => Date.now() }) {
    const svc = () => (typeof giveaways === "function" ? giveaways() : giveaways);
    const metaKey = (gid, uid) => `streamgw:${gid}:${uid}`;
    const active = (gid, uid) => {
        const id = Number(db.getMeta(metaKey(gid, uid)) ?? 0);
        const g = id ? db.getGiveaway(id) : null;
        return g && (g.status === "active" || g.status === "scheduled") ? g : null;
    };
    return {
        enabled: () => Boolean(svc()),
        active,
        /**
         * Starts it. The caller has already checked they may stream here. Either `{ game, key, minutes }` for the quick version (the slash
         * command), or `input` from the full form: prizes, look, rules and entry steps. `endWithStream` (on by default) draws the winners
         * the moment the stream ends; without it the giveaway just runs for its length.
         */
        async start(guildId, who, { game, key, minutes = 60, input = null, endWithStream = true }) {
            const gw = svc();
            if (!gw) throw new UserError("Giveaways aren't set up on this bot.");
            const c = db.getCommunity(guildId);
            if (!c.live_channel) throw new UserError("This server has no live channel yet. A manager can pick one with `/server stream setup`.");
            if (!db.getStreamLive(guildId, who.id)) throw new UserError("Go live first (`/server stream live`). The giveaway can end with your stream.");
            if (endWithStream && active(guildId, who.id)) throw new UserError("You already have a stream giveaway running. It ends when your stream does.");
            const name = who.name || "A streamer";
            let req;
            if (input) {
                if (!input.keys?.length) throw new UserError("Add at least one prize.");
                const label = String(input.game_title ?? input.keys[0].label ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
                const mins = Math.round((input.duration_ms ?? 3600_000) / 60_000);
                if (mins < 5 || mins > MAX_MIN) throw new UserError(`A stream giveaway runs between 5 minutes and ${MAX_MIN / 60} hours.`);
                req = { ...input, rounds: 1, start_in_ms: 0, repeat_ms: null, guild_id: guildId, channel_id: c.live_channel, host_id: who.id,
                    title: input.title || `${name}'s stream giveaway${label ? ": " + label : ""}`, game_title: input.game_title ?? null,
                    claim_hours: input.claim_hours ?? 24, host: { host_name: who.name ?? null } };
            } else {
                const title = String(game ?? "").replace(/\s+/g, " ").trim().slice(0, 80), k = String(key ?? "").trim();
                if (!title) throw new UserError("Say which game the key is for.");
                if (k.length < 4 || k.length > 200) throw new UserError("That doesn't look like a game key.");
                const mins = Math.min(MAX_MIN, Math.max(5, Math.trunc(Number(minutes)) || 60));
                req = { guild_id: guildId, channel_id: c.live_channel, host_id: who.id, keys: [{ label: title, key: k, kind: "key" }], title: `${name}'s stream giveaway: ${title}`,
                    game_title: title, duration_ms: mins * 60_000, claim_hours: 24, host: { host_name: who.name ?? null } };
            }
            const r = await gw.create(req);
            if (endWithStream) db.setMeta(metaKey(guildId, who.id), String(r.id));
            return { id: r.id, channelId: c.live_channel, endsAt: now() + req.duration_ms, endsWithStream: endWithStream, prizes: r.prizes };
        },
        /** Called when a stream ends. Draws the winner right away. Never throws: ending a stream must not fail because of this. */
        async onEnd(guildId, userId) {
            try { const g = active(guildId, userId); if (g && svc()) await svc().end(g.id, { by: userId }); } catch { /* already over */ }
        }
    };
}
