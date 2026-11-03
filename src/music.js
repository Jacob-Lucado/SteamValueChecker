// The music player. One queue and one voice connection per server; SoundCloud audio comes from musicsource.js.
// Discord's voice library is passed in, so the logic here can be tested with a stand-in.
import { UserError } from "./errors.js";
import { createQueue, LOOP_MODES } from "./musicqueue.js";
import { isSoundcloudUrl, cleanQuery } from "./musicsource.js";
import { parseRadioUrl } from "./musicradio.js";
import { MAX_PENDING_PER_USER } from "./musicstore.js";
import { createAnalyser } from "./musicviz.js";
import { pipeline } from "node:stream";

export const MAX_STREAMS = Number(process.env.MUSIC_MAX_STREAMS) || 6;

/** Can this person run DJ-level controls? Everyone can when the server has no DJ role. Managers always can. */
export function isDj(settings, member) {
    if (!settings.dj_role_id) return true;
    return Boolean(member?.isManager) || Boolean(member?.isModerator) || (member?.roleIds ?? []).includes(settings.dj_role_id);
}

/** What this person is in the music player: a manager (Manage Server), a moderator, a DJ (has the DJ role) or just a listener. */
export function tierOf(settings, member) {
    if (member?.isManager) return "manager";
    if (member?.isModerator) return "moderator";
    if (settings.dj_role_id && (member?.roleIds ?? []).includes(settings.dj_role_id)) return "dj";
    return "listener";
}
const shuffled = arr => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };

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
const LIVE_MS = 10_000;
const EARLY_END_SECONDS = 8, MAX_RESUMES = 4; // a song ending more than this early counts as a dropped stream
/** Discord plays Opus. Left alone the encoder picks a modest bitrate, so raise it to what the voice channel allows (SoundCloud itself tops out around 128 kbps, so more than that adds nothing). */
export const MAX_BITRATE = 128_000;
export function tuneEncoder(resource, channelBitrate) {
    const enc = resource?.encoder;
    if (!enc) return;
    const target = Math.max(32_000, Math.min(MAX_BITRATE, Number(channelBitrate) || 64_000));
    try { enc.setBitrate(target); enc.setFEC?.(false); enc.setPLP?.(0); } catch { /* an encoder without these controls keeps its defaults */ }
}
export function createMusic({ db, source, voice, getGuild, api = null, panel = null, log = () => {}, setTimer = setTimeout, clearTimer = clearTimeout }) {
    const guilds = new Map();

    const get = gid => guilds.get(String(gid)) ?? null;
    function state(gid) {
        const id = String(gid);
        if (!guilds.has(id)) guilds.set(id, { guildId: id, queue: createQueue(), connection: null, player: null, voiceChannelId: null, textChannelId: null, resource: null, offset: 0, volume: null, panel: null, leaveTimer: null, aloneTimer: null, votes: new Set(), swapping: false, playing: false, failures: 0, autoMode: false, autoSuppressed: false, autoBag: [], autoTimer: null, resumes: 0 });
        return guilds.get(id);
    }
    const activeStreams = () => [...guilds.values()].filter(g => g.playing).length;

    // ---------- reading ----------
    function status(gid) {
        const g = get(gid);
        const waiting = Boolean(db.getMusicSettings(gid).stay && g?.connection && !g.playing && !g.queue.current);
        const auto = { waiting, on: autoOn(gid), mode: Boolean(g?.autoMode), pending: db.countSubmissions(gid), playlist: db.getAutoPlaylist(gid).length };
        if (!g || !g.connection) return { active: false, playing: false, paused: false, current: null, next: [], total: 0, loop: "off", volume: db.getMusicSettings(gid).volume, position: 0, totalSeconds: 0, channelId: null, live: false, auto };
        const paused = g.player?.state?.status === "paused" || g.player?.state?.status === "autopaused";
        return {
            active: true, playing: g.playing && !paused, paused, channelId: g.voiceChannelId, channelName: getGuild(gid)?.channelName?.(g.voiceChannelId) ?? null,
            current: g.queue.current, position: position(g), next: g.queue.next.slice(0, 50), total: g.queue.size, loop: g.queue.loop, volume: g.volume, totalSeconds: g.queue.totalSeconds(), live: Boolean(g.queue.current?.live), auto
        };
    }
    /** What the music page needs to draw the visualizer: the next stretch of pictures, lined up with what is playing now. */
    function viz(gid, spanMs = 200) {
        const g = get(gid);
        if (!g?.viz || !g.resource || !g.playing) return null;
        const paused = g.player?.state?.status === "paused" || g.player?.state?.status === "autopaused";
        if (paused) return { paused: true };
        const playMs = g.resource.playbackDuration ?? 0;
        return { playMs, ...g.viz.window(playMs, spanMs) };
    }
    /** Seconds into the song, to a tenth. (Whole seconds made the progress bars on the web jump a little every time they refreshed.) */
    function position(g) { return Math.round((g.offset + (g.resource?.playbackDuration ?? 0) / 1000) * 10) / 10; }

    // ---------- permission checks ----------
    /** Returns who this is and what they may do. Throws UserError with a plain reason when they can't use the player at all. */
    function who(gid, userId, { needChannel = true } = {}) {
        const guild = getGuild(gid);
        if (!guild) throw new UserError("I'm not in that server.");
        const settings = db.getMusicSettings(gid);
        if (!settings.enabled) throw new UserError("Music is turned off in this server. A manager can turn it on from the dashboard.");
        const member = withModerator(gid, guild.memberInfo(userId));
        const vc = guild.voiceChannelOf(userId);
        const g = get(gid);
        if (needChannel) {
            if (!vc) throw new UserError("Join a voice channel first, then try again.");
            if (g?.connection && g.voiceChannelId && vc.id !== g.voiceChannelId) throw new UserError(`I'm playing in <#${g.voiceChannelId}>. Join that channel to control the music.`);
        }
        return { guild, settings, member, vc, dj: isDj(settings, member) };
    }
    /** Moderators are whoever has the server's moderator role from community setup. They get DJ powers and can manage requests. */
    function withModerator(gid, member) {
        const modRole = db.getCommunity?.(gid)?.mod_role_id;
        return { ...member, isModerator: Boolean(modRole) && (member?.roleIds ?? []).includes(modRole) };
    }
    function needDj(w) {
        if (!w.dj) throw new UserError(`Only people with the <@&${w.settings.dj_role_id}> role (or Manage Server) can do that.`);
    }

    /** What this person can do right now, for the dashboard. Never throws. */
    function access(gid, userId) {
        const guild = getGuild(gid);
        const settings = db.getMusicSettings(gid);
        if (!guild) return { present: false, enabled: Boolean(settings.enabled) };
        const member = withModerator(gid, guild.memberInfo(userId)), vc = guild.voiceChannelOf(userId), g = get(gid);
        const sameChannel = Boolean(vc) && (!g?.connection || g.voiceChannelId === vc.id);
        return { present: true, enabled: Boolean(settings.enabled), inVoice: Boolean(vc), voiceName: vc?.name ?? null, sameChannel, dj: isDj(settings, member), tier: tierOf(settings, member), canSubmit: Boolean(settings.enabled && settings.autodj && settings.autodj_submit), isManager: Boolean(member?.isManager), botChannel: g?.voiceChannelId ?? null };
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
        if (w.settings.stay) db.setMusicSettings(g.guildId, { home_channel_id: w.vc.id });
        clearAlone(g);
    }

    function teardown(g, { keepQueue = false } = {}) {
        voiceStatus(g, null); // clear the line under the channel name before the channel id is forgotten
        clearTimer(g.leaveTimer); clearTimer(g.aloneTimer); g.leaveTimer = g.aloneTimer = null;
        try { g.stream?.kill(); } catch { /* */ }
        try { g.player?.stop(true); } catch { /* */ }
        try { g.connection?.destroy(); } catch { /* */ }
        g.stream = null; g.resource = null; g.connection = null; g.player = null; g.playing = false; g.voiceChannelId = null; g.offset = 0;
        retirePanel(g);
        if (!keepQueue) { g.queue.reset(); g.votes.clear(); g.volume = null; guilds.delete(g.guildId); }
    }

    // ---------- playing ----------
    async function playCurrent(g, { seek = 0, resume = false } = {}) {
        const track = g.queue.current;
        if (!track) { g.playing = false; voiceStatus(g, null); scheduleLeave(g); return null; }
        clearTimer(g.leaveTimer); g.leaveTimer = null;
        g.votes.clear();
        try { g.stream?.kill(); } catch { /* */ }
        // Tracks that came from a playlist link only have a link until now. Fill in the title, length and picture.
        if (!track.live && (!track.duration || !track.thumb)) { try { Object.assign(track, withoutEmpty(await source.details(track)), { requestedBy: track.requestedBy }); } catch { /* the basics are enough */ } }
        if (g.voiceChannelId && db.getMusicSettings(g.guildId).stay && db.getMusicSettings(g.guildId).home_channel_id !== g.voiceChannelId) db.setMusicSettings(g.guildId, { home_channel_id: g.voiceChannelId });
        if (!resume && !track.auto) {
            // what the bot goes back to when someone walks into an empty channel it is sitting in
            const keep = track.live ? JSON.stringify({ url: track.url, title: track.title, artist: track.artist ?? null, genre: track.genre ?? null, live: true, radio: true }) : null;
            if (keep !== db.getMusicSettings(g.guildId).last_radio) db.setMusicSettings(g.guildId, { last_radio: keep });
        }
        const cap = db.getMusicSettings(g.guildId).max_minutes * 60;
        if (cap && track.duration && track.duration > cap) return failTrack(g, track, new Error(`longer than the ${cap / 60}-minute limit`), { quiet: false });
        let s;
        try { s = await source.stream(track, { seek }); }
        catch (err) { return failTrack(g, track, err); }
        // Someone may have stopped everything while we were fetching.
        if (!g.connection || g.queue.current !== track) { try { s.kill(); } catch { /* */ } return null; }
        g.stream = s; g.offset = seek; g.failures = 0; if (!resume && seek === 0) g.resumes = 0;
        // The sound passes through a listener on its way to Discord, so the music page can show a live visualizer.
        let input = s.stream; g.viz = null;
        try { if (typeof s.stream?.pipe === "function") { const tap = createAnalyser(); pipeline(s.stream, tap, () => {}); input = tap; g.viz = tap; } } catch { input = s.stream; g.viz = null; }
        const resource = voice.createAudioResource(input, { inputType: voice.StreamType.Raw, inlineVolume: true });
        resource.volume?.setVolume((g.volume ?? 50) / 100);
        tuneEncoder(resource, getGuild(g.guildId)?.channelBitrate?.(g.voiceChannelId));
        g.resource = resource; g.playing = true; g.swapping = true;
        g.player.play(resource);
        g.swapping = false;
        if (seek === 0) announce(g, track);
        voiceStatus(g, track);
        return track;
    }
    const withoutEmpty = o => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== ""));

    /** Fetches real titles and lengths for a long playlist in the background, a couple at a time, so the queue fills in as you watch. */
    async function hydrate(g, list) {
        const todo = list.filter(t => !t.live && (!t.duration || !t.thumb));
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
        if (g.failures >= 3) { g.queue.reset(); g.playing = false; g.autoSuppressed = true; scheduleLeave(g); return null; }
        const nxt = g.queue.advance({ force: true });
        return nxt ? playCurrent(g) : (g.playing = false, scheduleLeave(g), null);
    }
    function onIdle(g) {
        if (g.swapping || !g.connection) return;
        // The stream can die partway through a song (a dropped connection while fetching its pieces). That isn't the song ending, so pick it up again where it stopped.
        const t = g.queue.current;
        const at = g.offset + (g.resource?.playbackDuration ?? 0) / 1000;
        if (((t?.duration && at < t.duration - EARLY_END_SECONDS) || t?.live) && (g.resumes ?? 0) < MAX_RESUMES) {
            g.resumes = (g.resumes ?? 0) + 1;
            log(`stream ended early at ${Math.floor(at)}s of ${t.duration ?? "live"}s (${g.stream?.lastError?.() || "no error"}), resuming (${g.resumes}/${MAX_RESUMES})`);
            g.resource = null;
            playCurrent(g, { seek: t.live ? 0 : Math.floor(at), resume: true }).catch(err => log(`resume failed: ${err?.message}`));
            return;
        }
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
        clearTimer(g.leaveTimer); clearTimer(g.autoTimer); g.autoTimer = null;
        const s = db.getMusicSettings(g.guildId);
        // With the Auto DJ on and something for it to play, idle time turns into music instead of the bot leaving.
        if (autoOn(g.guildId) && !g.autoSuppressed && autoHasContent(g.guildId)) {
            g.autoTimer = setTimer(() => { g.autoTimer = null; startAuto(g).then(ok => { if (!ok) idleLeave(g); }).catch(err => log(`auto dj failed: ${err?.message}`)); }, g.autoMode ? 1500 : Math.max(5, s.autodj_idle) * 1000);
            g.autoTimer.unref?.();
            return;
        }
        idleLeave(g);
    }
    function idleLeave(g) {
        clearTimer(g.leaveTimer);
        const s = db.getMusicSettings(g.guildId);
        if (s.stay) return;
        g.leaveTimer = setTimer(() => { if (!g.playing) teardown(g); }, Math.max(1, s.leave_minutes) * 60_000);
        g.leaveTimer.unref?.();
    }

    // ---------- the voice channel's status line ("Set a channel status") shows the song ----------
    /** Puts the current song under the voice channel's name, or clears it (track = null). Quietly gives up if the bot lacks the permission. */
    function voiceStatus(g, track) {
        const ch = g.voiceChannelId;
        if (!api?.setVoiceStatus || !ch) return;
        const on = db.getMusicSettings(g.guildId).vc_status;
        const text = track && on ? `${track.live ? "📻" : "🎵"} ${[track.title, track.artist && !track.live ? track.artist : null].filter(Boolean).join(" — ")}`.replace(/\s+/g, " ").trim().slice(0, 120) : "";
        if (text === (g.vcText ?? "") || (!text && !g.vcText)) return;
        if (g.vcDenied === ch) return;
        g.vcText = text;
        Promise.resolve(api.setVoiceStatus(ch, text)).catch(e => { if (e?.status === 403 || e?.status === 404) g.vcDenied = ch; log?.(`voice status: ${e?.message ?? e}`); });
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
        if (m?.id) { g.panel = { channelId: g.textChannelId, messageId: m.id }; live(g); }
    }
    /** Keeps the now-playing card moving: the progress bar is redrawn every few seconds while a song plays. */
    function live(g) {
        clearTimer(g.liveTimer);
        g.liveTimer = setTimer(() => { g.liveTimer = null; if (!g.panel) return; if (g.playing && g.player?.state?.status === "playing") refreshPanel(g); live(g); }, LIVE_MS);
        g.liveTimer?.unref?.();
    }
    function retirePanel(g) {
        clearTimer(g.liveTimer); g.liveTimer = null;
        const p = g.panel; g.panel = null;
        if (!p || !api) return;
        // Old now-playing cards are removed so the channel doesn't fill up. If the bot can't delete (missing permission), it just takes the buttons off.
        const strip = () => api.editMessage(p.channelId, p.messageId, { components: [] }).catch(() => {});
        if (api.deleteMessage) Promise.resolve(api.deleteMessage(p.channelId, p.messageId)).catch(strip); else strip();
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
    async function lookup(query, { allowRadio = true } = {}) {
        const q = String(query ?? "").trim();
        if (!q) throw new UserError("Give me a SoundCloud link or something to search for.");
        // Any other web address is treated as a live radio stream (Icecast, Shoutcast or a direct MP3/AAC address).
        if (/^https?:\/\//i.test(q) && !isSoundcloudUrl(q)) {
            if (!allowRadio) throw new UserError("Paste a SoundCloud link, or type what to search for.");
            if (!source.radioProbe || !parseRadioUrl(q)) throw new UserError("That isn't a stream address I can use. Live radio needs a public http or https stream link.");
            try { const t = await source.radioProbe(q); return { kind: "radio", title: t.title, tracks: [t] }; }
            catch (err) { throw err instanceof UserError ? err : new UserError("I couldn't open that stream."); }
        }
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
        if (!tracks && /^https?:\/\//i.test(String(query ?? "").trim()) && !isSoundcloudUrl(String(query).trim()) && !w.settings.radio) throw new UserError("Live stream links are turned off in this server. A manager can allow them on the dashboard.");
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
        g.autoSuppressed = false; clearTimer(g.autoTimer); g.autoTimer = null;
        let startedNow = !g.queue.current && Boolean(g.queue.start());
        if (startedNow) await playCurrent(g);
        else if (g.queue.current?.auto) { await advance(g, { force: true }); startedNow = g.queue.current?.url === list[0].url; } // a request beats the Auto DJ's filler song
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
        if (t?.live) throw new UserError("You can't jump around in a live stream.");
        if (!Number.isFinite(seconds) || seconds < 0) throw new UserError("That isn't a valid time.");
        if (t.duration && seconds >= t.duration) throw new UserError(`That track is only ${fmtTime(t.duration)} long.`);
        g.swapping = true; try { g.player.stop(true); } catch { /* */ } g.swapping = false;
        await playCurrent(g, { seek: Math.floor(seconds) });
        refreshPanel(g);
        return seconds;
    }
    function stop(gid, userId) { const w = who(gid, userId); needDj(w); const g = get(gid); if (!g?.connection) throw new UserError("I'm not playing anything."); g.autoSuppressed = true; g.autoMode = false; g.queue.reset(); g.swapping = true; try { g.player.stop(true); } catch { /* */ } g.swapping = false; g.playing = false; g.resource = null; voiceStatus(g, null); retirePanel(g); scheduleLeave(g); }
    function leave(gid, userId) { const w = who(gid, userId); needDj(w); const g = get(gid); if (!g?.connection) throw new UserError("I'm not in a voice channel."); db.setMusicSettings(gid, { home_channel_id: null }); teardown(g); }
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

    // ---------- Auto DJ ----------
    // With the Auto DJ on, the bot keeps music going: members' requests first (oldest first), then the server's own playlist.
    // A real request from someone in the channel always beats the playlist filler.
    const autoOn = gid => { const s = db.getMusicSettings(gid); return Boolean(s.enabled && s.autodj); };
    const autoHasContent = gid => db.countSubmissions(gid) > 0 || db.getAutoPlaylist(gid).length > 0;

    function pickAuto(g) {
        const request = db.takeSubmission(g.guildId);
        if (request) return request;
        const s = db.getMusicSettings(g.guildId), list = db.getAutoPlaylist(g.guildId);
        if (!list.length) return null;
        if (!g.autoBag?.length || g.autoBag.some(i => i >= list.length)) {
            g.autoBag = list.map((_, i) => i);
            if (s.autodj_shuffle) { shuffled(g.autoBag); if (g.autoBag.length > 1 && g.autoBag[0] === g.lastAuto) g.autoBag.push(g.autoBag.shift()); }
        }
        const i = g.autoBag.shift(); g.lastAuto = i;
        return { ...list[i], auto: true, requestedBy: null };
    }

    /** Starts the next Auto DJ song if the bot is sitting idle with someone to listen. Returns whether it started one. */
    async function startAuto(g) {
        clearTimer(g.autoTimer); g.autoTimer = null;
        if (!g.connection || g.playing || g.queue.current || g.autoSuppressed || !autoOn(g.guildId)) return false;
        if ((getGuild(g.guildId)?.humansIn(g.voiceChannelId) ?? 0) === 0) return false;
        const t = pickAuto(g);
        if (!t) return false;
        g.queue.add([t]); g.queue.start(); g.autoMode = true;
        g.textChannelId = db.getMusicSettings(g.guildId).channel_id ?? g.textChannelId;
        await playCurrent(g);
        return true;
    }

    /** Someone has walked into a channel the bot is sitting idle in: carry on with the last live station, or start the Auto DJ. */
    async function wake(g) {
        if (!g?.connection || g.playing || g.queue.current || g.waking) return false;
        const s = db.getMusicSettings(g.guildId);
        if (!s.enabled || (getGuild(g.guildId)?.humansIn(g.voiceChannelId) ?? 0) === 0) return false;
        g.waking = true;
        try {
            g.autoSuppressed = false;
            let station = null;
            if (s.stay && s.radio && s.last_radio) { try { station = JSON.parse(s.last_radio); } catch { station = null; } }
            if (station?.url) {
                g.queue.add([{ ...station, requestedBy: null, resumed: true }]); g.queue.start(); g.autoMode = false;
                g.textChannelId = s.channel_id ?? g.textChannelId;
                await playCurrent(g);
                if (g.playing) return true;
                g.queue.reset(); g.autoSuppressed = false; g.failures = 0; // the station is down: fall back to the Auto DJ
            }
            return await startAuto(g);
        } finally { g.waking = false; }
    }

    /** Joins the server's Auto DJ channel, or the channel it was last used in, when someone is in it and the bot isn't playing anywhere. */
    async function autoJoin(guildId, { empty = false } = {}) {
        const s = db.getMusicSettings(guildId);
        if (!s.enabled) return false;
        const guild = getGuild(guildId);
        const wanted = [];
        if (s.autodj && s.autodj_channel_id && autoHasContent(guildId)) wanted.push(s.autodj_channel_id);
        if (s.stay && s.home_channel_id) wanted.push(s.home_channel_id);
        const vc = wanted.map(id => guild?.voiceChannelInfo?.(id)).find(c => c && (empty || (guild.humansIn(c.id) ?? 0) > 0));
        if (!vc) return false;
        const g = state(guildId);
        if (g.connection || g.joining) return false;
        g.joining = true;
        try { await connect(g, { guild, settings: s, vc }); }
        catch (err) { log(`auto join couldn't connect: ${err?.message}`); if (!g.connection) guilds.delete(g.guildId); return false; }
        finally { g.joining = false; }
        g.autoSuppressed = false;
        return wake(g);
    }
    /** After a restart: join the Auto DJ channel of every server that has someone in it, and go back to the channel each "stay" server was last in. */
    async function autoBoot() {
        for (const r of db.autoChannelGuilds()) await autoJoin(r.guild_id).catch(() => {});
        for (const r of db.homeGuilds()) await autoJoin(r.guild_id, { empty: true }).catch(() => {});
    }

    /** A member asks for a song (or a whole playlist link) to be played by the Auto DJ. They don't need to be in the voice channel. */
    async function submit(gid, userId, { query = null, tracks = null } = {}) {
        const w = who(gid, userId, { needChannel: false });
        if (!w.settings.autodj) throw new UserError("The Auto DJ isn't turned on in this server.");
        if (!w.settings.autodj_submit) throw new UserError("This server isn't taking song requests right now.");
        const have = db.countSubmissions(gid, userId);
        if (have >= MAX_PENDING_PER_USER) throw new UserError(`You already have ${have} requests waiting. Once some play you can add more.`);
        const found = tracks ? { kind: tracks.length > 1 ? "playlist" : "track", title: tracks[0]?.title ?? "", tracks } : await lookup(query, { allowRadio: false });
        let list = found.tracks.filter(t => !t.live);
        const limit = w.settings.max_minutes * 60;
        if (limit) list = list.filter(t => !t.duration || t.duration <= limit);
        if (!list.length) throw new UserError("None of that can be requested here (live streams and tracks over the length limit aren't allowed).");
        const added = db.addSubmissions(gid, userId, list);
        if (!added) throw new UserError("The request list is full. Try again once some have played.");
        const g = get(gid);
        if (g?.connection && !g.playing && !g.queue.current && !g.autoSuppressed) { clearTimer(g.autoTimer); g.autoTimer = setTimer(() => { g.autoTimer = null; startAuto(g).catch(() => {}); }, 1500); g.autoTimer.unref?.(); }
        else autoJoin(gid).catch(() => {});
        return { added, kind: found.kind, title: found.title, first: list[0], pending: db.countSubmissions(gid, userId), trimmed: list.length - added };
    }
    const listSubmissions = gid => db.listSubmissions(gid);
    /** You can take back your own request. DJs, moderators and managers can remove anyone's. */
    function removeSubmission(gid, userId, id) {
        const w = who(gid, userId, { needChannel: false });
        const row = db.listSubmissions(gid).find(r => r.id === Number(id));
        if (!row) throw new UserError("That request isn't in the list anymore.");
        if (row.user_id !== String(userId) && !w.dj) throw new UserError("Only DJs and moderators can remove someone else's request.");
        return db.removeSubmission(gid, id);
    }
    function clearSubmissions(gid, userId) { const w = who(gid, userId, { needChannel: false }); if (!w.dj || !(w.member?.isManager || w.member?.isModerator || !w.settings.dj_role_id)) throw new UserError("Only DJs and moderators can clear the request list."); return db.clearSubmissions(gid); }

    /** Sets the playlist the Auto DJ plays from a SoundCloud playlist (or track) link, or from tracks you already have (a saved playlist). */
    async function setAutoPlaylist(gid, { link = null, tracks = null, label = null } = {}) {
        let list, src;
        if (tracks) { list = tracks; src = label ? `Saved playlist: ${label}` : null; }
        else {
            const q = String(link ?? "").trim();
            if (!isSoundcloudUrl(q)) throw new UserError("Paste a SoundCloud playlist (or song) link.");
            const found = await lookup(q, { allowRadio: false });
            list = found.tracks; src = q;
        }
        list = list.filter(t => !t.live).slice(0, 100);
        if (!list.length) throw new UserError("I couldn't find any playable tracks there. Is it private?");
        const n = db.setAutoPlaylist(gid, list, src);
        const g = get(gid); if (g) g.autoBag = [];
        // Playlist links only carry the basics. Fill in titles, lengths and pictures in the background so the dashboard shows them.
        hydrateAuto(gid, list, src).catch(() => {});
        return { count: n, source: src };
    }
    async function hydrateAuto(gid, list, src) {
        const out = list.map(t => ({ ...t })); let i = 0;
        const worker = async () => { while (i < out.length) { const t = out[i++]; if (t.duration && t.thumb) continue; try { Object.assign(t, withoutEmpty(await source.details(t))); } catch { /* keep the basics */ } } };
        await Promise.all([worker(), worker()]);
        if (db.getMusicSettings(gid).autodj_source === src) db.setAutoPlaylist(gid, out, src);
    }
    function clearAutoPlaylist(gid) { db.setAutoPlaylist(gid, [], null); const g = get(gid); if (g) g.autoBag = []; }

    /** For the bot owner: every server the player is active in right now. */
    function sessions() {
        return [...guilds.values()].filter(g => g.connection).map(g => ({ guildId: g.guildId, channelId: g.voiceChannelId, channelName: getGuild(g.guildId)?.channelName?.(g.voiceChannelId) ?? null, playing: g.playing, track: g.queue.current ? { title: g.queue.current.title, artist: g.queue.current.artist, live: Boolean(g.queue.current.live), auto: Boolean(g.queue.current.auto) } : null, queue: g.queue.size, listeners: getGuild(g.guildId)?.humansIn(g.voiceChannelId) ?? 0, autoDj: autoOn(g.guildId) }));
    }
    /** For the bot owner: stop or disconnect a server's player no matter who started it. */
    function adminForce(gid, action) {
        const g = get(gid); if (!g?.connection) throw new UserError("The player isn't active in that server.");
        if (action === "leave") { teardown(g); return; }
        if (action === "stop") { g.autoSuppressed = true; g.autoMode = false; g.queue.reset(); g.swapping = true; try { g.player.stop(true); } catch { /* */ } g.swapping = false; g.playing = false; g.resource = null; retirePanel(g); scheduleLeave(g); return; }
        throw new UserError("Unknown action.");
    }

    // ---------- voice channel changes ----------
    /** Call when anyone joins or leaves a voice channel. Leaves a few minutes after everyone has gone. */
    function onVoiceChange(guildId) {
        const g = get(guildId);
        if (!g?.connection) { autoJoin(guildId).catch(err => log(`auto join failed: ${err?.message}`)); return; }
        const humans = getGuild(guildId)?.humansIn(g.voiceChannelId) ?? 0;
        const s = db.getMusicSettings(guildId);
        if (humans === 0) {
            if (s.stay) {
                // Sitting in the channel for good: a live stream just stops (it picks up again when someone returns), songs wait paused.
                if (g.queue.current?.live && g.playing) {
                    const t = g.queue.current;
                    db.setMusicSettings(guildId, { last_radio: JSON.stringify({ url: t.url, title: t.title, artist: t.artist ?? null, genre: t.genre ?? null, live: true, radio: true }) });
                    g.autoMode = false; g.queue.reset(); g.swapping = true; try { g.player.stop(true); } catch { /* */ } g.swapping = false; g.playing = false; g.resource = null; try { g.stream?.kill(); } catch { /* */ } g.stream = null; retirePanel(g);
                } else if (g.autoMode && g.playing) {
                    g.autoMode = false; g.queue.reset(); g.swapping = true; try { g.player.stop(true); } catch { /* */ } g.swapping = false; g.playing = false; g.resource = null; try { g.stream?.kill(); } catch { /* */ } g.stream = null; retirePanel(g);
                } else { try { g.player?.pause(true); } catch { /* */ } }
                return;
            }
            if (!g.aloneTimer) { g.aloneTimer = setTimer(() => { g.aloneTimer = null; if ((getGuild(guildId)?.humansIn(g.voiceChannelId) ?? 0) === 0) teardown(g); }, Math.max(1, s.leave_minutes) * 60_000); g.aloneTimer.unref?.(); try { g.player?.pause(true); } catch { /* */ } }
        } else {
            clearAlone(g);
            try { g.player?.unpause(); } catch { /* */ }
            if (!g.playing && !g.queue.current) wake(g).catch(err => log(`wake failed: ${err?.message}`));
        }
    }
    function clearAlone(g) { if (g.aloneTimer) { clearTimer(g.aloneTimer); g.aloneTimer = null; try { g.player?.unpause(); } catch { /* */ } } }
    /** The bot was kicked from the channel, or the server removed it. */
    function onBotDisconnected(guildId) { const g = get(guildId); if (g?.connection) teardown(g); }

    return { viz, submit, listSubmissions, removeSubmission, clearSubmissions, setAutoPlaylist, clearAutoPlaylist, autoBoot, autoJoin, sessions, adminForce, status, access, who, enqueue, search, lookup, pause, resume, skip, skipTo, previous, seek, stop, leave, setVolume, setLoop, shuffle, remove, move, clear, onVoiceChange, onBotDisconnected, refreshPanel, get: gid => get(gid), shutdown: () => { for (const g of [...guilds.values()]) teardown(g); } };
}
