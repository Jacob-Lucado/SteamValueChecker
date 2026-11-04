// A guided menu for each command hub (/games, /me, /server, /manage, /bot, /mod).
// It reads the real command definitions, so it can never drift from what the hub actually offers:
// pick an area, pick a command, see how to use it, and run it right there when it needs no input.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, MentionableSelectMenuBuilder, ModalBuilder, RoleSelectMenuBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder } from "discord.js";
import { button, pid, rowOf, select } from "./panel.js";
import { UserError } from "./errors.js";

const COLOR = 0x5865f2;
const TYPE = { 3: "text", 4: "number", 10: "number", 5: "yes/no", 6: "member", 7: "channel", 8: "role", 11: "file" };
const ICON = { music: "🎵", games: "🎮", me: "🧑", server: "🏠", manage: "🛠️", bot: "🤖", mod: "🛡️" };
const MENU = { type: 1, name: "menu", description: "Open the guided menu: browse every command here and run it" };
export { MENU };

/** Turns a hub's command JSON into areas: [{ key, label, items: [{ path, desc, opts }] }]. */
export function catalog(json) {
    const flat = [], areas = [];
    for (const o of json.options ?? []) {
        if (o.name === "menu") continue;
        if (o.type === 1) flat.push({ path: [o.name], desc: o.description, opts: o.options ?? [] });
        else if (o.type === 2) areas.push({ key: o.name, label: o.name, desc: o.description, items: (o.options ?? []).map(s => ({ path: [o.name, s.name], desc: s.description, opts: s.options ?? [] })) });
    }
    return [...(flat.length ? [{ key: "main", label: "Everyday", desc: `The main ${json.name} commands`, items: flat }] : []), ...areas];
}

export const usage = (hub, item) => {
    const bits = item.opts.map(o => (o.required ? `<${o.name}>` : `[${o.name}]`));
    return `/${hub} ${item.path.join(" ")}${bits.length ? " " + bits.join(" ") : ""}`;
};
export const needsInput = item => item.opts.some(o => o.required);

const isText = o => [3, 4, 10].includes(o.type) && !(o.choices?.length);
const isFile = o => o.type === 11;
const FORM_TTL = 30 * 60_000;
const short = (t, n) => (String(t).length > n ? String(t).slice(0, n - 1) + "…" : String(t));

function shown(o, st) {
    if (!st) return null;
    if (o.type === 6) return `<@${st.v}>`;
    if (o.type === 7) return `<#${st.v}>`;
    if (o.type === 8) return `<@&${st.v}>`;
    if (o.type === 5) return st.v ? "Yes" : "No";
    const ch = o.choices?.find(c => c.value === st.v);
    return short(ch ? ch.name : st.v, 120);
}

/** Reads a typed value for a text or number option; throws UserError with a plain reason. */
export function readTyped(o, raw) {
    const t = String(raw ?? "").trim();
    if (!t) return undefined;
    if (o.type === 3) {
        if (o.max_length && t.length > o.max_length) throw new UserError(`${o.name} can be at most ${o.max_length} characters.`);
        if (o.min_length && t.length < o.min_length) throw new UserError(`${o.name} needs at least ${o.min_length} characters.`);
        return t;
    }
    const n = Number(t.replace(",", "."));
    if (!Number.isFinite(n)) throw new UserError(`${o.name} should be a number.`);
    if (o.type === 4 && !Number.isInteger(n)) throw new UserError(`${o.name} should be a whole number.`);
    if (o.min_value !== undefined && n < o.min_value) throw new UserError(`${o.name} must be at least ${o.min_value}.`);
    if (o.max_value !== undefined && n > o.max_value) throw new UserError(`${o.name} must be at most ${o.max_value}.`);
    return n;
}

/** The panel's own area index, so a purpose-built panel can send people back to it. */
export const areaIndex = (json, key) => catalog(json).findIndex(a => a.key === key);

export function hubPanel({ json, glance = () => [], areaGlance = () => [], dashUrl = null, runner = null, bespoke = {} }) {
    const hub = json.name;
    const id = `hub-${hub}`;
    const areas = catalog(json);
    const forms = new Map(); // userId -> { key, at, vals: { optionName: { v, obj } } }
    const parse = page => {
        const m = /^(?:a(\d+))?(?:\.c(\d+))?(?:\.o(\d+))?$/.exec(page ?? "") ?? [];
        const a = m[1] === undefined ? null : Number(m[1]);
        const area = a === null ? null : areas[a] ?? null;
        const c = area && m[2] !== undefined && area.items[Number(m[2])] ? Number(m[2]) : null;
        const item = c === null ? null : area.items[c];
        const k = item && m[3] !== undefined && item.opts[Number(m[3])] ? Number(m[3]) : null;
        return { a: area ? a : null, area, c, item, k };
    };
    const formFor = (ctx, a, c) => {
        const key = `${a}.${c}`, f = forms.get(ctx.user.discord_id);
        if (f && f.key === key && Date.now() - f.at < FORM_TTL) { f.at = Date.now(); return f; }
        const fresh = { key, at: Date.now(), vals: {} };
        forms.set(ctx.user.discord_id, fresh);
        return fresh;
    };
    const quick = area => area.items.map((x, n) => [x, n]).filter(([x]) => !needsInput(x)).slice(0, 4);

    function formView(ctx, a, c, item, k, notice) {
        const f = formFor(ctx, a, c), page = `a${a}.c${c}`;
        const lines = item.opts.map(o => {
            const st = f.vals[o.name];
            const t = TYPE[o.type] ?? "text";
            return st ? `✅ **${o.name}**: ${shown(o, st)}` : `${o.required ? "🔸" : "▫️"} **${o.name}** ${o.required ? "(needed)" : "(optional)"}: ${short(o.description, 90)} · *${t}*`;
        });
        const missing = item.opts.filter(o => o.required && !f.vals[o.name] && !isFile(o));
        const embed = { color: COLOR, title: `/${hub} ${item.path.join(" ")}`, footer: { text: "Fill in what you need, then press Run. Nothing happens until you do." },
            description: [notice ? `> ${notice}` : null, item.desc, "", ...lines, "", missing.length ? `Still needed: ${missing.map(o => `**${o.name}**`).join(", ")}` : "Ready to run."].filter(x => x !== null).join("\n").slice(0, 4000) };
        const rows = [rowOf(select(id, "opt", `${a}.${c}`, "Pick an option to fill in", item.opts.map((o, n) => ({ label: `${f.vals[o.name] ? "✅ " : ""}${o.name}`, value: n, description: o.description, default: n === k }))))];
        const o = k === null ? null : item.opts[k];
        if (o && !isText(o) && !isFile(o)) {
            const arg = `${a}.${c}.${k}`;
            if (o.type === 6) rows.push(rowOf(new UserSelectMenuBuilder().setCustomId(pid(id, "set", arg)).setPlaceholder(`Choose ${o.name}`)));
            else if (o.type === 7) { const m = new ChannelSelectMenuBuilder().setCustomId(pid(id, "set", arg)).setPlaceholder(`Choose ${o.name}`); if (o.channel_types?.length) m.setChannelTypes(o.channel_types); rows.push(rowOf(m)); }
            else if (o.type === 8) rows.push(rowOf(new RoleSelectMenuBuilder().setCustomId(pid(id, "set", arg)).setPlaceholder(`Choose ${o.name}`)));
            else if (o.type === 9) rows.push(rowOf(new MentionableSelectMenuBuilder().setCustomId(pid(id, "set", arg)).setPlaceholder(`Choose ${o.name}`)));
            else if (o.type === 5) rows.push(rowOf(select(id, "set", arg, `${o.name}: yes or no`, [{ label: "Yes", value: "1" }, { label: "No", value: "0" }])));
            else if (o.choices?.length) rows.push(rowOf(select(id, "set", arg, `Choose ${o.name}`, o.choices.slice(0, 25).map(ch => ({ label: ch.name, value: String(ch.value), default: f.vals[o.name]?.v === ch.value })))));
        }
        const texts = item.opts.filter(isText);
        const btns = [button(id, "Run", "run", page, { style: ButtonStyle.Success, emoji: "▶️", disabled: !runner || missing.length > 0 })];
        if (texts.length > 1) btns.push(button(id, "Type several", "textform", page, { emoji: "✏️" }));
        btns.push(button(id, "Clear", "clear", page), button(id, "Back", "go", `a${a}`));
        rows.push(rowOf(...btns));
        return { embeds: [embed], components: rows };
    }

    function render(ctx, page, notice) {
        const { a, area, c, item, k } = parse(page);
        if (item && item.opts.length) return formView(ctx, a, c, item, k, notice);
        const embed = { color: COLOR, footer: { text: "Pick an area, then a command. Typing /" + hub + " and the command name works too." } };
        if (!area) {
            embed.title = `${ICON[hub] ?? "📚"} /${hub}`;
            embed.description = [notice ? `> ${notice}` : null, json.description, ...glance(ctx), "",
                ...areas.map(x => `**${x.label}**  ${x.items.map(i => `\`${i.path[i.path.length - 1]}\``).join(" ")}`)].filter(x => x !== null).join("\n").slice(0, 4000);
        } else if (!item) {
            embed.title = `${ICON[hub] ?? "📚"} /${hub} · ${area.label}`;
            embed.description = [notice ? `> ${notice}` : null, area.desc, ...(areaGlance(ctx, area.key).length ? ["", ...areaGlance(ctx, area.key)] : []), "", ...area.items.map(i => `**${i.path.join(" ")}**${needsInput(i) ? " ✏️" : ""}  ${i.desc}`)].filter(x => x !== null).join("\n").slice(0, 4000);
        } else {
            embed.title = `/${hub} ${item.path.join(" ")}`;
            embed.description = [notice ? `> ${notice}` : null, item.desc, "", "No options. Press Run."].filter(x => x !== null).join("\n");
        }
        const rows = [rowOf(select(id, "area", "", "Choose an area", [{ label: "Overview", value: "home", default: !area }, ...areas.map((x, n) => ({ label: x.label, value: n, description: x.desc, default: n === a }))]))];
        if (area) rows.push(rowOf(select(id, "cmd", String(a), "Choose a command (✏️ ones ask for details)", area.items.map((i, n) => ({ label: `${needsInput(i) ? "✏️ " : ""}${i.path.join(" ")}`, value: n, description: i.desc, default: n === c })))));
        const btns = [];
        if (item && runner) btns.push(button(id, "Run", "run", page, { style: ButtonStyle.Success, emoji: "▶️" }));
        else if (area && runner) for (const [x, n] of quick(area).slice(0, bespoke[area.key] ? 3 : 4)) btns.push(button(id, x.path[x.path.length - 1], "run", `a${a}.c${n}`, { style: ButtonStyle.Secondary }));
        if (!item && area && bespoke[area.key]) btns.unshift(button(bespoke[area.key][0], bespoke[area.key][1], "go", "", { style: ButtonStyle.Primary, emoji: "🧩" }));
        if (item) btns.push(button(id, "Back", "go", `a${a}`));
        if (dashUrl && (!area || area.page)) btns.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Open dashboard").setURL(dashUrl));
        if (btns.length) rows.push(rowOf(...btns.slice(0, 5)));
        return { embeds: [embed], components: rows };
    }

    function textModal(page, item, only) {
        const opts = (only === null ? item.opts.filter(isText) : [item.opts[only]]).slice(0, 5);
        const m = new ModalBuilder().setCustomId(pid(id, "fm", only === null ? page : `${page}.o${only}`)).setTitle(short(`/${hub} ${item.path.join(" ")}`, 45));
        return m.addComponents(...opts.map(o => new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(o.name).setLabel(short(o.name, 45)).setStyle(o.max_length > 200 ? TextInputStyle.Paragraph : TextInputStyle.Short)
            .setRequired(!!o.required).setPlaceholder(short(o.description, 100)).setMaxLength(Math.min(o.max_length ?? 400, 4000)))));
    }

    return {
        live: true, remember: true,
        pages: [["", "Overview"]],
        pageOf: arg => (/^a\d+(\.c\d+)?/.exec(arg ?? "")?.[0] ?? ""),
        render,
        async handle(ctx, kind, arg, i, values) {
            const nums = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(arg); // "set" and "opt" carry plain numbers: area.command.option
            const here = parse(nums ? `a${nums[1]}.c${nums[2]}${nums[3] !== undefined ? `.o${nums[3]}` : ""}` : arg);
            switch (kind) {
                case "go": return { page: arg };
                case "area": return { page: values[0] === "home" ? "" : `a${values[0]}` };
                case "cmd": return { page: `a${arg}.c${values[0]}` };
                case "opt": {
                    const { a, c, item } = here;
                    const o = item.opts[Number(values[0])];
                    if (isFile(o)) return { page: `a${a}.c${c}`, notice: `**${o.name}** needs a file. Type this command in the chat box to attach one.` };
                    if (isText(o)) return { modal: textModal(`a${a}.c${c}`, item, Number(values[0])) };
                    return { page: `a${a}.c${c}.o${values[0]}` };
                }
                case "textform": return { modal: textModal(arg, here.item, null) };
                case "set": {
                    const o = here.item.opts[here.k], f = formFor(ctx, here.a, here.c);
                    if (o.type === 6) f.vals[o.name] = { v: i.users.first().id, obj: i.users.first(), member: i.members?.first() };
                    else if (o.type === 7) f.vals[o.name] = { v: i.channels.first().id, obj: i.channels.first() };
                    else if (o.type === 8) f.vals[o.name] = { v: i.roles.first().id, obj: i.roles.first() };
                    else if (o.type === 9) f.vals[o.name] = { v: values[0], obj: i.roles?.first() ?? i.users?.first() };
                    else if (o.type === 5) f.vals[o.name] = { v: values[0] === "1" };
                    else { const ch = o.choices.find(x => String(x.value) === values[0]); f.vals[o.name] = { v: ch?.value ?? values[0] }; }
                    return { page: `a${here.a}.c${here.c}` };
                }
                case "fm": {
                    const m = /^(a\d+\.c\d+)(?:\.o(\d+))?$/.exec(arg), pg = parse(m[1]);
                    const f = formFor(ctx, pg.a, pg.c);
                    const list = m[2] === undefined ? pg.item.opts.filter(isText) : [pg.item.opts[Number(m[2])]];
                    for (const o of list.slice(0, 5)) {
                        let raw = ""; try { raw = i.fields.getTextInputValue(o.name); } catch {}
                        const v = readTyped(o, raw);
                        if (v === undefined) delete f.vals[o.name]; else f.vals[o.name] = { v };
                    }
                    return { page: m[1] };
                }
                case "clear": forms.delete(ctx.user.discord_id); return { page: arg, notice: "Cleared." };
                case "run": {
                    const { item, a, c } = here;
                    if (!item || !runner) throw new UserError("That one is not available here. Type it in the chat box.");
                    const f = item.opts.length ? formFor(ctx, a, c) : { vals: {} };
                    const miss = item.opts.filter(o => o.required && !f.vals[o.name]);
                    if (miss.length) throw new UserError(`Still needed: ${miss.map(o => o.name).join(", ")}.`);
                    await runner(i, hub, item.path, f.vals);
                    forms.delete(ctx.user.discord_id);
                    return { done: true };
                }
            }
            return { page: "" };
        }
    };
}

/** Replays a hub command as if it had been typed, from a button or menu click, with the options the person filled in. */
export function replayAsCommand(i, hub, path, dispatch, vals = {}) {
    const [group, sub] = path.length === 2 ? path : [null, path[0]];
    const val = n => vals[n]?.v ?? null;
    const need = (n, req) => { const v = val(n); if (v === null && req) throw new UserError(`${n} is needed. Fill it in on the panel.`); return v; };
    const getters = {
        getSubcommand: () => sub, getSubcommandGroup: () => group, data: [],
        getString: need, getInteger: need, getNumber: need, getBoolean: need,
        getUser: (n, req) => { need(n, req); return vals[n]?.obj ?? null; },
        getMember: n => vals[n]?.member ?? null,
        getChannel: (n, req) => { need(n, req); return vals[n]?.obj ?? null; },
        getRole: (n, req) => { need(n, req); return vals[n]?.obj ?? null; },
        getMentionable: n => vals[n]?.obj ?? null, getAttachment: () => null,
        get: n => (vals[n] ? { name: n, value: vals[n].v } : null)
    };
    const options = new Proxy({}, { get: (_, k) => (k in getters ? getters[k] : () => null) });
    const off = new Set(["isAutocomplete", "isButton", "isAnySelectMenu", "isStringSelectMenu", "isModalSubmit", "isUserContextMenuCommand", "isMessageContextMenuCommand"]);
    const px = new Proxy(i, { get(t, k) {
        if (k === "commandName") return hub;
        if (k === "options") return options;
        if (k === "isChatInputCommand") return () => true;
        if (off.has(k)) return () => false;
        const v = t[k]; return typeof v === "function" ? v.bind(t) : v;
    } });
    return dispatch(px, true);
}

// Dashboard page that does the same job as each command area, so the Help page can link straight to it.
const DASH_PAGE = {
    "games/main": "deals", "games/saleprep": "warroom", "games/codes": "codes",
    "me/main": "mypage", "me/wishlist": "wishlist", "me/library": "library", "me/steam": "steam", "me/friend": "friends", "me/mydata": "mydata",
    "server/main": "servers", "server/giveaway": "giveaways", "server/promos": "codes", "server/serverlist": "servers", "server/lfg": "lfg", "server/calendar": "calendar", "server/invites": "community", "server/stream": "streamer",
    "manage/main": "setup", "manage/community": "community", "manage/alertchannel": "servers", "manage/emoji": "community", "manage/memes": "community",
    "bot/main": "help", "bot/support": "support", "bot/feature": "requests",
    "mod/main": "mod", "alerts/main": "alerts", "music/main": "music"
};

/** What the dashboard's Help page shows: every hub, its areas, and how to use each command. */
export function commandGuide(jsons) {
    return jsons.filter(j => ["games", "me", "server", "manage", "bot", "mod", "alerts", "music"].includes(j.name)).map(j => ({
        name: j.name, description: j.description, menu: j.name !== "alerts" && j.name !== "music",
        areas: catalog(j).map(a => ({
            label: a.label, desc: a.desc, page: DASH_PAGE[`${j.name}/${a.key}`] ?? null,
            items: a.items.map(i => ({ usage: usage(j.name, i), desc: i.desc, options: i.opts.map(o => ({ name: o.name, required: !!o.required, desc: o.description })) }))
        }))
    }));
}
