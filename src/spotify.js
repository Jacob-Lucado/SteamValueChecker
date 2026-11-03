// Spotify links for the music feature. Spotify's audio is copy-protected, so it can't be played from here. What is public is the
// title and artist of each song, which Spotify's own embed pages show without any account or key. So a Spotify track, album or
// playlist link is read for its song list, and each song is then looked up on SoundCloud and played from there. Some will be a
// different upload than the original and a few won't be found, which the reply says.
const SPOTIFY_HOST = /^(?:open|www)\.spotify\.com$/i;
const KINDS = new Set(["track", "album", "playlist"]);
export const SPOTIFY_MAX = 30; // songs taken from one link, so matching them stays quick

/** { type, id } for a Spotify track, album or playlist link, or null. */
export function parseSpotifyUrl(text) {
    try {
        const u = new URL(String(text).trim());
        if (u.protocol !== "https:" || !SPOTIFY_HOST.test(u.hostname)) return null;
        const parts = u.pathname.split("/").filter(Boolean).filter(p => !/^intl-[a-z-]+$/i.test(p) && p.toLowerCase() !== "embed");
        const [type, id] = parts;
        return KINDS.has(type) && /^[A-Za-z0-9]{22}$/.test(id ?? "") ? { type, id } : null;
    } catch { return null; }
}
export const isSpotifyUrl = text => parseSpotifyUrl(text) !== null;

const clean = s => String(s ?? "").replace(/[\r\n\0]+/g, " ").trim();

/** Reads the song list out of an embed page. Throws a message fit to show when the page has nothing readable (a private playlist, say). */
export function parseEmbed(html, type) {
    const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(String(html ?? ""));
    let entity = null;
    try { entity = JSON.parse(m?.[1] ?? "null")?.props?.pageProps?.state?.data?.entity ?? null; } catch { /* handled below */ }
    if (!entity || entity.type !== type) throw Object.assign(new Error("I couldn't read that Spotify link. Is it a public track, album or playlist?"), { userFacing: true });
    const artistOf = t => clean(t.subtitle ?? (Array.isArray(t.artists) ? t.artists.map(a => a.name).join(", ") : ""));
    const list = type === "track" ? [entity] : (entity.trackList ?? []);
    const tracks = list.filter(t => t && t.isPlayable !== false && (t.entityType ?? "track") === "track" && clean(t.title ?? t.name))
        .map(t => ({ title: clean(t.title ?? t.name).slice(0, 150), artist: artistOf(t).slice(0, 100), durationMs: Number(t.duration) > 0 ? Number(t.duration) : null }));
    if (!tracks.length) throw Object.assign(new Error("There are no songs I can read in that Spotify link. A private playlist can't be read; make it public first."), { userFacing: true });
    return { kind: type, title: clean(entity.title ?? entity.name).slice(0, 120) || "Spotify", owner: type === "track" ? "" : clean(entity.subtitle).slice(0, 80), tracks };
}

export function createSpotify({ fetchImpl = globalThis.fetch } = {}) {
    return {
        /** The song list behind a Spotify link: { kind, title, owner, tracks: [{ title, artist, durationMs }], total }. */
        async read(url) {
            const p = parseSpotifyUrl(url);
            if (!p) throw Object.assign(new Error("That isn't a Spotify track, album or playlist link."), { userFacing: true });
            let html;
            try {
                const res = await fetchImpl(`https://open.spotify.com/embed/${p.type}/${p.id}`, { signal: AbortSignal.timeout(10_000), headers: { "User-Agent": "Mozilla/5.0 (compatible; SteamValueChecker/1.0; +https://steamvaluechecker.com)", "Accept-Language": "en" } });
                if (!res.ok) throw new Error(`spotify ${res.status}`);
                html = await res.text();
            } catch (err) { if (err?.userFacing) throw err; throw Object.assign(new Error("Spotify didn't answer. Try again in a moment."), { userFacing: true }); }
            const r = parseEmbed(html, p.type);
            return { ...r, total: r.tracks.length, tracks: r.tracks.slice(0, SPOTIFY_MAX) };
        }
    };
}

// ---------- finding the same song on SoundCloud ----------
const BAD = /\b(?:remix|mix|rework|bootleg|preview|snippet|cover|nightcore|slowed|sped\s*up|reverb|karaoke|instrumental|8d|bass\s*boosted|mashup|tribute|acoustic|live)\b/i;
const tokens = s => String(s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").split(/[^a-z0-9]+/).filter(Boolean);
/** "Song (feat. Someone) - Remastered 2011" -> "Song": the part a SoundCloud title is most likely to share. */
const bareTitle = t => String(t).replace(/\s*[(\[](?:feat|ft|with|prod)\b[^)\]]*[)\]]/gi, "").replace(/\s+-\s+(?:remaster(?:ed)?|\d{4}\b|single version|radio edit|mono|stereo).*$/i, "").trim();

/** Query for a song: "artist title" without the featured-artist noise. */
export const searchQuery = t => `${tokens(t.artist.split(",")[0]).join(" ")} ${tokens(bareTitle(t.title)).join(" ")}`.trim().slice(0, 120);

/** The best SoundCloud result for a Spotify song, or null when nothing is close enough to be the same song. */
export function pickMatch(want, candidates) {
    const wantTitle = new Set(tokens(bareTitle(want.title))), firstArtist = tokens(want.artist.split(",")[0]);
    let best = null, bestScore = 0;
    for (const c of candidates ?? []) {
        const hay = tokens(`${c.title} ${c.artist}`), haySet = new Set(hay);
        if (BAD.test(c.title) && !BAD.test(want.title)) continue; // a remix or cover isn't the song
        const hit = [...wantTitle].filter(w => haySet.has(w)).length;
        const titleRatio = wantTitle.size ? hit / wantTitle.size : 0;
        if (titleRatio < 0.6) continue;
        const artistOk = firstArtist.length > 0 && firstArtist.every(w => haySet.has(w));
        const diff = want.durationMs && c.duration ? Math.abs(c.duration - want.durationMs / 1000) : null;
        const lengthOk = diff !== null && diff <= 8;
        if (diff !== null && diff > Math.max(25, want.durationMs / 4000)) continue; // far too short or long: a 30 second preview, a mix or a different version
        if (!artistOk && !lengthOk) continue; // the title alone isn't enough: another band's song can share it
        let score = 3 + (titleRatio >= 0.99 ? 1 : 0) + (artistOk ? 2 : 0);
        if (diff !== null) score += diff <= 8 ? 4 : 2;
        if (score > bestScore) { best = c; bestScore = score; }
    }
    return best;
}

/** Looks every song up with `search(query, n)` a few at a time. Songs that aren't found are listed in `missing`. */
export async function matchSongs(songs, search, { concurrency = 4, deadlineMs = 90_000, now = () => Date.now() } = {}) {
    const found = new Array(songs.length).fill(null), stop = now() + deadlineMs;
    let next = 0, failed = 0;
    const worker = async () => {
        while (next < songs.length && now() < stop) {
            const i = next++, s = songs[i];
            try { found[i] = pickMatch(s, await search(searchQuery(s), 4)); } catch { failed++; }
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, songs.length) }, worker));
    return { tracks: found.filter(Boolean), missing: songs.filter((_, i) => !found[i]).map(s => `${s.artist ? s.artist.split(",")[0] + " - " : ""}${s.title}`), failed };
}
