// Sends the bot's log lines to the owner's Discord (a channel, or DMs when no channel is set) so they can be read without opening Fly.
// Repeats are folded into one line with a count, and the number of messages per minute is capped, so a bad hour is a few messages, not a flood.
// Lines already have secrets masked by the log buffer.

export const MODES = { off: "Off", problems: "Problems only", all: "Everything" };
const META_MODE = "logfeed_mode", META_CHANNEL = "logfeed_channel";
const PROBLEM = /\b(failed|failure|could not|couldn't|can't|cannot|degraded|timed out|timeout|crash|unhandled|refused)\b/i;
const ICON = { error: "🔴", warn: "🟠", info: "⚪", activity: "🔵" };

export function createLogFeed({ db, send, now = () => Date.now(), windowMs = 20_000, perMinute = 5, timer = setTimeout }) {
    const queue = new Map();
    let pending = null, dropped = 0, sentAt = [], lastSent = null, lastError = null, sent = 0;

    const mode = () => (MODES[db.getMeta(META_MODE)] ? db.getMeta(META_MODE) : "problems");
    const channel = () => db.getMeta(META_CHANNEL) || null;
    const norm = t => t.replace(/\d{5,}/g, "#").replace(/\d+/g, "N").slice(0, 160);

    /** True when this line is worth sending in the current mode. */
    function wanted(entry) {
        const m = mode();
        if (m === "off") return false;
        if (entry.level === "error" || entry.level === "warn") return true;
        if (m === "all") return true;
        return entry.level === "info" && PROBLEM.test(entry.text);
    }

    function accept(entry) {
        try {
            if (!entry || !wanted(entry)) return;
            const key = entry.level + norm(entry.text);
            const hit = queue.get(key);
            if (hit) hit.count++;
            else if (queue.size < 200) queue.set(key, { level: entry.level, text: entry.text, at: entry.at, count: 1 });
            else dropped++;
            if (!pending) { pending = timer(() => { pending = null; flush().catch(() => {}); }, windowMs); pending.unref?.(); }
        } catch { /* the feed must never break logging */ }
    }

    const clock = at => new Date(at).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
    const lineOf = l => `${ICON[l.level] ?? "⚪"} ${clock(l.at)} ${l.text.replace(/\s+/g, " ").slice(0, 280)}${l.count > 1 ? ` ×${l.count}` : ""}`;

    /** Packs the queued lines into messages under Discord's 2000 characters. */
    function pack(lines) {
        const out = []; let cur = "";
        for (const l of lines) { const s = lineOf(l) + "\n"; if (cur.length + s.length > 1850) { out.push(cur); cur = ""; } cur += s; }
        if (cur) out.push(cur);
        return out.map(t => "```\n" + t.replace(/```/g, "'''") + "```");
    }

    async function post(content) {
        const ch = channel();
        try { await send({ channelId: ch, content }); }
        catch (e) { if (!ch) throw e; await send({ channelId: null, content: "⚠️ I couldn't post to your log channel, so logs are coming here instead.\n" + content }); }
    }

    async function flush() {
        const lines = [...queue.values()]; queue.clear();
        if (!lines.length) return 0;
        let msgs = pack(lines);
        sentAt = sentAt.filter(t => now() - t < 60_000);
        const room = Math.max(0, perMinute - sentAt.length);
        if (msgs.length > room) { dropped += lines.length * (msgs.length - room) / msgs.length | 0; msgs = msgs.slice(0, room); }
        if (dropped && msgs.length) { msgs[msgs.length - 1] += `\n… and about ${dropped} more lines. Check the Fly logs for the rest.`; dropped = 0; }
        for (const m of msgs) {
            try { await post(m); sent++; lastSent = now(); lastError = null; sentAt.push(now()); }
            catch (e) { lastError = String(e?.message ?? e).slice(0, 120); break; }
        }
        return msgs.length;
    }

    return {
        accept, flush, mode, channel,
        status: () => ({ mode: mode(), channel: channel(), modes: MODES, sent, lastSent, lastError, queued: queue.size }),
        setSettings({ mode: m, channel: c } = {}) {
            if (m !== undefined) { if (!MODES[m]) throw Object.assign(new Error("Pick off, problems or all."), { user: true }); db.setMeta(META_MODE, m); }
            if (c !== undefined) {
                const id = String(c ?? "").trim();
                if (id && !/^\d{17,20}$/.test(id)) throw Object.assign(new Error("A channel ID is 17 to 20 digits. Right-click the channel in Discord with Developer Mode on and choose Copy Channel ID."), { user: true });
                db.setMeta(META_CHANNEL, id);
            }
            return this.status();
        },
        /** A message that proves the route works. */
        async test() { await send({ channelId: channel(), content: "✅ Log feed is working. Problems from the bot will show up here." }); }
    };
}
