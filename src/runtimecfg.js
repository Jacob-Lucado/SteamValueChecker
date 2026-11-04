// Settings the bot owner can change while the bot is running, from the admin panel. Anything not changed keeps its default.
// Stored as one JSON value, so there is nothing to migrate when a setting is added: it just has its default until someone sets it.
import { UserError } from "./errors.js";

export const AI_MODELS = [
    ["claude-haiku-5-5", "Haiku 5.5: fastest and cheapest"],
    ["claude-sonnet-5-5", "Sonnet 5.5: smarter, costs more"],
    ["claude-opus-5-5", "Opus 5.5: the most capable, costs the most"]
];

export const GROUPS = {
    ai: "AI companion",
    profiles: "Public profiles",
    trap: "Trap channels",
    site: "Site notice"
};

/** Every adjustable setting. `type` is bool, int, enum, text (several lines) or line (one line). */
export const SETTINGS = [
    { key: "ai_enabled", group: "ai", type: "bool", def: true, label: "AI companion on", help: "The master switch. Off, every server's AI companion goes quiet at once, whatever the servers chose." },
    { key: "ai_model", group: "ai", type: "line", def: "claude-haiku-5-5", maxLen: 80, label: "Model", help: "Which model writes the answers. Pick one of the usual ones or paste any model name your key can use." },
    { key: "ai_daily_cap", group: "ai", type: "int", def: 300, min: 1, max: 5000, label: "Answers per server per day", help: "The most answers one server can get in a (UTC) day. You can give a single server a different number below." },
    { key: "ai_cooldown", group: "ai", type: "int", def: 15, min: 3, max: 600, label: "Seconds between questions", help: "How long one person waits before they can ask again." },
    { key: "ai_max_question", group: "ai", type: "int", def: 700, min: 50, max: 2000, label: "Longest question (characters)", help: "Longer questions are cut off here." },
    { key: "ai_max_tokens", group: "ai", type: "int", def: 500, min: 100, max: 1500, label: "Longest answer (tokens)", help: "About 4 characters per token. Discord messages end at 2000 characters, so the answer is also cut at that." },
    { key: "ai_history", group: "ai", type: "int", def: 6, min: 0, max: 12, label: "Messages it remembers in a thread", help: "When someone replies to an answer, this many earlier messages of the thread go along. 0 makes every question stand alone." },
    { key: "ai_tone", group: "ai", type: "enum", def: "friendly", options: [["friendly", "Friendly gamer"], ["concise", "Short and to the point"], ["playful", "Playful and jokey"], ["professional", "Calm and professional"]], label: "Tone", help: "How it talks." },
    { key: "ai_extra", group: "ai", type: "text", def: "", maxLen: 1000, label: "Extra instructions", help: "Added to what the AI is told. For example: 'Our server is about co-op games. Suggest those first.'" },
    { key: "ai_plus_cap", group: "ai", type: "int", def: 2000, min: 1, max: 50000, label: "AI Plus answers per server per day", help: "The daily limit for servers you gave AI Plus (the subscription, still a work in progress). Your own server is never limited." },
    { key: "ai_plus_visible", group: "ai", type: "bool", def: true, label: "Show the AI Plus preview to server managers", help: "A small 'coming soon' box in the dashboard, with a button to say they are interested." },
    { key: "ai_react", group: "ai", type: "bool", def: true, label: "React with ⏳ when someone asks too fast", help: "Off, a question during the cooldown is ignored with no reaction." },
    { key: "ai_ping_reply", group: "ai", type: "bool", def: false, label: "Ping the person in its replies", help: "Replies are sent as a reply to the question. This also pings the asker." },
    { key: "ai_limit_notice", group: "ai", type: "bool", def: true, label: "Say so when a server reaches its daily limit", help: "Off, it just goes quiet for the rest of the day." },
    { key: "profiles_enabled", group: "profiles", type: "bool", def: true, label: "Public profile pages are visible", help: "Off, every /u/ page shows as unavailable. Nothing is deleted. Use it if something goes wrong." },
    { key: "profile_songs", group: "profiles", type: "bool", def: true, label: "Profile songs play", help: "Off, profile pages show no song player." },
    { key: "trap_enabled", group: "trap", type: "bool", def: true, label: "Trap channels ban", help: "Off, nobody is banned for posting in a trap channel (the message is still removed). Handy while you test." },
    { key: "trap_delete_days", group: "trap", type: "int", def: 1, min: 0, max: 7, label: "Days of messages removed with a ban", help: "How much of a trap-banned account's history is deleted. 0 keeps it." },
    { key: "notice_text", group: "site", type: "line", def: "", maxLen: 240, label: "Notice at the top of the dashboard", help: "Shown to everyone above every page. Leave empty for none." },
    { key: "notice_level", group: "site", type: "enum", def: "info", options: [["info", "Information"], ["warn", "Warning"]], label: "Notice style", help: "Warnings are yellow." }
];
const BY_KEY = new Map(SETTINGS.map(s => [s.key, s]));

const KEY = "rt:v1";
const EMPTY = () => ({ values: {}, blockedUsers: [], blockedServers: [], serverCaps: {} });
const ID = /^\d{5,25}$/;

export function createRuntimeCfg(db, defaults = {}) {
    const read = () => { try { return { ...EMPTY(), ...JSON.parse(db.getMeta(KEY) ?? "{}") }; } catch { return EMPTY(); } };
    const write = state => db.setMeta(KEY, JSON.stringify(state));
    const def = s => (defaults[s.key] !== undefined ? defaults[s.key] : s.def);

    function get(key) {
        const s = BY_KEY.get(key);
        if (!s) throw new Error(`unknown setting ${key}`);
        const v = read().values[key];
        return v === undefined ? def(s) : v;
    }

    function clean(s, v) {
        if (s.type === "bool") return Boolean(v);
        if (s.type === "int") {
            const n = Number(v);
            if (!Number.isInteger(n) || n < s.min || n > s.max) throw new UserError(`${s.label} must be a whole number from ${s.min} to ${s.max}.`);
            return n;
        }
        if (s.type === "enum") {
            if (!s.options.some(([o]) => o === v)) throw new UserError(`Pick one of the choices for ${s.label}.`);
            return v;
        }
        const t = String(v ?? "").replace(/\r/g, "").trim();
        const text = s.type === "line" ? t.replace(/\s*\n\s*/g, " ") : t;
        if (text.length > s.maxLen) throw new UserError(`${s.label} can be up to ${s.maxLen} characters.`);
        return text;
    }

    /** Changes several settings at once; nothing is saved if one of them is not valid. Returns the keys that changed. */
    function set(patch) {
        const state = read(), changed = [];
        for (const [k, v] of Object.entries(patch ?? {})) {
            const s = BY_KEY.get(k);
            if (!s) throw new UserError(`There is no setting called ${k}.`);
            const val = clean(s, v);
            if (JSON.stringify(state.values[k] ?? def(s)) !== JSON.stringify(val)) changed.push(k);
            if (JSON.stringify(val) === JSON.stringify(def(s))) delete state.values[k]; else state.values[k] = val;
        }
        write(state);
        return changed;
    }

    /** Everything the admin page shows. */
    function view() {
        const state = read();
        return {
            settings: SETTINGS.map(s => ({ key: s.key, group: s.group, type: s.type, label: s.label, help: s.help, min: s.min, max: s.max, maxLen: s.maxLen, options: s.options, default: def(s), value: state.values[s.key] === undefined ? def(s) : state.values[s.key] })),
            groups: GROUPS, models: AI_MODELS,
            blockedUsers: state.blockedUsers, blockedServers: state.blockedServers, serverCaps: state.serverCaps
        };
    }

    function listOp(name, id, on) {
        if (!ID.test(String(id ?? ""))) throw new UserError("That does not look like a Discord ID (a long number).");
        const state = read(), list = new Set(state[name]);
        on ? list.add(String(id)) : list.delete(String(id));
        if (list.size > 500) throw new UserError("That list is full.");
        state[name] = [...list];
        write(state);
    }
    const blockUser = (id, on = true) => listOp("blockedUsers", id, on);
    const blockServer = (id, on = true) => listOp("blockedServers", id, on);
    const isUserBlocked = id => read().blockedUsers.includes(String(id));
    const isServerBlocked = id => read().blockedServers.includes(String(id));

    /** A server's own daily limit, or null to follow the general one. */
    function setServerCap(id, cap) {
        if (!ID.test(String(id ?? ""))) throw new UserError("That does not look like a server ID.");
        const state = read();
        if (cap === null || cap === "" || cap === undefined) delete state.serverCaps[id];
        else {
            const n = Number(cap);
            if (!Number.isInteger(n) || n < 0 || n > 50000) throw new UserError("A server's limit is a whole number from 0 to 50000.");
            state.serverCaps[id] = n;
        }
        write(state);
    }
    const serverCap = id => { const v = read().serverCaps[String(id)]; return Number.isInteger(v) ? v : null; };

    return { get, set, view, blockUser, blockServer, isUserBlocked, isServerBlocked, setServerCap, serverCap };
}
