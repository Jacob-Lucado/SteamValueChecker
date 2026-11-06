// Top.gg votes. Every few minutes we ask Top.gg for the votes that came in since last time and thank each voter with bonus XP
// in every server where they already have XP. The token comes from the TOPGG_TOKEN secret and is never written anywhere else.
export const TOPGG_API = "https://top.gg/api/v1/projects/@me";
export const VOTE_XP = 250;                     // per vote; a weekend vote counts double on Top.gg's side, so it pays double here too
import { pushEvent, readEvents } from "./adminlog.js";
const SEEN_KEEP_MS = 3 * 86400_000;

export function createTopgg({ token, db, reward, notify = async () => {}, fetchImpl = globalThis.fetch, now = () => Date.now(), log = () => {} } = {}) {
    const enabled = Boolean(token);
    const state = { lastOkAt: null, lastErrorAt: null, lastError: null, rewarded: 0 };
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };

    async function call(path) {
        const res = await fetchImpl(TOPGG_API + path, { headers, signal: AbortSignal.timeout(12_000) });
        if (res.status === 404) return null;
        if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { code: `http${res.status}` });
        return await res.json();
    }

    /** The newest votes first seen since the last check. Each vote pays out once, even after a restart. */
    async function poll() {
        if (!enabled) return { rewarded: 0 };
        let cursor = db.getMeta("topgg:cursor");
        const since = Number(db.getMeta("topgg:since")) || now() - 86400_000;
        let paid = 0;
        try {
            for (let page = 0; page < 20; page++) {
                const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : `?startDate=${encodeURIComponent(new Date(since).toISOString())}`;
                let body;
                try { body = await call("/votes" + q); }
                catch (e) { if (cursor && e.code === "http400") { cursor = null; db.setMeta("topgg:cursor", ""); continue; } throw e; }
                const rows = Array.isArray(body?.data) ? body.data : [];
                if (body?.cursor) { cursor = body.cursor; db.setMeta("topgg:cursor", cursor); }
                if (!rows.length) break;
                for (const v of rows) paid += await handle(v);
            }
            state.lastOkAt = now(); state.lastError = null;
            prune();
        } catch (err) {
            state.lastErrorAt = now(); state.lastError = err.code ?? err.name ?? "error";
            log(`Top.gg check failed: ${state.lastError}`);
        }
        state.rewarded += paid;
        return { rewarded: paid };
    }

    async function handle(v) {
        const id = String(v.platform_id ?? ""), at = Date.parse(v.created_at);
        if (!/^\d{5,25}$/.test(id) || !Number.isFinite(at)) return 0;
        const key = `topgg:seen:${id}:${at}`;
        if (db.getMeta(key) !== null) return 0;
        db.setMeta(key, String(at));
        db.setMeta("topgg:since", String(Math.max(Number(db.getMeta("topgg:since")) || 0, at)));
        const weight = Math.max(1, Math.min(4, Math.round(Number(v.weight) || 1)));
        const total = Number(db.getMeta(`topgg:votes:${id}`)) || 0;
        db.setMeta(`topgg:votes:${id}`, String(total + 1));
        const xp = VOTE_XP * weight;
        let servers = 0;
        try { servers = await reward(id, xp); } catch (e) { log(`Vote reward failed: ${e.message}`); }
        db.setMeta("topgg:stat:votes", String((Number(db.getMeta("topgg:stat:votes")) || 0) + 1));
        db.setMeta("topgg:stat:xp", String((Number(db.getMeta("topgg:stat:xp")) || 0) + xp * servers));
        pushEvent(db, "topgg:recent", { id, at, xp, servers, weight }, 30);
        await notify(id, { xp, servers, total: total + 1, expiresAt: Date.parse(v.expires_at) || null }).catch(() => {});
        return 1;
    }

    function prune() {
        for (const r of db.listMetaPrefix("topgg:seen:")) if (now() - Number(r.value) > SEEN_KEEP_MS) db.setMeta(r.key, "");
    }

    /** Has this person voted and when can they again. Used by the vote command and the dashboard. */
    async function status(userId) {
        const base = { enabled, votes: Number(db.getMeta(`topgg:votes:${userId}`)) || 0, voted: false, nextAt: null };
        if (!enabled) return base;
        try {
            const r = await call(`/votes/${encodeURIComponent(userId)}?source=discord`);
            if (r?.expires_at && Date.parse(r.expires_at) > now()) return { ...base, voted: true, nextAt: Date.parse(r.expires_at) };
        } catch { /* fall back to what we have */ }
        return base;
    }

    /** Numbers for the admin page: totals since tracking began, the most loyal voters and the latest votes. */
    function adminStats() {
        const top = db.listMetaPrefix("topgg:votes:").map(r => ({ id: r.key.slice("topgg:votes:".length), votes: Number(r.value) || 0 })).filter(r => r.votes > 0).sort((a, b) => b.votes - a.votes).slice(0, 10);
        return {
            enabled, health: { lastOkAt: state.lastOkAt, lastError: state.lastError },
            votes: Number(db.getMeta("topgg:stat:votes")) || 0, xp: Number(db.getMeta("topgg:stat:xp")) || 0,
            voters: db.listMetaPrefix("topgg:votes:").filter(r => Number(r.value) > 0).length,
            perVote: VOTE_XP, top, recent: readEvents(db, "topgg:recent", 15)
        };
    }

    return { poll, status, adminStats, health: () => ({ enabled, ...state }), enabled };
}
