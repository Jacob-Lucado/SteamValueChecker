// Now playing: who in a server is in a game right now, and a "squad up" post when two or more are in the same one.
// It reads Steam's own current-game field for members who linked Steam, share their library with the server AND turned on
// /alerts nowplaying. Nobody else is ever looked up. Steam only reports a game when the profile's game details are public.
import { steamArt, safeUrl } from "./render.js";

const BATCH = 100;
const SQUAD_GAP_MS = 4 * 3600_000; // the same game in the same server is announced at most this often

/** Steam's GetPlayerSummaries for up to 100 ids at a time: Map(steamid -> { name, appid, game }). Only people in a game have appid. */
export async function fetchPlayers(steamids, { apiKey, fetchImpl = globalThis.fetch } = {}) {
    const out = new Map();
    if (!apiKey) return out;
    const ids = [...new Set(steamids.filter(x => /^\d{17}$/.test(String(x))))];
    for (let i = 0; i < ids.length; i += BATCH) {
        const res = await fetchImpl(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(apiKey)}&steamids=${ids.slice(i, i + BATCH).join(",")}`, { signal: AbortSignal.timeout(12_000), headers: { "User-Agent": "SteamValueChecker" } });
        if (!res.ok) throw Object.assign(new Error(`steam ${res.status}`), { code: res.status === 429 ? "rate_limited" : "http" });
        for (const p of (await res.json())?.response?.players ?? []) {
            const appid = Number(p.gameid);
            out.set(String(p.steamid), { name: String(p.personaname ?? "").slice(0, 60), appid: Number.isInteger(appid) && appid > 0 ? appid : null, game: appid > 0 ? String(p.gameextrainfo ?? "").slice(0, 100) || null : null });
        }
    }
    return out;
}

/** Remembers answers for a minute so the dashboard page, the command and the squad check don't each ask Steam. */
export function createNowPlaying({ apiKey = null, fetchImpl = globalThis.fetch, now = () => Date.now(), ttlMs = 60_000 } = {}) {
    const cache = new Map();
    async function lookup(steamids) {
        const want = [...new Set(steamids.map(String))], fresh = new Map(), need = [];
        for (const id of want) { const c = cache.get(id); if (c && now() - c.at < ttlMs) fresh.set(id, c.v); else need.push(id); }
        if (cache.size > 5000) for (const [k, c] of cache) if (now() - c.at >= ttlMs) cache.delete(k);
        if (need.length) {
            const got = await fetchPlayers(need, { apiKey, fetchImpl });
            for (const id of need) { const v = got.get(id) ?? { name: "", appid: null, game: null }; cache.set(id, { at: now(), v }); fresh.set(id, v); }
        }
        return fresh;
    }
    return { lookup, enabled: Boolean(apiKey) };
}

/** Everyone in the server who is in a game now: [{ userId, name, appid, game }], and the games grouped with their players. */
export async function whoIsPlaying(db, src, guildId) {
    const members = db.nowPlayingMembers(guildId);
    if (!members.length || !src?.enabled) return { players: [], games: [], watching: members.length };
    const seen = await src.lookup(members.map(m => m.steamid));
    const players = members.map(m => ({ userId: m.discord_id, ...(seen.get(String(m.steamid)) ?? {}) })).filter(p => p.appid && p.game);
    const byGame = new Map();
    for (const p of players) { if (!byGame.has(p.appid)) byGame.set(p.appid, { appid: p.appid, game: p.game, players: [] }); byGame.get(p.appid).players.push(p); }
    return { players, games: [...byGame.values()].sort((a, b) => b.players.length - a.players.length || a.game.localeCompare(b.game)), watching: members.length };
}

export function nowPlayingEmbed({ games, watching }, { serverName = "this server" } = {}) {
    const lines = games.map(g => `**${g.game}**: ${g.players.map(p => `<@${p.userId}>`).join(", ")}`);
    return {
        color: 0x57f287, title: "🎮 Playing right now",
        description: lines.length ? lines.join("\n").slice(0, 3800) : watching ? "Nobody who shares their activity is in a game at the moment." : `Nobody in ${serverName} has turned this on yet. Run \`/alerts nowplaying\` to show up here.`,
        footer: { text: `${watching} member${watching === 1 ? "" : "s"} share${watching === 1 ? "s" : ""} what they play  •  /alerts nowplaying to join in or leave` }
    };
}

export function squadEmbed(game) {
    return {
        color: 0x57f287, title: `🎮 ${game.players.length} members are playing ${game.game}`, url: `https://store.steampowered.com/app/${game.appid}/`,
        description: `${game.players.map(p => `<@${p.userId}>`).join(", ")} ${game.players.length === 2 ? "are" : "are all"} in it right now. Want to join them?`,
        thumbnail: { url: steamArt(game.appid) }, footer: { text: "Squad up  •  /alerts nowplaying to leave this" }
    };
}

/**
 * Posts a squad-up message in each server that has a squad channel when two or more sharing members are in the same game.
 * The role (if the server picked one) is pinged; members are only named inside the card. Once per game per server every few hours.
 */
export async function runSquadUps({ db, src, notifier, now = () => Date.now(), log = () => {} }) {
    const stats = { servers: 0, squads: 0, posted: 0 };
    if (!src?.enabled) return stats;
    for (const g of db.squadGuilds()) {
        stats.servers++;
        let r;
        try { r = await whoIsPlaying(db, src, g.guild_id); } catch (err) { log(`now playing: ${err.code ?? err.name}`); break; }
        for (const game of r.games.filter(x => x.players.length >= 2)) {
            stats.squads++;
            const key = `squad:${g.guild_id}:${game.appid}`, last = Number(db.getMeta(key) ?? 0);
            if (last && now() - last < SQUAD_GAP_MS) continue;
            const ok = await notifier.postChannel(g.squad_channel, { embeds: [squadEmbed(game)], components: [{ type: 1, components: [{ type: 2, style: 5, label: "Open on Steam", url: safeUrl(`https://store.steampowered.com/app/${game.appid}/`) }] }] }, g.ping_squad || null);
            if (ok) { db.setMeta(key, String(now())); stats.posted++; }
        }
    }
    return stats;
}
