// Bundle tracker: record a bundle you bought, see what its games are worth now and what each one cost you.
import { summarize } from "./report.js";
import { UserError } from "./errors.js";
import { importLibrary } from "./library.js";
import { MAX_BUNDLES } from "./bundlestore.js";

export const verdictFor = (paid, msrp) => {
    if (!(msrp > 0)) return null;
    const off = Math.round((1 - paid / msrp) * 100);
    return off >= 50 ? { tone: "ok", text: `Great: ${off}% under full price` } : off >= 15 ? { tone: "ok", text: `Good: ${off}% under full price` } : off >= 0 ? { tone: "", text: "About full price" } : { tone: "bad", text: "Cost more than buying the games separately" };
};

/** Resolves the titles, files the new games in the library (paid split evenly, existing games keep what you paid) and saves the bundle. */
export async function addBundle(db, itad, userId, { name, paid, titles }) {
    const cleanName = String(name ?? "").trim().slice(0, 80);
    if (!cleanName) throw new UserError("Give the bundle a name.");
    if (!Number.isFinite(paid) || paid < 0 || paid > 10_000) throw new UserError("What you paid must be a number from 0 to 10,000.");
    const list = [...new Set((Array.isArray(titles) ? titles : String(titles ?? "").split(/[\n,;|]+/)).map(t => String(t).trim()).filter(Boolean))].slice(0, 60);
    if (list.length < 2) throw new UserError("List at least 2 games, separated by commas.");
    if (db.countBundles(userId) >= MAX_BUNDLES) throw new UserError(`You have ${MAX_BUNDLES} bundles saved. Remove one first.`);
    const resolved = await itad.lookupTitles(list);
    const found = resolved.filter(r => r.id);
    const notFound = resolved.filter(r => !r.id).map(r => r.title);
    if (found.length < 2) throw new UserError("I could only match fewer than 2 of those titles. Check the spelling.");
    const have = new Set(db.listLibrary(userId).map(l => l.itad_id));
    const each = Math.round(paid / found.length * 100) / 100;
    const fresh = found.filter(r => !have.has(r.id)).map(r => ({ title: r.approx ? r.matched : r.title, paid: each }));
    if (fresh.length) await importLibrary(db, itad, userId, fresh);
    const id = db.addBundle(userId, cleanName, paid, [...new Set(found.map(r => r.id))]);
    return { id, matched: found.length, notFound, newGames: fresh.length };
}

/** Every saved bundle with what its games cost at full price and today's cheapest, and the hours played. */
export async function bundleView(db, itad, user) {
    const bundles = db.listBundles(user.discord_id);
    if (!bundles.length) return { bundles: [], currency: "USD" };
    const ids = [...new Set(bundles.flatMap(b => b.ids))];
    const prices = await itad.getPrices(ids, user.region);
    const lib = new Map(db.listLibrary(user.discord_id).map(l => [l.itad_id, l]));
    let currency = "USD";
    const out = bundles.map(b => {
        let msrp = 0, cheapest = 0, minutes = 0, played = 0, titles = [];
        for (const id of b.ids) {
            const s = summarize(prices.get(id), { majorOnly: user.stores === "major" });
            if (s.currency) currency = s.currency;
            msrp += s.msrp ?? 0; cheapest += s.best?.price ?? 0;
            const row = lib.get(id);
            if (row) { titles.push(row.title); minutes += row.minutes ?? 0; if ((row.minutes ?? 0) > 0 || ["played", "finished"].includes(row.status)) played++; }
        }
        return { id: b.id, name: b.name, paid: b.paid, boughtAt: b.bought_at, games: b.ids.length, msrp, cheapest, hours: Math.round(minutes / 6) / 10, played, perGame: b.ids.length ? b.paid / b.ids.length : 0, verdict: verdictFor(b.paid, msrp), titles: titles.slice(0, 8) };
    });
    return { bundles: out, currency, totals: { paid: out.reduce((t, b) => t + b.paid, 0), msrp: out.reduce((t, b) => t + b.msrp, 0) } };
}
