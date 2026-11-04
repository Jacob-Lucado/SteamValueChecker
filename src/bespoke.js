// Purpose-built panels for the busiest areas: wishlist, library and streaming.
// They read and change data directly where that is simple, and replay the real command (so wording and checks stay
// identical) where the command does more than a database write, like pricing a game or going live.
import { ActionRowBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { button, rowOf, select } from "./panel.js";
import { UserError } from "./errors.js";
import { describeTrigger } from "./alerts.js";
import { ALERT_TYPES } from "./constants.js";
import { readTyped } from "./hubpanel.js";

const COLOR = 0x5865f2;
const PER = 7;
const short = (t, n) => (String(t).length > n ? String(t).slice(0, n - 1) + "…" : String(t));
const field = (id, label, { required = true, max = 100, ph = "", long = false } = {}) => new ActionRowBuilder().addComponents(new TextInputBuilder()
    .setCustomId(id).setLabel(label).setRequired(required).setMaxLength(max).setPlaceholder(ph).setStyle(long ? TextInputStyle.Paragraph : TextInputStyle.Short));
const val = v => ({ v });
const read = (i, k) => { try { return i.fields.getTextInputValue(k).trim(); } catch { return ""; } };

// ---------------------------------------------------------------- wishlist
export function wishlistPanel({ db, replay, back }) {
    const ID = "wl";
    const pageOf = (items, p) => { const pages = Math.max(1, Math.ceil(items.length / PER)); const n = Math.min(Math.max(p, 0), pages - 1); return { n, pages, rows: items.slice(n * PER, n * PER + PER) }; };
    const rule = it => describeTrigger(it);
    function render(ctx, page, notice) {
        const items = ctx.db.listItems(ctx.user.discord_id);
        const m = /^d(\d+)$/.exec(page ?? "");
        const it = m ? items.find(x => x.id === Number(m[1])) : null;
        if (it) {
            return {
                embeds: [{ color: COLOR, title: `${it.priority ? "⭐ " : ""}${it.title}`, description: [notice ? `> ${notice}` : null, `**Alerts when:** ${rule(it)}`, `**Source:** ${it.source === "steam" ? "Steam wishlist" : "added by hand"}`,
                    it.last_alert_at ? `**Last alert:** <t:${Math.floor(it.last_alert_at / 1000)}:R>${it.last_alert_price != null ? ` at ${Number(it.last_alert_price).toFixed(2)}` : ""}` : "No alert sent yet."].filter(Boolean).join("\n") }],
                components: [
                    rowOf(select(ID, "rule", String(it.id), "Change when it alerts", ALERT_TYPES.map(t => ({ label: t.name, value: t.value, default: t.value === it.trigger_type })))),
                    rowOf(button(ID, it.priority ? "Remove star" : "Star it", "star", String(it.id), { emoji: "⭐" }), button(ID, "Price check", "check", String(it.id), { emoji: "💰" }),
                        button(ID, "Remove", "rm", String(it.id), { style: ButtonStyle.Danger, emoji: "🗑️" }), button(ID, "Back to list", "go", "l0"))
                ]
            };
        }
        const { n, pages, rows } = pageOf(items, Number((/^l(\d+)$/.exec(page ?? "") ?? [])[1] ?? 0));
        const lines = rows.map(x => `${x.priority ? "⭐" : "▫️"} **${short(x.title, 60)}**  ${rule(x)}`);
        const comps = [];
        if (rows.length) comps.push(rowOf(select(ID, "pick", "", "Open a game", rows.map(x => ({ label: short(x.title, 100), value: x.id, description: rule(x) })))));
        comps.push(rowOf(button(ID, "◀", "go", `l${n - 1}`, { disabled: n === 0 }), button(ID, `${n + 1} / ${pages}`, "go", `l${n}`, { disabled: true }), button(ID, "▶", "go", `l${n + 1}`, { disabled: n >= pages - 1 }),
            button(ID, "Add a game", "add", "", { style: ButtonStyle.Success, emoji: "➕" }), button(ID, "Menu", "menu", "")));
        comps.push(rowOf(button(ID, "Prices now", "view", "l"), button(ID, "Remove games I own", "cleanup", ""), button(ID, "Import from Steam", "import", "")));
        return { embeds: [{ color: COLOR, title: "Your wishlist", footer: { text: "Open a game to star it, change its alert or remove it." },
            description: [notice ? `> ${notice}` : null, items.length ? `${items.length} games.` : "Nothing here yet. Add a game, or import your Steam wishlist.", "", ...lines].filter(x => x !== null).join("\n") }], components: comps };
    }
    const own = (ctx, id) => { const it = ctx.db.listItems(ctx.user.discord_id).find(x => x.id === Number(id)); if (!it) throw new UserError("That game is not on your wishlist any more."); return it; };
    return {
        pages: [["l0", "List"]], pageOf: arg => (/^\d+/.test(arg) ? `d${/^\d+/.exec(arg)[0]}` : "l0"), render,
        async handle(ctx, kind, arg, i, values) {
            switch (kind) {
                case "go": return { page: arg || "l0" };
                case "menu": return { page: "l0", menuBack: true };
                case "pick": return { page: `d${values[0]}` };
                case "star": { const it = own(ctx, arg); ctx.db.setPriority(ctx.user.discord_id, it.itad_id, !it.priority); return { page: `d${it.id}`, notice: it.priority ? "Star removed." : "Starred. It is listed first and its alerts come through quiet hours." }; }
                case "rm": { const it = own(ctx, arg); ctx.db.removeItem(ctx.user.discord_id, it.itad_id); return { page: "l0", notice: `Removed **${it.title}**.` }; }
                case "check": { const it = own(ctx, arg); await replay(i, "me", ["wishlist", "check"], { game: val(it.title) }); return { done: true }; }
                case "view": await replay(i, "me", ["wishlist", "view"], {}); return { done: true };
                case "cleanup": await replay(i, "me", ["wishlist", "cleanup"], {}); return { done: true };
                case "import": await replay(i, "me", ["wishlist", "import"], {}); return { done: true };
                case "add": return { modal: new ModalBuilder().setCustomId("pn:wl:addm").setTitle("Add a game").addComponents(field("title", "Game title", { ph: "Hades II" })) };
                case "addm": { const t = read(i, "title"); if (!t) throw new UserError("Type a game title."); await replay(i, "me", ["wishlist", "add"], { title: val(t) }); return { done: true }; }
                case "rule": {
                    const it = own(ctx, arg), type = values[0];
                    if (type === "percent" || type === "price") return { modal: new ModalBuilder().setCustomId(`pn:wl:rulem:${it.id}:${type}`).setTitle(type === "percent" ? "Percent off" : "Price").addComponents(field("value", type === "percent" ? "Alert at this percent off or more" : "Alert at this price or lower", { ph: type === "percent" ? "50" : "9.99", max: 10 })) };
                    await replay(i, "me", ["wishlist", "alert"], { type: val(type), game: val(it.title) });
                    return { done: true };
                }
                case "rulem": {
                    const [id, type] = arg.split(":"), it = own(ctx, id);
                    const v = readTyped({ name: "value", type: 10, min_value: 0.01, max_value: 100000 }, read(i, "value"));
                    if (v === undefined) throw new UserError("Type a number.");
                    await replay(i, "me", ["wishlist", "alert"], { type: val(type), value: val(v), game: val(it.title) });
                    return { done: true };
                }
            }
            return { page: "l0" };
        }
    };
}

// ---------------------------------------------------------------- library
const STATUS = [["backlog", "Backlog"], ["playing", "Playing"], ["played", "Played"], ["finished", "Finished"], ["dropped", "Dropped"]];
export function libraryPanel({ db }) {
    const ID = "lib";
    const parse = page => { const m = /^(all|backlog|playing|played|finished|dropped)\.(\d+)(?:\.(\d+))?$/.exec(page ?? ""); return m ? { f: m[1], p: Number(m[2]), pick: m[3] ? Number(m[3]) : null } : { f: "all", p: 0, pick: null }; };
    function render(ctx, page, notice) {
        const all = ctx.db.listLibrary(ctx.user.discord_id);
        const { f, p, pick } = parse(page);
        const counts = Object.fromEntries(STATUS.map(([k]) => [k, all.filter(x => (x.status ?? "backlog") === k).length]));
        const list = f === "all" ? all : all.filter(x => (x.status ?? "backlog") === f);
        const pages = Math.max(1, Math.ceil(list.length / PER)), n = Math.min(p, pages - 1), rows = list.slice(n * PER, n * PER + PER);
        const chosen = pick !== null ? list.find(x => x.id === pick) : null;
        const lines = rows.map(x => `${x.id === chosen?.id ? "👉" : "▫️"} **${short(x.title, 60)}**  ${(x.status ?? "backlog")}`);
        const comps = [
            rowOf(select(ID, "filter", "", "Show", [{ label: `All (${all.length})`, value: "all", default: f === "all" }, ...STATUS.map(([k, l]) => ({ label: `${l} (${counts[k]})`, value: k, default: f === k }))]))
        ];
        if (rows.length) comps.push(rowOf(select(ID, "pick", `${f}.${n}`, "Pick a game to change its status", rows.map(x => ({ label: short(x.title, 100), value: x.id, description: x.status ?? "backlog", default: x.id === chosen?.id })))));
        if (chosen) comps.push(rowOf(select(ID, "status", `${f}.${n}.${chosen.id}`, `Set status for ${short(chosen.title, 60)}`, STATUS.map(([k, l]) => ({ label: l, value: k, default: (chosen.status ?? "backlog") === k })))));
        comps.push(rowOf(button(ID, "◀", "go", `${f}.${n - 1}`, { disabled: n === 0 }), button(ID, `${n + 1} / ${pages}`, "go", `${f}.${n}`, { disabled: true }), button(ID, "▶", "go", `${f}.${n + 1}`, { disabled: n >= pages - 1 }), button(ID, "Menu", "menu", "")));
        return { embeds: [{ color: COLOR, title: "Your library", footer: { text: "Pick a game to mark it playing, finished, dropped and so on." },
            description: [notice ? `> ${notice}` : null, all.length ? STATUS.map(([k, l]) => `${l} **${counts[k]}**`).join(" · ") : "Your library is empty. Link Steam and sync, or add games with `/me library add`.", "", ...lines].filter(x => x !== null).join("\n") }], components: comps };
    }
    return {
        pages: [["all.0", "All"]], pageOf: () => "all.0", render,
        async handle(ctx, kind, arg, i, values) {
            switch (kind) {
                case "go": return { page: arg };
                case "menu": return { page: "all.0", menuBack: true };
                case "filter": return { page: `${values[0]}.0` };
                case "pick": return { page: `${arg}.${values[0]}` };
                case "status": {
                    const [f, p, id] = arg.split("."), row = ctx.db.listLibrary(ctx.user.discord_id).find(x => x.id === Number(id));
                    if (!row) throw new UserError("That game is not in your library any more.");
                    ctx.db.setLibraryStatus(ctx.user.discord_id, row.itad_id, values[0]);
                    return { page: `${f}.${p}.${id}`, notice: `**${row.title}** is now ${values[0]}.` };
                }
            }
            return { page: "all.0" };
        }
    };
}

// ---------------------------------------------------------------- streaming
export function streamPanel({ db, replay }) {
    const ID = "strm";
    function render(ctx, page, notice) {
        const g = ctx.i?.guildId ?? ctx.user.guild_id, live = g ? db.listStreamLive(g) : [], mine = g ? db.getStreamLink(g, ctx.user.discord_id) : null;
        const me = live.find(x => x.user_id === ctx.user.discord_id);
        const lines = live.slice(0, 8).map(x => `🔴 <@${x.user_id}> ${short(x.title, 60)}${x.game ? ` · ${x.game}` : ""}\n${x.url}`);
        return { embeds: [{ color: 0x9146ff, title: "Streaming", footer: { text: "Go live, give a key to your viewers, or get chat commands for your stream." },
            description: [notice ? `> ${notice}` : null, g ? null : "Open this in a server to use it.", `**You:** ${me ? "live now" : mine ? "channel linked, not live" : "no channel linked yet"}`, "", live.length ? lines.join("\n") : "Nobody is live right now."].filter(x => x !== null).join("\n").slice(0, 4000) }],
            components: [
                rowOf(button(ID, "Go live", "live", "", { style: ButtonStyle.Success, emoji: "🔴" }), button(ID, "End stream", "end", "", { disabled: !me, emoji: "⏹️" }), button(ID, "Link my channel", "link", "", { emoji: "🔗" }), button(ID, "Unlink", "unlink", "", { disabled: !mine })),
                rowOf(button(ID, "Give a key away", "gw", "", { emoji: "🎁", disabled: !me }), button(ID, "Chat commands", "chat", "", { emoji: "💬" }), button(ID, "Live pings on/off", "ping", "", { emoji: "🔔" }), button(ID, "Menu", "menu", ""))
            ] };
    }
    const modal = (id, title, ...fields) => new ModalBuilder().setCustomId(`pn:strm:${id}`).setTitle(title).addComponents(...fields);
    const run = (i, sub, vals) => replay(i, "server", ["stream", sub], vals);
    return {
        live: true, pages: [["", "Streaming"]], pageOf: () => "", render,
        async handle(ctx, kind, arg, i) {
            switch (kind) {
                case "go": return { page: "" };
                case "menu": return { page: "", menuBack: true };
                case "live": return { modal: modal("livem", "Go live", field("link", "Your stream link", { ph: "https://twitch.tv/you", max: 200 }), field("title", "Title (optional)", { required: false, max: 100 }), field("game", "Game (optional)", { required: false, max: 100 })) };
                case "livem": { const v = { link: val(read(i, "link")) }; for (const k of ["title", "game"]) if (read(i, k)) v[k] = val(read(i, k)); await run(i, "live", v); return { done: true }; }
                case "end": await run(i, "end", {}); return { done: true };
                case "link": return { modal: modal("linkm", "Link your channel", field("channel", "Your Twitch, Kick or YouTube channel", { ph: "https://twitch.tv/you", max: 200 })) };
                case "linkm": await run(i, "link", { channel: val(read(i, "channel")) }); return { done: true };
                case "unlink": await run(i, "unlink", {}); return { done: true };
                case "gw": return { modal: modal("gwm", "Give a key away", field("game", "Game", { max: 100 }), field("key", "The key (it stays private)", { max: 200 }), field("minutes", "Minutes to enter (optional)", { required: false, max: 4 })) };
                case "gwm": { const v = { game: val(read(i, "game")), key: val(read(i, "key")) }; if (read(i, "minutes")) v.minutes = val(readTyped({ name: "minutes", type: 4, min_value: 1, max_value: 600 }, read(i, "minutes"))); await run(i, "giveaway", v); return { done: true }; }
                case "chat": await run(i, "chat", {}); return { done: true };
                case "ping": return { modal: modal("pingm", "Live pings", field("on", "Type yes to get pinged, no to stop", { ph: "yes", max: 3 })) };
                case "pingm": { const t = read(i, "on").toLowerCase(); if (!["yes", "no", "y", "n"].includes(t)) throw new UserError("Type yes or no."); await run(i, "ping", { enabled: val(t.startsWith("y")) }); return { done: true }; }
            }
            return { page: "" };
        }
    };
}
