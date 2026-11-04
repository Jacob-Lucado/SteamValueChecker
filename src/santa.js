// Secret Santa for a server. A manager sets a budget, members join, the bot draws and privately tells each person who they're buying for,
// along with what's on that person's wishlist inside the budget at today's cheapest price. Joining is what shares the wishlist, and only
// with whoever draws you.
import { MessageFlags, PermissionFlagsBits } from "discord.js";
import { UserError } from "./errors.js";
import { summarize } from "./report.js";
import { REGIONS } from "./constants.js";

export const santaSchema = `
CREATE TABLE IF NOT EXISTS santa_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT NOT NULL,
    channel_id TEXT,
    title      TEXT NOT NULL,
    budget     REAL NOT NULL,
    region     TEXT NOT NULL DEFAULT 'US',
    currency   TEXT NOT NULL DEFAULT 'USD',
    status     TEXT NOT NULL DEFAULT 'open',
    created_by TEXT,
    created_at INTEGER NOT NULL,
    drawn_at   INTEGER
);
CREATE INDEX IF NOT EXISTS santa_events_guild ON santa_events (guild_id, id);
CREATE TABLE IF NOT EXISTS santa_entries (
    event_id   INTEGER NOT NULL REFERENCES santa_events(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL,
    giftee_id  TEXT,
    joined_at  INTEGER NOT NULL,
    PRIMARY KEY (event_id, user_id)
);
`;

export const MIN_PLAYERS = 3, MAX_PLAYERS = 60;

export function santaStore({ run, get, all, now }) {
    return {
        /** The server's current event: the open or drawn one, otherwise the last finished one. */
        getSanta: gid => get("SELECT * FROM santa_events WHERE guild_id = ? ORDER BY (status != 'ended') DESC, id DESC LIMIT 1", String(gid)) ?? null,
        createSanta: e => Number(run("INSERT INTO santa_events (guild_id, channel_id, title, budget, region, currency, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)", String(e.guild_id), e.channel_id ?? null, e.title, e.budget, e.region, e.currency, e.created_by ?? null, now()).lastInsertRowid),
        setSantaStatus: (id, status) => run("UPDATE santa_events SET status = ?, drawn_at = CASE WHEN ? = 'drawn' THEN ? ELSE drawn_at END WHERE id = ?", status, status, now(), id),
        santaEntries: id => all("SELECT * FROM santa_entries WHERE event_id = ? ORDER BY joined_at, user_id", id),
        santaEntry: (id, uid) => get("SELECT * FROM santa_entries WHERE event_id = ? AND user_id = ?", id, String(uid)) ?? null,
        joinSanta: (id, uid) => run("INSERT OR IGNORE INTO santa_entries (event_id, user_id, joined_at) VALUES (?,?,?)", id, String(uid), now()).changes > 0,
        leaveSanta: (id, uid) => run("DELETE FROM santa_entries WHERE event_id = ? AND user_id = ?", id, String(uid)).changes > 0,
        setSantaGiftee: (id, uid, giftee) => run("UPDATE santa_entries SET giftee_id = ? WHERE event_id = ? AND user_id = ?", String(giftee), id, String(uid)),
        santaFor: (id, giftee) => get("SELECT user_id FROM santa_entries WHERE event_id = ? AND giftee_id = ?", id, String(giftee))?.user_id ?? null
    };
}

/** One big loop around everyone, so nobody draws themselves and nobody's giftee is also their own Santa unless there are only two. */
export function draw(userIds, rand = Math.random) {
    const ids = [...new Set(userIds.map(String))];
    if (ids.length < MIN_PLAYERS) throw new UserError(`It needs at least ${MIN_PLAYERS} people to draw. Right now there are ${ids.length}.`);
    for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
    return new Map(ids.map((id, i) => [id, ids[(i + 1) % ids.length]]));
}

const currencyOf = region => REGIONS.find(r => r.value === region)?.name.match(/\(([A-Z]{3})\)/)?.[1] ?? "USD";
const money = (n, c) => { try { return new Intl.NumberFormat("en-US", { style: "currency", currency: c || "USD" }).format(n); } catch { return `${Number(n).toFixed(2)} ${c ?? ""}`.trim(); } };

/** Wishlist games the person doesn't own, at or under the budget at today's cheapest price, biggest discount first. */
export async function giftIdeas({ db, itad, giftee, event, limit = 6 }) {
    const owned = new Set(db.listLibrary(giftee).map(g => g.itad_id));
    const items = db.listItems(giftee).filter(i => !owned.has(i.itad_id));
    if (!items.length) return { ideas: [], wishlist: 0 };
    const prices = await itad.getPrices(items.map(i => i.itad_id), event.region);
    const ideas = [];
    for (const it of items) {
        const s = summarize(prices.get(it.itad_id), { majorOnly: false });
        if (!s.best || !(s.best.price > 0) || s.best.price > event.budget + 0.005) continue;
        ideas.push({ title: it.title, price: s.best.price, regular: s.msrp, shop: s.best.shop, url: s.best.url, discount: s.msrp ? Math.max(0, 1 - s.best.price / s.msrp) : 0, starred: Boolean(it.priority) });
    }
    ideas.sort((a, b) => Number(b.starred) - Number(a.starred) || b.discount - a.discount || a.price - b.price);
    return { ideas: ideas.slice(0, limit), wishlist: items.length };
}

export function eventEmbed(event, entries, { guildName = null } = {}) {
    const open = event.status === "open";
    return {
        color: 0xe74c3c,
        title: `🎅 ${event.title}`,
        description: open
            ? `Join with \`/server santa join\`. When a manager draws names, you'll get a private message with who you're buying for, plus what's on their wishlist inside the budget.\n\nJoining shares your wishlist with **only** the person who draws you.`
            : event.status === "drawn" ? "Names are drawn and everyone has been told privately. Check `/server santa ideas` if you lost your message." : "This one is wrapped up.",
        fields: [
            { name: "💰 Budget", value: money(event.budget, event.currency), inline: true },
            { name: "👥 In", value: String(entries.length), inline: true },
            { name: "Status", value: open ? "Open for sign-ups" : event.status === "drawn" ? "Drawn" : "Finished", inline: true }
        ],
        footer: { text: `${guildName ? guildName + "  •  " : ""}Prices from IsThereAnyDeal, in ${event.currency}` }
    };
}

export function giftDm({ event, giftee, guildName, ideas, wishlist }) {
    const lines = ideas.map(x => `• **${x.title}**: ${money(x.price, event.currency)}${x.regular && x.regular > x.price ? ` (${Math.round(x.discount * 100)}% off)` : ""} at ${x.shop}${x.starred ? " ⭐" : ""}`);
    const buttons = ideas.filter(x => /^https:\/\//.test(x.url ?? "")).slice(0, 5).map(x => ({ type: 2, style: 5, label: x.title.slice(0, 70), url: x.url }));
    return {
        embeds: [{
            color: 0xe74c3c, title: `🎅 You're Secret Santa for ${giftee.name}`,
            description: `In **${guildName}**, budget **${money(event.budget, event.currency)}**. Keep it secret!\n\n${ideas.length ? "From their wishlist, inside the budget:\n" + lines.join("\n") : wishlist ? "Nothing on their wishlist is under the budget right now. Check again closer to the day, or ask them what they'd like." : "They haven't got a wishlist set up. Ask them what they'd like."}`,
            footer: { text: "Games can be gifted on Steam from the store page. Prices change, so check before buying." }
        }],
        ...(buttons.length ? { components: [{ type: 1, components: buttons }] } : {}),
        allowed_mentions: { parse: [] }
    };
}

/** Starts a new event for the server. Only one can be going at a time. */
export function createEvent(db, { guildId, channelId = null, title, budget, region = "US", by }) {
    const cur = db.getSanta(guildId);
    if (cur && cur.status !== "ended") throw new UserError("This server already has a Secret Santa going. Finish it with `/server santa reveal` first.");
    const b = Number(budget);
    if (!Number.isFinite(b) || b < 1 || b > 1000) throw new UserError("Pick a budget between 1 and 1000.");
    const id = db.createSanta({ guild_id: guildId, channel_id: channelId, title: String(title ?? "").trim().slice(0, 80) || "Secret Santa", budget: Math.round(b * 100) / 100, region, currency: currencyOf(region), created_by: by });
    return db.getSanta(guildId) && { ...db.getSanta(guildId), id };
}

export function joinEvent(db, guildId, userId) {
    const ev = db.getSanta(guildId);
    if (!ev || ev.status !== "open") throw new UserError("There's no Secret Santa open for sign-ups here.");
    if (db.santaEntries(ev.id).length >= MAX_PLAYERS) throw new UserError(`It's full (${MAX_PLAYERS} people).`);
    return { event: ev, joined: db.joinSanta(ev.id, userId) };
}

export function leaveEvent(db, guildId, userId) {
    const ev = db.getSanta(guildId);
    if (!ev || ev.status !== "open") throw new UserError("Names are already drawn, so you can't leave now. Ask a manager.");
    return { event: ev, left: db.leaveSanta(ev.id, userId) };
}

/** Draws, saves the pairs and messages every Santa. Returns who couldn't be messaged. */
export async function drawEvent({ db, itad, sendDm, nameOf, guildName, guildId, rand = Math.random }) {
    const ev = db.getSanta(guildId);
    if (!ev || ev.status !== "open") throw new UserError("There's no open Secret Santa to draw.");
    const entries = db.santaEntries(ev.id);
    const pairs = draw(entries.map(e => e.user_id), rand);
    for (const [santa, giftee] of pairs) db.setSantaGiftee(ev.id, santa, giftee);
    db.setSantaStatus(ev.id, "drawn");
    const failed = [];
    for (const [santa, giftee] of pairs) {
        try {
            const { ideas, wishlist } = await giftIdeas({ db, itad, giftee, event: ev }).catch(() => ({ ideas: [], wishlist: 0 }));
            await sendDm(santa, giftDm({ event: ev, giftee: { name: await nameOf(giftee) }, guildName, ideas, wishlist }));
        } catch { failed.push(santa); }
    }
    return { event: db.getSanta(guildId), count: pairs.size, failed };
}

/** For someone who lost their message or has closed DMs: who they have and the ideas, only if they're a Santa in a drawn event. */
export async function myAssignment({ db, itad, guildId, userId, nameOf, guildName }) {
    const ev = db.getSanta(guildId);
    if (!ev || ev.status === "open") throw new UserError(ev ? "Names haven't been drawn yet." : "There's no Secret Santa here.");
    const mine = db.santaEntry(ev.id, userId);
    if (!mine?.giftee_id) throw new UserError("You're not in this one.");
    const { ideas, wishlist } = await giftIdeas({ db, itad, giftee: mine.giftee_id, event: ev });
    return giftDm({ event: ev, giftee: { name: await nameOf(mine.giftee_id) }, guildName, ideas, wishlist });
}

export function revealEmbed(event, entries) {
    return {
        color: 0xe74c3c, title: `🎁 ${event.title}: the reveal`,
        description: entries.filter(e => e.giftee_id).map(e => `<@${e.user_id}> → <@${e.giftee_id}>`).join("\n").slice(0, 4000) || "Nobody was drawn.",
        footer: { text: "Hope everyone liked their gift!" }
    };
}

export function endEvent(db, guildId) {
    const ev = db.getSanta(guildId);
    if (!ev || ev.status === "ended") throw new UserError("There's no Secret Santa to wrap up.");
    const entries = db.santaEntries(ev.id);
    db.setSantaStatus(ev.id, "ended");
    return { event: { ...ev, status: "ended" }, entries };
}

export function createSantaHandlers({ db, itad, sendDm, nameOf = async id => `<@${id}>` }) {
    const eph = (i, content) => i.reply({ content, flags: MessageFlags.Ephemeral });
    const manage = i => { if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) throw new UserError("You need the Manage Server permission for that."); };
    async function handle(i) {
        try {
            if (!i.guildId) throw new UserError("Use this in a server.");
            const sub = i.options.getSubcommand(), gid = i.guildId, guildName = i.guild?.name ?? "this server";
            const user = db.ensureUser(i.user.id, gid);
            if (sub === "create") {
                manage(i);
                const ev = createEvent(db, { guildId: gid, channelId: i.channelId, title: i.options.getString("title"), budget: i.options.getNumber("budget", true), region: user.region || "US", by: i.user.id });
                return void await i.reply({ embeds: [eventEmbed(ev, [], { guildName })], allowedMentions: { parse: [] } });
            }
            if (sub === "join") {
                const { event, joined } = joinEvent(db, gid, i.user.id);
                return void await eph(i, joined ? `You're in **${event.title}**. Keep your wishlist up to date, because that's what your Santa will see.` : "You're already in.");
            }
            if (sub === "leave") { const { left } = leaveEvent(db, gid, i.user.id); return void await eph(i, left ? "You've left the Secret Santa." : "You weren't in it."); }
            if (sub === "status") {
                const ev = db.getSanta(gid);
                if (!ev) return void await eph(i, "There's no Secret Santa here yet. A manager can start one with `/server santa create`.");
                return void await i.reply({ embeds: [eventEmbed(ev, db.santaEntries(ev.id), { guildName })], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
            }
            if (sub === "ideas") {
                await i.deferReply({ flags: MessageFlags.Ephemeral });
                return void await i.editReply(await myAssignment({ db, itad, guildId: gid, userId: i.user.id, nameOf, guildName }));
            }
            manage(i);
            if (sub === "draw") {
                await i.deferReply({ flags: MessageFlags.Ephemeral });
                const r = await drawEvent({ db, itad, sendDm, nameOf, guildName, guildId: gid });
                return void await i.editReply(`Drawn! ${r.count} people have been told who they have.${r.failed.length ? `\nI couldn't message ${r.failed.map(id => `<@${id}>`).join(", ")} (DMs closed). They can use \`/server santa ideas\` to see theirs.` : ""}`);
            }
            if (sub === "reveal") {
                const { event, entries } = endEvent(db, gid);
                return void await i.reply({ embeds: [revealEmbed(event, entries)], allowedMentions: { parse: [] } });
            }
        } catch (err) {
            const content = err instanceof UserError ? err.message : "Something went wrong. Try again in a moment.";
            if (!(err instanceof UserError)) console.error(`[santa] ${err.message}`);
            if (i.deferred || i.replied) await i.editReply({ content }).catch(() => {}); else await eph(i, content).catch(() => {});
        }
    }
    return { handle };
}
