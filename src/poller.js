// Checks every watched game's price and sends alerts. One price lookup per game and region,
// no matter how many people watch it, in batches of 50 through the ITAD client.

import { summarize } from "./report.js";
import { evaluate, describeTrigger } from "./alerts.js";
import { alertEmbed } from "./render.js";

const MAX_EMBEDS = 10; // Discord's limit per message

/**
 * Runs one check. Returns { checked, alerts, delivered, failed }.
 * Items are only marked as alerted after the message was actually delivered, so a failed
 * delivery is retried on the next run instead of being lost.
 */
export async function runCycle({ db, itad, notifier, log = () => {} }) {
    const items = db.activeItems();
    const stats = { checked: items.length, alerts: 0, delivered: 0, failed: 0 };
    if (!items.length) return stats;

    // one lookup per region
    const byRegion = new Map();
    for (const it of items) {
        if (!byRegion.has(it.region)) byRegion.set(it.region, new Set());
        byRegion.get(it.region).add(it.itad_id);
    }
    const prices = new Map();
    for (const [region, ids] of byRegion) {
        try {
            prices.set(region, await itad.getPrices([...ids], region));
        } catch (err) {
            log(`price lookup failed for ${region}: ${err.code ?? err.name}`);
        }
    }

    // evaluate, grouped by user
    const perUser = new Map();
    for (const it of items) {
        const entry = prices.get(it.region)?.get(it.itad_id);
        if (entry === undefined) continue; // lookup failed for this region; try again next run
        const summary = summarize(entry, { majorOnly: it.stores === "major" });
        const result = evaluate(it, summary);
        if (result.action === "reset") db.clearAlerted(it.id);
        if (result.action !== "alert") continue;
        if (!perUser.has(it.discord_id)) perUser.set(it.discord_id, []);
        perUser.get(it.discord_id).push({ item: it, now: result.now, reason: result.reason });
    }

    for (const [userId, list] of perUser) {
        stats.alerts += list.length;
        const user = db.getUser(userId);
        if (!user) continue;
        for (let i = 0; i < list.length; i += MAX_EMBEDS) {
            const part = list.slice(i, i + MAX_EMBEDS);
            const payload = {
                content: part.length > 1 ? `${part.length} games on your wishlist hit your alert.` : undefined,
                embeds: part.map(a => alertEmbed(a.item, a.now, { trigger: describeTrigger(a.item), lower: a.reason === "lower" }))
            };
            const res = await notifier.deliver(user, payload);
            if (res.ok) {
                stats.delivered += part.length;
                for (const a of part) db.markAlerted(a.item.id, a.now.price);
            } else {
                stats.failed += part.length;
                log(`delivery failed (${res.reason})`);
            }
        }
    }
    return stats;
}

/** Runs `fn` now and then every `everyMs`, never overlapping itself. Returns a stop function. */
export function schedule(fn, everyMs, { onError = () => {}, setIntervalImpl = setInterval, clearIntervalImpl = clearInterval } = {}) {
    let running = false;
    const tick = async () => {
        if (running) return;
        running = true;
        try { await fn(); } catch (err) { onError(err); } finally { running = false; }
    };
    const handle = setIntervalImpl(tick, everyMs);
    handle.unref?.();
    tick();
    return () => clearIntervalImpl(handle);
}
