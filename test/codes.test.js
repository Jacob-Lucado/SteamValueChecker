import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { fetchHoyoCodes, fetchAllCodes, joinRewards, cleanRewardItem, redeemUrlFor, gameByKey, cleanEntry, cleanReward, gameByName, gameArt, normalizeCode, parseExpiry, parseShiftFeed, fetchShiftCodes } from "../src/codesource.js";
import { codeEmbed, runCodes, applyCodeSettings } from "../src/codes.js";
import { createCodeHandlers } from "../src/codeshandlers.js";

const NOW = Date.UTC(2026, 10, 1, 12, 0, 0);
const raw = (over = {}) => ({ code: "J9R33-CCTTC-WRBJ5-TJJB3-9BT5T", type: "shift", game: "Borderlands 4", platform: "universal", reward: "3 Golden Keys", archived: "2026-11-01 10:43:50+00:00", expires: "Nov 3, 2026", expired: false, link: "https://example.com/bl4", ...over });

test("codes: a code is cleaned and checked before it is trusted", () => {
    assert.equal(normalizeCode("j9r33-ccttc-wrbj5-tjjb3-9bt5t"), "J9R33-CCTTC-WRBJ5-TJJB3-9BT5T");
    assert.equal(normalizeCode("j9r33 ccttc wrbj5 tjjb3 9bt5t"), "J9R33-CCTTC-WRBJ5-TJJB3-9BT5T");
    assert.equal(normalizeCode("TOO-SHORT"), null);
    assert.equal(normalizeCode(null), null);
    const c = cleanEntry(raw(), NOW);
    assert.equal(c.key, "shift:J9R33-CCTTC-WRBJ5-TJJB3-9BT5T");
    assert.equal(c.game, "bl4");
    assert.equal(c.platform, "All platforms");
    assert.equal(c.expiresAt, Date.UTC(2026, 10, 3, 23, 59, 59));
    assert.equal(cleanEntry(raw({ code: "nope" }), NOW), null, "a bad code is dropped");
    assert.equal(cleanEntry(raw({ game: "Some Other Game" }), NOW), null, "an unknown game is dropped");
    assert.equal(cleanEntry(raw({ expires: "Oct 1, 2026" }), NOW), null, "a code that already ended is dropped");
    assert.equal(cleanEntry(raw({ type: "other" }), NOW), null);
});

test("codes: end dates in the odd shapes the feed uses", () => {
    assert.equal(parseExpiry("Sept 29, 2026", NOW), Date.UTC(2026, 8, 29, 23, 59, 59));
    assert.equal(parseExpiry("Unknown", NOW), null);
    assert.equal(parseExpiry("ZRX33-K9Z33", NOW), null, "garbage in the date field means no date");
    assert.equal(parseExpiry("Dec 31, 2030", NOW), null, "a far-off placeholder means no end date");
    assert.equal(cleanEntry(raw({ expires: "Unknown" }), NOW).expiresAt, null);
});

test("codes: an old code with no end date is ignored, and one that ages out is retired", () => {
    assert.equal(cleanEntry(raw({ expires: "Unknown", archived: "2026-08-01 10:00:00+00:00" }), NOW), null, "months old with no end date");
    assert.ok(cleanEntry(raw({ expires: "Unknown", archived: "2026-10-25 10:00:00+00:00" }), NOW), "a week old is still trusted");
    const db = openDb(":memory:");
    const c = cleanEntry(raw({ expires: "Unknown", archived: "2026-10-25 10:00:00+00:00" }), NOW);
    db.upsertCode(c);
    assert.equal(db.expireDue(NOW).length, 0);
    assert.equal(db.expireDue(NOW + 30 * 86400_000).length, 1);
});

test("codes: glued reward text is split and a region note is kept apart", () => {
    assert.deepEqual(cleanReward("1 Golden Key2K Japan"), { reward: "1 Golden Key", note: "2K Japan" });
    assert.equal(cleanReward("Loveless CosmeticMint Chipset").reward, "Loveless Cosmetic, Mint Chipset");
    assert.equal(cleanReward("").reward, "Unknown reward");
});

test("codes: each game gets its own art, never another game's", () => {
    assert.equal(gameByName("Borderlands 4").key, "bl4");
    assert.equal(gameByName("Borderlands 3").key, "bl3");
    assert.equal(gameByName("Borderlands: Game of the Year Edition").key, "blgoty");
    assert.equal(gameByName("Borderlands The Pre-Sequel").key, "bltps");
    assert.equal(gameByName("Tiny Tina's Wonderlands").key, "wonderlands");
    assert.match(gameArt(gameByName("Borderlands 2")), /\/apps\/49520\//);
    assert.match(gameArt(gameByName("Borderlands 4")), /\/apps\/1285190\//);
    const embed = codeEmbed({ code: "J9R33-CCTTC-WRBJ5-TJJB3-9BT5T", game: "bl3", reward: "3 Golden Keys", platform: "Steam", expires_at: NOW + 86400_000 });
    assert.match(embed.embeds[0].image.url, /\/apps\/397540\//);
    assert.match(embed.embeds[0].author.name, /Borderlands 3/);
});

test("codes: the same code in the feed twice, or in a later poll, is one row", () => {
    const list = parseShiftFeed([{ codes: [raw(), raw({ code: "j9r33-ccttc-wrbj5-tjjb3-9bt5t" })] }], NOW);
    assert.equal(list.length, 1);
    const db = openDb(":memory:");
    assert.equal(db.upsertCode(list[0]).isNew, true);
    assert.equal(db.upsertCode(list[0]).isNew, false);
    assert.equal(db.listCodes().length, 1);
});

test("codes: fetching reports a bad feed instead of throwing something strange", async () => {
    await assert.rejects(fetchShiftCodes({ fetchImpl: async () => ({ ok: false, status: 500 }) }), /500/);
    await assert.rejects(fetchShiftCodes({ fetchImpl: async () => ({ ok: true, json: async () => { throw new Error("x"); } }) }), /not valid JSON/);
    await assert.rejects(fetchShiftCodes({ fetchImpl: async () => ({ ok: true, json: async () => [{ codes: [] }] }) }), /no usable codes/);
    const ok = await fetchShiftCodes({ now: NOW, fetchImpl: async () => ({ ok: true, json: async () => [{ codes: [raw()] }] }) });
    assert.equal(ok.length, 1);
});

function fakeApi() {
    const sent = [], edits = [];
    let n = 0;
    return { sent, edits, api: {
        sendMessage: async (channel, payload) => { sent.push({ channel, payload }); return { id: "m" + (++n) }; },
        editMessage: async (channel, id, payload) => { edits.push({ channel, id, payload }); return {}; }
    } };
}
const codeAt = (n, over = {}) => cleanEntry(raw({ code: `AAAA${n}-BBBBB-CCCCC-DDDDD-EEEEE`, expires: "Dec 31, 2099", ...over }), NOW);

test("codes: a code is posted once per server, however many polls run", async () => {
    const db = openDb(":memory:");
    db.setCodeSettings("g1", { channel_id: "c1" });
    const { api, sent } = fakeApi();
    const feed = async () => [codeAt(1), codeAt(2)];
    const base = { db, api, fetchCodes: feed, now: () => NOW, sleep: async () => {} };
    const r1 = await runCodes(base);
    assert.equal(r1.posted, 2);
    const r2 = await runCodes(base);
    const r3 = await runCodes(base);
    assert.equal(r2.posted + r3.posted, 0, "nothing is posted twice");
    assert.equal(sent.length, 2);
    // a new code later is the only new post
    const r4 = await runCodes({ ...base, fetchCodes: async () => [codeAt(1), codeAt(2), codeAt(3)] });
    assert.equal(r4.posted, 1);
    assert.equal(sent.length, 3);
    assert.match(sent[2].payload.embeds[0].description, /AAAA3-BBBBB/);
});

test("codes: a new server only gets the newest few, and a failed feed does not break the poll", async () => {
    const db = openDb(":memory:");
    db.setCodeSettings("g1", { channel_id: "c1" });
    const { api, sent } = fakeApi();
    const many = [1, 2, 3, 4, 5, 6].map(n => codeAt(n));
    await runCodes({ db, api, fetchCodes: async () => many, now: () => NOW, sleep: async () => {} });
    assert.equal(sent.length, 3, "the first run does not flood the channel");
    const r = await runCodes({ db, api, fetchCodes: async () => { throw new Error("down"); }, now: () => NOW, sleep: async () => {} });
    assert.equal(r.feedError, "down");
    assert.equal(sent.length, 3, "the other three were marked as seen, not posted later");
});

test("codes: the game filter, the ping role and servers without a channel", async () => {
    const db = openDb(":memory:");
    db.setCodeSettings("g1", { channel_id: "c1", games: ["bl3"], role_id: "r1" });
    db.setCodeSettings("g2", { channel_id: null });
    const { api, sent } = fakeApi();
    const feed = async () => [codeAt(1, { game: "Borderlands 3" }), codeAt(2, { game: "Borderlands 4" })];
    await runCodes({ db, api, fetchCodes: feed, now: () => NOW, sleep: async () => {} });
    assert.equal(sent.length, 1);
    assert.match(sent[0].payload.embeds[0].author.name, /Borderlands 3/);
    assert.equal(sent[0].payload.content, "<@&r1>");
    assert.deepEqual(sent[0].payload.allowed_mentions, { roles: ["r1"] });
});

test("codes: when a code ends its post is edited once, grayed out, with no buttons", async () => {
    const db = openDb(":memory:");
    db.setCodeSettings("g1", { channel_id: "c1" });
    const { api, edits } = fakeApi();
    let at = NOW;
    const feed = async () => [codeAt(1, { expires: "Nov 2, 2026" })];
    await runCodes({ db, api, fetchCodes: feed, now: () => at, sleep: async () => {} });
    at = Date.UTC(2026, 10, 4);
    const r = await runCodes({ db, api, fetchCodes: async () => [], now: () => at, sleep: async () => {} });
    assert.equal(r.expired, 1);
    assert.equal(edits.length, 1);
    assert.equal(edits[0].payload.components.length, 0);
    assert.match(edits[0].payload.embeds[0].title, /^Expired/);
    await runCodes({ db, api, fetchCodes: async () => [], now: () => at, sleep: async () => {} });
    assert.equal(edits.length, 1, "edited only once");
});

test("codes: a channel that vanished is skipped without stopping the other servers", async () => {
    const db = openDb(":memory:");
    db.setCodeSettings("g1", { channel_id: "gone" });
    db.setCodeSettings("g2", { channel_id: "ok" });
    const sent = [];
    const api = { sendMessage: async (c, p) => { if (c === "gone") { const e = new Error("nope"); e.status = 404; throw e; } sent.push(c); return { id: "m" }; }, editMessage: async () => ({}) };
    const r = await runCodes({ db, api, fetchCodes: async () => [codeAt(1)], now: () => NOW, sleep: async () => {} });
    assert.equal(r.failed, 1);
    assert.deepEqual(sent, ["ok"]);
    assert.ok(!db.codePost(1, "g1"), "it will be tried again next poll");
});

test("codes: settings are validated", () => {
    const db = openDb(":memory:");
    assert.throws(() => applyCodeSettings(db, "g1", { games: ["nope"] }), /not a game/);
    assert.deepEqual(applyCodeSettings(db, "g1", { games: ["bl4", "bl3", "wonderlands", "blgoty", "bltps", "bl2", "genshin", "hsr", "zzz", "destiny2", "warframe"] }).games, [], "every game selected means no filter");
    assert.deepEqual(applyCodeSettings(db, "g1", { games: ["bl2"], channel_id: "c9" }).games, ["bl2"]);
    assert.equal(db.getCodeSettings("g1").channel_id, "c9");
});

function interaction({ sub, options = {}, manager = true, guild = "g1" }) {
    const replies = [];
    return { replies, inGuild: () => Boolean(guild), guildId: guild, memberPermissions: { has: () => manager }, deferred: false, replied: false,
        options: { getSubcommand: () => sub, getString: k => options[k] ?? null, getBoolean: k => options[k] ?? null, getChannel: k => options[k] ?? null, getRole: k => options[k] ?? null },
        reply: async p => { replies.push(p); } };
}

test("codes: /codes latest lists working codes for anyone, settings need Manage Server", async () => {
    const db = openDb(":memory:");
    db.upsertCode(codeAt(1)); db.upsertCode(codeAt(2, { game: "Borderlands 3" }));
    const ui = createCodeHandlers({ db });
    const a = interaction({ sub: "latest", manager: false });
    await ui.handleCommand(a);
    assert.match(a.replies[0].embeds[0].description, /AAAA1-BBBBB/);
    assert.match(a.replies[0].embeds[0].description, /AAAA2-BBBBB/);
    const only = interaction({ sub: "latest", options: { game: "bl3" }, manager: false });
    await ui.handleCommand(only);
    assert.doesNotMatch(only.replies[0].embeds[0].description, /AAAA1-BBBBB/);
    const denied = interaction({ sub: "channel", manager: false, options: { channel: { id: "c1", send: async () => {} } } });
    await ui.handleCommand(denied);
    assert.match(denied.replies[0].content, /Manage Server/);
    assert.equal(db.getCodeSettings("g1").channel_id, null);
    const set = interaction({ sub: "channel", options: { channel: { id: "c1", send: async () => {} } } });
    await ui.handleCommand(set);
    assert.equal(db.getCodeSettings("g1").channel_id, "c1");
    const cantPost = interaction({ sub: "channel", options: { channel: { id: "c2", send: async () => { throw new Error("403"); } } } });
    await ui.handleCommand(cantPost);
    assert.match(cantPost.replies[0].content, /can't post/);
    assert.equal(db.getCodeSettings("g1").channel_id, "c1");
    await ui.handleCommand(interaction({ sub: "games", options: { game: "bl4", on: false } }));
    assert.ok(!db.getCodeSettings("g1").games.includes("bl4") && db.getCodeSettings("g1").games.length === 10);
    await ui.handleCommand(interaction({ sub: "ping", options: { role: { id: "r5" } } }));
    assert.equal(db.getCodeSettings("g1").role_id, "r5");
});

test("codes: community setup adds a game-codes channel and points the server at it", async () => {
    const { TEMPLATE, ADDED_LATER } = await import("../src/community.js");
    const chans = TEMPLATE.categories.flatMap(c => c.channels ?? []);
    assert.ok(chans.some(c => c.key === "codes" && c.name === "game-codes"));
    assert.ok(ADDED_LATER.has("codes"), "servers that already ran setup get it on the next run");
});

// ---------- HoYoverse games ----------
const json = body => async () => ({ ok: true, status: 200, json: async () => body });
const ennead = { active: [{ code: "ABCD1234EFGH", rewards: ["Primogem ×60", "Adventurer's Experience ×5"] }, { code: "GIFTCODE", rewards: ["Mora ×10000"] }], inactive: [{ code: "OLDCODE12345", rewards: [] }] };
const seria = { codes: [{ code: "GIFTCODE", status: "OK", rewards: "Mora*10000" }, { code: "ONLYSERIA999", status: "OK", rewards: "Primogem*40;Mora*20000" }, { code: "BROKEN", status: "NOT_OK", rewards: "" }] };
const hoyoFetch = (over = {}) => async url => {
    if (over[new URL(url).host] === "down") return { ok: false, status: 503 };
    if (url.includes("ennead")) return { ok: true, json: async () => ennead };
    return { ok: true, json: async () => seria };
};

test("hoyo: rewards from both lists become one readable line", () => {
    assert.equal(cleanRewardItem("Primogem ×60"), "60 Primogem");
    assert.equal(cleanRewardItem("Stellar Jade x100"), "100 Stellar Jade");
    assert.equal(cleanRewardItem("Credit ×50,000"), "50,000 Credit");
    assert.equal(cleanRewardItem("Mora*10000"), "10000 Mora");
    assert.equal(cleanRewardItem("Free items"), "Free items");
    assert.equal(joinRewards("Primogem*40;Mora*20000"), "40 Primogem, 20000 Mora");
    assert.equal(joinRewards(["Primogem ×60", "Adventurer's Experience ×5"]), "60 Primogem, 5 Adventurer's Experience");
    assert.equal(joinRewards(""), "Free items");
    assert.equal(joinRewards("60 stellar jade and one fuel"), "60 stellar jade and one fuel");
});

test("hoyo: the two lists are merged, duplicates collapse, broken codes are left out", async () => {
    const r = await fetchHoyoCodes({ fetchImpl: hoyoFetch(), now: NOW });
    const genshin = r.codes.filter(c => c.game === "genshin").map(c => c.code).sort();
    assert.deepEqual(genshin, ["ABCD1234EFGH", "GIFTCODE", "ONLYSERIA999"]);
    assert.equal(r.codes.find(c => c.code === "GIFTCODE" && c.game === "genshin").reward, "10000 Mora");
    assert.equal(r.codes.find(c => c.code === "ONLYSERIA999").key, "hoyo:genshin:ONLYSERIA999");
    assert.ok(r.complete.includes("genshin") && r.complete.includes("hsr") && r.complete.includes("zzz"));
    const half = await fetchHoyoCodes({ fetchImpl: hoyoFetch({ "hoyo-codes.seria.moe": "down" }), now: NOW });
    assert.ok(half.codes.length > 0 && half.complete.length === 0, "one list down: still posts what it has, but never decides a code ended");
    assert.ok(half.errors.length > 0);
    await assert.rejects(fetchHoyoCodes({ fetchImpl: async () => ({ ok: false, status: 500 }), now: NOW }), /500/);
});

test("hoyo: redeem links fill the code in, and each game has its own look", () => {
    assert.equal(redeemUrlFor(gameByKey("genshin"), "ABC123"), "https://genshin.hoyoverse.com/en/gift?code=ABC123");
    assert.match(redeemUrlFor(gameByKey("hsr"), "ABC123"), /hsr\.hoyoverse\.com\/gift\?code=ABC123/);
    assert.match(redeemUrlFor(gameByKey("zzz"), "ABC123"), /zenless\.hoyoverse\.com\/redemption\?code=ABC123/);
    assert.match(redeemUrlFor(gameByKey("bl4"), "X"), /shift\.gearboxsoftware\.com/);
    const e = codeEmbed({ code: "GIFTCODE", game: "zzz", reward: "20 Polychrome", platform: "All platforms", expires_at: null });
    assert.match(e.embeds[0].author.name, /Zenless Zone Zero · redeem code/);
    assert.equal(e.embeds[0].image, undefined, "no art is better than the wrong art");
    assert.equal(e.components[0].components[0].url, "https://zenless.hoyoverse.com/redemption?code=GIFTCODE");
    assert.match(e.embeds[0].fields.find(f => f.name === "Heads up").value, /servers or regions/);
});

test("hoyo: a code that drops off a complete list ends, but a partial answer never ends anything", async () => {
    const db = openDb(":memory:");
    db.setCodeSettings("g1", { channel_id: "c1" });
    const { api, sent, edits } = fakeApi();
    const run = fetchImpl => runCodes({ db, api, fetchCodes: () => fetchAllCodes({ fetchImpl, now: NOW }), now: () => NOW, sleep: async () => {} });
    const shiftFeed = [{ codes: [raw()] }];
    const both = over => async url => (url.includes("githubusercontent") ? { ok: true, json: async () => shiftFeed } : hoyoFetch(over)(url));
    const r1 = await run(both());
    assert.ok(r1.added >= 5);
    assert.equal(sent.length, 3, "first run posts the newest few");
    // seria goes down: the codes only it listed are NOT treated as ended
    const r2 = await run(both({ "hoyo-codes.seria.moe": "down" }));
    assert.equal(r2.expired, 0);
    assert.ok(db.codeByKey("hoyo:genshin:ONLYSERIA999").status === "active");
    // both answer, and ONLYSERIA999 is gone from the list
    seria.codes = seria.codes.filter(c => c.code !== "ONLYSERIA999");
    const r3 = await run(both());
    assert.equal(r3.expired, 3, "the mock serves the same lists for all three games");
    assert.equal(db.codeByKey("hoyo:genshin:ONLYSERIA999").status, "expired");
    // one provider failing entirely does not hide the other
    const r4 = await run(async url => (url.includes("githubusercontent") ? { ok: false, status: 500 } : hoyoFetch()(url)));
    assert.match(r4.feedError, /SHiFT/);
    assert.ok(edits.length >= 0);
});

test("hoyo: codes without an end date do not age out like old SHiFT codes", () => {
    const db = openDb(":memory:");
    db.upsertCode({ provider: "hoyo", key: "hoyo:genshin:KEEPME123", code: "KEEPME123", game: "genshin", reward: "x", expiresAt: null, seenAt: NOW });
    assert.equal(db.expireDue(NOW + 90 * 86400_000).length, 0);
});

test("codes: the Borderlands games are one entry, and the HoYoverse games have their own art", async () => {
    const { GAME_FAMILIES, expandGames, gameByKey, gameArt } = await import("../src/codesource.js");
    const { describeGames, codeFamilies, codeView } = await import("../src/codes.js");
    assert.deepEqual(GAME_FAMILIES.map(f => f.key), ["borderlands", "genshin", "hsr", "zzz", "destiny2", "warframe"]);
    assert.equal(expandGames(["borderlands"]).length, 6);
    assert.deepEqual(expandGames(["zzz", "bl4", "zzz"]), ["zzz", "bl4"]);
    assert.equal(describeGames(["bl4", "bl2", "genshin"]), "Borderlands, Genshin Impact");
    assert.equal(describeGames([]), "every game");
    assert.equal(codeFamilies().length, 6);
    // HoYoverse art is our own copy: a relative path for the site, the full address for Discord, nothing when there is no address
    for (const k of ["genshin", "hsr", "zzz"]) {
        assert.equal(gameArt(gameByKey(k), ""), `/img/codes/${k}.jpg`);
        assert.equal(gameArt(gameByKey(k), "https://bot.example"), `https://bot.example/img/codes/${k}.jpg`);
        assert.equal(gameArt(gameByKey(k)), null);
    }
    assert.match(gameArt(gameByKey("bl4"), ""), /^\/art\/header\/\d+\.jpg$/);
    const e = codeEmbed({ code: "ABC", game: "hsr", reward: "x", expires_at: null }, { base: "https://bot.example" });
    assert.equal(e.embeds[0].image.url, "https://bot.example/img/codes/hsr.jpg");
    assert.equal(codeView({ id: 1, code: "ABC", game: "zzz", status: "active" }).art, "/img/codes/zzz.jpg");
    const { readFileSync, statSync } = await import("node:fs");
    for (const k of ["genshin", "hsr", "zzz"]) assert.ok(statSync(new URL(`../public/img/codes/${k}.jpg`, import.meta.url)).size > 20000);
});

test("codes: picking Borderlands for a server turns on all six games", () => {
    const db = openDb(":memory:");
    const s = applyCodeSettings(db, "g1", { games: ["borderlands", "zzz"] });
    assert.equal(s.games.length, 7);
    assert.ok(!s.games.includes("genshin"));
    assert.deepEqual(applyCodeSettings(db, "g1", { games: ["borderlands", "genshin", "hsr", "zzz", "destiny2", "warframe"] }).games, [], "everything is no filter");
});

// ---------- Destiny 2 and Warframe ----------
import { parseDestinyCodes, parseWarframeCodes, fetchCommunityCodes } from "../src/codesource.js";

const D2_HTML = `<table><tr><th>Codes</th><th>Rewards</th></tr>
<tr><td><strong>R9J-79M-J6C</strong></td><td>End of the Rainbow transmat</td></tr>
<tr><td><strong>XVX-DKJ-CVM</strong></td><td>Seraphim&#8217;s Gauntlets Emblem</td></tr>
<tr><td><strong>XVX-DKJ-CVM</strong></td><td>A repeat that is ignored</td></tr>
<tr><td>not a code</td><td>nothing</td></tr></table>`;
const WF_HTML = `<h2>Active Codes</h2><ul>
<li>ANDROID-QV4RX - Redeem for 3 Day Affinity Booster, Zylok, and Wolf Howl</li>
<li><strong>SPECIALEFFECT</strong> &#8211; Redeem for Special Effect Glyph</li>
<li>Pride2025 - Redeem for Pride Glyph IV</li></ul>
<h2>Expired Codes</h2><ul><li>Discord100k - Redeem for Glyph</li></ul>`;

test("destiny 2: codes and rewards come out of the guide's table, repeats and junk rows are dropped", () => {
    const m = parseDestinyCodes(D2_HTML);
    assert.deepEqual([...m.keys()], ["R9J-79M-J6C", "XVX-DKJ-CVM"]);
    assert.equal(m.get("XVX-DKJ-CVM"), "Seraphim's Gauntlets Emblem");
});

test("warframe: only the Active section is read, and 'Redeem for' is trimmed from the reward", () => {
    const m = parseWarframeCodes(WF_HTML);
    assert.deepEqual([...m.keys()], ["ANDROID-QV4RX", "SPECIALEFFECT", "PRIDE2025"]);
    assert.equal(m.get("SPECIALEFFECT"), "Special Effect Glyph");
    assert.equal(m.get("ANDROID-QV4RX"), "3 Day Affinity Booster, Zylok, and Wolf Howl");
    assert.equal(parseWarframeCodes("<p>nothing here</p>").size, 0);
});

test("community codes: one list being down does not hide the other, and a game is only 'complete' when its page answered", async () => {
    const fetchImpl = async url => url.includes("ggrecon") ? { ok: false, status: 503 } : { ok: true, status: 200, text: async () => WF_HTML };
    const r = await fetchCommunityCodes({ fetchImpl, now: 5 });
    assert.deepEqual(r.complete, ["warframe"]);
    assert.equal(r.codes.length, 3); assert.equal(r.codes[0].key, "community:warframe:ANDROID-QV4RX");
    assert.match(r.errors[0], /Destiny 2: .*503/);
});

test("destiny and warframe posts show the reward, how to claim, and a button to the game's own redeem page", () => {
    const post = codeEmbed({ code: "J64-HYC-HTD", game: "destiny2", reward: "Red Shift Returning Emblem", key: "community:destiny2:J64-HYC-HTD", status: "active" });
    const e = post.embeds[0];
    assert.match(e.author.name, /Destiny 2 · promo code/); assert.match(e.description, /J64-HYC-HTD/);
    assert.equal(e.fields.find(f => f.name === "How to claim").value.includes("Bungie.net"), true);
    assert.equal(post.components[0].components[0].label, "Redeem on Bungie.net"); assert.match(post.components[0].components[0].url, /bungie\.net/);
    assert.match(e.image.url, /1085660/);
    const wf = codeEmbed({ code: "SPECIALEFFECT", game: "warframe", reward: "Special Effect Glyph", status: "active" });
    assert.equal(wf.components[0].components[0].url, "https://www.warframe.com/promocode");
});
