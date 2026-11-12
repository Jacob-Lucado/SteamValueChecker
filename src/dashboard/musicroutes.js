// The music player's API: the queue, controls, radio stations and the overlay link.
// server.js passes in the helpers it already has (ctx) and merges these routes into its table.
import { CATEGORIES } from "../stations.js";
import { HttpError } from "./http.js";
import { isHidden } from "../hidden.js";
import { isSoundcloudUrl } from "../musicsource.js";

export function createMusicRoutes(ctx) {
    const { botGuilds, chat, cooldown, db, guildChoices, isManager, isOwner, managedGuild, mayStream, music, musicCall, musicGuild, musicMember, musicOrigin, origin, remember, rest, session, stations, streamAccess, streamRoutes } = ctx;
    return {
        // ----- music (SoundCloud in voice channels) -----
        "GET /api/music": async (req, _b, url) => {
            const s = session(req);
            if (!music) throw new HttpError(503, "Music isn't available on this bot right now.");
            const gid = url.searchParams.get("guild");
            if (!gid) {
                // the servers this person is in where the bot is too
                return { guilds: s.guilds.filter(g => !isHidden(g.id) && botGuilds?.(g.id)).map(g => ({ id: g.id, name: g.name, icon: g.icon, manager: isManager(g), active: music.status(g.id).active })) };
            }
            const g = musicMember(s, gid);
            await musicGuild?.(gid)?.warm?.(s.userId);
            const { autodj_playlist: _skip, last_radio: lastRadio, ...settings } = db.getMusicSettings(gid);
            const subs = db.listSubmissions(gid);
            const names = Object.fromEntries(await Promise.all([...new Set(subs.slice(0, 50).map(r => r.user_id))].map(async id => [id, (await remember("name:" + g.id + ":" + id, 10 * 60_000, () => rest.memberName(g.id, id)).catch(() => null)) || "Member " + id.slice(-4)])));
            const out = {
                guild: { id: g.id, name: g.name }, settings, status: music.status(gid), access: { ...music.access(gid, s.userId), isBotOwner: isOwner(s), canStream: await mayStream(s, g) }, playlists: db.listPlaylists(s.userId).map(p => ({ name: p.name, count: p.tracks.length })),
                autodj: { playlist: db.getAutoPlaylist(gid).slice(0, 100), count: db.getAutoPlaylist(gid).length, lastStation: (() => { try { return lastRadio ? JSON.parse(lastRadio).title ?? null : null; } catch { return null; } })() },
                submissions: subs.slice(0, 50).map(r => ({ id: r.id, userId: r.user_id, name: names[r.user_id], title: r.title, artist: r.artist, url: r.url, thumb: r.thumb, duration: r.duration, mine: r.user_id === s.userId }))
            };
            if (isManager(g)) { const c = await remember("choices:" + gid, 60_000, () => guildChoices(gid)); out.channels = c.channels; out.roles = c.roles; out.voiceChannels = await remember("voice:" + gid, 60_000, () => Promise.resolve(rest.listVoiceChannels?.(gid) ?? [])).catch(() => []); }
            return out;
        },
        // ----- the chat beside the player: in memory, one room per server, plain text only -----
        "GET /api/music/chat": async (req, _b, url) => {
            const s = session(req);
            const g = musicMember(s, url.searchParams.get("guild"));
            return chat.poll(g.id, { id: s.userId, name: s.username, avatar: s.avatar }, Number(url.searchParams.get("since")) || 0);
        },
        "POST /api/music/chat": async (req, body) => {
            const s = session(req);
            const g = musicMember(s, body.guild_id);
            const who = { id: s.userId, name: s.username, avatar: s.avatar };
            const r = body.react ? chat.react(g.id, who, String(body.react)) : chat.say(g.id, who, body.text);
            if (r.error) throw new HttpError(r.wait ? 429 : 400, r.error);
            return { message: r.msg };
        },
        "POST /api/music/chat/delete": async (req, body) => {
            const s = session(req);
            const g = musicMember(s, body.guild_id);
            const a = music.access(g.id, s.userId), mod = Boolean(a.dj || a.isManager || isOwner(s));
            if (body.clear) { if (!mod) throw new HttpError(403, "Only DJs, moderators and managers can clear the chat."); chat.clear(g.id); return { ok: true }; }
            if (!chat.remove(g.id, body.id, { by: s.userId, mod })) throw new HttpError(403, "You can only remove your own messages.");
            return { ok: true };
        },
        // The OBS overlay link for a server. Only people with Manage Server can see or change it.
        "GET /api/music/overlay": async (req, _b, url) => {
            const s = session(req), g = await streamAccess(s, url.searchParams.get("guild"));
            const o = db.getOverlay(g.id, s.userId);
            return { on: Boolean(o), token: o?.token ?? null, base: musicOrigin ? musicOrigin + "/overlay" : origin + "/overlay" };
        },
        "POST /api/music/overlay": async (req, body) => {
            const s = session(req), g = await streamAccess(s, body.guild_id);
            if (body.action === "remove") { db.removeOverlay(g.id, s.userId); return { on: false, token: null }; }
            if (body.action !== "create" && body.action !== "reset") throw new HttpError(400, "Unknown action.");
            return { on: true, token: db.resetOverlay(g.id, s.userId, isOwner(s) ? "owner" : isManager(g) ? "manager" : "role") };
        },
        ...streamRoutes,
        "GET /api/music/search": async (req, _b, url) => {
            const s = session(req);
            if (!music) throw new HttpError(503, "Music isn't available on this bot right now.");
            musicMember(s, url.searchParams.get("guild"));
            cooldown(s.userId, "musicsearch");
            return { results: await musicCall(() => music.search(url.searchParams.get("q"))) };
        },
        "POST /api/music/play": async (req, body) => {
            const s = session(req);
            if (!music) throw new HttpError(503, "Music isn't available on this bot right now.");
            const g = musicMember(s, body.guild_id);
            cooldown(s.userId, "musicplay");
            await musicGuild?.(g.id)?.warm?.(s.userId);
            const tracks = Array.isArray(body.tracks) && body.tracks.length ? body.tracks.slice(0, 1).map(t => ({ url: String(t.url ?? ""), title: String(t.title ?? "").slice(0, 150), artist: String(t.artist ?? "").slice(0, 80), duration: Number(t.duration) || null, thumb: typeof t.thumb === "string" && t.thumb.startsWith("https://") ? t.thumb : null })).filter(t => isSoundcloudUrl(t.url)) : null;
            const r = await musicCall(() => music.enqueue({ guildId: g.id, userId: s.userId, textChannelId: null, query: body.query, tracks: tracks?.length ? tracks : null, playNext: Boolean(body.next), shuffleAdded: Boolean(body.shuffle) }));
            if (r.title) chat.note(g.id, `${s.username} added ${r.kind === "playlist" ? `${r.added} songs from ${r.title}` : r.title}`);
            return { added: r.added, kind: r.kind, title: r.title, startedNow: r.startedNow, status: music.status(g.id) };
        },
        "POST /api/music/control": async (req, body) => {
            const s = session(req);
            if (!music) throw new HttpError(503, "Music isn't available on this bot right now.");
            const g = musicMember(s, body.guild_id);
            cooldown(s.userId, "music");
            await musicGuild?.(g.id)?.warm?.(s.userId);
            const id = g.id, u = s.userId, n = Number(body.n ?? body.value);
            const acts = {
                pause: () => music.pause(id, u), resume: () => music.resume(id, u), skip: () => music.skip(id, u), stop: () => music.stop(id, u), leave: () => music.leave(id, u),
                previous: () => music.previous(id, u), shuffle: () => music.shuffle(id, u), clear: () => music.clear(id, u), loop: () => music.setLoop(id, u, String(body.value)),
                volume: () => music.setVolume(id, u, n), seek: () => music.seek(id, u, n), skipto: () => music.skipTo(id, u, n), remove: () => music.remove(id, u, n), move: () => music.move(id, u, Number(body.from), Number(body.to))
            };
            if (!Object.hasOwn(acts, String(body.action))) throw new HttpError(400, "Unknown action.");
            const result = await musicCall(async () => acts[body.action]());
            return { result: result && typeof result === "object" && "skipped" in result ? { skipped: result.skipped, votes: result.votes, need: result.need } : null, status: music.status(id) };
        },
        "POST /api/music/playlists": async (req, body) => {
            const s = session(req);
            if (!music) throw new HttpError(503, "Music isn't available on this bot right now.");
            const g = musicMember(s, body.guild_id);
            const name = String(body.name ?? "").trim();
            if (body.action === "save") {
                const st = music.status(g.id); const tracks = [st.current, ...st.next].filter(Boolean);
                if (!tracks.length) throw new HttpError(400, "Nothing is playing or queued to save.");
                try { var saved = db.savePlaylist(s.userId, name, tracks); } catch (e) { throw new HttpError(400, e.message); }
                return { saved, playlists: db.listPlaylists(s.userId).map(p => ({ name: p.name, count: p.tracks.length })) };
            }
            if (body.action === "delete") {
                if (!db.deletePlaylist(s.userId, name)) throw new HttpError(404, "You don't have a playlist with that name.");
                return { playlists: db.listPlaylists(s.userId).map(p => ({ name: p.name, count: p.tracks.length })) };
            }
            if (body.action === "load") {
                const p = db.getPlaylist(s.userId, name);
                if (!p) throw new HttpError(404, "You don't have a playlist with that name.");
                cooldown(s.userId, "musicplay");
                await musicGuild?.(g.id)?.warm?.(s.userId);
                const r = await musicCall(() => music.enqueue({ guildId: g.id, userId: s.userId, textChannelId: null, tracks: p.tracks }));
                return { added: r.added, status: music.status(g.id) };
            }
            throw new HttpError(400, "Unknown action.");
        },
        "GET /api/music/stations": async (req, _b, url) => {
            const s = session(req);
            if (!music) throw new HttpError(503, "Music isn't available on this bot right now.");
            musicMember(s, url.searchParams.get("guild"));
            cooldown(s.userId, "musicstations");
            return { categories: CATEGORIES.map(([id, name]) => ({ id, name })), stations: stations ? (await stations.working()).map(t => ({ title: t.title, genre: t.genre, cat: t.cat ?? "", url: t.url, name: t.title })) : [] };
        },
        "POST /api/music/submit": async (req, body) => {
            const s = session(req);
            if (!music) throw new HttpError(503, "Music isn't available on this bot right now.");
            const g = musicMember(s, body.guild_id);
            cooldown(s.userId, "musicsubmit");
            await musicGuild?.(g.id)?.warm?.(s.userId);
            const tracks = Array.isArray(body.tracks) && body.tracks.length ? body.tracks.slice(0, 1).map(t => ({ url: String(t.url ?? ""), title: String(t.title ?? "").slice(0, 150), artist: String(t.artist ?? "").slice(0, 80), duration: Number(t.duration) > 0 ? Math.round(Number(t.duration)) : null, thumb: typeof t.thumb === "string" && t.thumb.startsWith("https://") ? t.thumb : null })).filter(t => isSoundcloudUrl(t.url)) : null;
            const r = await musicCall(() => music.submit(g.id, s.userId, { query: body.query, tracks: tracks?.length ? tracks : null }));
            return { added: r.added, title: r.title, pending: r.pending };
        },
        "POST /api/music/submission": async (req, body) => {
            const s = session(req);
            if (!music) throw new HttpError(503, "Music isn't available on this bot right now.");
            const g = musicMember(s, body.guild_id);
            await musicGuild?.(g.id)?.warm?.(s.userId);
            if (body.action === "clear") { const n = await musicCall(async () => music.clearSubmissions(g.id, s.userId)); return { cleared: n }; }
            await musicCall(async () => music.removeSubmission(g.id, s.userId, body.id));
            return { removed: true };
        },
        "POST /api/music/autodj": async (req, body) => {
            const s = session(req);
            if (!music) throw new HttpError(503, "Music isn't available on this bot right now.");
            const g = managedGuild(req, body.guild_id);
            cooldown(s.userId, "musicauto");
            const patch = {};
            const flag = k => { if (body[k] !== undefined) patch[k] = body[k] ? 1 : 0; };
            flag("autodj"); flag("autodj_submit"); flag("autodj_shuffle"); flag("radio");
            if (body.autodj_idle !== undefined) { const n = Math.round(Number(body.autodj_idle)); if (!(n >= 5 && n <= 600)) throw new HttpError(400, "Idle time must be between 5 and 600 seconds."); patch.autodj_idle = n; }
            if (body.autodj_channel_id !== undefined) {
                if (body.autodj_channel_id) { const vcs = await Promise.resolve(rest.listVoiceChannels?.(g.id) ?? []).catch(() => []); if (!vcs.some(c => c.id === body.autodj_channel_id)) throw new HttpError(400, "Pick a voice channel from the list."); }
                patch.autodj_channel_id = body.autodj_channel_id || null;
            }
            if (Object.keys(patch).length) db.setMusicSettings(g.id, patch);
            let note = null;
            if (body.clear_playlist) { music.clearAutoPlaylist(g.id); note = "Playlist removed."; }
            else if (body.playlist_url) { const r = await musicCall(() => music.setAutoPlaylist(g.id, { link: body.playlist_url })); note = `Playlist set: ${r.count} songs.`; }
            else if (body.saved_playlist) {
                const p = db.getPlaylist(s.userId, String(body.saved_playlist));
                if (!p) throw new HttpError(404, "You don't have a saved playlist with that name.");
                const r = await musicCall(() => music.setAutoPlaylist(g.id, { tracks: p.tracks, label: p.name })); note = `Playlist set from ${p.name}: ${r.count} songs.`;
            }
            if (db.getMusicSettings(g.id).autodj) music.autoJoin(g.id).catch(() => {});
            const { autodj_playlist: _skip, ...settings } = db.getMusicSettings(g.id);
            return { settings, note, count: db.getAutoPlaylist(g.id).length };
        },
        "POST /api/music/settings": async (req, body) => {
            const s = session(req);
            if (!music) throw new HttpError(503, "Music isn't available on this bot right now.");
            const g = managedGuild(req, body.guild_id);
            const patch = {};
            const int = (k, lo, hi, label) => { if (body[k] === undefined) return; const n = Math.round(Number(body[k])); if (!(n >= lo && n <= hi)) throw new HttpError(400, `${label} must be between ${lo} and ${hi}.`); patch[k] = n; };
            if (body.enabled !== undefined) patch.enabled = body.enabled ? 1 : 0;
            if (body.announce !== undefined) patch.announce = body.announce ? 1 : 0;
            if (body.vc_status !== undefined) patch.vc_status = body.vc_status ? 1 : 0;
            if (body.stay !== undefined) patch.stay = body.stay ? 1 : 0;
            if (body.radio !== undefined) patch.radio = body.radio ? 1 : 0;
            int("volume", 1, 100, "Starting volume"); int("max_queue", 5, 500, "Queue size"); int("max_minutes", 0, 600, "Song length limit"); int("leave_minutes", 1, 60, "Leave time");
            if (body.dj_role_id !== undefined || body.channel_id !== undefined) {
                const { channels, roles } = await guildChoices(g.id);
                if (body.dj_role_id !== undefined) { if (body.dj_role_id && !roles.some(r => r.id === body.dj_role_id)) throw new HttpError(400, "Pick a role from the list."); patch.dj_role_id = body.dj_role_id || null; }
                if (body.channel_id !== undefined) { if (body.channel_id && !channels.some(c => c.id === body.channel_id)) throw new HttpError(400, "Pick a text channel from the list."); patch.channel_id = body.channel_id || null; }
            }
            return { settings: Object.keys(patch).length ? db.setMusicSettings(g.id, patch) : db.getMusicSettings(g.id) };
        },
    };
}
