import { featureOn } from "./features.js";
// Auto memes: every hour (or whatever the server picks) the bot drops one meme in the #memes channel.
// Memes come from meme-api.com, which serves popular posts from a handful of subreddits. Nothing marked NSFW or spoiler is ever used,
// pictures must sit on Reddit's or Imgur's own image hosts, and a server never gets the same post twice.
import { UserError } from "./errors.js";
import { reportProblem } from "./guildproblems.js";

// Only subreddits that are actually for memes. General ones (r/gaming, r/pcmasterrace, r/Steam) are mostly builds, screenshots and news.
export const MEME_SUBS = ["memes", "dankmemes", "wholesomememes", "gamingmemes", "ProgrammerHumor", "me_irl"];
export const MEME_HOURS = [1, 2, 3, 6, 12, 24];
const IMAGE_URL = /^https:\/\/(?:i\.redd\.it|i\.imgur\.com|preview\.redd\.it)\/[\w./-]+\.(?:png|jpe?g|gif|webp)$/i;
const BLOCKED_WORDS = /\b(nsfw|porn|nude|sex|rape|gore|suicide|nazi|hitler|slur)\b/i;
const MIN_UPS = 500;
// Titles that mean it's a photo, a question or a showcase and not a meme.
const NOT_A_MEME = /\b(?:my (?:first|new|latest|setup|build|collection|dog|cat|art|drawing|painting)|i (?:made|built|drew|painted|finally|just (?:got|bought|made|finished))|rate my|ama|eli5|help|how (?:do|can|to)|why (?:do|does|is)|what (?:is|are|do)|anyone|does anyone|question|thoughts|discussion|psa|news|update|megathread|official|giveaway|announcement|review|screenshot|oc art|fanart|commission|selfie|pic of)\b|\?\s*$|^\[/i;

const sourceFetch = (fetchImpl, url) => fetchImpl(url, { signal: AbortSignal.timeout(10_000), headers: { "user-agent": "SteamValueChecker/1.0 (discord bot)" } });

/** Picks a usable meme out of whatever the API returned, or null. `seen` is a Set of post links this server already got. */
export function chooseMeme(list, seen = new Set(), rnd = Math.random) {
    const ok = (Array.isArray(list) ? list : []).filter(m => m && !m.nsfw && !m.spoiler && IMAGE_URL.test(String(m.url ?? "")) && typeof m.postLink === "string"
        && /^https:\/\/(?:redd\.it|www\.reddit\.com)\//.test(m.postLink) && !seen.has(m.postLink) && Number(m.ups) >= MIN_UPS && !BLOCKED_WORDS.test(String(m.title ?? "")) && !NOT_A_MEME.test(String(m.title ?? "").trim()) && String(m.title ?? "").length <= 140
        && (!m.subreddit || MEME_SUBS.some(x => x.toLowerCase() === String(m.subreddit).toLowerCase())));
    // favor the better half by upvotes so the feed stays funny, but still vary it
    const top = ok.sort((a, b) => Number(b.ups) - Number(a.ups)).slice(0, Math.max(1, Math.ceil(ok.length / 2)));
    return top.length ? top[Math.floor(rnd() * top.length)] : null;
}

export function memeEmbed(m) {
    return {
        color: 0xff4500, title: String(m.title ?? "Meme").slice(0, 250), url: m.postLink, image: { url: m.url },
        footer: { text: `r/${String(m.subreddit ?? "memes").slice(0, 40)} · 👍 ${Number(m.ups).toLocaleString("en-US")}` }
    };
}

export function createMemes({ fetchImpl = globalThis.fetch, rnd = Math.random } = {}) {
    /** One meme this server hasn't had yet. Tries a few subreddits before giving up. */
    async function pick(seen = new Set()) {
        const subs = [...MEME_SUBS].sort(() => rnd() - 0.5).slice(0, 4);
        for (const sub of subs) {
            try {
                const res = await sourceFetch(fetchImpl, `https://meme-api.com/gimme/${encodeURIComponent(sub)}/30`);
                if (!res.ok) continue;
                const data = await res.json();
                const m = chooseMeme(data.memes ?? (data.url ? [data] : []), seen, rnd);
                if (m) return m;
            } catch { /* that subreddit didn't answer: try the next */ }
        }
        return null;
    }
    return { pick };
}

/** Posts one meme in the server's meme channel. Throws a UserError with a plain sentence when it can't. */
export async function postMeme({ db, api, memes, guildId, now = () => Date.now() }) {
    const c = db.getCommunity(guildId);
    if (!c.meme_channel) throw new UserError("No meme channel is set. Pick one with `/manage memes setup` or on the dashboard's Community page.");
    const m = await memes.pick(db.memeSeen(guildId));
    if (!m) throw new UserError("I couldn't find a fresh meme right now. Try again in a few minutes.");
    const sent = await api.sendMessage(c.meme_channel, { embeds: [memeEmbed(m)], allowed_mentions: { parse: [] } }).catch(() => null);
    if (!sent) throw new UserError("I couldn't post in the meme channel. Give me View Channel, Send Messages and Embed Links there.");
    db.memeMark(guildId, m.postLink, now());
    db.setCommunity(guildId, { meme_at: now() });
    return { channelId: c.meme_channel, meme: m };
}

/** Finds a text channel called "memes" for servers set up before this feature existed. */
async function discoverChannel(api, guildId) {
    const list = await Promise.resolve(api.listChannels?.(guildId)).catch(() => null);
    return (list ?? []).find(ch => ch.type === 0 && String(ch.name).toLowerCase().replace(/^[^a-z0-9]+/, "") === "memes")?.id ?? null;
}

/** Called every few minutes: posts in every server whose meme is due. One failure never stops the rest. */
export async function tickMemes({ db, api, memes, now = () => Date.now(), has = () => true, sleep = ms => new Promise(r => setTimeout(r, ms)), log = () => {} }) {
    let done = 0;
    for (const c of db.allCommunity()) {
        if (!c.meme_on || !has(c.guild_id) || !featureOn(db, c.guild_id, "fun")) continue; // a server can switch the fun area off
        const every = Math.max(1, c.meme_hours || 1) * 3_600_000;
        if (c.meme_at && now() - c.meme_at < every) continue;
        try {
            if (!c.meme_channel) {
                const id = c.setup_at ? await discoverChannel(api, c.guild_id) : null; // only servers that ran community setup
                if (!id) { db.setCommunity(c.guild_id, { meme_at: now() }); continue; }
                db.setCommunity(c.guild_id, { meme_channel: id });
            }
            await postMeme({ db, api, memes, guildId: c.guild_id, now }); done++;
        } catch (e) {
            // a source hiccup is retried in ten minutes; anything else waits a full interval so a broken channel isn't hit every tick
            db.setCommunity(c.guild_id, { meme_at: /fresh meme/.test(e.message) ? now() - every + 10 * 60_000 : now() });
            log(`memes ${c.guild_id}: ${e.message}`);
            if (!/fresh meme/.test(e.message)) reportProblem(db, c.guild_id, "memes", "post the auto meme", e);
        }
        await sleep(1500);
    }
    return done;
}

/** /manage memes setup and /manage memes now. */
export function createMemeHandlers({ db, api, memes }) {
    const EPH = 64;
    const eph = (i, p) => (i.deferred || i.replied ? i.editReply(p) : i.reply({ ...(typeof p === "string" ? { content: p } : p), flags: EPH }));
    const summary = c => ({ color: 0xff4500, title: "😂 Auto memes", description: [`**Channel:** ${c.meme_channel ? `<#${c.meme_channel}>` : "not set"}`, `**Status:** ${c.meme_on ? `on, one every ${c.meme_hours} hour${c.meme_hours === 1 ? "" : "s"}` : "off"}`, c.meme_at ? `**Last one:** <t:${Math.floor(c.meme_at / 1000)}:R>` : null].filter(Boolean).join("\n"), footer: { text: "Nothing marked NSFW is ever posted." } });
    async function handleCommand(i) {
        const gid = i.guildId, sub = i.options.getSubcommand();
        try {
            if (!i.memberPermissions?.has?.(0x20n) && !i.memberPermissions?.has?.(0x8n)) throw new UserError("You need the Manage Server permission to change this.");
            if (sub === "setup") {
                const patch = {}, ch = i.options.getChannel("channel"), hours = i.options.getInteger("hours"), on = i.options.getBoolean("enabled");
                if (ch) { patch.meme_channel = ch.id; patch.meme_at = null; }
                if (hours) patch.meme_hours = hours;
                if (on !== null && on !== undefined) patch.meme_on = on ? 1 : 0;
                if (Object.keys(patch).length) db.setCommunity(gid, patch);
                return await eph(i, { embeds: [summary(db.getCommunity(gid))] });
            }
            if (sub === "now") {
                await i.deferReply({ flags: EPH });
                const r = await postMeme({ db, api, memes, guildId: gid });
                return await eph(i, `Posted a meme in <#${r.channelId}>.`);
            }
        } catch (e) {
            if (!(e instanceof UserError)) throw e;
            return eph(i, { content: e.message });
        }
    }
    return { handleCommand };
}
