// What the music feature looks like in Discord: the now-playing post with its buttons, the queue and search results.
import { fmtTime } from "./music.js";

const COLOR = 0xff5500; // SoundCloud orange
const short = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + "…" : String(s));
const link = t => `[${short(t.title, 70).replace(/[\[\]]/g, "")}](${t.url})`;
const LOOP_LABEL = { off: "Off", track: "This track", queue: "Whole queue" };

export function progressBar(pos, dur, width = 14) {
    if (!dur) return "";
    const at = Math.min(width - 1, Math.floor((pos / dur) * width));
    return "▬".repeat(at) + "🔘" + "▬".repeat(width - 1 - at);
}

export function nowPlayingEmbed(st) {
    const t = st.current;
    if (!t) return { color: COLOR, title: "Nothing is playing", description: "Use `/play` to add a song from SoundCloud." };
    const bar = t.live ? "\n\n🔴 **LIVE**" : t.duration ? `\n\n${progressBar(st.position, t.duration)}\n\`${fmtTime(st.position)} / ${fmtTime(t.duration)}\`` : "";
    return {
        color: COLOR, author: { name: st.paused ? "⏸️ Paused" : t.live ? "📻 Live radio" : t.auto ? "🎧 Auto DJ" : "🎶 Now playing" },
        title: short(t.title, 200), url: t.url,
        description: `${t.artist ? `by **${short(t.artist, 60)}**\n` : ""}${t.auto ? "Playing from the **Auto DJ**" : `Requested by ${t.requestedBy ? `<@${t.requestedBy}>` : "someone"}`}${bar}`,
        ...(t.thumb ? { thumbnail: { url: t.thumb } } : {}),
        fields: [
            { name: "Up next", value: st.next[0] ? short(st.next[0].title, 60) : "Nothing yet", inline: true },
            { name: "Queue", value: `${st.total} track${st.total === 1 ? "" : "s"}${st.totalSeconds ? ` · ${fmtTime(st.totalSeconds)}` : ""}`, inline: true },
            { name: "Loop · Volume", value: `${LOOP_LABEL[st.loop]} · ${st.volume}%`, inline: true }
        ],
        footer: { text: "SoundCloud" }
    };
}

const btn = (id, label, style = 2, disabled = false) => ({ type: 2, style, label, custom_id: `mu:${id}`, disabled });

/** `playerUrl` is the big player for this server. It becomes a link button; Discord link buttons need no handler. */
export function controls(st, playerUrl = null, guildId = null) {
    const listen = guildId && st.channelId ? voiceLink(guildId, st.channelId) : null;
    const links = [...(listen ? [{ type: 2, style: 5, label: "🎧 Listen here", url: listen }] : []), ...(playerUrl ? [{ type: 2, style: 5, label: "🎛 Big player", url: playerUrl }] : [])];
    return [
        { type: 1, components: [btn("prev", "⏮"), btn(st.paused ? "resume" : "pause", st.paused ? "▶ Resume" : "⏸ Pause", st.paused ? 3 : 1), btn("skip", "⏭ Skip"), btn("stop", "⏹ Stop", 4), btn("loop", `🔁 ${LOOP_LABEL[st.loop]}`)] },
        { type: 1, components: [btn("shuffle", "🔀 Shuffle"), btn("voldown", "🔉 -10"), btn("volup", "🔊 +10"), btn("queue", "📜 Queue")] },
        ...(links.length ? [{ type: 1, components: links }] : [])
    ];
}

export const nowPlayingPayload = (st, playerUrl = null, guildId = null) => ({ embeds: [nowPlayingEmbed(st)], components: st.current ? controls(st, playerUrl, guildId) : [], allowed_mentions: { parse: [] } });

/** Opening this puts the person in the voice channel the music is playing in. */
export const voiceLink = (guildId, channelId) => `https://discord.com/channels/${guildId}/${channelId}`;

/** The link to the big player, opened on the right server. Null when the web dashboard isn't set up. */
export function playerLink(base, guildId) {
    if (!base) return null;
    try { const u = new URL(base); u.searchParams.set("guild", String(guildId)); return u.toString(); } catch { return null; }
}

export const QUEUE_PAGE = 10;
export function queueEmbed(st, page = 0) {
    const pages = Math.max(1, Math.ceil(st.next.length / QUEUE_PAGE));
    const p = Math.min(Math.max(0, page), pages - 1);
    const rows = st.next.slice(p * QUEUE_PAGE, p * QUEUE_PAGE + QUEUE_PAGE).map((t, i) => `**${p * QUEUE_PAGE + i + 1}.** ${link(t)}${t.duration ? ` \`${fmtTime(t.duration)}\`` : ""}`);
    return {
        color: COLOR, title: "Music queue",
        description: [st.current ? `**Now:** ${link(st.current)}${st.current.duration ? ` \`${fmtTime(st.position)}/${fmtTime(st.current.duration)}\`` : ""}` : "Nothing is playing.", "", ...(rows.length ? rows : ["_The queue is empty. Add songs with `/play`._"])].join("\n").slice(0, 4000),
        footer: { text: `Page ${p + 1} of ${pages} · ${st.total} track${st.total === 1 ? "" : "s"}${st.totalSeconds ? ` · ${fmtTime(st.totalSeconds)} total` : ""} · Loop: ${LOOP_LABEL[st.loop]}` }
    };
}

export function addedEmbed(r) {
    const t = r.first;
    const many = r.added > 1;
    return {
        color: COLOR, title: r.startedNow ? "🎶 Playing now" : many ? `➕ Added ${r.added} tracks` : "➕ Added to the queue",
        description: many ? `**${short(r.title, 100)}**\n${r.added} tracks${r.durationSec ? ` · ${fmtTime(r.durationSec)}` : ""}` : `${link(t)}${t.artist ? ` by **${short(t.artist, 50)}**` : ""}${t.duration ? ` · \`${fmtTime(t.duration)}\`` : ""}`,
        ...(t.thumb && !many ? { thumbnail: { url: t.thumb } } : {}),
        footer: { text: [!r.startedNow && r.position ? `Position ${r.position} in the queue` : null, r.tooLong ? `${r.tooLong} skipped for being too long` : null, r.trimmed ? `${r.trimmed} didn't fit in the queue` : null].filter(Boolean).join(" · ") || "SoundCloud" }
    };
}

/** Search results as a menu the person picks from. `token` ties the menu to the stored results. */
export function searchPayload(results, token, query) {
    return {
        embeds: [{ color: COLOR, title: `Results for "${short(query, 60)}"`, description: results.map((t, i) => `**${i + 1}.** ${link(t)}${t.artist ? ` · ${short(t.artist, 30)}` : ""}${t.duration ? ` · \`${fmtTime(t.duration)}\`` : ""}`).join("\n") }],
        components: [{ type: 1, components: [{ type: 3, custom_id: `mu_pick:${token}`, placeholder: "Pick a song to play", options: results.map((t, i) => ({ label: short(t.title, 100), description: short([t.artist, t.duration ? fmtTime(t.duration) : ""].filter(Boolean).join(" · ") || "SoundCloud", 100), value: String(i) })) }] }]
    };
}

export function playlistLine(p) {
    return `**${p.name}** · ${p.tracks.length} track${p.tracks.length === 1 ? "" : "s"}`;
}

/** Any short reply from a music command, as an embed. `bad` makes it red for problems. */
export function noteEmbed(text, bad = false) {
    const m = String(text).match(/^(\p{Extended_Pictographic}\uFE0F?)\s*(.*)$/su);
    return { color: bad ? 0xed4245 : COLOR, description: bad ? `⚠️ ${text}` : (m ? `${m[1]}  ${m[2]}` : String(text)), footer: { text: "SoundCloud" } };
}
/** Turns a plain-text reply into an embed one; payloads that already have embeds pass through. */
export function fancy(payload, bad = false) {
    if (typeof payload === "string") payload = { content: payload };
    if (payload.embeds || !payload.content) return payload;
    const { content, ...rest } = payload;
    return { ...rest, embeds: [noteEmbed(content, bad)] };
}
