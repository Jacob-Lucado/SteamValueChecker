// Libraries from other game platforms, next to Steam. The member gives a key from their own account, we read the list of games once and
// keep only the titles. The key itself is never stored or logged.
import { UserError } from "./errors.js";
import { importLibrary } from "./library.js";

const UA = { "User-Agent": "SteamValueChecker/1.0", "Accept": "application/json" };
async function getJson(url, headers, fetchFn) {
    let res;
    try { res = await fetchFn(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout?.(15000) }); }
    catch { throw new UserError("I couldn't reach that service just now. Try again in a minute."); }
    if (res.status === 401 || res.status === 403) throw new UserError("That key was refused. Check that you copied the whole thing and that it's still active.");
    if (res.status === 429) throw new UserError("That service is rate limiting us. Try again in a few minutes.");
    if (!res.ok) throw new UserError(`That service answered ${res.status}. Try again later.`);
    return res.json();
}

/** itch.io: the games and keys on your account, using the API key from your itch.io settings. */
export async function itchGames(key, fetchFn = globalThis.fetch) {
    const out = [], seen = new Set();
    for (let page = 1; page <= 20; page++) {
        const data = await getJson(`https://itch.io/api/1/${encodeURIComponent(key)}/my-owned-keys?page=${page}`, {}, fetchFn);
        if (data?.errors?.length) throw new UserError("itch.io said no to that key. Make one under Settings, then API keys.");
        const keys = data?.owned_keys ?? [];
        for (const k of keys) {
            const title = String(k?.game?.title ?? "").trim();
            if (title && !seen.has(title.toLowerCase())) { seen.add(title.toLowerCase()); out.push({ title }); }
        }
        if (keys.length < 50) break;
    }
    return out;
}

/** Xbox, through an OpenXBL key (a free third-party service that reads your Xbox profile). It lists games you have played. */
export async function xboxGames(key, fetchFn = globalThis.fetch) {
    const data = await getJson("https://xbl.io/api/v2/achievements", { "X-Authorization": key }, fetchFn);
    const titles = data?.titles ?? [];
    const out = [], seen = new Set();
    for (const t of titles) {
        const title = String(t?.name ?? "").trim();
        if (!title || !/pc|xbox|windows/i.test(JSON.stringify(t?.devices ?? ["xbox"]))) continue;
        if (!seen.has(title.toLowerCase())) { seen.add(title.toLowerCase()); out.push({ title }); }
    }
    return out;
}

export const PLATFORMS = [
    { id: "itch", label: "itch.io", icon: "🎮", needsKey: true, load: itchGames, keyLabel: "itch.io API key",
      how: "On itch.io open Settings, then API keys, and make one. Paste it here. It's used once to read your games and then thrown away." },
    { id: "xbox", label: "Xbox", icon: "🟢", needsKey: true, load: xboxGames, keyLabel: "OpenXBL API key",
      how: "Sign in at xbl.io with your Microsoft account, copy your API key from the profile page and paste it here. It's used once to read the games you've played, then thrown away." },
    { id: "gog", label: "GOG", icon: "🟣", needsKey: false,
      why: "GOG doesn't give out a way to read a library without your login. Use the file import on My library: a GOG Galaxy export or a list of titles works." },
    { id: "epic", label: "Epic Games Store", icon: "⚫", needsKey: false,
      why: "Epic has no official way to read a library. Export yours with the free Legendary tool (`legendary list --csv`), then upload that file on My library. It reads Legendary's export directly, skips DLC, and your Epic login never touches us." },
    { id: "playstation", label: "PlayStation", icon: "🔵", needsKey: false,
      why: "Sony has no official library feed, and the unofficial ways need a token that gives away your whole account, so we won't ask for it. Paste titles on My library instead." },
    { id: "nintendo", label: "Nintendo", icon: "🔴", needsKey: false,
      why: "Nintendo doesn't offer a library feed at all. Paste titles on My library instead." }
];

const MAX = 600;

/** Reads the list and adds the games to the member's library, tagged with where they came from. Returns the counts. */
export async function syncPlatform({ db, itad, userId, platform, key, fetchFn = globalThis.fetch }) {
    const p = PLATFORMS.find(x => x.id === platform);
    if (!p?.load) throw new UserError("That platform can't be synced from here.");
    const k = String(key ?? "").trim();
    if (k.length < 8 || k.length > 200 || /\s/.test(k)) throw new UserError(`Paste your ${p.keyLabel} as it is, with no spaces.`);
    const games = (await p.load(k, fetchFn)).slice(0, MAX);
    if (!games.length) throw new UserError(`I found no games on that ${p.label} account. If you do have some, check the key and that the profile shares them.`);
    const r = await importLibrary(db, itad, userId, games, { platform: p.id });
    return { platform: p.id, found: games.length, added: r.added, updated: r.updated, skippedForLimit: r.skippedForLimit, notFound: r.notFound.slice(0, 30) };
}
