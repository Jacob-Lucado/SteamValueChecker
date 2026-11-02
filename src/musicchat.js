// The chat that sits beside the music player. It lives in memory only: nothing is saved, and it is gone when the bot restarts.
// People in the same server share one room. Messages are plain text, never HTML, and a person can only post every second or so.
const REACTIONS = new Set(["🔥", "💜", "🎉", "😂", "👏", "🤘", "🎧", "😍"]);
const KEEP = 120;                 // messages kept per server
const IDLE_MS = 6 * 3600_000;     // a quiet room is dropped after this long
const HERE_MS = 25_000;           // someone counts as "here" if they checked in this recently

export const cleanText = raw => String(raw ?? "").replace(new RegExp("[\\u0000-\\u001f\\u007f\\u200b-\\u200f\\u2028-\\u202e\\u2066-\\u2069]", "g"), " ").replace(/\s+/g, " ").trim().slice(0, 300);

export function createMusicChat({ now = () => Date.now() } = {}) {
    const rooms = new Map();
    let nextId = 1;
    const room = gid => {
        let r = rooms.get(gid);
        if (!r) { r = { msgs: [], here: new Map(), last: now(), sent: new Map() }; rooms.set(gid, r); }
        r.last = now();
        return r;
    }
    const push = (gid, m) => {
        const r = room(gid);
        const msg = { id: nextId++, at: now(), ...m };
        r.msgs.push(msg);
        if (r.msgs.length > KEEP) r.msgs.splice(0, r.msgs.length - KEEP);
        return msg;
    };
    /** Per person: at most 1 message per 1.2 s and 20 per minute. Returns seconds to wait, or 0. */
    function wait(r, userId, key = userId, gap = 1200, perMinute = 20) {
        const t = now(), log = (r.sent.get(key) ?? []).filter(x => t - x < 60_000);
        r.sent.set(key, log);
        if (log.length && t - log[log.length - 1] < gap) return 1;
        if (log.length >= perMinute) return Math.ceil((60_000 - (t - log[0])) / 1000);
        return 0;
    }
    return {
        say(gid, user, text) {
            const body = cleanText(text);
            if (!body) return { error: "Type something first." };
            const r = room(gid), w = wait(r, user.id);
            if (w) return { error: `Slow down a little. Try again in ${w}s.`, wait: w };
            r.sent.get(user.id).push(now());
            return { msg: push(gid, { kind: "msg", userId: user.id, name: String(user.name ?? "Someone").slice(0, 40), avatar: user.avatar ?? null, text: body }) };
        },
        react(gid, user, emoji) {
            if (!REACTIONS.has(emoji)) return { error: "That reaction isn't available." };
            const r = room(gid), key = "r:" + user.id, w = wait(r, user.id, key, 350, 40); // reactions have their own, looser limit
            if (w) return { error: "Easy there.", wait: w };
            r.sent.get(key).push(now());
            return { msg: push(gid, { kind: "react", userId: user.id, name: String(user.name ?? "Someone").slice(0, 40), text: emoji }) };
        },
        /** A line from the player itself ("Sam added a song"). */
        note: (gid, text) => push(gid, { kind: "note", text: cleanText(text) }),
        /** Messages after `since`, plus who is here. Asking counts as being here. */
        poll(gid, user, since = 0) {
            const r = room(gid), t = now();
            r.here.set(user.id, { name: String(user.name ?? "Someone").slice(0, 40), avatar: user.avatar ?? null, at: t });
            for (const [k, v] of r.here) if (t - v.at > HERE_MS) r.here.delete(k);
            return { messages: r.msgs.filter(m => m.id > since), last: r.msgs.length ? r.msgs[r.msgs.length - 1].id : since, here: [...r.here].map(([id, v]) => ({ id, name: v.name, avatar: v.avatar })).slice(0, 40) };
        },
        remove(gid, id, { by, mod }) {
            const r = rooms.get(gid), i = r ? r.msgs.findIndex(m => m.id === Number(id)) : -1;
            if (i < 0) return false;
            if (!mod && r.msgs[i].userId !== by) return false;
            r.msgs.splice(i, 1);
            push(gid, { kind: "gone", text: String(id) }); // lets other browsers drop it from the screen
            return true;
        },
        clear(gid) { const r = rooms.get(gid); if (r) r.msgs.length = 0; push(gid, { kind: "clear", text: "" }); },
        sweep() { const t = now(); for (const [k, r] of rooms) if (t - r.last > IDLE_MS) rooms.delete(k); },
        REACTIONS: [...REACTIONS]
    };
}
