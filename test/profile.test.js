import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { cleanLink, cleanSong, songEmbed, cleanProfile, withDefaults, buildProfile, DEFAULT_SECTIONS } from "../src/profilepage.js";

test("links: only the right site for each kind, https only, nothing sneaky", () => {
    assert.equal(cleanLink("twitch", "twitch.tv/jacob").url, "https://twitch.tv/jacob");
    assert.throws(() => cleanLink("twitch", "https://evil.example/twitch.tv"), /not a Twitch link/);
    assert.throws(() => cleanLink("website", "http://example.com"), /https/);
    assert.throws(() => cleanLink("website", "https://user:pw@example.com"), /username/);
    assert.throws(() => cleanLink("website", "https://localhost"), /normal website/);
    assert.throws(() => cleanLink("website", "https://127.0.0.1/x"), /normal website/);
    assert.throws(() => cleanLink("website", "javascript:alert(1)"), /link|https/);
    assert.throws(() => cleanLink("nope", "https://x.com"), /Pick one/);
    assert.equal(cleanLink("website", "https://example.com/a#frag").url, "https://example.com/a");
});

test("song: only YouTube, SoundCloud and Spotify, turned into official embeds", () => {
    const yt = cleanSong("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5");
    assert.deepEqual([yt.provider, yt.id], ["youtube", "dQw4w9WgXcQ"]);
    assert.match(songEmbed(yt), /^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?autoplay=1/);
    assert.equal(cleanSong("https://youtu.be/dQw4w9WgXcQ").id, "dQw4w9WgXcQ");
    const sc = cleanSong({ url: "https://soundcloud.com/artist/track-name", title: "  My <b>jam</b>  " });
    assert.equal(sc.title, "My <b>jam</b>");
    assert.match(songEmbed(sc), /^https:\/\/w\.soundcloud\.com\/player\/\?url=https%3A%2F%2Fsoundcloud\.com%2Fartist%2Ftrack-name/);
    const sp = cleanSong("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=abc");
    assert.match(songEmbed(sp), /^https:\/\/open\.spotify\.com\/embed\/track\/4uLU6hMCjMI75M1A2tKUQC/);
    for (const bad of ["https://evil.example/x.mp3", "http://youtu.be/dQw4w9WgXcQ", "https://youtube.com/watch?v=short", "https://soundcloud.com/only-one", "https://open.spotify.com/user/x"]) assert.throws(() => cleanSong(bad), /link|YouTube|SoundCloud|Spotify|https/, bad);
    assert.equal(cleanSong(""), null); assert.equal(cleanSong({ url: "" }), null);
});

test("profile settings are validated and merged", () => {
    const p = cleanProfile({ name: "  Jacob‮  ", bio: "line1\nline2", theme: "ocean", accent: "#AABBCC", bgstyle: "dots", layout: "wide", favorites: ["Hades", "Hades", "Celeste"], links: [{ kind: "x", url: "x.com/me" }] });
    assert.equal(p.name, "Jacob"); assert.equal(p.accent, "#aabbcc"); assert.deepEqual(p.favorites, ["Hades", "Celeste"]); assert.equal(p.links[0].url, "https://x.com/me");
    assert.throws(() => cleanProfile({ theme: "neon" }), /colour theme/);
    assert.throws(() => cleanProfile({ accent: "red" }), /Colours/);
    assert.throws(() => cleanProfile({ links: Array.from({ length: 7 }, () => ({ kind: "website", url: "https://example.com" })) }), /up to 6/);
    const s = cleanProfile({ sections: [{ key: "steam", vis: "server" }, { key: "about", vis: "public" }, { key: "bogus", vis: "public" }] });
    assert.deepEqual(s.sections.slice(0, 2), [{ key: "steam", vis: "server" }, { key: "about", vis: "public" }]);
    assert.equal(s.sections.length, DEFAULT_SECTIONS.length, "missing sections are added back, hidden");
    assert.equal(s.sections.find(x => x.key === "wishlist").vis, "hidden");
    assert.throws(() => cleanProfile({ sections: [{ key: "about", vis: "everyone" }] }), /public, server only or hidden/);
    assert.equal(withDefaults({}).theme, "night");
});

test("a profile only shows what the owner chose, to the people they chose", async () => {
    const db = openDb(":memory:");
    db.ensureUser("o", "g1"); db.updateUser("o", { guild_id: "g1" }); db.setProfile("o", { slug: "owner", isPublic: true });
    db.upsertLibrary("o", [{ itad_id: "a", title: "Hades" }, { itad_id: "b", title: "Celeste" }]); db.setLibraryStatus("o", "b", "finished");
    db.setSteamLink("o", "76561190000000001");
    db.setProfileData("o", cleanProfile({ bio: "hi there", favorites: ["Hades"], sections: [{ key: "about", vis: "public" }, { key: "favorites", vis: "public" }, { key: "recent", vis: "server" }, { key: "steam", vis: "hidden" }, { key: "wishlist", vis: "hidden" }], song: "https://youtu.be/dQw4w9WgXcQ" }));
    const owner = db.getUser("o"), deps = { db, itad: { getPrices: async () => new Map() } };
    const keys = p => p.sections.map(s => s.key);
    const pub = await buildProfile(deps, owner, { owner: false, sameServer: false });
    assert.deepEqual(keys(pub), ["about", "favorites"]);
    assert.equal(pub.bio, "hi there"); assert.equal(pub.song.provider, "youtube");
    assert.doesNotMatch(JSON.stringify(pub), /76561190000000001|Celeste/, "hidden and server-only data never reaches a stranger");
    const mate = await buildProfile(deps, owner, { owner: false, sameServer: true });
    assert.deepEqual(keys(mate), ["about", "favorites", "recent"]);
    assert.equal(mate.sections.find(s => s.key === "recent").games[0].title, "Celeste");
    const me = await buildProfile(deps, owner, { owner: true, sameServer: true });
    assert.ok(keys(me).includes("steam") && keys(me).includes("wishlist"), "the owner sees everything, to preview it");
    const draft = await buildProfile(deps, owner, { owner: true, sameServer: true }, { draft: withDefaults(cleanProfile({ theme: "light", bio: "unsaved" })) });
    assert.equal(draft.bio, "unsaved"); assert.equal(draft.theme.light, true);
});

test("the profile page code loads on its own, without a circular import crash", async () => {
    const { execFileSync } = await import("node:child_process");
    const out = execFileSync(process.execPath, ["--no-warnings", "--input-type=module", "-e", 'import("./src/profilepage.js").then(m => console.log(Object.keys(m.PROFILE_THEMES).length))'], { cwd: new URL("..", import.meta.url).pathname, encoding: "utf8" });
    assert.match(out, /\d/);
});

test("the Discord theme choices match the real themes", async () => {
    const { PROFILE_THEMES } = await import("../src/profilepage.js");
    const { hubCommands } = await import("../src/commands.js");
    const me = hubCommands.find(c => c.name === "me");
    const look = me.options.find(o => o.name === "profile").options.find(o => o.name === "look");
    assert.deepEqual(look.options.find(o => o.name === "theme").choices.map(c => c.value).sort(), Object.keys(PROFILE_THEMES).sort());
});

test("/me profile: small changes save, mistakes are explained, nothing is lost", async () => {
    const { createProfileHandlers } = await import("../src/profilehandlers.js");
    const db = openDb(":memory:"); db.ensureUser("u1", null); db.setProfile("u1", { slug: "jay", isPublic: true });
    const h = createProfileHandlers({ db, publicUrl: "https://svc.test" });
    const run = async (sub, opts = {}) => {
        const out = []; await h.handle({ user: { id: "u1" }, guildId: null, options: { getSubcommand: () => sub, getString: (k, req) => { const v = opts[k] ?? null; if (v === null && req) throw new Error("missing " + k); return v; }, getBoolean: k => opts[k] ?? null }, reply: async o => out.push(o) });
        return out[0];
    };
    assert.match((await run("bio", { text: "hello" })).content, /Bio saved[\s\S]*https:\/\/svc\.test\/u\/jay/);
    await run("look", { theme: "ocean", accent: "#112233" });
    await run("song", { url: "https://youtu.be/dQw4w9WgXcQ", title: "Jam" });
    await run("link", { kind: "twitch", url: "twitch.tv/jay" });
    await run("link", { kind: "twitch", url: "twitch.tv/jay2" });
    await run("favorite", { game: "Hades" });
    await run("show", { section: "steam", who: "server" });
    let d = db.getProfileData("u1").data;
    assert.deepEqual([d.bio, d.theme, d.accent, d.song.id, d.links.length, d.links[0].url, d.favorites, d.sections.find(s => s.key === "steam").vis], ["hello", "ocean", "#112233", "dQw4w9WgXcQ", 1, "https://twitch.tv/jay2", ["Hades"], "server"]);
    assert.match((await run("favorite", { game: "hades" })).content, /already/);
    assert.match((await run("link", { kind: "twitch", url: "https://evil.example" })).content, /not a Twitch link/);
    assert.match((await run("look")).content, /Pick at least one/);
    assert.match((await run("song", { remove: true })).content, /removed/); assert.equal(db.getProfileData("u1").data.song, null);
    const v = await run("view"); assert.match(v.embeds[0].description, /hello/); assert.match(v.embeds[0].description, /Steam stats \(members of your server\)/);
});
