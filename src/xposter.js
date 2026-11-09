// Posts the free games the bot finds to the project's X account. X charges for every post it takes through the API
// (about 1.5 cents for plain text, and about 20 cents once a post has a link in it), so this only ever posts plain text,
// at most a few a day, and does nothing until the owner switches it on and has added the four keys.
import { createHmac, randomBytes } from "node:crypto";

export const X_POST_URL = "https://api.x.com/2/tweets";
export const X_ME_URL = "https://api.x.com/2/users/me";
const ON = "xposter:on", CAP = "xposter:daily", LAST = "xposter:last", ERR = "xposter:error", DAYKEY = "xposter:day:", SEEN = "xposted:";
export const DEFAULT_DAILY = 2, MAX_DAILY = 6, GAP_MS = 3 * 3_600_000, COST_PER_POST = 0.015;

const enc = s => encodeURIComponent(String(s)).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());

/** The OAuth 1.0a header X wants for a user-context call. A JSON body isn't part of the signature, only the query string is. */
export function oauthHeader({ method, url, keys, nonce = randomBytes(16).toString("hex"), timestamp = Math.floor(Date.now() / 1000) }) {
    const u = new URL(url);
    const oauth = { oauth_consumer_key: keys.apiKey, oauth_nonce: nonce, oauth_signature_method: "HMAC-SHA1", oauth_timestamp: String(timestamp), oauth_token: keys.accessToken, oauth_version: "1.0" };
    const params = [...Object.entries(oauth), ...u.searchParams.entries()].map(([k, v]) => [enc(k), enc(v)]).sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));
    const base = [method.toUpperCase(), enc(u.origin + u.pathname), enc(params.map(([k, v]) => `${k}=${v}`).join("&"))].join("&");
    const signature = createHmac("sha1", `${enc(keys.apiSecret)}&${enc(keys.accessSecret)}`).update(base).digest("base64");
    return "OAuth " + Object.entries({ ...oauth, oauth_signature: signature }).map(([k, v]) => `${enc(k)}="${enc(v)}"`).join(", ");
}

/** The day in Eastern time as YYYY-MM-DD, so "per day" means the owner's day. */
const dayOf = ms => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(ms));

/** Plain text only: no link, so X doesn't bill it as a link post. */
export function freeGameText(g, now = Date.now()) {
    const shop = g.shop ? ` on ${g.shop}` : "";
    const left = g.expiry && g.expiry > now ? g.expiry - now : null;
    const when = left === null ? "" : left < 36 * 3_600_000 ? `\n⏳ Ends ${left < 3_600_000 ? "within the hour" : `in about ${Math.round(left / 3_600_000)} hours`}.` : `\n⏳ Ends ${new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" }).format(new Date(g.expiry))}.`;
    const title = String(g.title).slice(0, 110);
    return `🎁 Free right now: ${title}${shop}${when}\n\nKeep it forever once you claim it. Our Discord bot posts every free game as it drops. Link in bio.\n\n#FreeGames #PCGaming`;
}

export function createXPoster({ env = process.env, db, fetchImpl = globalThis.fetch, now = () => Date.now(), log = () => {} }) {
    // pasted values often come with a space, a line break or quote marks stuck to them
    const clean = v => String(v ?? "").trim().replace(/^["']+|["']+$/g, "").trim();
    const keys = { apiKey: clean(env.X_API_KEY), apiSecret: clean(env.X_API_SECRET), accessToken: clean(env.X_ACCESS_TOKEN), accessSecret: clean(env.X_ACCESS_SECRET) };
    const configured = () => Object.values(keys).every(v => String(v ?? "").trim());
    const enabled = () => db.getMeta(ON) === "1";
    const daily = () => Math.min(MAX_DAILY, Math.max(1, Number(db.getMeta(CAP)) || DEFAULT_DAILY));
    const postedToday = () => Number(db.getMeta(DAYKEY + dayOf(now()))) || 0;

    async function call(method, url, body) {
        const res = await fetchImpl(url, { method, headers: { Authorization: oauthHeader({ method, url, keys, timestamp: Math.floor(now() / 1000) }), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15_000) });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
            const why = res.status === 402 || /credit|billing|payment/i.test(JSON.stringify(json)) ? "X says the account is out of credits. Add some in the X developer console."
                : res.status === 401 ? "X rejected the keys. Check all four are copied right, and that the access token was made after the API key (regenerating the key kills the old token)."
                : res.status === 403 ? "X refused it. The app needs Read and write access, and billing has to be switched on for the project."
                : res.status === 429 ? "X is rate limiting this account. It will try again later."
                : `X answered ${res.status}.`;
            throw Object.assign(new Error(why), { status: res.status });
        }
        return json;
    }

    /** One plain-text post. */
    async function post(text) {
        if (!configured()) throw new Error("The four X keys aren't set yet.");
        const out = await call("POST", X_POST_URL, { text: String(text).slice(0, 280) });
        return { id: out?.data?.id ?? null };
    }
    /** Proves the keys work without posting anything. */
    async function check() {
        if (!configured()) throw new Error("The four X keys aren't set yet.");
        const out = await call("GET", X_ME_URL);
        return { username: out?.data?.username ?? null };
    }

    /** Posts at most one new free game now, if it's switched on, under today's cap and far enough after the last one. */
    async function tick(list) {
        if (!enabled() || !configured()) return { skipped: "off" };
        if (postedToday() >= daily()) return { skipped: "cap" };
        if (now() - (Number(db.getMeta(LAST)) || 0) < GAP_MS) return { skipped: "gap" };
        const fresh = (list ?? []).filter(g => g.type !== "dlc" && /^https:\/\//.test(g.url ?? "") && g.title && !db.getMeta(SEEN + g.id) && (!g.expiry || g.expiry - now() > 2 * 3_600_000));
        const g = fresh.sort((a, b) => (a.expiry ?? Infinity) - (b.expiry ?? Infinity))[0];
        if (!g) return { skipped: "nothing" };
        db.setMeta(SEEN + g.id, String(now())); // marked first, so a failure can't turn into a loop of retries that each cost money
        try {
            const r = await post(freeGameText(g, now()));
            db.setMeta(LAST, String(now())); db.setMeta(DAYKEY + dayOf(now()), String(postedToday() + 1)); db.setMeta(ERR, "");
            log(`posted ${g.title}`);
            return { posted: g.title, id: r.id };
        } catch (err) {
            db.setMeta(ERR, JSON.stringify({ at: now(), message: err.message }));
            log(`post failed: ${err.message}`);
            return { error: err.message };
        }
    }

    function status() {
        let err = null; try { err = db.getMeta(ERR) ? JSON.parse(db.getMeta(ERR)) : null; } catch { /* none */ }
        const d = daily();
        return { configured: configured(), enabled: enabled(), daily: d, postedToday: postedToday(), lastAt: Number(db.getMeta(LAST)) || null, error: err, monthlyCost: Math.round(d * 30 * COST_PER_POST * 100) / 100, maxDaily: MAX_DAILY };
    }
    function setSettings({ enabled: on, daily: n } = {}) {
        if (on !== undefined) db.setMeta(ON, on ? "1" : "0");
        if (n !== undefined) { const v = Math.round(Number(n)); if (!(v >= 1 && v <= MAX_DAILY)) throw Object.assign(new Error(`Posts per day must be between 1 and ${MAX_DAILY}.`), { user: true }); db.setMeta(CAP, String(v)); }
        return status();
    }
    return { configured, post, check, tick, status, setSettings };
}
