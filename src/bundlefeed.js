// The bundle feed: one post per bundle per server, grayed out when the bundle ends. Same rhythm as the game code posts.
import { bundlePageUrl } from "./deallinks.js";
import { fetchAllBundles, BUNDLE_STORES, BUNDLE_STORE_KEYS } from "./bundlefeedsource.js";

const sleepDefault = ms => new Promise(r => setTimeout(r, ms));
const GREY = 0x6b7280;
const MAX_PER_RUN = 6;     // posts per server per poll, so a server that was offline for days is not flooded
const FIRST_RUN_POSTS = 3; // a server's first poll posts the newest few and marks the rest as already seen
const unix = ms => Math.floor(ms / 1000);

/** "Humble Bundle, Steam" for a store list. Empty means every store. */
export const describeStores = keys => (keys?.length ? keys.filter(k => BUNDLE_STORES[k]).map(k => BUNDLE_STORES[k].name).join(", ") : "every store");

/** What the dashboard and the slash command show for one stored bundle. */
export const bundleFeedView = b => ({ id: b.id, store: b.store, storeName: BUNDLE_STORES[b.store]?.name ?? b.store, title: b.title, url: b.url, image: b.image, games: b.games, gameCount: b.game_count,
    price: b.price, expiresAt: b.expires_at, status: b.status === "active" && b.expires_at && b.expires_at < Date.now() ? "expired" : b.status, firstSeen: b.first_seen });

/** The post for one bundle. `expired` grays it out and drops the buttons. */
export function bundleFeedEmbed(b, { expired = false } = {}) {
    const store = BUNDLE_STORES[b.store] ?? { name: b.store, emoji: "📦", color: 0x4da3ff, home: b.url };
    const count = b.game_count ?? (b.games?.length || null);
    const fields = [
        { name: "Store", value: store.name, inline: true },
        { name: "Price", value: b.price || "See the store", inline: true },
        { name: "Games", value: count ? String(count) : "See the store", inline: true }
    ];
    if (b.games?.length) {
        const shown = b.games.slice(0, 8).map(g => `• ${g}`);
        const more = (count ?? b.games.length) - shown.length;
        fields.push({ name: "Featured games", value: shown.join("\n") + (more > 0 ? `\n*and ${more} more*` : ""), inline: false });
    }
    fields.push({ name: expired ? "Status" : "Ends", value: expired ? "This bundle has ended" : b.expires_at ? `<t:${unix(b.expires_at)}:F> (<t:${unix(b.expires_at)}:R>)` : "No end date listed, so grab it while it lasts", inline: false });
    const page = b.id ? bundlePageUrl(b.id) : null; // goes through the site first, which counts the visit and then sends people on to the store
    const embed = {
        color: expired ? GREY : store.color,
        author: { name: `${store.emoji} ${store.name} · ${expired ? "bundle ended" : "new bundle"}` },
        title: expired ? `Ended: ${b.title}` : b.title,
        url: page ?? b.url,
        description: expired ? undefined : `${count ? `**${count} games**` : "A new game bundle"} just went up on ${store.name}. Tiers and prices are on the store page.`,
        fields,
        image: b.image ? { url: b.image } : undefined,
        footer: { text: expired ? "Steam Value Checker · bundle ended" : "Steam Value Checker · bundle prices and end dates can change" }
    };
    const buttons = [{ type: 2, style: 5, label: `Get it on ${store.name}`, url: page ?? b.url }, { type: 2, style: 5, label: "All bundles", url: store.home }];
    return { embeds: [embed], components: expired ? [] : [{ type: 1, components: buttons }], allowed_mentions: { parse: [] } };
}

const wanted = (settings, b) => (!settings.stores.length || settings.stores.includes(b.store)) && (settings.adult || !b.adult);

/** Newest-first active bundles this server should see and has not been sent yet. */
export const pendingBundlesFor = (db, guildId, settings) => db.listFeedBundles({ status: "active", limit: 200 }).filter(b => wanted(settings, b) && !db.feedBundlePost(b.id, guildId));

/**
 * One poll: read the stores, save anything new, retire what ended, post what each server has not had, and edit old posts.
 * `fetchBundles` is injectable for tests. A failed read still lets the expiry and edit steps run.
 */
export async function runBundleFeed({ db, api, deep = false, fetchBundles = fetchAllBundles, now = Date.now, sleep = sleepDefault, pace = 500, log = () => {} }) {
    const stats = { fetched: 0, added: 0, posted: 0, expired: 0, failed: 0, feedError: null };
    try {
        const got = await fetchBundles({ deep });
        const list = Array.isArray(got) ? got : got.bundles;
        stats.fetched = list.length;
        const backfilled = [];
        for (const b of list) { const r = db.upsertFeedBundle(b); if (r.isNew) { stats.added++; if (deep && b.store === "steam") backfilled.push(r.id ?? db.getFeedBundle(b.key)?.id); } }
        // A deep check reaches back through hundreds of older Steam bundles; they fill the dashboard page but are not announced as news.
        for (const id of backfilled.filter(Boolean)) for (const g of db.bundleFeedGuilds()) db.addFeedBundlePost(id, g.guild_id, g.channel_id, null);
        if (got.errors?.length) { stats.feedError = got.errors.join("; "); log(`bundle feed (partial): ${stats.feedError}`); }
        for (const store of got.complete ?? []) stats.expired += db.expireMissingBundles(store, list.filter(b => b.store === store).map(b => b.key)).length;
    } catch (err) { stats.feedError = err.message; log(`bundle feed: ${err.message}`); }

    stats.expired += db.expireDueBundles(now()).length;

    for (const settings of db.bundleFeedGuilds()) {
        const gid = settings.guild_id;
        const fresh = pendingBundlesFor(db, gid, settings);
        if (!fresh.length) continue;
        const first = !db.hasAnyFeedBundlePost(gid);
        const toPost = first ? fresh.slice(0, FIRST_RUN_POSTS) : fresh.slice(0, MAX_PER_RUN);
        if (first) for (const b of fresh.slice(FIRST_RUN_POSTS)) db.addFeedBundlePost(b.id, gid, settings.channel_id, null);
        const ping = settings.role_id ?? db.getCommunity?.(gid)?.ping_bundles ?? null;
        for (const b of [...toPost].reverse()) { // oldest first, so the newest ends up at the bottom
            try {
                const msg = await api.sendMessage(settings.channel_id, { ...bundleFeedEmbed(b), content: ping ? `<@&${ping}>` : undefined, allowed_mentions: ping ? { roles: [ping] } : { parse: [] } });
                db.addFeedBundlePost(b.id, gid, settings.channel_id, msg?.id ?? null);
                stats.posted++;
            } catch (err) {
                stats.failed++;
                log(`bundle post failed for a server (${err?.status ?? err?.name})`);
                break; // the channel is gone or locked; try again next poll
            }
            await sleep(pace);
        }
    }

    for (const p of db.staleFeedBundlePosts()) {
        try { await api.editMessage(p.channel_id, p.message_id, bundleFeedEmbed({ ...p, expires_at: p.expires_at }, { expired: true })); db.markFeedBundlePostExpired(p.bundle_id, p.guild_id); }
        catch (err) { if (err?.status === 404 || err?.status === 403) db.markFeedBundlePostExpired(p.bundle_id, p.guild_id); else stats.failed++; }
        await sleep(pace);
    }
    db.pruneFeedBundles();
    return stats;
}

/** Shared by the slash command and the dashboard: validate and save a server's settings. Throws an Error with a plain message. */
export function applyBundleFeedSettings(db, guildId, body) {
    const patch = {};
    if (body.channel_id !== undefined) patch.channel_id = body.channel_id || null;
    if (body.role_id !== undefined) patch.role_id = body.role_id || null;
    if (body.adult !== undefined) patch.adult = body.adult === true || body.adult === "true";
    if (body.stores !== undefined) {
        const stores = [...new Set((Array.isArray(body.stores) ? body.stores : []).map(String))];
        if (stores.some(s => !BUNDLE_STORE_KEYS.includes(s))) throw new Error("That is not a store I track bundles for.");
        patch.stores = stores.length === BUNDLE_STORE_KEYS.length ? [] : stores; // every store selected is the same as no filter
    }
    return db.setBundleFeedSettings(guildId, patch);
}
