// Discord side of the music feature: /music, /play, the buttons under the now-playing post and the search menu.
import { MessageFlags, PermissionFlagsBits, ChannelType } from "discord.js";
import { UserError } from "./errors.js";
import { fmtTime } from "./music.js";
import { fancy, nowPlayingEmbed, queueEmbed, addedEmbed, searchPayload, playlistLine, QUEUE_PAGE } from "./musicrender.js";

const eph = (i, payload, bad = false) => i.reply({ ...fancy(payload, bad), flags: MessageFlags.Ephemeral });

/** "1:30", "90", "1m30s" or "1h2m" to seconds. NaN when it can't be read. */
export function parseTime(text) {
    const t = String(text ?? "").trim().toLowerCase();
    if (/^\d+$/.test(t)) return Number(t);
    if (/^\d{1,3}(:\d{1,2}){1,2}$/.test(t)) return t.split(":").reduce((a, n) => a * 60 + Number(n), 0);
    const m = t.match(/^(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?$/);
    if (m && (m[1] || m[2] || m[3])) return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
    return NaN;
}

/** Lets music.js look at a server through discord.js without importing it. */
export function guildAdapter(client) {
    return gid => {
        const guild = client.guilds.cache.get(String(gid));
        if (!guild) return null;
        const me = () => guild.members.me;
        return {
            id: guild.id, voiceAdapterCreator: guild.voiceAdapterCreator,
            async warm(userId) { await guild.members.fetch(userId).catch(() => null); },
            memberInfo(userId) {
                const m = guild.members.cache.get(userId);
                if (!m) return { roleIds: [], isManager: guild.ownerId === userId };
                return { roleIds: [...m.roles.cache.keys()], isManager: guild.ownerId === userId || m.permissions.has(PermissionFlagsBits.ManageGuild) || m.permissions.has(PermissionFlagsBits.Administrator) };
            },
            voiceChannelInfo(channelId) {
                const ch = guild.channels.cache.get(channelId);
                if (!ch || (ch.type !== ChannelType.GuildVoice && ch.type !== ChannelType.GuildStageVoice)) return null;
                const p = me() ? ch.permissionsFor(me()) : null;
                return { id: ch.id, name: ch.name, canJoin: Boolean(p?.has(PermissionFlagsBits.Connect)) && !(ch.full && !p?.has(PermissionFlagsBits.MoveMembers)), canSpeak: ch.type === ChannelType.GuildStageVoice || Boolean(p?.has(PermissionFlagsBits.Speak)) };
            },
            voiceChannelOf(userId) {
                const ch = guild.voiceStates.cache.get(userId)?.channel;
                if (!ch) return null;
                const p = me() ? ch.permissionsFor(me()) : null;
                return { id: ch.id, name: ch.name, canJoin: Boolean(p?.has(PermissionFlagsBits.Connect)) && !(ch.full && !p?.has(PermissionFlagsBits.MoveMembers)), canSpeak: ch.type === ChannelType.GuildStageVoice || Boolean(p?.has(PermissionFlagsBits.Speak)) };
            },
            humansIn(channelId) { const ch = guild.channels.cache.get(channelId); return ch ? ch.members.filter(m => !m.user.bot).size : 0; },
            channelBitrate(channelId) { return guild.channels.cache.get(channelId)?.bitrate ?? null; },
            channelName(channelId) { return guild.channels.cache.get(channelId)?.name ?? null; }
        };
    };
}

export function settingsSummary(s) {
    return [
        `Music is **${s.enabled ? "on" : "off"}**. Volume starts at **${s.volume}%**.`,
        s.dj_role_id ? `Controls need <@&${s.dj_role_id}> (or Manage Server). Anyone can still add songs.` : "Everyone in the voice channel can use the controls.",
        s.channel_id ? `Now-playing messages go to <#${s.channel_id}>.` : "Now-playing messages go where `/play` was used.",
        `Up to **${s.max_queue}** songs in the queue${s.max_minutes ? `, **${s.max_minutes}** minutes max per song` : ""}.`,
        s.announce ? "I post a message when each song starts." : "No song-start messages.",
        s.stay ? "I stay in the voice channel when the queue ends." : `I leave ${s.leave_minutes} minutes after the queue ends or everyone leaves.`,
        `Live radio links are **${s.radio ? "allowed" : "off"}**.`
    ].join("\n");
}

export function autoSummary(s, count, pending) {
    return [
        `Auto DJ is **${s.autodj ? "on" : "off"}**. It plays ${count ? `**${count}** songs from ${s.autodj_source ? (/^https?:/.test(s.autodj_source) ? "the playlist you set" : s.autodj_source) : "its playlist"}` : "nothing yet (set a playlist)"}${s.autodj_shuffle ? ", shuffled" : " in order"}.`,
        `It starts after **${s.autodj_idle}s** of silence${s.autodj_channel_id ? ` and joins <#${s.autodj_channel_id}> by itself when someone is in it` : ""}.`,
        s.autodj_submit ? `Members can request songs (${pending} waiting). Requests play before the playlist.` : "Song requests are off.",
        `Live radio links are **${s.radio ? "allowed" : "off"}**.`
    ].join("\n");
}

export function createMusicHandlers({ db, music, adapter, stations = null }) {
    const picks = new Map(); // search results waiting for a choice
    const sweep = () => { const t = Date.now(); for (const [k, v] of picks) if (v.exp < t) picks.delete(k); };
    const managerOnly = i => { if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) throw new UserError("You need the Manage Server permission to change this."); };

    async function say(i, content) { const p = { ...fancy(content), allowedMentions: { parse: [] } }; return i.replied || i.deferred ? i.editReply(p) : i.reply(p); }

    async function handleCommand(i) {
        let deferred = false;
        try {
            if (!i.inGuild()) throw new UserError("Music works in servers. Join a voice channel in one and use this there.");
            const sub = i.commandName === "play" ? "play" : i.options.getSubcommand();
            const gid = i.guildId, uid = i.user.id;
            await adapter(gid)?.warm?.(uid);
            const slow = ["play", "search", "loadplaylist", "live", "submit", "setup"].includes(sub);
            if (slow) { await i.deferReply(); deferred = true; }
            const reply = async payload => (deferred ? i.editReply(fancy(payload)) : i.reply(fancy(payload)));

            switch (sub) {
                case "play": {
                    const r = await music.enqueue({ guildId: gid, userId: uid, textChannelId: i.channelId, query: i.options.getString("song"), playNext: Boolean(i.options.getBoolean("next")), shuffleAdded: Boolean(i.options.getBoolean("shuffle")) });
                    return await reply({ embeds: [addedEmbed(r)], allowedMentions: { parse: [] } });
                }
                case "search": {
                    const q = i.options.getString("query");
                    music.who(gid, uid);
                    const results = await music.search(q);
                    if (!results.length) throw new UserError("No results. Try other words.");
                    sweep();
                    const token = `${uid}${Date.now().toString(36)}`;
                    picks.set(token, { results, userId: uid, exp: Date.now() + 5 * 60_000 });
                    return await reply(searchPayload(results, token, q));
                }
                case "live": {
                    music.who(gid, uid);
                    if (!db.getMusicSettings(gid).radio) throw new UserError("Live radio is turned off in this server. A manager can allow it with `/music settings`.");
                    const list = stations ? await stations.working() : [];
                    if (!list.length) throw new UserError("None of the stations answered just now. Try again in a minute, or paste a stream link with `/play`.");
                    sweep();
                    const token = `${uid}${Date.now().toString(36)}`;
                    picks.set(token, { results: list.slice(0, 25), userId: uid, exp: Date.now() + 5 * 60_000 });
                    return await reply({ embeds: [{ color: 0xff5500, title: "📻 Live radio", description: list.slice(0, 25).map((t, n) => `**${n + 1}.** ${t.title} · ${t.genre ?? ""}`).join("\n"), footer: { text: "Pick a station to start it. These are checked just now, so every one is on the air." } }], components: [{ type: 1, components: [{ type: 3, custom_id: `mu_pick:${token}`, placeholder: "Pick a station", options: list.slice(0, 25).map((t, n) => ({ label: t.title.slice(0, 100), description: String(t.genre ?? "Live radio").slice(0, 100), value: String(n) })) }] }], allowedMentions: { parse: [] } });
                }
                case "submit": {
                    const r = await music.submit(gid, uid, { query: i.options.getString("song") });
                    return await reply({ embeds: [{ color: 0xff5500, title: "🎧 Request added", description: `${r.added > 1 ? `**${r.added} songs** from **${r.title}**` : `**${r.first.title}**`} will play on the Auto DJ.\nYou have **${r.pending}** waiting. Requests play before the Auto DJ's own playlist.`, footer: { text: "See the list with /music autodj requests" } }], allowedMentions: { parse: [] } });
                }
                case "requests": {
                    const rows = music.listSubmissions(gid);
                    return await reply({ embeds: [{ color: 0xff5500, title: "Waiting for the Auto DJ", description: rows.length ? rows.slice(0, 20).map((r, n) => `**${n + 1}.** ${r.title}${r.artist ? ` · ${r.artist}` : ""} · <@${r.user_id}>`).join("\n") + (rows.length > 20 ? `\n…and ${rows.length - 20} more` : "") : "No requests right now. Add one with `/music autodj submit`." }], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
                }
                case "setup": {
                    managerOnly(i);
                    const o = i.options, patch = {}; let playlistNote = "";
                    if (o.getBoolean("enabled") !== null) patch.autodj = o.getBoolean("enabled") ? 1 : 0;
                    if (o.getInteger("idle") !== null) patch.autodj_idle = o.getInteger("idle");
                    if (o.getBoolean("requests") !== null) patch.autodj_submit = o.getBoolean("requests") ? 1 : 0;
                    if (o.getBoolean("shuffle") !== null) patch.autodj_shuffle = o.getBoolean("shuffle") ? 1 : 0;
                    if (o.getChannel("channel")) patch.autodj_channel_id = o.getChannel("channel").id;
                    if (o.getBoolean("clearchannel")) patch.autodj_channel_id = null;
                    if (Object.keys(patch).length) db.setMusicSettings(gid, patch);
                    if (o.getBoolean("clearplaylist")) { music.clearAutoPlaylist(gid); playlistNote = "Playlist removed.\n"; }
                    else if (o.getString("playlist")) { const r = await music.setAutoPlaylist(gid, { link: o.getString("playlist") }); playlistNote = `Playlist set: ${r.count} songs.\n`; }
                    else if (o.getString("savedplaylist")) {
                        const p = db.getPlaylist(uid, o.getString("savedplaylist"));
                        if (!p) throw new UserError("You don't have a saved playlist with that name. `/music playlists` lists yours.");
                        const r = await music.setAutoPlaylist(gid, { tracks: p.tracks, label: p.name }); playlistNote = `Playlist set from **${p.name}**: ${r.count} songs.\n`;
                    }
                    if (db.getMusicSettings(gid).autodj) music.autoJoin(gid).catch(() => {});
                    return await reply({ content: (Object.keys(patch).length || playlistNote ? "Saved.\n" : "") + playlistNote + autoSummary(db.getMusicSettings(gid), db.getAutoPlaylist(gid).length, db.countSubmissions(gid)), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
                }
                case "nowplaying": return await reply({ embeds: [nowPlayingEmbed(music.status(gid))] });
                case "queue": return await reply({ embeds: [queueEmbed(music.status(gid), (i.options.getInteger("page") ?? 1) - 1)], flags: MessageFlags.Ephemeral });
                case "pause": music.pause(gid, uid); return await reply(`⏸️ Paused by <@${uid}>.`);
                case "resume": music.resume(gid, uid); return await reply(`▶️ Resumed by <@${uid}>.`);
                case "skip": {
                    const r = await music.skip(gid, uid);
                    return await reply(r.skipped ? `⏭️ Skipped **${r.track.title}**.` : { content: `🗳️ Vote to skip: **${r.votes}/${r.need}**.`, flags: MessageFlags.Ephemeral });
                }
                case "skipto": { const t = await music.skipTo(gid, uid, i.options.getInteger("number")); return await reply(`⏭️ Jumped to **${t.title}**.`); }
                case "previous": { const t = await music.previous(gid, uid); return await reply(`⏮️ Back to **${t.title}**.`); }
                case "seek": {
                    const secs = parseTime(i.options.getString("time"));
                    if (!Number.isFinite(secs)) throw new UserError("I couldn't read that time. Try `1:30`, `90` or `1m30s`.");
                    await music.seek(gid, uid, secs);
                    return await reply(`⏩ Jumped to **${fmtTime(secs)}**.`);
                }
                case "stop": music.stop(gid, uid); return await reply(`⏹️ Stopped and cleared the queue (<@${uid}>).`);
                case "leave": music.leave(gid, uid); return await reply("👋 Left the voice channel.");
                case "volume": { const v = music.setVolume(gid, uid, i.options.getInteger("percent")); return await reply(`🔊 Volume is **${v}%**.`); }
                case "loop": { const m = music.setLoop(gid, uid, i.options.getString("mode")); return await reply(`🔁 Loop: **${m === "off" ? "off" : m === "track" ? "this song" : "the whole queue"}**.`); }
                case "shuffle": { const n = music.shuffle(gid, uid); return await reply(`🔀 Shuffled ${n} songs.`); }
                case "remove": { const t = music.remove(gid, uid, i.options.getInteger("number")); return await reply(`🗑️ Removed **${t.title}**.`); }
                case "move": { const t = music.move(gid, uid, i.options.getInteger("from"), i.options.getInteger("to")); return await reply(`↕️ Moved **${t.title}** to ${i.options.getInteger("to")}.`); }
                case "clear": { const n = music.clear(gid, uid); return await reply(`🧹 Cleared ${n} song${n === 1 ? "" : "s"} from the queue.`); }
                case "saveplaylist": {
                    const st = music.status(gid);
                    const tracks = [st.current, ...st.next].filter(Boolean);
                    if (!tracks.length) throw new UserError("Nothing is playing or queued to save.");
                    let r; try { r = db.savePlaylist(uid, i.options.getString("name"), tracks); } catch (e) { throw new UserError(e.message); }
                    return await reply({ content: `💾 Saved **${r.name}** with ${r.count} song${r.count === 1 ? "" : "s"}. Load it any time with \`/music loadplaylist\`.`, flags: MessageFlags.Ephemeral });
                }
                case "loadplaylist": {
                    const p = db.getPlaylist(uid, i.options.getString("name"));
                    if (!p) throw new UserError("You don't have a playlist with that name. `/music playlists` lists yours.");
                    const r = await music.enqueue({ guildId: gid, userId: uid, textChannelId: i.channelId, tracks: p.tracks });
                    return await reply({ embeds: [addedEmbed({ ...r, title: p.name })], allowedMentions: { parse: [] } });
                }
                case "playlists": {
                    const rows = db.listPlaylists(uid);
                    return await reply({ embeds: [{ color: 0xff5500, title: "Your playlists", description: rows.length ? rows.map(playlistLine).join("\n") : "None yet. Play some songs and use `/music saveplaylist`." }], flags: MessageFlags.Ephemeral });
                }
                case "deleteplaylist": {
                    if (!db.deletePlaylist(uid, i.options.getString("name"))) throw new UserError("You don't have a playlist with that name.");
                    return await reply({ content: "Deleted.", flags: MessageFlags.Ephemeral });
                }
                case "settings": {
                    managerOnly(i);
                    const o = i.options, patch = {};
                    if (o.getBoolean("enabled") !== null) patch.enabled = o.getBoolean("enabled") ? 1 : 0;
                    if (o.getRole("djrole")) patch.dj_role_id = o.getRole("djrole").id;
                    if (o.getBoolean("cleardj")) patch.dj_role_id = null;
                    if (o.getChannel("channel")) patch.channel_id = o.getChannel("channel").id;
                    if (o.getInteger("volume") !== null) patch.volume = o.getInteger("volume");
                    if (o.getInteger("maxqueue") !== null) patch.max_queue = o.getInteger("maxqueue");
                    if (o.getInteger("maxminutes") !== null) patch.max_minutes = o.getInteger("maxminutes");
                    if (o.getBoolean("radio") !== null) patch.radio = o.getBoolean("radio") ? 1 : 0;
                    if (o.getBoolean("announce") !== null) patch.announce = o.getBoolean("announce") ? 1 : 0;
                    if (o.getBoolean("stay") !== null) patch.stay = o.getBoolean("stay") ? 1 : 0;
                    const s = Object.keys(patch).length ? db.setMusicSettings(gid, patch) : db.getMusicSettings(gid);
                    return await reply({ content: (Object.keys(patch).length ? "Saved.\n" : "") + settingsSummary(s), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
                }
            }
        } catch (err) {
            if (!(err instanceof UserError)) throw err;
            if (deferred) { await i.deleteReply().catch(() => {}); return i.followUp({ ...fancy(err.message, true), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } }); }
            return eph(i, { ...fancy(err.message, true), allowedMentions: { parse: [] } });
        }
    }

    /** The buttons under the now-playing post. */
    async function handleButton(i) {
        const action = i.customId.slice(3);
        const gid = i.guildId, uid = i.user.id;
        try {
            if (!gid) return;
            await adapter(gid)?.warm?.(uid);
            const st = music.status(gid);
            switch (action) {
                case "pause": music.pause(gid, uid); break;
                case "resume": music.resume(gid, uid); break;
                case "skip": { const r = await music.skip(gid, uid); if (!r.skipped) return await eph(i, `🗳️ Vote to skip: **${r.votes}/${r.need}**.`); break; }
                case "stop": music.stop(gid, uid); break;
                case "prev": await music.previous(gid, uid); break;
                case "shuffle": music.shuffle(gid, uid); break;
                case "loop": music.setLoop(gid, uid, st.loop === "off" ? "track" : st.loop === "track" ? "queue" : "off"); break;
                case "voldown": music.setVolume(gid, uid, Math.max(1, st.volume - 10)); break;
                case "volup": music.setVolume(gid, uid, Math.min(100, st.volume + 10)); break;
                case "queue": return await eph(i, { embeds: [queueEmbed(st)] });
                default: return;
            }
            await i.deferUpdate().catch(() => {});
            music.refreshPanel(music.get(gid) ?? { panel: null });
        } catch (err) {
            if (!(err instanceof UserError)) throw err;
            return eph(i, { ...fancy(err.message, true), allowedMentions: { parse: [] } });
        }
    }

    /** Someone picked a result from /music search. */
    async function handleSelect(i) {
        const entry = picks.get(i.customId.slice("mu_pick:".length));
        if (!entry || entry.exp < Date.now()) return eph(i, "That search has expired. Run it again.");
        if (entry.userId !== i.user.id) return eph(i, "Only the person who searched can pick.");
        const track = entry.results[Number(i.values[0])];
        if (!track) return eph(i, "That choice isn't there anymore.");
        try {
            await adapter(i.guildId)?.warm?.(i.user.id);
            await i.deferUpdate();
            const r = await music.enqueue({ guildId: i.guildId, userId: i.user.id, textChannelId: i.channelId, tracks: [track] });
            picks.delete(i.customId.slice("mu_pick:".length));
            return await i.editReply({ embeds: [addedEmbed(r)], components: [], allowedMentions: { parse: [] } });
        } catch (err) {
            if (!(err instanceof UserError)) throw err;
            return i.followUp({ ...fancy(err.message, true), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
        }
    }

    async function handleAutocomplete(i) {
        const f = i.options.getFocused(true);
        if (f.name !== "name" && f.name !== "savedplaylist") return i.respond([]);
        const q = String(f.value ?? "").toLowerCase();
        return i.respond(db.listPlaylists(i.user.id).filter(p => p.name.toLowerCase().includes(q)).slice(0, 25).map(p => ({ name: `${p.name} (${p.tracks.length})`.slice(0, 100), value: p.name })));
    }

    return { handleCommand, handleButton, handleSelect, handleAutocomplete };
}
