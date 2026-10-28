import test from "node:test";
import assert from "node:assert/strict";
import { mergePrefs, viewPrefs, okImageUrl } from "../src/cardprefs.js";
import { fetchImageDataUri, isPrivateIp, svgToPng } from "../src/imgrender.js";
import { profileCardSvg, valueSvg } from "../src/cardimg.js";

const PNG = [0x89, 0x50, 0x4e, 0x47];

test("card prefs: platforms are validated, tidied and de-duplicated", () => {
    const p = mergePrefs({}, { platforms: [{ id: "xbox", name: "  Zed‮<b>  " }, { id: "xbox", name: "Zed2" }, { id: "gog", name: "" }] });
    assert.deepEqual(p.platforms, [{ id: "xbox", name: "Zed2" }], "last one wins, and markup is stripped");
    assert.throws(() => mergePrefs({}, { platforms: [{ id: "myspace", name: "x" }] }), /platform/);
    assert.throws(() => mergePrefs({}, { platforms: "xbox" }), /list/);
    assert.equal(mergePrefs({}, { platforms: Array.from({ length: 40 }, (_, i) => ({ id: "steam", name: "n" + i })) }).platforms.length, 1);
});

test("card prefs: only the keys sent change; bad colours and links are refused", () => {
    const old = { theme: "night", platforms: [{ id: "steam", name: "me" }], avatar: "https://a.example/p.png" };
    const next = mergePrefs(old, { banner: "https://a.example/b.png", show: { badges: false, nonsense: false } });
    assert.equal(next.theme, "night"); assert.equal(next.avatar, "https://a.example/p.png"); assert.equal(next.banner, "https://a.example/b.png");
    assert.equal(next.show.badges, false); assert.equal(next.show.games, true); assert.equal("nonsense" in next.show, false);
    assert.throws(() => mergePrefs({}, { theme: "neon" }), /colour/);
    assert.throws(() => mergePrefs({}, { avatar: "http://a.example/p.png" }), /https/);
    assert.equal(mergePrefs(old, { avatar: "" }).avatar, "");
    assert.deepEqual(viewPrefs({ theme: "bogus", avatar: "javascript:1" }).theme, "steam");
    assert.equal(okImageUrl("https://u:p@a.example/x.png"), false);
});

test("pictures are only fetched from public https addresses", async () => {
    assert.equal(isPrivateIp("10.0.0.5"), true); assert.equal(isPrivateIp("127.0.0.1"), true); assert.equal(isPrivateIp("169.254.169.254"), true);
    assert.equal(isPrivateIp("172.20.1.1"), true); assert.equal(isPrivateIp("192.168.1.1"), true); assert.equal(isPrivateIp("::1"), true);
    assert.equal(isPrivateIp("fd00::1"), true); assert.equal(isPrivateIp("::ffff:10.1.1.1"), true); assert.equal(isPrivateIp("93.184.216.34"), false);
    let calls = 0;
    const png = Buffer.from(PNG);
    const ok = async () => { calls++; return { ok: true, status: 200, headers: new Headers({ "content-type": "image/png" }), arrayBuffer: async () => png }; };
    const pub = async () => [{ address: "93.184.216.34" }], priv = async () => [{ address: "10.0.0.1" }];
    assert.match(await fetchImageDataUri("https://pics.example/a.png", { fetchImpl: ok, resolve: pub }), /^data:image\/png;base64,/);
    for (const [url, resolve] of [["http://pics.example/a.png", pub], ["https://pics.example/a.png", priv], ["https://127.0.0.1/a.png", pub], ["https://u:p@pics.example/a.png", pub], ["https://pics.example:8080/a.png", pub]]) {
        const before = calls;
        assert.equal(await fetchImageDataUri(url, { fetchImpl: ok, resolve }), null, url);
        assert.equal(calls, before, "never contacted " + url);
    }
    const html = async () => ({ ok: true, status: 200, headers: new Headers({ "content-type": "text/html" }), arrayBuffer: async () => Buffer.from("<html>") });
    assert.equal(await fetchImageDataUri("https://pics.example/a", { fetchImpl: html, resolve: pub }), null);
    const redirect = async () => ({ ok: false, status: 302, headers: new Headers({ location: "http://169.254.169.254/" }), arrayBuffer: async () => Buffer.alloc(0) });
    assert.equal(await fetchImageDataUri("https://pics.example/a.png", { fetchImpl: redirect, resolve: pub }), null);
    const big = async () => ({ ok: true, status: 200, headers: new Headers({ "content-type": "image/png", "content-length": "99999999" }), arrayBuffer: async () => png });
    assert.equal(await fetchImageDataUri("https://pics.example/a.png", { fetchImpl: big, resolve: pub }), null);
    assert.equal(await fetchImageDataUri("https://pics.example/a.png", { fetchImpl: async () => { throw new Error("down"); }, resolve: pub }), null);
});

test("the card and the account value draw to real PNG files, and names are escaped", () => {
    const d = { name: "<script>alert(1)</script> & Co", games: 5, finished: 2, hours: 10, savedPct: 20, streak: 1, bestStreak: 2, badges: [{ name: "Collector" }], genres: ["Action"] };
    const prefs = { platforms: [{ id: "xbox", name: "a&b <i>" }, { id: "steam", name: "me" }], theme: "forest" };
    const svg = profileCardSvg(d, prefs);
    assert.ok(!svg.includes("<script>") && !svg.includes("<i>"), "no raw markup from names");
    assert.ok(svg.includes("Xbox") && svg.includes("a&amp;b"));
    const png = svgToPng(svg);
    assert.deepEqual([...png.subarray(0, 4)], PNG);
    const stats = { games: 3, playedGames: 2, totalMinutes: 600, unplayedCount: 1, unplayedMsrp: 10, value: { msrp: 100, cheapest: 40, atl: 30, achDone: 1, achTotal: 4, achGames: 1, priced: 3, top: [{ title: "A & B", msrp: 50 }] } };
    const v = valueSvg({ stats, currency: "USD", link: { games: 3, synced_at: 0 }, card: { name: "Me" } });
    assert.ok(v.includes("ESTIMATED ACCOUNT VALUE") && v.includes("$100.00") && v.includes("A &amp; B"));
    assert.deepEqual([...svgToPng(v).subarray(0, 4)], PNG);
    // Without any picture links or Steam link it still draws (letter avatar, pattern banner).
    assert.deepEqual([...svgToPng(profileCardSvg({ ...d, badges: [], genres: [] }, {})).subarray(0, 4)], PNG);
});

test("many platform names collapse into a +N more tag instead of running off the card", () => {
    const platforms = ["steam", "xbox", "playstation", "nintendo", "epic", "gog", "battlenet", "ea", "ubisoft", "riot"].map(id => ({ id, name: "SomeLongPlayerName" + id }));
    const svg = profileCardSvg({ name: "X", games: 1, finished: 0, hours: 0, savedPct: null, streak: 0, bestStreak: 0, badges: [], genres: [] }, { platforms });
    assert.match(svg, /\+\d+ more/);
});

test("/profilecard replies with the card picture, privately unless public:true, and is rate limited", async () => {
    const { createCardHandlers } = await import("../src/cardhandlers.js");
    const { openDb } = await import("../src/db.js");
    const db = openDb(":memory:");
    const handlers = createCardHandlers({ db, fetchImpl: async () => { throw new Error("offline"); }, publicUrl: "https://dash.example" });
    const fake = (id, pub) => {
        const calls = { defer: null, edit: null, reply: null };
        return { calls, user: { id, username: "jacob", globalName: "Jacob" }, deferred: false, replied: false,
            options: { getBoolean: () => pub },
            deferReply: async o => { calls.defer = o; }, editReply: async o => { calls.edit = o; }, reply: async o => { calls.reply = o; } };
    };
    const a = fake("c1", false);
    await handlers.handle(a);
    assert.ok(a.calls.defer.flags, "private by default");
    assert.equal(a.calls.edit.files.length, 1);
    assert.equal(a.calls.edit.files[0].name, "my-game-profile.png");
    assert.deepEqual([...Buffer.from(a.calls.edit.files[0].attachment).subarray(0, 4)], PNG);
    assert.match(a.calls.edit.content, /dash\.example\/#\/mypage/);
    const b = fake("c1", false);
    await handlers.handle(b);
    assert.match(b.calls.reply.content, /Slow down/);
    const c = fake("c2", true);
    await handlers.handle(c);
    assert.equal(c.calls.defer.flags, undefined, "public posts in the channel");
});
