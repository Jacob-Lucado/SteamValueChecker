// Game night: what a group can play together, and what is worth buying together. Only members who opted in
// (/alerts share) are counted, and only their game titles are used. Pure logic plus one price lookup.
import { summarize } from "./report.js";
import { current } from "./alerts.js";
import { UserError } from "./errors.js";
import { money } from "./render.js";

const MAX_PEOPLE = 12, MAX_LIST = 12, MAX_BUY = 5;

export async function gameNight({ db, itad, userIds, region = "US" }) {
    const unique = [...new Set(userIds)].slice(0, MAX_PEOPLE);
    const users = unique.map(id => db.getUser(id)).filter(u => u && u.share === 1);
    const hidden = unique.length - users.length;
    if (users.length < 2) throw new UserError(`I need at least 2 people who opted in with /alerts share${hidden ? ` (${hidden} in this group have not)` : ""}.`);

    const owned = new Map(), wants = new Map(), title = new Map();
    for (const u of users) {
        owned.set(u.discord_id, new Set(db.listLibrary(u.discord_id).map(l => (title.set(l.itad_id, l.title), l.itad_id))));
        wants.set(u.discord_id, new Set(db.listItems(u.discord_id).map(i => (title.set(i.itad_id, i.title), i.itad_id))));
    }
    const ids = users.map(u => u.discord_id);
    const empty = ids.filter(id => owned.get(id).size === 0);
    const everyGame = new Set([...owned.values()].flatMap(s => [...s]));
    const allOwn = [], almost = [];
    for (const g of everyGame) {
        const missing = ids.filter(id => !owned.get(id).has(g));
        if (!missing.length) allOwn.push({ id: g, title: title.get(g) });
        else if (users.length >= 3 && missing.length <= Math.ceil(users.length / 3)) almost.push({ id: g, title: title.get(g), missing });
    }
    // Group buy: a game at least two of them want that those people do not own.
    const buyCandidates = new Map();
    for (const u of users) for (const g of wants.get(u.discord_id)) {
        if (owned.get(u.discord_id).has(g)) continue;
        if (!buyCandidates.has(g)) buyCandidates.set(g, []);
        buyCandidates.get(g).push(u.discord_id);
    }
    const wanted = [...buyCandidates].filter(([, w]) => w.length >= 2).sort((a, b) => b[1].length - a[1].length).slice(0, MAX_BUY);
    let prices = new Map();
    if (wanted.length) { try { prices = await itad.getPrices(wanted.map(([g]) => g), region); } catch { /* the list still helps without prices */ } }
    const buy = wanted.map(([g, w]) => ({ id: g, title: title.get(g), wanters: w, now: prices.get(g) ? current(summarize(prices.get(g))) : null }));

    const byTitle = (a, b) => a.title.localeCompare(b.title);
    return { people: ids, hidden, empty, allOwn: allOwn.sort(byTitle), almost: almost.sort((a, b) => a.missing.length - b.missing.length || byTitle(a, b)), buy };
}

const list = (rows, f) => (rows.length ? rows.slice(0, MAX_LIST).map(f).join("\n") + (rows.length > MAX_LIST ? `\n…and ${rows.length - MAX_LIST} more` : "") : null);
export const GN_PICK = "gn_pick";

export function gameNightEmbed(r) {
    const fields = [];
    const own = list(r.allOwn, g => `• ${g.title}`);
    fields.push({ name: `Everyone owns (${r.allOwn.length})`, value: own ?? "Nothing in common yet. Check the buy list below." });
    const near = list(r.almost, g => `• ${g.title} (missing: ${g.missing.map(m => `<@${m}>`).join(", ")})`);
    if (near) fields.push({ name: "Almost everyone owns", value: near });
    const buy = list(r.buy, b => `• **${b.title}** wanted by ${b.wanters.map(w => `<@${w}>`).join(", ")}${b.now?.price != null ? ` at **${money(b.now.price, b.now.currency ?? "USD")}**${b.now.discount > 0 ? ` (-${Math.round(b.now.discount * 100)}%)` : ""}${b.now.shop ? ` at ${b.now.shop}` : ""}` : ""}`);
    if (buy) fields.push({ name: "Worth buying together", value: buy });
    if (r.empty?.length) fields.push({ name: "No games on record", value: `${r.empty.map(m => `<@${m}>`).join(", ")} ${r.empty.length === 1 ? "has" : "have"} no games in the bot yet, so ${r.empty.length === 1 ? "they are" : "they are all"} left out of "Everyone owns". Link Steam with \`/steam link\` or add games with \`/library import\`.` });
    return { color: 0xff9800, title: `Game night for ${r.people.length}`, description: r.people.map(p => `<@${p}>`).join(" "), fields,
        footer: { text: `${r.hidden ? `${r.hidden} not counted (not opted in)  •  ` : ""}Only members who opted in with /alerts share are included` } };
}

export const gameNightButtons = (channelId = "0") => [{ type: 1, components: [{ type: 2, style: 1, label: "Pick a game for us", custom_id: `${GN_PICK}:${channelId}` }] }];

/** One game chosen at random from what everyone owns, else from what almost everyone owns. */
export function pickGame(r, rand = Math.random) {
    const pool = r.allOwn.length ? r.allOwn : r.almost;
    return pool.length ? pool[Math.floor(rand() * pool.length)] : null;
}

/**
 * During a price run: when 2 or more people sitting in the same voice channel all have the same game hit their alert,
 * post once in that channel's text chat. `voice` is { channelIds(guildId) -> Map(channelId -> [userId]) }.
 */
export function voiceGroups({ db, eligible, voiceMap }) {
    const out = [];
    for (const guild of db.guildsWithGameNight()) {
        const channels = voiceMap(guild.guild_id);
        if (!channels?.size) continue;
        const byUser = new Map();
        for (const h of eligible) {
            if (h.item.share !== 1) continue;
            if (!byUser.has(h.item.discord_id)) byUser.set(h.item.discord_id, []);
            byUser.get(h.item.discord_id).push(h);
        }
        for (const [channelId, members] of channels) {
            const byGame = new Map();
            for (const u of members) for (const h of byUser.get(u) ?? []) {
                if (!byGame.has(h.item.itad_id)) byGame.set(h.item.itad_id, []);
                byGame.get(h.item.itad_id).push(h);
            }
            for (const [itadId, hits] of byGame) {
                if (hits.length < 2) continue;
                const best = hits.reduce((m, h) => (h.now.price < m.now.price ? h : m));
                out.push({ guildId: guild.guild_id, channelId, itadId, title: best.item.title, users: hits.map(h => h.item.discord_id), now: best.now });
            }
        }
    }
    return out;
}

export function voiceBuyEmbed(g) {
    const off = g.now.discount > 0 ? ` (-${Math.round(g.now.discount * 100)}%)` : "";
    return { color: 0x57f287, title: `${g.users.length} of you want ${g.title}`, url: /^https:\/\//.test(g.now.url ?? "") ? g.now.url : undefined,
        description: `${g.users.map(u => `<@${u}>`).join(" ")}\nIt just dropped to **${money(g.now.price, g.now.currency ?? "USD")}**${off}${g.now.shop ? ` at ${g.now.shop}` : ""}. Buy it together for game night?`,
        footer: { text: "Only members who opted in with /alerts share are included  •  /setup to turn this off" } };
}
