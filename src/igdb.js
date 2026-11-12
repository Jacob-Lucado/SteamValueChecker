// How long a game takes and what critics scored it, from IGDB (the game database Twitch runs). It uses the same Twitch app
// as go-live detection (TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET); without those this is simply off.
// Answers are kept for a month, since neither number moves much.
const KEEP_MS = 30 * 86400_000, MISS_MS = 3 * 86400_000;
const hours = sec => (Number.isFinite(sec) && sec > 0 ? Math.max(1, Math.round(sec / 3600)) : null);

export function createIgdb({ clientId = "", clientSecret = "", fetchImpl = globalThis.fetch, now = () => Date.now(), db = null, log = () => {} } = {}) {
    const enabled = Boolean(clientId && clientSecret);
    let token = null, tokenUntil = 0, pausedUntil = 0;
    const mem = new Map();

    async function bearer() {
        if (token && now() < tokenUntil) return token;
        const res = await fetchImpl(`https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&grant_type=client_credentials`, { method: "POST", signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error(`sign-in answered ${res.status}`);
        const j = await res.json();
        token = j.access_token; tokenUntil = now() + Math.max(60, (Number(j.expires_in) || 3600) - 300) * 1000;
        return token;
    }
    async function ask(endpoint, body) {
        const res = await fetchImpl(`https://api.igdb.com/v4/${endpoint}`, { method: "POST", headers: { "Client-ID": clientId, Authorization: `Bearer ${await bearer()}`, Accept: "application/json" }, body, signal: AbortSignal.timeout(8000) });
        if (res.status === 401) { token = null; throw new Error("sign-in expired"); }
        if (res.status === 429) { pausedUntil = now() + 60_000; throw new Error("rate limited"); }
        if (!res.ok) { const e = new Error(`${endpoint} answered ${res.status}`); e.status = res.status; throw e; }
        const j = await res.json();
        return Array.isArray(j) ? j : [];
    }
    // IGDB renamed a couple of fields over the years. Try the current name, then the older one.
    const either = async (endpoint, bodies) => {
        let last;
        for (const b of bodies) { try { return await ask(endpoint, b); } catch (e) { last = e; if (e.status !== 400) throw e; } }
        throw last;
    };

    /**
     * { hours: { main, rushed, complete }, critic: { score, count } } for a Steam app, with nulls for what IGDB lacks,
     * or null when IGDB does not know the game (or this is off). Never throws.
     */
    async function facts(appid) {
        if (!enabled || !Number.isInteger(appid) || appid <= 0) return null;
        const key = `igdb:${appid}`;
        let hit = mem.get(appid);
        if (!hit && db) { try { hit = JSON.parse(db.getMeta(key) ?? "null"); } catch { hit = null; } }
        if (hit && now() - hit.at < (hit.v ? KEEP_MS : MISS_MS)) { mem.set(appid, hit); return hit.v; }
        if (now() < pausedUntil) return hit?.v ?? null;
        try {
            const ext = await either("external_games", [`fields game; where uid = "${appid}" & external_game_source = 1; limit 1;`, `fields game; where uid = "${appid}" & category = 1; limit 1;`]);
            const game = Number(ext[0]?.game) || null;
            let v = null;
            if (game) {
                const [g] = await ask("games", `fields aggregated_rating,aggregated_rating_count; where id = ${game}; limit 1;`);
                let t = null;
                try { [t] = await either("game_time_to_beats", [`fields hastily,normally,completely; where game_id = ${game}; limit 1;`, `fields hastily,normally,completely; where game = ${game}; limit 1;`]); } catch { /* no times is fine */ }
                const score = Number(g?.aggregated_rating), count = Number(g?.aggregated_rating_count) || 0;
                v = {
                    hours: { main: hours(t?.normally), rushed: hours(t?.hastily), complete: hours(t?.completely) },
                    critic: Number.isFinite(score) && count >= 3 ? { score: Math.round(score), count } : null
                };
                if (!v.critic && !v.hours.main && !v.hours.rushed && !v.hours.complete) v = null;
            }
            const row = { at: now(), v };
            if (mem.size > 3000) mem.clear();
            mem.set(appid, row);
            try { db?.setMeta(key, JSON.stringify(row)); } catch { /* kept in memory only */ }
            return v;
        } catch (e) { log(`game ${appid}: ${e?.message ?? e}`); return hit?.v ?? null; }
    }
    return { enabled, facts };
}

/** "About 22 hours to finish (95 to see everything)", or null. */
export function timeLine(f) {
    const h = f?.hours; const main = h?.main ?? h?.rushed ?? null;
    if (!main) return null;
    return `⏱️ About **${main} hour${main === 1 ? "" : "s"}** to finish${h.complete && h.complete > main ? ` (${h.complete} to see everything)` : ""}`;
}
export const criticLine = f => (f?.critic ? `📰 Critics: **${f.critic.score}/100** from ${f.critic.count} reviews` : null);
/** What an hour of the main story costs at this price, or null. */
export const perHour = (f, price) => { const h = f?.hours?.main ?? f?.hours?.rushed; return h && Number.isFinite(price) && price > 0 ? price / h : null; };
