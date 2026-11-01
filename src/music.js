// The music player. One queue and one voice connection per server; SoundCloud audio comes from musicsource.js.
// Discord's voice library is passed in, so the logic here can be tested with a stand-in.
import { UserError } from "./errors.js";
import { createQueue, LOOP_MODES } from "./musicqueue.js";
import { isSoundcloudUrl, cleanQuery } from "./musicsource.js";

export const MAX_STREAMS = Number(process.env.MUSIC_MAX_STREAMS) || 6;

/** Can this person run DJ-level controls? Everyone can when the server has no DJ role. Managers always can. */
export function isDj(settings, member) {
    if (!settings.dj_role_id) return true;
    return Boolean(member?.isManager) || (member?.roleIds ?? []).includes(settings.dj_role_id);
}

export const fmtTime = sec => {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
};

/**
 * deps: { db, source, voice, getGuild, api, log }
 *  voice    – the @discordjs/voice module (or a stand-in with the same functions)
 *  getGuild – guildId => { id, voiceAdapterCreator, memberInfo(userId) -> {roleIds, isManager}, voiceChannelOf(userId) -> {id,name,humans,canJoin,canSpeak}, humansIn(channelId), channelName(id) } | null
 *  api      – bot REST: sendMessage(channelId, payload), editMessage(channelId, messageId, payload)
 */
export function createMusic({ db, source, voice, getGuild, api = null, panel = null, log = () => {}, setTimer = setTimeout, clearTimer = clearTimeout }) {
    const guilds = new Map();

    const get = gid => guilds.get(String(gid)) ?? null;
    function state(gid) {
        const id = String(gid);
        if (!guilds.has(id)) guilds.set(id, { guildId: id, queue: createQueue(), connection: null, player: null, voiceChannelId: null, textChannelId: null, resource: null, offset: 0, volume: null, panel: null, leaveTimer: null, aloneTimer: null, votes: new Set(), swapping: false, playing: false, failures: 0 });
        return guilds.get(id);
    }
    const activeStreams = () => [...guilds.values()].filter(g => g.playing).length;

    // ---------- reading ----------
    function status(gid) {
        const g = get(gid);
        if (!g || !g.connection) return { active: false, playing: false, paused: false, current: null, next: [], total: 0, loop: "off", volume: db.getMusicSettings(gid).volume, position: 0, totalSeconds: 0, channelId: null };
        const paused = g.player?.state?.status === "paused" || g.player?.state?.status === "autopaused";
        return {
            active: true, playing: g.playing && !paused, paused, channelId: g.voiceChannelId, channelName: getGuild(gid)?.channelName?.(g.voiceChannelId) ?? null,
            current: g.queue.current, position: position(g), next: g.queue.next.slice(0, 50), total: g.queue.size, loop: g.queue.loop, volume: g.volume, totalSeconds: g.queue.totalSeconds()
        };
    }
    function position(g) { return Math.floor(g.offset + (g.resource?.playbackDuration ?? 0) / 1000); }

    // ---------- permission checks ----------
    /** Returns who this is and what they may do. Throws UserError with a plain reason when they can't use the player at all. */
    function who(gid, userId, { needChannel = true } = {}) {
        const guild = getGuild(gid);
        if (!guild) throw new UserError("I'm not in that server.");
        const settings = db.getMusicSettings(gid);
        if (!settings.enabled) throw new UserError("Music is turned off in this server. A manager can turn it on from the dashboard.");
        const member = guild.memberInfo(userId);
        const vc = guild.voiceChannelOf(userId);
        const g = get(gid);
        if (needChannel) {
            if (!vc) throw new UserError("Join a voice channel first, then try again.");
            if (g?.connection && g.voiceChannelId && vc.id !== g.voiceChannelId) throw new UserError(`I'm playing in <#${g.voiceChannelId}>. Join that channel to control the music.`);
        }
        return { guild, settings, member, vc, dj: isDj(settings, member) };
    }
    function needDj(w) {
        if (!w.dj) throw new UserError(`Only people with the <@&${w.settings.dj_role_id}> role (or Manage Server) can do that.`);
    }

    /** What this person can do right now, for the dashboard. Never throws. */
    function access(gid, userId) {
        const guild = getGuild(gid);
        const settings = db.getMusicSettings(gid);
        if (!guild) return { present: false, enabled: Boolean(settings.enabled) };
        const member = guild.memberInfo(userId), vc = guild.voiceChannelOf(userId), g = get(gid);
        const sameChannel = Boolean(vc) && (!g?.connection || g.voiceChannelId === vc.id);
        return { present: true, enabled: Boolean(settings.enabled), inVoice: Boolean(vc), voiceName: vc?.name ?? null, sameChannel, dj: isDj(settings, member), isManager: Boolean(member?.isManager), botChannel: g?.voiceChannelId ?? null };
    }

    // ---------- connection ----------
    async function connect(g, w) {
        if (g.connection && g.voiceChannelId === w.vc.id) return;
        if (!w.vc.canJoin) throw new UserError("I can't join that voice channel. Give me Connect and Speak there.");
        if (!w.vc.canSpeak) throw new UserError("I can join but not speak in that channel. Give me the Speak permission.");
        if (!g.playing && activeStreams() >= MAX_STREAMS) throw new UserError("The music player is busy with other servers right now. Try again in a few minutes.");
        const conn = voice.joinVoiceChannel({ channelId: w.vc.id, guildId: g.guildId, adapterCreator: w.guild.voiceAdapterCreator, selfDeaf: true });
        try { await voice.entersState(conn, voice.VoiceConnectionStatus.Ready, 15_000); }
        catch { try { conn.destroy(); } catch { /* already gone */ } throw new UserError("I couldn't connect to that voice channel. Check my permissions and try again."); }
        conn.on(voice.VoiceConnectionStatus.Disconnected, async () => {
            try { await Promise.race([voice.entersState(conn, voice.VoiceConnectionStatus.Signalling, 5_000), voice.entersState(conn, voice.VoiceConnectionStatus.Connecting, 5_000)]); }
            catch { teardown(g); }
        });
        const player = voice.createAudioPlayer({ behaviors: { noSubscriber: voice.NoSubscriberBehavior.Pause } });
        conn.subscribe(player);
        player.on(voice.AudioPlayerStatus.Idle, () => onIdle(g));
        player.on("error", err => onPlayerError(g, err));
        g.connection = conn; g.player = player; g.voiceChannelId = w.vc.id;
        g.volume = g.volume ?? w.settings.volume;
        clearAlone(g);
    }

    function teardown(g, { keepQueue = false } = {}) {
        clearTimer(g.leaveTimer); clearTimer(g.aloneTimer); g.leaveTimer = g.aloneTimer = null;
        try { g.stream?.kill(); } catch { /* */ }
        try { g.player?.stop(true); } catch { /* */ }
        try { g.connection?.destroy(); } catch { /* */ }
        g.stream = null; g.resource = null; g.connection = null; g.player = null; g.playing = false; g.voiceChannelId = null; g.offset = 0;
        retirePanel(g);
        if (!keepQueue) { g.queue.reset(); g.votes.clear(); g.volume = null; guilds.delete(g.guildId); }
    }

    // ---------- playing ----------
    async function playCurrent(g, { seek = 0 } = {}) {
        const track = g.queue.current;
        if (!track) { g.playing = false; scheduleLeave(g); return null; }
        clearTimer(g.leaveTimer); g.leaveTimer = null;
        g.votes.clear();
        try { g.stream?.kill(); } catch { /* */ }
        // Tracks that came from a playlist link only have a link until now. Fill in the title, length and picture.
        if (!track.duration || !track.thumb) { try { Object.assign(track, withoutEmpty(await source.details(track)), { requestedBy: track.requestedBy }); } catch { /* the basics are enough */ } }
        const cap = db.getMusicSettings(g.guildId).max_minutes * 60;
        if (cap && track.duration && track.duration > cap) return failTrack(g, track, new Error(`longer than the ${cap / 60}-minute limit`), { quiet: false });
        let s;
        try { s = await source.stream(track, { seek }); }
        catch (err) { return failTrack(g, track, err); }
        // Someone may have stopped everything while we were fetching.
        if (!g.connection || g.queue.current !== track) { try { s.kill(); } catch { /* */ } return null; }
        g.stream = s; g.offset = seek; g.failures = 0;
        const resource = voice.createAudioResource(s.stream, { inputType: voice.StreamType.Raw, inlineVolume: true });
        resource.volume?.setVolume((g.volume ?? 50) / 100);
        g.resource = resource; g.playing = true; g.swapping = true;
        g.player.play(resource);
        g.swapping = false;
        if (seek === 0) announce(g, track);
        return track;
    }
    const withoutEmpty = o => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== ""));

    /** Fetches real titles and lengths for a long playlist in the background, a couple at a time, so the queue fills in as you watch. */
    async function hydrate(g, list) {
        const todo = list.filter(t => !t.duration || !t.thumb);
        let i = 0;
        const worker = async () => {
            while (i < todo.length) {
                const t = todo[i++];
                if (!guilds.has(g.guildId) || !g.connection) return;
                if (t.duration && t.thumb) continue;
                try { Object.assign(t, withoutEmpty(await source.details(t)), { requestedBy: t.requestedBy }); } catch { /* keep the placeholder */ }
            }
        };
        await Promise.all([worker(), worker()]);
        refreshPanel(g);
    }

    function failTrack(g, track, err) {
        log(`track failed: ${String(err?.message ?? err).slice(0, 150)}`);
        if (!/minute limit/.test(String(err?.message))) g.failures++;
        const tooLong = /minute limit/.test(String(err?.message));
        say(g, { content: tooLong ? `⏭️ **${track.title}** is over this server's song length limit, skipping it.` : `⚠️ Couldn't play **${track.title}**${g.failures >= 3 ? ". Skipping a few in a row failed, so I'm stopping here." : ", skipping it."}`, allowed_mentions: { parse: [] } });
        if (g.failures >= 3) { g.queue.reset(); g.playing = false; scheduleLeave(g); return null; }
        const nxt = g.queue.advance({ force: true });
        return nxt ? playCurrent(g) : (g.playing = false, scheduleLeave(g), null);
    }
    function onIdle(g) {
        if (g.swapping || !g.connection) return;
        g.playing = false; g.resource = null;
        const nxt = g.queue.advance();
        if (nxt) playCurrent(g).catch(err => log(`play failed: ${err?.message}`));
        else { retirePanel(g); scheduleLeave(g); }
    }
    function onPlayerError(g, err) {
        log(`player error: ${String(err?.message ?? err).slice(0, 150)}`);
        const track = g.queue.current;
        if (track) failTrack(g, track, err);
    }
    function scheduleLeave(g) {
        clearTimer(g.leaveTimer);
        const s = db.getMusicSettings(g.guildId);
        if (s.stay) return;
        g.leaveTimer = setTimer(() => { if (!g.playing) teardown(g); }, Math.max(1, s.leave_minutes) * 60_000);
        g.leaveTimer.unref?.();
    }

    // ---------- the "now playing" post ----------
    function say(g, payload) {
        const ch = g.textChannelId;
        if (!api || !ch || !db.getMusicSettings(g.guildId).announce) return Promise.resolve(null);
        return api.sendMessage(ch, payload).catch(() => null);
    }
    async function announce(g, track) {
        retirePanel(g);
        if (!panel) return;
        const m = await say(g, panel(g.guildId, status(g.guildId)));
        if (m?.id) g.panel = { channelId: g.textChannelId, messageId: m.id };
    }
    function retirePanel(g) {
        const p = g.panel; g.panel = null;
        if (p && api) api.editMessage(p.channelId, p.messageId, { components: [] }).catch(() => {});
    }
    async function refreshPanel(g) {
        if (!g.panel || !api || !panel) return;
        api.editMessage(g.panel.channelId, g.panel.messageId, panel(g.guildId, status(g.guildId))).catch(() => {});
    }

    // ---------- actions ----------
    /** Searches for results to choose from (no joining, no queueing). */
    async function search(query) {
        const q = cleanQuery(query);
        if (!q) throw new UserError("Type what you want to hear.");
        try { return await source.search(q, 5); }
        catch (err) { throw sourceError(err); }
    }
    const sourceError = err => (err?.missing ? new UserError(err.message) : new UserError("SoundCloud didn't answer that. Try again in a moment, or try a different search."));

    /** Looks up what a play request means: a SoundCloud link or search words. */
    async function lookup(query) {
        const q = String(query ?? "").trim();
        if (!q) throw new UserError("Give me a SoundCloud link or something to search for.");
        try {
            if (isSoundcloudUrl(q)) {
                const r = await source.resolve(q);
                if (!r.tracks.length) throw new UserError("I couldn't find any playable tracks there. Is it private?");
                return r;
            }
            const found = await source.search(q, 1);
            if (!found.length) throw new UserError(`Nothing on SoundCloud matched "${cleanQuery(q).slice(0, 60)}".`);
            return { kind: "track", title: found[0].title, tracks: [found[0]] };
        } catch (err) { throw err instanceof UserError ? err : sourceError(err); }
    }

    /** Adds to the queue and starts playing if nothing is. `tracks` are ready-made (from a search pick or a saved playlist). */
    async function enqueue({ guildId, userId, textChannelId, query = null, tracks = null, playNext = false, shuffleAdded = false }) {
        const w = who(guildId, userId);
        const g = state(guildId);
        let found = tracks ? { kind: tracks.length > 1 ? "playlist" : "track", title: tracks[0]?.title ?? "", tracks } : await lookup(query);
        let list = found.tracks.map(t => ({ ...t, requestedBy: String(userId) }));
        const limit = w.settings.max_minutes * 60;
        let tooLong = 0;
        if (limit) { const before = list.length; list = list.filter(t => !t.duration || t.duration <= limit); tooLong = before - list.length; }
        if (!list.length) throw new UserError(`That's longer than the ${w.settings.max_minutes}-minute limit this server set for one track.`);
        if (shuffleAdded && list.length > 1) for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
        await connect(g, w);
        g.textChannelId = w.settings.channel_id ?? textChannelId ?? g.textChannelId;
        const before = g.queue.size;
        const added = g.queue.add(list, { max: w.settings.max_queue, first: playNext });
        if (!added) { if (!g.queue.current) teardown(g); throw new UserError(`The queue is full (${w.settings.max_queue} tracks).`); }
        const startedNow = !g.queue.current && Boolean(g.queue.start());
        if (startedNow) await playCurrent(g);
        else refreshPanel(g);
        db.bumpUsage?.("music_play");
        if (added > 1 || list.slice(0, added).some(t => !t.duration)) hydrate(g, list.slice(0, added)).catch(() => {});
        return { kind: found.kind, title: found.title, added, first: list[0], position: startedNow ? 0 : (playNext ? 1 : before), startedNow, tooLong, trimmed: list.length - added, durationSec: list.slice(0, added).reduce((t, x) => t + (x.duration ?? 0), 0) };
    }

    function pause(gid, userId) { const w = who(gid, userId); needDj(w); const g = must(gid); if (!g.player.pause(true)) throw new UserError("It's already paused."); refreshPanel(g); return status(gid); }
    function resume(gid, userId) { const w = who(gid, userId); needDj(w); const g = must(gid); if (!g.player.unpause()) throw new UserError("It isn't paused."); refreshPanel(g); return status(gid); }
    function must(gid) { const g = get(gid); if (!g?.connection || !g.queue.current) throw new UserError("Nothing is playing right now."); return g; }

    /** Skip: the person who queued it or a DJ skips straight away; everyone else votes (half of the listeners). */
    async function skip(gid, userId) {
        const w = who(gid, userId); const g = must(gid);
        const t = g.queue.current;
        const humans = Math.max(1, getGuild(gid).humansIn(g.voiceChannelId));
        const force = t.requestedBy === String(userId) || (w.dj && Boolean(w.settings.dj_role_id)) || w.member?.isManager || humans <= 2;
        if (!force) {
            g.votes.add(String(userId));
            const need = Math.ceil(humans / 2);
            if (g.votes.size < need) return { skipped: false, votes: g.votes.size, need };
        }
        await advance(g, { force: true });
        return { skipped: true, track: t, status: status(gid) };
    }
    async function advance(g, opts) {
        const nxt = g.queue.advance(opts);
        g.swapping = true; try { g.player?.stop(true); } catch { /* */ } g.swapping = false;
        g.playing = false; g.resource = null;
        if (nxt) await playCurrent(g); else { retirePanel(g); scheduleLeave(g); }
    }
    async function skipTo(gid, userId, n) { const w = who(gid, userId); needDj(w); const g = must(gid); const t = g.queue.skipTo(n); if (!t) throw new UserError(`There's no track number ${n} in the queue.`); g.swapping = true; try { g.player.stop(true); } catch { /* */ } g.swapping = false; await playCurrent(g); return t; }
    async function previous(gid, userId) { const w = who(gid, userId); needDj(w); const g = must(gid); if (!g.queue.previous()) throw new UserError("There's nothing before this track."); g.swapping = true; try { g.player.stop(true); } catch { /* */ } g.swapping = false; await playCurrent(g); return g.queue.current; }
    async function seek(gid, userId, seconds) {
        const w = who(gid, userId); needDj(w); const g = must(gid); const t = g.queue.current;
        if (!Number.isFinite(seconds) || seconds < 0) throw new UserError("That isn't a valid time.");
        if (t.duration && seconds >= t.duration) throw new UserError(`That track is only ${fmtTime(t.duration)} long.`);
        g.swapping = true; try { g.player.stop(true); } catch { /* */ } g.swapping = false;
        await playCurrent(g, { seek: Math.floor(seconds) });
        refreshPanel(g);
        return seconds;
    }
    function stop(gid, userId) { const w = who(gid, userId); needDj(w); const g = get(gid); if (!g?.connection) throw new UserError("I'm not playing anything."); g.queue.reset(); g.swapping = true; try { g.player.stop(true); } catch { /* */ } g.swapping = false; g.playing = false; g.resource = null; retirePanel(g); scheduleLeave(g); }
    function leave(gid, userId) { const w = who(gid, userId); needDj(w); const g = get(gid); if (!g?.connection) throw new UserError("I'm not in a voice channel."); teardown(g); }
    function setVolume(gid, userId, v) { const w = who(gid, userId); needDj(w); const g = must(gid); const n = Math.round(Number(v)); if (!(n >= 1 && n <= 100)) throw new UserError("Volume is 1 to 100."); g.volume = n; g.resource?.volume?.setVolume(n / 100); refreshPanel(g); return n; }
    function setLoop(gid, userId, mode) { const w = who(gid, userId); needDj(w); const g = must(gid); if (!LOOP_MODES.includes(mode)) throw new UserError("Loop can be off, track or queue."); g.queue.setLoop(mode); refreshPanel(g); return mode; }
    function shuffle(gid, userId) { const w = who(gid, userId); needDj(w); const g = must(gid); if (g.queue.next.length < 2) throw new UserError("Need at least two upcoming tracks to shuffle."); const n = g.queue.shuffle(); refreshPanel(g); return n; }
    function remove(gid, userId, n) {
        const w = who(gid, userId); const g = must(gid); const t = g.queue.next[n - 1];
        if (!t) throw new UserError(`There's no track number ${n} in the queue.`);
        if (t.requestedBy !== String(userId)) needDj(w);
        return g.queue.remove(n);
    }
    function move(gid, userId, from, to) { const w = who(gid, userId); needDj(w); const g = must(gid); const t = g.queue.move(from, to); if (!t) throw new UserError("Those aren't valid queue positions."); return t; }
    function clear(gid, userId) { const w = who(gid, userId); needDj(w); const g = must(gid); return g.queue.clear(); }

    // ---------- voice channel changes ----------
    /** Call when anyone joins or leaves a voice channel. Leaves a few minutes after everyone has gone. */
    function onVoiceChange(guildId) {
        const g = get(guildId);
        if (!g?.connection) return;
        const humans = getGuild(guildId)?.humansIn(g.voiceChannelId) ?? 0;
        if (humans === 0) {
            if (!g.aloneTimer) { g.aloneTimer = setTimer(() => { g.aloneTimer = null; if ((getGuild(guildId)?.humansIn(g.voiceChannelId) ?? 0) === 0) teardown(g); }, Math.max(1, db.getMusicSettings(guildId).leave_minutes) * 60_000); g.aloneTimer.unref?.(); try { g.player?.pause(true); } catch { /* */ } }
        } else clearAlone(g);
    }
    function clearAlone(g) { if (g.aloneTimer) { clearTimer(g.aloneTimer); g.aloneTimer = null; try { g.player?.unpause(); } catch { /* */ } } }
    /** The bot was kicked from the channel, or the server removed it. */
    function onBotDisconnected(guildId) { const g = get(guildId); if (g?.connection) teardown(g); }

    return { status, access, who, enqueue, search, lookup, pause, resume, skip, skipTo, previous, seek, stop, leave, setVolume, setLoop, shuffle, remove, move, clear, onVoiceChange, onBotDisconnected, refreshPanel, get: gid => get(gid), shutdown: () => { for (const g of [...guilds.values()]) teardown(g); } };
}
