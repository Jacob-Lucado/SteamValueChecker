// Small fixed-window rate limiter, kept in memory.
export function createLimiter({ windowMs, max, now = () => Date.now() }) {
    const hits = new Map();
    return {
        /** Returns { ok, retryAfterS }. */
        hit(key) {
            const t = now();
            if (hits.size > 5000) for (const [k, v] of hits) if (v.reset <= t) hits.delete(k);
            let h = hits.get(key);
            if (!h || h.reset <= t) { h = { count: 0, reset: t + windowMs }; hits.set(key, h); }
            h.count++;
            return h.count > max ? { ok: false, retryAfterS: Math.max(1, Math.ceil((h.reset - t) / 1000)) } : { ok: true, retryAfterS: 0 };
        }
    };
}
