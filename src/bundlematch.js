// Bundle Match: a new bundle is only exciting if it has something you want. This compares every bundle's games with each person's
// wishlist and tells them, once, when a bundle has games they're already watching. Everyone else isn't bothered.
import { BUNDLE_STORES } from "./bundlefeedsource.js";
import { bundlePageUrl } from "./deallinks.js";

const EDITION = /\s(?:game of the year|goty|definitive|complete|deluxe|ultimate|gold|enhanced|remastered|special|standard|digital|anniversary|legendary|premium|collector's?)\s+edition$|\sedition$/;
/** A title boiled down so "The Witcher® 3: Wild Hunt – Complete Edition" and "Witcher 3 Wild Hunt" meet. */
export function normTitle(t) {
    let s = String(t ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[™®©]/g, "").replace(/&/g, " and ");
    s = s.replace(/[^a-z0-9' ]+/g, " ").replace(/'/g, "").replace(/\s+/g, " ").trim().replace(/^the /, "");
    for (let i = 0; i < 2; i++) s = s.replace(EDITION, "").trim();
    return s;
}

/** Games of one bundle that are on a person's wishlist (rows are { itad_id, title }). */
export function matchesIn(bundleGames, wishlistRows) {
    const have = new Map();
    for (const g of bundleGames ?? []) { const k = normTitle(g); if (k.length >= 3 && !have.has(k)) have.set(k, g); }
    const out = [], seen = new Set();
    for (const r of wishlistRows) { const k = normTitle(r.title); if (have.has(k) && !seen.has(k)) { seen.add(k); out.push({ itad_id: r.itad_id, title: have.get(k) }); } }
    return out;
}

export function bundleMatchEmbed(b, matches, { owned = 0 } = {}) {
    const store = BUNDLE_STORES[b.store] ?? { name: b.store, emoji: "📦", color: 0x4da3ff, home: b.url };
    const n = matches.length;
    const shown = matches.slice(0, 8).map(m => `• **${m.title}**`).join("\n") + (n > 8 ? `\n*and ${n - 8} more*` : "");
    const page = (b.id && bundlePageUrl(b.id)) || b.url; // our own page when the site address is set, otherwise the store
    return {
        embeds: [{
            color: store.color,
            author: { name: `${store.emoji} ${store.name} · bundle match` },
            title: n === 1 ? `A bundle has a game from your wishlist: ${matches[0].title}` : `A bundle has ${n} games from your wishlist`,
            url: page,
            description: `**${b.title}**${b.price ? ` · ${b.price}` : ""}\n${shown}`,
            fields: [
                ...(b.games?.length ? [{ name: "In total", value: `${b.game_count ?? b.games.length} games` + (owned > 0 ? `, ${owned} already in your library` : ""), inline: true }] : []),
                { name: "Ends", value: b.expires_at ? `<t:${Math.floor(b.expires_at / 1000)}:R>` : "No end date listed", inline: true },
                { name: "Worth a look", value: "Bundles often undercut buying each game alone, but check the tiers: the games you want may sit in a higher one.", inline: false }
            ],
            image: b.image ? { url: b.image } : undefined,
            footer: { text: "Steam Value Checker · bundle match · mute \"Bundle and giveaway alerts\" to stop these" }
        }],
        components: [{ type: 1, components: [{ type: 2, style: 5, label: `Get it on ${store.name}`, url: page }] }],
        allowed_mentions: { parse: [] }
    };
}

const DAY = 86400_000, CAP_PER_DAY = 3, FRESH_MS = 48 * 3600_000;

/** After the bundle feed ran: tell each person about fresh bundles that hold games from their wishlist. */
export async function runBundleMatch({ db, notifier, now = Date.now, log = () => {} }) {
    const stats = { bundles: 0, matched: 0, sent: 0, skipped: 0, failed: 0 };
    const fresh = db.listFeedBundles({ status: "active", limit: 100 }).filter(b => b.games?.length && now() - b.first_seen < FRESH_MS && !b.adult);
    if (!fresh.length) return stats;
    const byUser = new Map();
    for (const r of db.wishlistTitleRows()) { if (!byUser.has(r.discord_id)) byUser.set(r.discord_id, []); byUser.get(r.discord_id).push(r); }
    for (const b of fresh) {
        stats.bundles++;
        for (const [id, rows] of byUser) {
            if (db.hasBundleMatch(b.id, id)) continue;
            const m = matchesIn(b.games, rows);
            if (!m.length) continue;
            stats.matched++;
            const user = db.getUser(id);
            if (!user || db.isBanned?.(id) || user.paused) { stats.skipped++; continue; }
            if (db.countBundleMatchesSince(id, now() - DAY) >= CAP_PER_DAY) { stats.skipped++; continue; }
            db.addBundleMatch(b.id, id, m.map(x => x.title)); // recorded first, so a slow send can never double up
            try {
                const r = await notifier.deliver(user, bundleMatchEmbed(b, m, { owned: matchesIn(b.games, db.userLibraryRows(id)).length }), "bundle", { bundleId: b.id });
                if (r?.ok) stats.sent++; else { stats.failed++; log(`bundle match for ${id}: ${r?.reason ?? "not delivered"}`); }
            } catch (e) { stats.failed++; log(`bundle match for ${id}: ${e.message}`); }
        }
    }
    db.pruneBundleMatches(now() - 30 * DAY);
    return stats;
}

/** How many members of a server have at least one game from this bundle on their wishlist. Only a number, never who. */
export function watchersIn(db, guildId, bundle) {
    const by = new Map();
    for (const r of db.guildWishlistRows(guildId)) { if (!by.has(r.discord_id)) by.set(r.discord_id, []); by.get(r.discord_id).push(r); }
    let n = 0;
    for (const rows of by.values()) if (matchesIn(bundle.games, rows).length) n++;
    return n;
}

/** For the dashboard: which games of each listed bundle this person already owns. { bundleId: [titles] } */
export function ownedForUser(db, userId, bundles) {
    const rows = db.userLibraryRows(userId), out = {};
    if (!rows.length) return out;
    for (const b of bundles) { const m = matchesIn(b.games, rows); if (m.length) out[b.id] = m.map(x => x.title); }
    return out;
}

/** For the dashboard: which of the listed bundles hold games from this person's wishlist. { bundleId: [titles] } */
export function matchesForUser(db, userId, bundles) {
    const rows = db.userWishlistRows(userId), out = {};
    if (!rows.length) return out;
    for (const b of bundles) { const m = matchesIn(b.games, rows); if (m.length) out[b.id] = m.map(x => x.title); }
    return out;
}
