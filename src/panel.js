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

const LIVE_FOR = 10 * 60_000;
export function createPanels({ db, tickMs = 30_000 }) {
    const reg = new Map();
    const live = new Map(); // userId -> { i, mid, id, page, until }: the one panel on screen that keeps itself fresh
    const mkCtx = i => ({ db, i, user: db.ensureUser(i.user.id, i.guildId) });
    const metaKey = (uid, id) => `pnlast:${uid}:${id}`;

    async function open(i, id, page, notice) {
        const p = reg.get(id);
        const ctx = mkCtx(i);
        let at = page;
        if (at === undefined && p.remember) { try { at = db.getMeta?.(metaKey(i.user.id, id)) ?? undefined; } catch { /* a missing note is fine */ } }
        at = at ?? p.pages[0][0];
        const view = await p.render(ctx, at, notice);
        await i.reply({ ...view, flags: MessageFlags.Ephemeral });
        if (p.live) {
            const entry = { i, mid: null, id, page: at, until: Date.now() + LIVE_FOR };
            live.set(i.user.id, entry);
            Promise.resolve(i.fetchReply?.()).then(m => { entry.mid = m?.id ?? null; }).catch(() => {});
        }
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
        const target = out.menuBack && p.back ? reg.get(p.back.id) : p;
        const tid = out.menuBack && p.back ? p.back.id : id;
        const at = out.menuBack && p.back ? p.back.page : out.page;
        const view = await target.render(mkCtx(i), at, out.notice);
        if (target.remember && typeof at === "string") { try { db.setMeta?.(metaKey(i.user.id, tid), at.replace(/\.c.*$/, "")); } catch { /* best effort */ } }
        const e = live.get(i.user.id);
        if (e && e.mid && i.message?.id === e.mid) { e.id = tid; e.page = at; e.until = Date.now() + LIVE_FOR; }
        return i.update(view);
    }

    /** Re-draws panels people have left open (live counts, who is streaming). Skips forms so nothing is overwritten mid-typing. */
    async function tick(now = Date.now()) {
        for (const [uid, e] of [...live]) {
            const p = reg.get(e.id);
            if (now > e.until || !p?.live) { live.delete(uid); continue; }
            if (/\.c\d/.test(String(e.page)) || !e.mid) continue;
            try { await e.i.editReply(await p.render(mkCtx(e.i), e.page)); } catch { live.delete(uid); }
        }
    }
    const timer = setInterval(() => { tick().catch(() => {}); }, tickMs);
    timer.unref?.();

    return { register: (id, panel) => reg.set(id, panel), open, handle, has: id => reg.has(id), tick, stop: () => clearInterval(timer), liveCount: () => live.size };
}
