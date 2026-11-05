// Lets viewers type !enter in a streamer's Twitch chat to join that streamer's running stream giveaway.
// Reading chat needs no login. Answering in chat needs a Twitch account for the bot (TWITCH_BOT_LOGIN and TWITCH_BOT_TOKEN); without it
// the entries still count for linked viewers, the bot just stays quiet.
// A chat name is not a Discord account, so only viewers who linked their Twitch to the bot (the dashboard Account page) are entered.
import { UserError } from "./errors.js";

const URL_IRC = "wss://irc-ws.chat.twitch.tv:443";
const plain = t => String(t).replace(/<@&\d+>/g, "the required role").replace(/<[@#][!&]?\d+>/g, "someone").replace(/[*_`~|]/g, "").replace(/\s+/g, " ").trim().slice(0, 300);
const unescapeTag = v => String(v ?? "").replace(/\\s/g, " ").replace(/\\:/g, ";").replace(/\\\\/g, "\\");

/** One chat line -> { tags, nick, command, channel, text }. Returns null for anything that isn't well formed. */
export function parseIrc(line) {
    let rest = String(line).replace(/[\r\n]+$/, ""), tags = {};
    if (rest.startsWith("@")) {
        const sp = rest.indexOf(" "); if (sp < 0) return null;
        for (const kv of rest.slice(1, sp).split(";")) { const i = kv.indexOf("="); tags[i < 0 ? kv : kv.slice(0, i)] = i < 0 ? "" : unescapeTag(kv.slice(i + 1)); }
        rest = rest.slice(sp + 1);
    }
    let nick = null;
    if (rest.startsWith(":")) { const sp = rest.indexOf(" "); if (sp < 0) return null; nick = rest.slice(1, sp).split("!")[0]; rest = rest.slice(sp + 1); }
    const m = /^(\S+)(?: (\S+))?(?: :(.*)| (.*))?$/.exec(rest);
    if (!m) return null;
    return { tags, nick, command: m[1], channel: m[2]?.startsWith("#") ? m[2].slice(1).toLowerCase() : null, text: m[3] ?? m[4] ?? "", raw: rest };
}

export function createTwitchChat({ db, giveaways, streamGw, member, site = "", env = {}, log = () => {}, WS = globalThis.WebSocket, now = () => Date.now(), sayEveryMs = 1_600 }) {
    const botLogin = String(env.TWITCH_BOT_LOGIN ?? "").trim().toLowerCase(), botToken = String(env.TWITCH_BOT_TOKEN ?? "").trim().replace(/^oauth:/i, "");
    const canSay = Boolean(botLogin && botToken);
    let ws = null, ready = false, backoff = 5_000, retryAt = 0, timer = null;
    const joined = new Set(), wanted = new Map(), cool = new Map(), told = new Map(), refreshed = new Map(), queue = [];
    let sayTimer = null;

    /** Channels to sit in right now: streamers with a running giveaway that allows chat entry and a Twitch channel linked in the same server. */
    function wantedNow() {
        const out = new Map();
        for (const l of db.allStreamLinks()) {
            if (l.platform !== "twitch") continue;
            const g = streamGw.latest(l.user_id);
            if (!g || g.guild_id !== l.guild_id || (g.status !== "active") || g.ends_at <= now()) continue;
            const chat = streamGw.chatFor(g.id);
            if (chat) out.set(String(l.handle).toLowerCase(), { giveawayId: g.id, guildId: g.guild_id, hostId: l.user_id, invite: chat.invite ?? null });
        }
        return out;
    }

    const send = line => { try { ws?.send(line); } catch { /* socket closing */ } };
    function say(channel, text) {
        if (!canSay || !ready) return;
        if (queue.length >= 15) return;
        queue.push(`PRIVMSG #${channel} :${text}`);
        if (!sayTimer) sayTimer = setInterval(() => { const next = queue.shift(); if (next) send(next); else { clearInterval(sayTimer); sayTimer = null; } }, sayEveryMs);
    }

    function connect() {
        if (ws || !WS || now() < retryAt) return;
        let sock;
        try { sock = ws = new WS(URL_IRC); } catch (e) { log(`twitch chat: could not open (${e?.message})`); ws = null; retryAt = now() + backoff; return; }
        ready = false;
        ws.onopen = () => {
            send("CAP REQ :twitch.tv/tags twitch.tv/commands");
            if (canSay) { send(`PASS oauth:${botToken}`); send(`NICK ${botLogin}`); } else send(`NICK justinfan${Math.floor(10000 + Math.random() * 80000)}`);
        };
        ws.onmessage = ev => { for (const line of String(ev.data).split("\n")) if (line.trim()) onLine(line); };
        ws.onclose = () => { if (sock !== ws) return; ws = null; ready = false; joined.clear(); retryAt = now() + backoff; backoff = Math.min(backoff * 2, 120_000); };
        ws.onerror = () => { /* onclose follows */ };
    }
    function disconnect() { try { ws?.close(); } catch { /* already closed */ } ws = null; ready = false; joined.clear(); queue.length = 0; }

    function sync() {
        const w = wantedNow();
        wanted.clear(); for (const [k, v] of w) wanted.set(k, v);
        if (!w.size) { if (ws) disconnect(); return; }
        if (!ws) { connect(); return; }
        if (!ready) return;
        for (const c of w.keys()) if (!joined.has(c)) { send(`JOIN #${c}`); joined.add(c); }
        for (const c of [...joined]) if (!w.has(c)) { send(`PART #${c}`); joined.delete(c); }
    }

    function onLine(line) {
        const m = parseIrc(line);
        if (!m) return;
        if (m.command === "PING") return send(`PONG :${m.text || "tmi.twitch.tv"}`);
        if (m.command === "001") { ready = true; backoff = 5_000; return sync(); }
        if (m.command === "NOTICE" && /authentication failed|login unsuccessful/i.test(m.text)) { log("twitch chat: the bot login was refused, check TWITCH_BOT_TOKEN"); return disconnect(); }
        if (m.command === "RECONNECT") return disconnect();
        if (m.command !== "PRIVMSG" || !m.channel) return;
        if (!/^!enter\b/i.test(m.text.trim())) return;
        handleEnter(m).catch(err => log(`twitch chat: ${err?.message ?? err}`));
    }

    async function handleEnter(m) {
        const w = wanted.get(m.channel), uid = m.tags["user-id"], name = m.tags["display-name"] || m.nick || "friend";
        if (!w || !uid || m.nick === botLogin) return;
        const key = m.channel + ":" + uid;
        if (now() - (cool.get(key) ?? 0) < 15_000) return;
        cool.set(key, now()); if (cool.size > 5000) for (const [k, t] of cool) if (now() - t > 60_000) cool.delete(k);
        const where = w.invite ? ` (${w.invite})` : "";
        const link = db.twitchLinkByTwitchId(uid);
        if (!link) {
            if (now() - (told.get(key) ?? 0) > 120_000) { told.set(key, now()); say(m.channel, `@${name} to enter, join the Discord${w.invite ? " " + w.invite : ""} and link your Twitch to the bot at ${site || "the bot's website"}/#/steam. Then type !enter again.`); }
            return;
        }
        const info = await member(w.guildId, link.discord_id);
        if (!info) return say(m.channel, `@${name} you need to join the Discord first${where}. Then type !enter again.`);
        if (db.getEntry(w.giveawayId, link.discord_id)) return say(m.channel, `@${name} you're already in. Good luck!`);
        try {
            const r = await giveaways.enter(w.giveawayId, { userId: link.discord_id, roleIds: info.roleIds ?? [], boosting: Boolean(info.boosting), joinedAt: info.joinedAt ?? null, createdAt: info.createdAt ?? null });
            say(m.channel, `@${name} you're in the giveaway! ${r.total} ${r.total === 1 ? "person has" : "people have"} entered.${r.steps?.length ? " Make sure you did the required steps." : ""}`);
            if (now() - (refreshed.get(w.giveawayId) ?? 0) > 20_000) { refreshed.set(w.giveawayId, now()); giveaways.refresh?.(w.giveawayId)?.catch?.(() => {}); }
        } catch (e) {
            if (e instanceof UserError) say(m.channel, `@${name} ${plain(e.message)}`);
            else throw e;
        }
    }

    return {
        canSay,
        start() { if (timer) return; timer = setInterval(sync, 30_000); timer.unref?.(); sync(); },
        stop() { clearInterval(timer); timer = null; clearInterval(sayTimer); sayTimer = null; disconnect(); },
        sync, onLine, wantedNow, handleEnter,
        get joined() { return [...joined]; }
    };
}
