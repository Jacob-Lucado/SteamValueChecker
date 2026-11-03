// A guided menu for each command hub (/games, /me, /server, /manage, /bot, /mod).
// It reads the real command definitions, so it can never drift from what the hub actually offers:
// pick an area, pick a command, see how to use it, and run it right there when it needs no input.
import { ButtonBuilder, ButtonStyle } from "discord.js";
import { button, rowOf, select } from "./panel.js";
import { UserError } from "./errors.js";

const COLOR = 0x5865f2;
const TYPE = { 3: "text", 4: "number", 10: "number", 5: "yes/no", 6: "member", 7: "channel", 8: "role", 11: "file" };
const ICON = { games: "🎮", me: "🧑", server: "🏠", manage: "🛠️", bot: "🤖", mod: "🛡️" };
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

export function hubPanel({ json, glance = () => [], dashUrl = null, runner = null }) {
    const hub = json.name;
    const id = `hub-${hub}`;
    const areas = catalog(json);
    const parse = page => {
        const m = /^(?:a(\d+))?(?:\.c(\d+))?$/.exec(page ?? "") ?? [];
        const a = m[1] === undefined ? null : Number(m[1]), c = m[2] === undefined ? null : Number(m[2]);
        const area = a === null ? null : areas[a] ?? null;
        return { a: area ? a : null, area, c: area && c !== null && area.items[c] ? c : null };
    };

    function render(ctx, page, notice) {
        const { a, area, c } = parse(page);
        const item = area && c !== null ? area.items[c] : null;
        const embed = { color: COLOR, footer: { text: "Pick an area, then a command. Typing /" + hub + " and the command name works too." } };
        if (!area) {
            embed.title = `${ICON[hub] ?? "📚"} /${hub}`;
            embed.description = [notice ? `> ${notice}` : null, json.description, ...glance(ctx), "",
                ...areas.map(x => `**${x.label}**  ${x.items.map(i => `\`${i.path[i.path.length - 1]}\``).join(" ")}`)].filter(x => x !== null).join("\n").slice(0, 4000);
        } else if (!item) {
            embed.title = `${ICON[hub] ?? "📚"} /${hub} · ${area.label}`;
            embed.description = [notice ? `> ${notice}` : null, area.desc, "", ...area.items.map(i => `\`${usage(hub, i)}\`\n${i.desc}`)].filter(x => x !== null).join("\n").slice(0, 4000);
        } else {
            embed.title = `/${hub} ${item.path.join(" ")}`;
            embed.description = [notice ? `> ${notice}` : null, item.desc, "", "```", usage(hub, item), "```",
                item.opts.length ? item.opts.map(o => `• **${o.name}**${o.required ? "" : " (optional)"}: ${o.description} · *${TYPE[o.type] ?? "text"}*`).join("\n") : "No options. It runs as is.",
                needsInput(item) ? "\nType it in the chat box to fill in the options." : null].filter(x => x !== null).join("\n").slice(0, 4000);
        }
        const rows = [rowOf(select(id, "area", "", "Choose an area", [{ label: "Overview", value: "home", default: !area }, ...areas.map((x, n) => ({ label: x.label, value: n, description: x.desc, default: n === a }))]))];
        if (area) rows.push(rowOf(select(id, "cmd", String(a), "Choose a command", area.items.map((i, n) => ({ label: i.path.join(" "), value: n, description: i.desc, default: n === c })))));
        const btns = [];
        if (item && runner && !needsInput(item)) btns.push(button(id, "Run it", "run", page, { style: ButtonStyle.Success, emoji: "▶️" }));
        if (area) btns.push(button(id, "Back", "go", item ? `a${a}` : "", {}));
        if (dashUrl) btns.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Open dashboard").setURL(dashUrl));
        if (btns.length) rows.push(rowOf(...btns));
        return { embeds: [embed], components: rows };
    }

    return {
        pages: [["", "Overview"]],
        pageOf: () => "",
        render,
        async handle(ctx, kind, arg, i, values) {
            switch (kind) {
                case "go": return { page: arg };
                case "area": return { page: values[0] === "home" ? "" : `a${values[0]}` };
                case "cmd": return { page: `a${arg}.c${values[0]}` };
                case "run": {
                    const { area, c } = parse(arg);
                    const item = area?.items[c];
                    if (!item || needsInput(item) || !runner) throw new UserError("Type that one in the chat box, it needs some details.");
                    await runner(i, hub, item.path);
                    return { done: true };
                }
            }
            return { page: "" };
        }
    };
}

/** Replays a hub command as if it had been typed, from a button or menu click. Only for commands with no required options. */
export function replayAsCommand(i, hub, path, dispatch) {
    const [group, sub] = path.length === 2 ? path : [null, path[0]];
    const options = new Proxy({}, { get: (_, k) => k === "getSubcommand" ? () => sub : k === "getSubcommandGroup" ? () => group : k === "data" ? [] : (_n, required) => { if (required) throw new UserError("That one needs details. Type it in the chat box."); return null; } });
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
