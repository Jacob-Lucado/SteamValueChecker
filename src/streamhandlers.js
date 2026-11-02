// /server stream: streamers announce when they go live, members opt in to the ping, managers pick the role and channel.
import { UserError } from "./errors.js";
import { canStreamIn } from "./streamlive.js";
import { parseChannel, channelUrl } from "./streamwatch.js";

const EPHEMERAL = 64;
const MANAGE_GUILD = 1n << 5n;

export const rolesOf = member => (Array.isArray(member?.roles) ? member.roles : [...(member?.roles?.cache?.keys?.() ?? [])]);

export function createStreamHandlers({ db, streams, ownerId = null, publicUrl = null, canWatch = () => true }) {
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
                    const patch = {}, role = i.options.getRole("streamerrole"), ch = i.options.getChannel("channel"), ping = i.options.getRole("pingrole");
                    if (role) patch.streamer_role_id = role.id; if (ch) patch.live_channel = ch.id; if (ping) patch.ping_stream = ping.id;
                    if (Object.keys(patch).length) db.setCommunity(gid, patch);
                    const n = db.getCommunity(gid);
                    return await eph(i, { embeds: [{ color: 0x9146ff, title: "Streams", description: [`**Streamer role:** ${n.streamer_role_id ? `<@&${n.streamer_role_id}>` : "not set"}`, `**Live channel:** ${n.live_channel ? `<#${n.live_channel}>` : "not set"}`, `**Ping role:** ${n.ping_stream ? `<@&${n.ping_stream}>` : "not set"}`, "", Object.keys(patch).length ? "Saved." : "Pick any of the options to change them. Moderators and managers can always stream.", publicUrl ? `\nDashboard: ${publicUrl}/#/streams` : ""].join("\n") }] });
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
