// What the AI companion shows besides its words: a card per game it looked up (picture, prices, links) and buttons that do something real.
// Link buttons open a store page. "Add to wishlist" and "Another pick" belong to the person who asked, so nobody else can press them for them.
import { randomBytes } from "node:crypto";
import { steamArt } from "./art.js";
import { itadArt, artUrl, safeUrl } from "./render.js";
import { playNext, libraryView } from "./library.js";
import { addGameByTitle } from "./wishlist.js";

export const AI_PREFIX = "ai:";
const COLOR = 0x66c0f4, MAX_CARDS = 3;
const btn = (label, url) => ({ type: 2, style: 5, label: String(label).slice(0, 80), url });
const action = (label, id, style = 2) => ({ type: 2, style, label: String(label).slice(0, 80), custom_id: id });
const cap = (s, n) => (String(s ?? "").length > n ? String(s).slice(0, n - 1) + "…" : String(s ?? ""));

/** One card as a Discord embed. The first carries a big picture, the rest a small one. */
function embedOf(c, i) {
    const img = safeUrl(c.image);
    return { color: COLOR, title: cap(c.title, 250), url: safeUrl(c.url), description: c.description ? cap(c.description, 600) : undefined,
        fields: (c.fields ?? []).filter(f => f.value).slice(0, 6).map(f => ({ name: cap(f.name, 60), value: cap(f.value, 200), inline: f.inline !== false })),
        image: i === 0 && img ? { url: img } : undefined, thumbnail: i > 0 && img ? { url: img } : undefined,
        footer: c.footer ? { text: cap(c.footer, 100) } : undefined };
}

/**
 * The embeds and button rows for an answer's cards. `db` keeps what the buttons need to remember (who asked, which games), because a
 * button's own id is too short to carry it. Returns {} when there is nothing to show.
 */
export function cardsPayload(cards, { db, userId }) {
    const list = (cards ?? []).filter(c => c?.title).slice(0, MAX_CARDS);
    if (!list.length) return {};
    const row = [];
    for (const c of list) {
        if (c.url && row.length < 3) row.push(btn(c.linkLabel ?? (list.length > 1 ? `Open ${cap(c.title, 24)}` : "Open the store page"), safeUrl(c.url)));
        if (c.steamUrl && c.steamUrl !== c.url && row.length < 3) row.push(btn(list.length > 1 ? `Steam: ${cap(c.title, 20)}` : "Steam page", c.steamUrl));
    }
    const wish = list.filter(c => c.wish).map(c => c.wish).slice(0, 3), another = list.find(c => c.another);
    if (wish.length || another) {
        const token = randomBytes(5).toString("hex");
        db.savePager(token, { kind: "ai", userId, wish, skip: another?.another?.skip ?? [] });
        if (wish.length) row.push(action(wish.length === 1 ? "➕ Add to my wishlist" : "➕ Add these to my wishlist", `${AI_PREFIX}wish:${token}`));
        if (another) row.push(action("🎲 Another pick", `${AI_PREFIX}next:${token}`));
    }
    return { embeds: list.map(embedOf), components: row.length ? [{ type: 1, components: row.slice(0, 5) }] : [] };
}

/** The card for a play-next suggestion, in the shape cardsPayload takes. */
export function pickCard(next, skip = []) {
    const g = next.pick;
    return { title: g.title, url: Number.isInteger(g.appid) ? `https://store.steampowered.com/app/${g.appid}/` : undefined, linkLabel: "Steam page", image: artUrl(g) ?? (Number.isInteger(g.appid) ? steamArt(g.appid) : undefined),
        description: String(next.why).replace(/,? or press Pick another/i, ", or hit Another pick"), footer: next.remaining ? `${next.remaining} more waiting in your backlog` : "That's the last one in your backlog", another: next.remaining ? { skip: [...skip, g.itad_id] } : undefined };
}

/** Presses on the AI's buttons. Only the person who asked can use them. */
export async function handleAiButton(i, { db, itad }) {
    const [kind, token] = i.customId.slice(AI_PREFIX.length).split(":");
    const data = db.getPager(token);
    if (!data || data.kind !== "ai") return i.update({ components: [] }).catch(() => {});
    if (i.user.id !== data.userId) return i.reply({ content: "Those buttons are for the person who asked. Ask me your own question and you'll get yours.", flags: 64 }).catch(() => {});
    if (kind === "wish") {
        await i.deferReply({ flags: 64 });
        const added = [];
        for (const t of data.wish ?? []) { try { const out = await addGameByTitle(db, itad, i.user.id, t, null, null, { source: "ai" }); added.push(out.name); } catch (e) { added.push(`${t} (${e.message})`); } }
        return i.editReply({ content: added.length ? `Added to your wishlist: ${added.join(", ")}.` : "Nothing to add." }).catch(() => {});
    }
    if (kind === "next") {
        await i.deferUpdate().catch(() => {});
        const u = db.getUser(i.user.id);
        const v = await libraryView(db, itad, u, { snapshot: false });
        const next = playNext(v.rows, { skip: data.skip ?? [] });
        if (!next) return i.followUp({ content: "That's everything in your backlog. Nothing left to suggest.", flags: 64 }).catch(() => {});
        const p = cardsPayload([pickCard(next, data.skip ?? [])], { db, userId: i.user.id });
        return i.editReply({ embeds: p.embeds, components: p.components }).catch(() => {});
    }
    return i.deferUpdate().catch(() => {});
}
