// Sample alerts, so a member can see what each kind looks like in their own DMs before the real ones arrive.
import { alertEmbed, bundleEmbed, subEmbed, newsEmbed, releaseEmbed, freeGamesPayload } from "./render.js";

export const SAMPLE_KINDS = ["sale", "free", "bundle", "sub", "news", "release"];
const NOTE = "🧪 **Sample alert.** You asked for this from the dashboard to see how alerts look. It isn't a real deal.";
const SHOP = "https://store.steampowered.com/";

/** The message to send for one kind of sample, or null for a kind that is not known. */
export function sampleAlert(kind, { now = Date.now(), currency = "USD" } = {}) {
    const day = 86400_000;
    const item = { title: "Sample Quest", priority: false };
    let p;
    switch (kind) {
        case "sale": p = { embeds: [alertEmbed(item, { price: 7.49, regular: 29.99, discount: 0.75, shop: "Steam", currency, atl: 6.99, url: SHOP, expiry: now + 2 * day }, { trigger: "any price drop", reviews: { desc: "Very Positive", pct: 92, total: 18420 } })] }; break;
        case "free": p = freeGamesPayload("Epic Games Store", [{ id: "sample", title: "Sample Quest", url: SHOP, expiry: now + day, type: "game" }]); break;
        case "bundle": p = { embeds: [bundleEmbed({ item, bundle: { title: "Sample Quest Bundle", shop: "Humble Bundle", price: 12, currency, url: SHOP, expiry: now + 5 * day, tiers: [] } })] }; break;
        case "sub": p = { embeds: [subEmbed({ item, sub: { name: "Game Pass", leaving: now + 20 * day }, kind: "sub" })] }; break;
        case "news": p = { embeds: [newsEmbed({ gameTitle: "Sample Quest", title: "Patch 1.2: new quests and fixes", summary: "A sample post, with the first lines of the real announcement under the title.", url: SHOP, date: now, patch: true })] }; break;
        case "release": p = { embeds: [releaseEmbed({ title: "Sample Quest", releaseAt: now, best: { price: 24.99, shop: "Steam" }, currency, url: SHOP })] }; break;
        default: return null;
    }
    if (!p) return null;
    return { ...p, content: p.content ? `${NOTE}\n${p.content}` : NOTE };
}
