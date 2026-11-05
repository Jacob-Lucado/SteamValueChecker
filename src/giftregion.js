// Gifting across regions: a Steam gift can be blocked, or priced differently, when the two people are in different Steam regions.
// A member's region is the country on their synced Steam profile when we have it, otherwise the price region they set for the bot.
import { grabberRegion, regionCurrency } from "./spend.js";

export function giftRegion(db, userId) {
    const user = db.getUser(userId);
    const cc = db.getSteamLink(userId)?.country ?? null;
    const region = grabberRegion(user, cc);
    return { region, currency: regionCurrency(region), fromSteam: Boolean(cc) };
}

/** null when the two are in the same region (or one is unknown); otherwise what differs. */
export function compareGiftRegions(db, visitorId, ownerId) {
    if (!db.getUser(visitorId) || !db.getUser(ownerId)) return null;
    const you = giftRegion(db, visitorId), them = giftRegion(db, ownerId);
    if (you.region === them.region) return null;
    return { yours: you.region, theirs: them.region, yoursCurrency: you.currency, theirsCurrency: them.currency, currencyDiffers: you.currency !== them.currency, yoursFromSteam: you.fromSteam };
}
