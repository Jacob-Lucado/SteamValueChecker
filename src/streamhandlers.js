// /server stream: streamers announce when they go live, members opt in to the ping, managers pick the role and channel.
import { UserError } from "./errors.js";
import { canStreamIn } from "./streamlive.js";
import { parseChannel, channelUrl } from "./streamwatch.js";
import { chatCommandSets } from "./streamcard.js";

const EPHEMERAL = 64;
const MANAGE_GUILD = 1n << 5n;

export const rolesOf = member => (Array.isArray(member?.roles) ? member.roles : [...(member?.roles?.cache?.keys?.() ?? [])]);

export function createStreamHandlers({ db, streams, streamGw = null, ownerId = null, publicUrl = null, canWatch = () => true }) {
    const eph = (i, content) => (i.replied || i.deferred ? i.editReply(typeof content === "string" ? { content } : content) : i.reply(typeof content === "string" ? { content, flags: EPHEMERAL, allowedMentions: { parse: [] } } : { ...content, flags: EPHEMERAL, allowedMentions: { parse: [] } }));
    const isManager = i => Boolean(i.memberPermissions?.has(MANAGE_GUILD));
    const who = i => ({ id: i.user.id, name: i.member?.displayName ?? i.user.globalName ?? i.user.username, avatarUrl: i.user.displayAvatarURL?.({ size: 128, extension: "png" }) ?? null });

    async function handleCommand(i) {
        try {
            if (!i.inGuild?.()) throw new UserError("Streams work in servers.");
            const gid = i.guildId, sub = i.options.getSubcommand(), c = db.getCommunity(gid);
            const mayGo = canStreamIn(c, { roleIds: rolesOf(i.member), isManager: isManager(i), isBotOwner: Boolean(ownerId) && i.user.id === ownerId });
            switch (sub) {
                case "live": {
                    if (!mayGo) throw new UserError(c.streamer_role_id ? `Only people with the <@&${c.streamer_role_id}> role, moderators and managers can announce a stream.` : "This server hasn't set a streamer role yet. A manager can do that with `/server stream setup`.");
                    await i.deferReply({ flags: EPHEMERAL });
                    const r = await streams.goLive(gid, who(i), { title: i.options.getString("title"), url: i.options.getString("link"), game: i.options.getString("game") });
                    return await eph(i, r.edited ? `Updated your post in <#${r.channelId}>.` : r.pinged ? `You're live! I posted in <#${r.channelId}> and pinged the people who opted in. Use \`/server stream end\` when you finish.` : `You're live! I posted in <#${r.channelId}>${c.ping_stream ? " (no ping this time, you went live a moment ago)" : ""}. Use \`/server stream end\` when you finish.`);
                }
                case "link": {
                    if (!mayGo) throw new UserError(c.streamer_role_id ? `Only people with the <@&${c.streamer_role_id}> role, moderators and managers can link a channel here.` : "This server hasn't set a streamer role yet. A manager can do that with `/server stream setup`.");
                    if (!c.live_channel) throw new UserError("This server has no live channel yet. A manager can pick one with `/server stream setup`.");
                    const { platform, handle } = parseChannel(i.options.getString("channel"));
                    const via = Boolean(ownerId) && i.user.id === ownerId ? "owner" : isManager(i) ? "manager" : "role";
                    db.setStreamLink(gid, i.user.id, { platform, handle, via, added: Date.now() });
                    const name = { twitch: "Twitch", kick: "Kick", youtube: "YouTube" }[platform];
                    return await eph(i, canWatch(platform) ? `Linked ${name}: ${channelUrl(platform, handle)}\nWhen you go live I'll post in <#${c.live_channel}> by myself (and ping the people who opted in), and close the post when you finish. Use \`/server stream unlink\` to stop.` : `Linked ${name}: ${channelUrl(platform, handle)}\nI can't check ${name} automatically on this bot yet, so use \`/server stream live\` when you start.`);
                }
                case "giveaway": {
                    if (!mayGo) throw new UserError("Only streamers, moderators and managers can run a stream giveaway here.");
                    if (!streamGw?.enabled()) throw new UserError("Giveaways aren't set up on this bot.");
                    await i.deferReply({ flags: EPHEMERAL });
                    const r = await streamGw.start(gid, who(i), { game: i.options.getString("game", true), key: i.options.getString("key", true), minutes: i.options.getInteger("minutes") ?? 60 });
                    return await eph(i, `Your giveaway is up in <#${r.channelId}>. It draws a winner when you end your stream (\`/server stream end\`), or <t:${Math.floor(r.endsAt / 1000)}:R> at the latest. The winner gets the key from me by message.`);
                }
                case "chat": {
                    if (!publicUrl) throw new UserError("The dashboard isn't set up on this bot, so there is no link to make.");
                    const base = publicUrl.replace(/\/$/, "");
                    const token = db.getStreamCard(i.user.id)?.token ?? db.resetStreamCard(i.user.id);
                    const sets = chatCommandSets(k => `${base}/api/streamcard/text?token=${token}&kind=${k}`), want = i.options.getString("bot");
                    const picked = want && sets[want] ? [[want, sets[want]]] : Object.entries(sets);
                    return await eph(i, { embeds: [{ color: 0x9146ff, title: "💬 Chat commands for your stream", description: "Paste these into your chat bot. Viewers type `!deals`, `!free` or `!wishlist` and get the best deal on your wishlist, a game that is free right now, or your gift-me page. It works in Twitch, Kick and YouTube chat, wherever your chat bot runs.",
                        fields: [...picked.map(([, t]) => ({ name: t.label, value: "```\n" + t.lines.join("\n") + "\n```" })), { name: "Keep it private", value: "These lines contain your private link. Anyone who can see your chat bot's commands can see it. Made a mess? Make a new link on the Streamer hub and paste the commands again." }], footer: { text: "Streamer hub on the dashboard has these with copy buttons" } }] });
                }
                case "unlink": { const had = db.getStreamLink(gid, i.user.id); db.removeStreamLink(gid, i.user.id); return await eph(i, had ? "Unlinked your channel. I won't post when you go live any more." : "You didn't have a channel linked."); }
                case "end": { await i.deferReply({ flags: EPHEMERAL }); await streams.endLive(gid, who(i)); return await eph(i, "Marked your stream as ended. Thanks for streaming!"); }
                case "ping": {
                    await i.deferReply({ flags: EPHEMERAL });
                    const cur = await streams.optedIn(gid, i.user.id);
                    const want = i.options.getBoolean("enabled") ?? !cur;
                    await streams.setOptIn(gid, i.user.id, want);
                    return await eph(i, want ? "You'll be pinged when someone goes live here. Run this again (or use the Streams page on the dashboard) to turn it off." : "Okay, no more stream pings.");
                }
                case "list": {
                    const live = db.listStreamLive(gid);
                    return await eph(i, { embeds: [{ color: 0x9146ff, title: "Live now", description: live.length ? live.map(s => `🔴 <@${s.user_id}> · [${s.title.slice(0, 80)}](${s.url})${s.game ? ` · ${s.game}` : ""}`).join("\n") : "Nobody is streaming right now.", footer: { text: c.ping_stream ? "/server stream ping turns the go-live ping on or off for you" : "Managers: /server stream setup" } }] });
                }
                case "setup": {
                    if (!isManager(i)) throw new UserError("You need the Manage Server permission to change this.");
                    const patch = {}, role = i.options.getRole("streamerrole"), ch = i.options.getChannel("channel"), ping = i.options.getRole("pingrole"), auto = i.options.getBoolean("auto");
                    if (role) patch.streamer_role_id = role.id; if (ch) patch.live_channel = ch.id; if (ping) patch.ping_stream = ping.id; if (auto !== null) patch.stream_auto = auto ? 1 : 0;
                    if (Object.keys(patch).length) db.setCommunity(gid, patch);
                    const n = db.getCommunity(gid);
                    return await eph(i, { embeds: [{ color: 0x9146ff, title: "Streams", description: [`**Streamer role:** ${n.streamer_role_id ? `<@&${n.streamer_role_id}>` : "not set"}`, `**Live channel:** ${n.live_channel ? `<#${n.live_channel}>` : "not set"}`, `**Ping role:** ${n.ping_stream ? `<@&${n.ping_stream}>` : "not set"}`, `**Automatic go-live:** ${n.stream_auto === 0 ? "off (people post with /server stream live)" : "on (linked channels are watched)"}`, "", Object.keys(patch).length ? "Saved." : "Pick any of the options to change them. Moderators and managers can always stream.", publicUrl ? `\nDashboard: ${publicUrl}/#/streams` : ""].join("\n") }] });
                }
                default: return;
            }
        } catch (e) {
            if (!(e instanceof UserError)) throw e;
            return eph(i, { content: e.message });
        }
    }
    return { handleCommand };
}
