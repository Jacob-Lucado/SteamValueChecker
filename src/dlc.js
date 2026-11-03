// Sale alerts for DLC and add-ons of games a member plays.
// Steam says which add-ons a game has (public store data, shared by everyone); the price site says what they cost.
import { summarize } from "./report.js";
import { current } from "./alerts.js";
import { money, saleEnds, steamArt } from "./render.js";
import { isQuiet } from "./timeutil.js";

export const DLC_MIN_PERCENT = 40; // a "big" sale, unless the member asked for a higher minimum
export const DLC_CHECK_EVERY_MS = 6 * 3600_000;
export const DLC_PER_MESSAGE = 5;
const MAX_DLC_LOOKUP = 300;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** The add-on app ids in Steam's store details for one game. */
export function parseDlc(json, appid) {
    const d = json?.[String(appid)];
    if (!d?.success) return null;
    return (Array.isArray(d.data?.dlc) ? d.data.dlc : []).map(Number).filter(n => Number.isInteger(n) && n > 0);
}

export async function fetchDlcList(appid, fetchImpl = globalThis.fetch) {
    const res = await fetchImpl(`https://store.steampowered.com/api/appdetails?appids=${Number(appid)}&filters=basic`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`steam ${res.status}`);
    return parseDlc(await res.json(), appid);
}

/** Looks up add-on lists for games that need it, slowly. A game Steam has no details for is stored as having none, so it isn't asked again for two weeks. */
export async function refreshDlc({ db, appids, fetchImpl = globalThis.fetch, delayMs = 1500 }) {
    let done = 0;
    for (const appid of appids) {
        try { db.saveAppDlc(appid, (await fetchDlcList(appid, fetchImpl)) ?? []); done++; }
        catch { break; } // rate limited or offline: the rest waits for the next run
        if (delayMs) await sleep(delayMs);
    }
    return done;
}

export function dlcEmbed({ title, base, appid, now, expiryNote = true }) {
    const c = now.currency ?? "USD", pct = Math.round((now.discount ?? 0) * 100);
    const saves = now.regular != null && now.price != null && now.regular > now.price ? ` (you save ${money(now.regular - now.price, c)})` : "";
    const lines = [`DLC for **${base}**, a game you play.`, `**${money(now.price, c)}**${now.shop ? ` at **${now.shop}**` : ""}${saves}`];
    const ends = expiryNote ? saleEnds(now.expiry) : null;
    if (ends) lines.push(ends);
    const fields = [{ name: "Regular", value: money(now.regular, c), inline: true }, { name: "Discount", value: `${pct}% off`, inline: true }];
    if (now.atl != null) fields.push({ name: "All-time low", value: money(now.atl, c), inline: true });
    return {
        color: 0x57f287, title: `🧩 ${title} is ${pct}% off`, url: /^https:\/\//.test(now.url ?? "") ? now.url : undefined, description: lines.join("\n"), fields,
        thumbnail: Number.isInteger(appid) ? { url: steamArt(appid) } : undefined,
        footer: { text: "DLC sale alerts can be turned off with /alerts dlc  •  Prices by IsThereAnyDeal" }
    };
}

/**
 * For each member with DLC alerts on: add-ons of the games they play that are on a big sale and that they haven't been told about at that price.
 * The first check is quiet (it only remembers what is already on sale), and each member is checked at most every six hours.
 */
export async function runDlcSales({ db, itad, notifier, now = () => Date.now(), log = () => {}, every = DLC_CHECK_EVERY_MS }) {
    const stats = { checked: 0, found: 0, delivered: 0, failed: 0, deferred: 0 };
    for (const user of db.dlcUsers()) {
        const id = user.discord_id, last = Number(db.getMeta(`dlcrun:${id}`) ?? 0);
        if (now() - last < every) continue;
        const owned = db.ownedWithDlc(id);
        if (!owned.length) continue;
        const baseOf = new Map();
        for (const g of owned) for (const d of g.dlc) if (!baseOf.has(d)) baseOf.set(d, g.title);
        const apps = [...baseOf.keys()].slice(0, MAX_DLC_LOOKUP);
        let map, prices;
        try {
            map = await itad.lookupShopIds(61, apps.map(a => `app/${a}`));
            const ids = [...new Set([...map.values()].filter(Boolean))];
            if (!ids.length) { db.setMeta(`dlcrun:${id}`, now()); continue; }
            prices = await itad.getPrices(ids, user.region);
        } catch (err) { log(`dlc lookup failed: ${err.code ?? err.name}`); stats.error = err.code ?? err.name; continue; }
        db.setMeta(`dlcrun:${id}`, now());
        stats.checked++;
        const floor = Math.max(DLC_MIN_PERCENT, user.min_discount ?? 0) / 100;
        const sales = [];
        for (const app of apps) {
            const itadId = map.get(`app/${app}`);
            if (!itadId) continue;
            const n = current(summarize(prices.get(itadId), { majorOnly: user.stores === "major" }));
            if (n.price == null || n.price <= 0 || (n.discount ?? 0) < floor) continue;
            sales.push({ itadId, app, base: baseOf.get(app), now: { ...n, currency: n.currency ?? "USD" }, key: `dlc:${itadId}:${Math.round(n.price * 100)}` });
        }
        const first = !db.hasSeen(id, "dlcstart");
        if (first) { for (const x of sales) db.markSeen(id, x.key); db.markSeen(id, "dlcstart"); continue; }
        const hits = sales.filter(x => !db.hasSeen(id, x.key)).sort((a, b) => b.now.discount - a.now.discount);
        if (!hits.length) continue;
        stats.found += hits.length;
        if (isQuiet(user, now())) { stats.deferred += hits.length; continue; }
        const part = hits.slice(0, DLC_PER_MESSAGE);
        for (const x of part) { try { x.title = (await itad.getTitle(x.itadId))?.title ?? null; } catch { x.title = null; } }
        const shown = part.filter(x => x.title);
        if (!shown.length) continue;
        const payload = {
            embeds: shown.map(x => dlcEmbed({ title: x.title, base: x.base, appid: x.app, now: x.now })),
            components: shown.map(x => (/^https:\/\//.test(x.now.url ?? "") ? { type: 1, components: [{ type: 2, style: 5, label: `Deal: ${x.title}`.slice(0, 80), url: x.now.url }] } : null)).filter(Boolean).slice(0, 5)
        };
        const res = await notifier.deliver(user, payload, "dlc");
        if (!res.ok) { stats.failed += shown.length; continue; }
        stats.delivered += shown.length;
        for (const x of shown) { db.markSeen(id, x.key); db.logAlert({ discord_id: id, itad_id: x.itadId, title: x.title, kind: "dlc", price: x.now.price, regular: x.now.regular, shop: x.now.shop, via: res.via }); }
    }
    return stats;
}
