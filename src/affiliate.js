// Affiliate links. Right now that means Fanatical through Awin. It stays off until the owner turns it on in Admin,
// because Awin only pays once the Fanatical programme has accepted the site.
const PUBLISHER = "3164574";
const MERCHANT = "118821"; // Fanatical Global on Awin
const isFanatical = u => { try { const x = new URL(u); return x.protocol === "https:" && /(^|\.)fanatical\.com$/i.test(x.hostname); } catch { return false; } };

export const affiliateOn = db => db.getMeta("affiliate:fanatical") === "1";
export const setAffiliate = (db, on) => db.setMeta("affiliate:fanatical", on ? "1" : "0");

/** The address to send a person to. Fanatical links become Awin tracking links when the switch is on; everything else comes back unchanged.
 *  `tag` says where the click came from (it shows up in Awin's reports), letters, digits, dashes and underscores only. */
export function affiliateUrl(url, { on = false, tag = "" } = {}) {
    if (!on || !url || !isFanatical(url)) return url;
    const ref = String(tag).replace(/[^\w-]/g, "").slice(0, 50);
    const q = new URLSearchParams({ awinmid: MERCHANT, awinaffid: PUBLISHER });
    if (ref) q.set("clickref", ref);
    q.set("ued", url);
    return `https://www.awin1.com/cread.php?${q}`;
}
export const isAffiliated = (url, on) => Boolean(on) && isFanatical(url);
