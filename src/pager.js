// One card at a time with Previous / Next and a jump menu. Used wherever a message would otherwise stack several cards.
import { randomBytes } from "node:crypto";

export const PAGE_PREFIX = "pg:";
export const JUMP_PREFIX = "pg_jump:";

const btn = (label, id, disabled = false, style = 2) => ({ type: 2, style, label, custom_id: id, ...(disabled ? { disabled: true } : {}) });

/** The message for page `n`: that card, the page buttons, and any buttons that belong to just that card. */
export function renderPage(token, data, n) {
    const total = data.pages.length;
    const page = Math.min(Math.max(0, n | 0), total - 1);
    const p = data.pages[page];
    const nav = { type: 1, components: [
        btn("◀ Previous", `${PAGE_PREFIX}${token}:${page - 1}`, page === 0),
        btn(`${page + 1} / ${total}`, `${PAGE_PREFIX}${token}:x`, true),
        btn("Next ▶", `${PAGE_PREFIX}${token}:${page + 1}`, page >= total - 1, 1)
    ] };
    const rows = [nav];
    if (total >= 3 && total <= 25 && data.jump !== false) {
        rows.push({ type: 1, components: [{ type: 3, custom_id: `${JUMP_PREFIX}${token}`, placeholder: "Jump to…", options: data.pages.map((x, i) => ({ label: String(x.label ?? `Page ${i + 1}`).slice(0, 100) || `Page ${i + 1}`, value: String(i), default: i === page })) }] });
    }
    for (const r of p.rows ?? []) if (rows.length < 5) rows.push(r);
    const content = p.content ?? data.content;
    return { content: content ?? "", embeds: p.embeds ?? [p.embed], components: rows };
}

/**
 * Turns several cards into one paged message. `pages` is [{ embed, rows?, label? }]; a single card is returned as it is.
 * `store` is anything with savePager (the database).
 */
export function pagedPayload(store, { content, pages, jump }) {
    if (pages.length === 1) return { ...(content ? { content } : {}), embeds: pages[0].embeds ?? [pages[0].embed], components: pages[0].rows ?? [] };
    const token = randomBytes(5).toString("hex");
    const data = { content: content ?? null, pages, jump };
    store.savePager(token, data);
    return renderPage(token, data, 0);
}

/** The token of the pager a message belongs to, read from its own buttons. */
export function tokenOf(message) {
    for (const row of message?.components ?? []) for (const c of row.components ?? []) { const id = c.customId ?? c.custom_id ?? ""; if (id.startsWith(PAGE_PREFIX)) return id.slice(PAGE_PREFIX.length).split(":")[0]; }
    return null;
}

/** Page buttons and the jump menu. */
export async function handlePager(i, store) {
    const isJump = i.isStringSelectMenu();
    const [token, rest] = isJump ? [i.customId.slice(JUMP_PREFIX.length), i.values[0]] : i.customId.slice(PAGE_PREFIX.length).split(":");
    const data = store.getPager(token);
    if (!data) return i.update({ components: [] }).catch(() => {});
    return i.update(renderPage(token, data, Number(rest)));
}
