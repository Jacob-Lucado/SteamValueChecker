// Storage for the bundle feed: the bundles seen on the storefronts, what each server has been sent, and each server's settings.
import { BUNDLE_STORE_KEYS } from "./bundlefeedsource.js";

export const bundleFeedSchema = `
CREATE TABLE IF NOT EXISTS feed_bundles (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    key        TEXT NOT NULL UNIQUE,
    store      TEXT NOT NULL,
    title      TEXT NOT NULL,
    url        TEXT NOT NULL,
    image      TEXT,
    games      TEXT,
    game_count INTEGER,
    price      TEXT,
    kind       TEXT,
    expires_at INTEGER,
    first_seen INTEGER NOT NULL,
    last_seen  INTEGER NOT NULL,
    status     TEXT NOT NULL DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS feed_bundles_status ON feed_bundles(status, first_seen);
CREATE TABLE IF NOT EXISTS feed_bundle_posts (
    bundle_id  INTEGER NOT NULL REFERENCES feed_bundles(id) ON DELETE CASCADE,
    guild_id   TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT,
    marked_expired INTEGER NOT NULL DEFAULT 0,
    posted_at  INTEGER NOT NULL,
    PRIMARY KEY (bundle_id, guild_id)
);
CREATE TABLE IF NOT EXISTS feed_bundle_guilds (
    guild_id   TEXT PRIMARY KEY,
    channel_id TEXT,
    stores     TEXT,
    role_id    TEXT
);
`;

const KEEP_ENDED_MS = 7 * 86400_000;
const parse = (s, fallback) => { try { return JSON.parse(s) ?? fallback; } catch { return fallback; } };

export function bundleFeedStore({ run, get, all, clean, now }) {
    const row = r => { const c = clean(r); return c ? { ...c, games: parse(c.games, []) } : c; };

    /** Adds a bundle, or refreshes what we know of one we have. Returns { id, isNew }. */
    function upsertFeedBundle(b) {
        const t = now(), adult = b.adult ? 1 : 0;
        const have = get("SELECT id FROM feed_bundles WHERE key = ?", b.key);
        if (have) {
            run("UPDATE feed_bundles SET last_seen = ?, title = ?, image = COALESCE(?, image), games = CASE WHEN ? > 0 THEN ? ELSE games END, game_count = COALESCE(?, game_count), price = COALESCE(?, price), expires_at = COALESCE(?, expires_at), adult = ? WHERE id = ?",
                t, b.title, b.image ?? null, b.games.length, JSON.stringify(b.games), b.gameCount ?? null, b.price ?? null, b.expiresAt ?? null, adult, have.id);
            return { id: Number(have.id), isNew: false };
        }
        const r = run("INSERT INTO feed_bundles (key, store, title, url, image, games, game_count, price, kind, expires_at, first_seen, last_seen, adult) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            b.key, b.store, b.title, b.url, b.image ?? null, JSON.stringify(b.games ?? []), b.gameCount ?? null, b.price ?? null, b.kind ?? null, b.expiresAt ?? null, b.seenAt ?? t, t, adult);
        return { id: Number(r.lastInsertRowid), isNew: true };
    }
    const getFeedBundle = id => row(get("SELECT * FROM feed_bundles WHERE id = ?", id));
    /** `adult: false` leaves adult bundles out; leave it unset to get everything (the admin view). */
    function listFeedBundles({ status = null, stores = null, limit = 50, adult } = {}) {
        const where = [], args = [];
        if (status) { where.push("status = ?"); args.push(status); }
        if (adult === false) where.push("adult = 0");
        if (stores?.length) { where.push(`store IN (${stores.map(() => "?").join(",")})`); args.push(...stores); }
        return all(`SELECT * FROM feed_bundles ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY first_seen DESC, id DESC LIMIT ?`, ...args, Math.min(200, Math.max(1, limit))).map(row);
    }
    /** Active bundles whose end date has passed. Returns the rows that changed. */
    function expireDueBundles(at = now()) {
        const due = all("SELECT * FROM feed_bundles WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < ?", at).map(row);
        for (const b of due) run("UPDATE feed_bundles SET status = 'expired' WHERE id = ?", b.id);
        return due.map(b => ({ ...b, status: "expired" }));
    }
    /** A store whose page answered fully: an active bundle of it that is no longer listed is over. */
    function expireMissingBundles(store, presentKeys) {
        const keep = new Set(presentKeys);
        const gone = all("SELECT * FROM feed_bundles WHERE status = 'active' AND store = ?", store).map(row).filter(b => !keep.has(b.key));
        for (const b of gone) run("UPDATE feed_bundles SET status = 'expired' WHERE id = ?", b.id);
        return gone.map(b => ({ ...b, status: "expired" }));
    }
    const setFeedBundleStatus = (id, status) => run("UPDATE feed_bundles SET status = ? WHERE id = ?", status, id).changes > 0;
    const pruneFeedBundles = (at = now()) => run("DELETE FROM feed_bundles WHERE status = 'expired' AND COALESCE(expires_at, last_seen) < ?", at - KEEP_ENDED_MS).changes;

    const feedBundlePost = (bundleId, guildId) => clean(get("SELECT * FROM feed_bundle_posts WHERE bundle_id = ? AND guild_id = ?", bundleId, guildId));
    function addFeedBundlePost(bundleId, guildId, channelId, messageId) {
        run("INSERT OR REPLACE INTO feed_bundle_posts (bundle_id, guild_id, channel_id, message_id, posted_at) VALUES (?, ?, ?, ?, ?)", bundleId, guildId, channelId, messageId ?? null, now());
    }
    const hasAnyFeedBundlePost = guildId => Boolean(get("SELECT 1 AS x FROM feed_bundle_posts WHERE guild_id = ? LIMIT 1", guildId));
    const markFeedBundlePostExpired = (bundleId, guildId) => run("UPDATE feed_bundle_posts SET marked_expired = 1 WHERE bundle_id = ? AND guild_id = ?", bundleId, guildId);
    /** Posts that still show a bundle as live although it has ended. */
    const staleFeedBundlePosts = () => all("SELECT p.*, b.key, b.store, b.title, b.url, b.image, b.games, b.game_count, b.price, b.kind, b.expires_at, b.status FROM feed_bundle_posts p JOIN feed_bundles b ON b.id = p.bundle_id WHERE b.status = 'expired' AND p.marked_expired = 0 AND p.message_id IS NOT NULL")
        .map(r => ({ ...clean(r), games: parse(r.games, []) }));

    function getBundleFeedSettings(guildId) {
        const r = clean(get("SELECT * FROM feed_bundle_guilds WHERE guild_id = ?", guildId));
        const stores = r ? parse(r.stores, []).filter(s => BUNDLE_STORE_KEYS.includes(s)) : [];
        return { guild_id: guildId, channel_id: r?.channel_id ?? null, role_id: r?.role_id ?? null, stores, adult: Boolean(r?.adult) };
    }
    /** `stores` empty means every store. */
    function setBundleFeedSettings(guildId, patch) {
        run("INSERT OR IGNORE INTO feed_bundle_guilds (guild_id) VALUES (?)", guildId);
        if (patch.channel_id !== undefined) run("UPDATE feed_bundle_guilds SET channel_id = ? WHERE guild_id = ?", patch.channel_id, guildId);
        if (patch.role_id !== undefined) run("UPDATE feed_bundle_guilds SET role_id = ? WHERE guild_id = ?", patch.role_id, guildId);
        if (patch.adult !== undefined) run("UPDATE feed_bundle_guilds SET adult = ? WHERE guild_id = ?", patch.adult ? 1 : 0, guildId);
        if (patch.stores !== undefined) run("UPDATE feed_bundle_guilds SET stores = ? WHERE guild_id = ?", JSON.stringify([...new Set(patch.stores)]), guildId);
        return getBundleFeedSettings(guildId);
    }
    const bundleFeedGuilds = () => all("SELECT guild_id FROM feed_bundle_guilds WHERE channel_id IS NOT NULL").map(r => getBundleFeedSettings(r.guild_id));
    const bundleFeedCounts = () => ({ active: Number(get("SELECT COUNT(*) AS n FROM feed_bundles WHERE status = 'active'").n), total: Number(get("SELECT COUNT(*) AS n FROM feed_bundles").n), servers: Number(get("SELECT COUNT(*) AS n FROM feed_bundle_guilds WHERE channel_id IS NOT NULL").n) });

    return { upsertFeedBundle, getFeedBundle, listFeedBundles, expireDueBundles, expireMissingBundles, setFeedBundleStatus, pruneFeedBundles, feedBundlePost, addFeedBundlePost, hasAnyFeedBundlePost,
        markFeedBundlePostExpired, staleFeedBundlePosts, getBundleFeedSettings, setBundleFeedSettings, bundleFeedGuilds, bundleFeedCounts };
}
