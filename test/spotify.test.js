import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseSpotifyUrl, isSpotifyUrl, parseEmbed, createSpotify, pickMatch, matchSongs, searchQuery, SPOTIFY_MAX } from "../src/spotify.js";

const F = n => readFileSync(new URL("./fixtures/" + n, import.meta.url), "utf8");
const ID = "4uLU6hMCjMI75M1A2tKUQC";

test("spotify: which links count", () => {
    assert.deepEqual(parseSpotifyUrl(`https://open.spotify.com/track/${ID}?si=abc`), { type: "track", id: ID });
    assert.deepEqual(parseSpotifyUrl(`https://open.spotify.com/intl-de/album/${ID}`), { type: "album", id: ID });
    assert.deepEqual(parseSpotifyUrl(`https://open.spotify.com/embed/playlist/${ID}`), { type: "playlist", id: ID });
    for (const bad of [`https://open.spotify.com/artist/${ID}`, `https://open.spotify.com/track/short`, `http://open.spotify.com/track/${ID}`, `https://spotify.evil.com/track/${ID}`, `https://evil.com/open.spotify.com/track/${ID}`, "spotify:track:" + ID, "", "nope"]) assert.equal(isSpotifyUrl(bad), false, bad);
});

test("spotify: song lists are read from real embed pages", () => {
    const t = parseEmbed(F("spotify-track.html"), "track");
    assert.deepEqual([t.kind, t.title, t.tracks.length], ["track", "Never Gonna Give You Up", 1]);
    assert.deepEqual(t.tracks[0], { title: "Never Gonna Give You Up", artist: "Rick Astley", durationMs: 213573 });
    const a = parseEmbed(F("spotify-album.html"), "album");
    assert.deepEqual([a.title, a.owner, a.tracks.length, a.tracks[0].title], ["The Dark Side of the Moon", "Pink Floyd", 10, "Speak to Me"]);
    const p = parseEmbed(F("spotify-playlist.html"), "playlist");
    assert.deepEqual([p.title, p.tracks.length, p.tracks[0].artist], ["Today’s Top Hits", 6, "Tame Impala"]);
    assert.throws(() => parseEmbed(F("spotify-track.html"), "album"), /couldn't read that Spotify link/, "a page of the wrong kind");
    assert.throws(() => parseEmbed("<html>nothing</html>", "playlist"), /couldn't read/);
    assert.throws(() => parseEmbed('<script id="__NEXT_DATA__">{bad</script>', "playlist"), /couldn't read/);
    const empty = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { state: { data: { entity: { type: "playlist", title: "Mine", trackList: [] } } } } } })}</script>`;
    assert.throws(() => parseEmbed(empty, "playlist"), /no songs I can read.*public/);
});

test("spotify: reading a link asks the embed page, caps the list and turns failures into a plain message", async () => {
    const urls = [];
    const big = { props: { pageProps: { state: { data: { entity: { type: "playlist", title: "Big", subtitle: "Me", trackList: Array.from({ length: 50 }, (_, i) => ({ title: "S" + i, subtitle: "A", duration: 1000, entityType: "track", isPlayable: true })) } } } } } };
    const ok = createSpotify({ fetchImpl: async url => { urls.push(url); return { ok: true, text: async () => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(big)}</script>` }; } });
    const r = await ok.read(`https://open.spotify.com/playlist/${ID}?si=1`);
    assert.deepEqual(urls, [`https://open.spotify.com/embed/playlist/${ID}`]);
    assert.deepEqual([r.total, r.tracks.length, SPOTIFY_MAX], [50, 30, 30]);
    await assert.rejects(createSpotify({ fetchImpl: async () => ({ ok: false, status: 500 }) }).read(`https://open.spotify.com/track/${ID}`), /Spotify didn't answer/);
    await assert.rejects(createSpotify({ fetchImpl: async () => { throw new Error("offline"); } }).read(`https://open.spotify.com/track/${ID}`), /Spotify didn't answer/);
    await assert.rejects(ok.read("https://example.com/x"), /isn't a Spotify/);
});

const want = { title: "Loser", artist: "Tame Impala", durationMs: 223_000 };
const cand = (title, artist, duration) => ({ url: "https://soundcloud.com/x/" + title.replace(/\W+/g, "-"), title, artist, duration });

test("spotify: the right SoundCloud upload is picked, and a wrong one is not", () => {
    const official = cand("Tame Impala - Loser", "Uploader", 224), remix = cand("Tame Impala - Loser (Remix)", "DJ", 223), cover = cand("Loser cover by Sam", "Sam", 223), other = cand("Beck - Loser", "Beck", 235);
    assert.equal(pickMatch(want, [remix, cover, other, official]), official, "not the remix, cover or another band's song of the same name");
    assert.equal(pickMatch(want, [remix, cover, other]), null, "nothing close enough is better than the wrong song");
    assert.equal(pickMatch(want, [cand("Loser", "Somebody else", 90)]), null, "the title alone isn't enough");
    assert.equal(pickMatch(want, [cand("Loser", "Tame Impala", null)]).title, "Loser", "the artist agreeing is enough when the length is unknown");
    assert.equal(pickMatch(want, [cand("Loser", "Somebody else", 224)]).title, "Loser", "or the length agreeing");
    assert.equal(pickMatch({ title: "Song (feat. Guest) - Remastered 2011", artist: "Band, Guest", durationMs: 200_000 }, [cand("Band - Song", "x", 201)]).title, "Band - Song", "featured artists and remaster tags are ignored");
    assert.equal(pickMatch({ title: "Song (Remix)", artist: "Band", durationMs: 200_000 }, [cand("Band - Song (Remix)", "x", 200)]).title, "Band - Song (Remix)", "a remix is fine when the remix is what was asked for");
    assert.equal(pickMatch({ title: "Speak to Me", artist: "Pink Floyd", durationMs: 64_000 }, [cand("Speak to Me", "Pink Floyd", 30)]), null, "SoundCloud's 30 second previews aren't the song");
    assert.equal(pickMatch({ title: "Us and Them", artist: "Pink Floyd", durationMs: 469_000 }, [cand("[FREE DOWNLOAD] Pink Floyd - Us And Them (Rework) [Preview]", "J.P.", 240)]), null);
    assert.equal(searchQuery({ title: "Song (feat. Guest)", artist: "Band, Guest" }), "band song");
    assert.equal(pickMatch(want, []), null); assert.equal(pickMatch(want, undefined), null);
});

test("spotify: songs are matched a few at a time, with the missing and failed ones counted", async () => {
    const songs = Array.from({ length: 9 }, (_, i) => ({ title: "Song" + i, artist: "Band", durationMs: 100_000 }));
    let live = 0, peak = 0;
    const search = async q => {
        live++; peak = Math.max(peak, live); await new Promise(r => setTimeout(r, 5)); live--;
        if (q.includes("song3")) return [];
        if (q.includes("song5")) throw new Error("soundcloud down");
        const t = q.split(" ").pop(); return [cand("Band - " + t, "Band", 100)];
    };
    const r = await matchSongs(songs, search, { concurrency: 3 });
    assert.equal(r.tracks.length, 7); assert.equal(r.failed, 1); assert.deepEqual(r.missing.sort(), ["Band - Song3", "Band - Song5"]);
    assert.ok(peak <= 3 && peak > 1, "limited concurrency");
    let t = 0; const late = await matchSongs(songs, async () => { t += 100_000; return []; }, { concurrency: 1, deadlineMs: 150_000, now: () => t });
    assert.ok(late.tracks.length === 0 && late.missing.length === 9, "stops asking once the time is up and lists the rest as missing");
});
