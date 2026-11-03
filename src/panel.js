// Small framework for interactive panels: one slash command opens a private embed with buttons and dropdowns.
// A panel is { title, pages, render(ctx, page, notice) -> {embeds, components}, handle(ctx, kind, arg, i, values) }.
// Component ids look like pn:<panel>:<kind>:<arg>, so one router in index.js serves every panel.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, StringSelectMenuBuilder } from "discord.js";
import { UserError } from "./errors.js";

export const PANEL_PREFIX = "pn:";
export const pid = (panel, kind, arg = "") => `${PANEL_PREFIX}${panel}:${kind}${arg === "" ? "" : `:${arg}`}`;

export function button(panel, label, kind, arg, { style = ButtonStyle.Secondary, emoji, disabled = false } = {}) {
    const b = new ButtonBuilder().setCustomId(pid(panel, kind, arg)).setLabel(label).setStyle(style).setDisabled(disabled);
    if (emoji) b.setEmoji(emoji);
    return b;
}

/** options: [{label, value, description?, default?}] */
export function select(panel, kind, arg, placeholder, options, { min = 1, max = 1 } = {}) {
    return new StringSelectMenuBuilder().setCustomId(pid(panel, kind, arg)).setPlaceholder(placeholder)
        .setMinValues(min).setMaxValues(Math.min(max, options.length))
        .addOptions(options.map(o => ({ label: o.label.slice(0, 100), value: String(o.value), ...(o.description ? { description: o.description.slice(0, 100) } : {}), default: !!o.default })));
}

export const rowOf = (...items) => new ActionRowBuilder().addComponents(...items);

/** Nav buttons: the current page is highlighted. pages: [[key, label]] */
export function navRow(panel, pages, current, extra = []) {
    return rowOf(...pages.map(([key, label]) => button(panel, label, "go", key, { style: key === current ? ButtonStyle.Primary : ButtonStyle.Secondary })), ...extra);
}

export function createPanels({ db }) {
    const reg = new Map();
    const mkCtx = i => ({ db, i, user: db.ensureUser(i.user.id, i.guildId) });

    async function open(i, id, page, notice) {
        const p = reg.get(id);
        const ctx = mkCtx(i);
        const view = await p.render(ctx, page ?? p.pages[0][0], notice);
        return i.reply({ ...view, flags: MessageFlags.Ephemeral });
    }

    async function handle(i) {
        const [, id, kind, ...rest] = i.customId.split(":");
        const arg = rest.join(":");
        const p = reg.get(id);
        if (!p) return i.reply({ content: "That panel is out of date. Run the command again.", flags: MessageFlags.Ephemeral });
        const ctx = mkCtx(i);
        let out = { page: p.pages[0][0] };
        try {
            out = (await p.handle(ctx, kind, arg, i, i.values ?? [])) ?? out;
        } catch (err) {
            if (!(err instanceof UserError)) { console.error(`panel ${id}:`, err); out = { page: p.pageOf?.(arg) ?? p.pages[0][0], notice: "Something went wrong. Try again in a moment." }; }
            else out = { page: p.pageOf?.(arg) ?? p.pages[0][0], notice: err.message };
        }
        if (out.done) return;
        if (out.modal) return i.showModal(out.modal);
        const view = await p.render(mkCtx(i), out.page, out.notice);
        return i.update(view);
    }

    return { register: (id, panel) => reg.set(id, panel), open, handle, has: id => reg.has(id) };
}
