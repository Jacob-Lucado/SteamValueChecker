// Fake Steam and Discord links: look-alike addresses (steamcomunity.com, discorcl.gift), "free Nitro" and "free Steam gift" pages.
// A server about Steam has plenty of honest steam-something sites, so this only fires on near-misses of the real addresses and on
// the classic bait words sitting in an address that isn't the real thing. Pure functions.

const REAL = ["steampowered.com", "steamcommunity.com", "steamstatic.com", "steamgames.com", "steam.com", "discord.com", "discord.gg", "discord.gift", "discordapp.com", "discordapp.net", "discord.media", "discordstatus.com"];
// Honest sites with Steam or Discord in the name, so they never count.
const FINE = ["steamdb.info", "steamgifts.com", "steamspy.com", "steamcharts.com", "steamrep.com", "steamladder.com", "steamcardexchange.co.uk", "steamid.io", "steamidfinder.com", "steamlvlup.com", "steamanalyst.com", "steamwebapi.com", "steamdeckhq.com", "steamunlocked.net", "discordservers.com", "discord.me", "discordbotlist.com", "discords.com", "top.gg", "disboard.org"];
const BAIT = /(?:^|[-.])(?:free|gift|gifts|nitro|promo|giveaway|airdrop|trade|offer|drop)(?:[-.]|$)/;

const registrable = host => { const p = host.split("."); return p.length <= 2 ? host : (p.at(-2).length <= 3 && p.at(-1).length === 2 ? p.slice(-3).join(".") : p.slice(-2).join(".")); };
function distance(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 9;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
}
const hostOf = u => { try { return new URL(/^https?:/i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };

/** Is this address pretending to be Steam or Discord? */
export function isPhishHost(host) {
    const h = String(host ?? "").toLowerCase();
    if (!h) return false;
    if (h.startsWith("xn--") || h.includes(".xn--")) { if (/steam|discord/.test(h)) return true; }
    const reg = registrable(h);
    if (REAL.includes(reg) || FINE.includes(reg)) return false;
    // one or two letters off from a real address (steamcomunity.com, steampowerd.com, discorcl.gift)
    if (REAL.some(r => distance(reg, r) <= 2 && reg !== r && Math.min(reg.split(".")[0].length, r.split(".")[0].length) >= 6)) return true;
    // the brand plus bait words, on a domain that isn't theirs (discord-nitro.xyz, steam-gift.ru)
    const label = reg.split(".")[0];
    return /(?:steam|discord|nitro)/.test(label) && (BAIT.test(label) || /(?:free|gift|nitro|promo|airdrop|giveaway)/.test(label)) && !FINE.includes(reg);
}

/** The links in a message that look like fake Steam or Discord addresses. */
export function phishLinks(text) {
    const urls = String(text ?? "").match(/\bhttps?:\/\/[^\s<>()]+|\bwww\.[^\s<>()]+/gi) ?? [];
    return urls.filter(u => isPhishHost(hostOf(u)));
}
