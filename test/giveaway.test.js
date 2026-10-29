import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { createVault } from "../src/vault.js";
import { createGiveawayService, steamHeader } from "../src/giveaway.js";
import { parseKeys, parseDuration, parseColor, parseImageUrl } from "../src/gwparse.js";
import { UserError } from "../src/errors.js";
import { giveawayPayload, keyMessage } from "../src/gwrender.js";

const SECRET = "test-secret-at-least-16-chars";
const HOUR = 3600_000;

function rig({ dmFails = new Set(), gone = new Set(), vouches = "vouch-chan", itad = null } = {}) {
    let clock = 1_800_000_000_000;
    const db = openDb(":memory:", { now: () => clock });
    const posts = [], edits = [], dms = [];
    let n = 100;
    const discord = {
        post: async (channelId, payload) => { posts.push({ channelId, payload }); return { id: String(++n) }; },
        edit: async (channelId, messageId, payload) => { edits.push({ channelId, messageId, payload }); },
        dm: async (userId, payload) => { if (dmFails.has(userId)) throw new Error("closed"); dms.push({ userId, payload }); },
        memberOk: async (g, u) => !gone.has(u),
        findChannelByName: async (g, name) => (name === "vouches" ? vouches : null)
    };
    const vault = createVault(SECRET);
    // deterministic "random": always the first candidate
    const svc = createGiveawayService({ db, vault, discord, itad, now: () => clock, rand: () => 0 });
    const make = (over = {}) => svc.create({
        guild_id: "G", channel_id: "C", host_id: "host", title: "Big giveaway", duration_ms: 2 * HOUR,
        keys: [{ label: "Hades", key: "AAAAA-BBBBB-CCCCC" }, { label: "Celeste", key: "DDDDD-EEEEE-FFFFF" }], ...over
    });
    const enterAll = async (id, users) => { for (const u of users) await svc.enter(id, { userId: u, roleIds: [] }); };
    return { db, vault, svc, posts, edits, dms, make, enterAll, advance: ms => { clock += ms; }, now: () => clock };
}

test("keys, durations, colors and links are parsed strictly", () => {
    const r = parseKeys("Hades | AAAAA-BBBBB\n\nBBBBB-CCCCC\nHades | AAAAA-BBBBB", "Default");
    assert.deepEqual(r.keys, [{ label: "Hades", key: "AAAAA-BBBBB" }, { label: "Default", key: "BBBBB-CCCCC" }]);
    assert.equal(r.duplicates, 1);
    assert.throws(() => parseKeys("", "x"), UserError);
    assert.throws(() => parseKeys("Hades KEY1 KEY2", "x"), UserError); // a space in a key
    assert.throws(() => parseKeys(Array.from({ length: 51 }, (_, i) => `K${i}`).join("\n"), "x"), UserError);
    assert.equal(parseDuration("1d12h"), 36 * HOUR);
    assert.equal(parseDuration("90m"), 90 * 60_000);
    assert.throws(() => parseDuration("2 minutes"), UserError);
    assert.throws(() => parseDuration("1m"), UserError);
    assert.throws(() => parseDuration("60d"), UserError);
    assert.equal(parseColor("#5865F2"), 0x5865f2);
    assert.equal(parseColor(""), null);
    assert.throws(() => parseColor("blue"), UserError);
    assert.equal(parseImageUrl("https://img.example/a.png"), "https://img.example/a.png");
    assert.throws(() => parseImageUrl("http://img.example/a.png"), UserError);
    assert.throws(() => parseImageUrl("javascript:alert(1)"), UserError);
});

test("keys are encrypted at rest and unreadable with another secret", () => {
    const v = createVault(SECRET);
    const blob = v.encrypt("AAAAA-BBBBB-CCCCC");
    assert.ok(!blob.includes("AAAAA"));
    assert.equal(v.decrypt(blob), "AAAAA-BBBBB-CCCCC");
    assert.equal(createVault("a-different-secret-entirely").decrypt(blob), null);
    assert.equal(v.decrypt("garbage"), null);
    assert.throws(() => createVault("short"));
});

test("creating posts an orderly giveaway and never shows a key", async () => {
    const t = rig();
    const r = await t.make({ keys: [{ label: "Hades", key: "K1" }, { label: "Hades", key: "K2" }, { label: "Celeste", key: "K3" }] });
    assert.equal(r.prizes, 3);
    const post = t.posts[0].payload;
    const text = JSON.stringify(post);
    assert.match(text, /Prizes \(3\)/);
    assert.match(text, /1\. \*\*Hades\*\* ×2/);
    assert.match(text, /2\. \*\*Celeste\*\*/);
    assert.ok(!/K1|K2|K3/.test(text));
    assert.equal(post.components[0].components[0].custom_id, `gw_enter:${r.id}`);
    const raw = JSON.stringify(t.db.listKeys(r.id));
    assert.ok(!/K1/.test(raw));
    assert.equal(t.db.getGiveaway(r.id).message_id, "101");
});

test("a failed post leaves nothing behind", async () => {
    const t = rig();
    const bad = createGiveawayService({ db: t.db, vault: t.vault, now: t.now, discord: { post: async () => { throw new Error("Missing Access"); } } });
    await assert.rejects(() => bad.create({ guild_id: "G", channel_id: "C", host_id: "h", title: "x", duration_ms: HOUR, keys: [{ label: "a", key: "k" }] }), UserError);
    assert.equal(t.db.listGiveaways("G").length, 0);
});

test("artwork: custom image wins, otherwise the Steam header is found automatically", async () => {
    const itad = { lookupTitles: async () => [{ id: "itad-1" }], getTitle: async () => ({ title: "Hades", appid: 1145360 }) };
    const t = rig({ itad });
    const auto = await t.make({ game_title: "Hades" });
    assert.equal(auto.imageSource, "auto");
    assert.equal(t.db.getGiveaway(auto.id).image_url, steamHeader(1145360));
    const custom = await t.make({ image_url: "https://img.example/mine.png" });
    assert.equal(custom.imageSource, "custom");
    assert.equal(t.db.getGiveaway(custom.id).image_url, "https://img.example/mine.png");
    const off = await t.make({ auto_image: false });
    assert.equal(off.imageSource, "none");
});

test("entering: toggle, role requirement, account age, host blocked, bonus entries", async () => {
    const t = rig();
    const { id } = await t.make({ require_role_id: "R1", bonus_role_id: "R2", bonus_entries: 3, min_account_days: 10 });
    await assert.rejects(() => t.svc.enter(id, { userId: "a", roleIds: [], createdAt: 0 }), /role/);
    await assert.rejects(() => t.svc.enter(id, { userId: "a", roleIds: ["R1"], createdAt: t.now() - 2 * 86400_000 }), /days old/);
    await assert.rejects(() => t.svc.enter(id, { userId: "host", roleIds: ["R1"] }), /hosting/);
    const ok = await t.svc.enter(id, { userId: "a", roleIds: ["R1", "R2"], createdAt: 0 });
    assert.deepEqual([ok.status, ok.entries, ok.total], ["entered", 3, 1]);
    assert.equal((await t.svc.enter(id, { userId: "a", roleIds: ["R1"] })).status, "left");
    assert.equal(t.db.countEntries(id), 0);
    t.advance(3 * HOUR);
    await assert.rejects(() => t.svc.enter(id, { userId: "b", roleIds: ["R1"] }), /ended/);
});

test("ending draws one distinct winner per prize and posts the winners with a Claim key button", async () => {
    const t = rig();
    const { id } = await t.make();
    await t.enterAll(id, ["a", "b", "c"]);
    t.advance(3 * HOUR);
    const done = await t.svc.tick();
    assert.equal(done.ended, 1);
    const keys = t.db.listKeys(id);
    assert.deepEqual(keys.map(k => k.status), ["assigned", "assigned"]);
    assert.equal(new Set(keys.map(k => k.winner_id)).size, 2);
    const winners = t.posts.at(-1).payload;
    assert.equal(winners.components[0].components[0].label, "Claim key");
    assert.match(winners.embeds[0].description, /Hades.*<@/);
    assert.ok(!/AAAAA|DDDDD/.test(JSON.stringify(t.posts)));
    assert.equal(t.db.getGiveaway(id).status, "ended");
});

test("fewer entries than prizes: unused keys go back to the host and are deleted", async () => {
    const t = rig();
    const { id } = await t.make();
    await t.enterAll(id, ["a"]);
    t.advance(3 * HOUR);
    await t.svc.tick();
    const hostDm = t.dms.find(d => d.userId === "host" && /Unused prizes/.test(JSON.stringify(d.payload)));
    assert.ok(hostDm);
    assert.match(JSON.stringify(hostDm.payload), /DDDDD-EEEEE-FFFFF/);
    const keys = t.db.listKeys(id);
    assert.equal(keys[1].has_key, false);
    assert.equal(keys[1].status, "returned");
});

test("no entries: nobody wins and the host gets the keys back", async () => {
    const t = rig();
    const { id } = await t.make();
    t.advance(3 * HOUR);
    await t.svc.tick();
    assert.match(t.posts.at(-1).payload.content, /no valid entries/);
    assert.ok(t.db.listKeys(id).every(k => !k.has_key));
});

test("winners who left the server are skipped", async () => {
    const t = rig({ gone: new Set(["a"]) });
    const { id } = await t.make({ keys: [{ label: "Hades", key: "K1" }] });
    await t.enterAll(id, ["a", "b"]);
    t.advance(3 * HOUR);
    await t.svc.tick();
    assert.equal(t.db.listKeys(id)[0].winner_id, "b");
});

test("the draw is weighted by bonus entries", async () => {
    const t = rig();
    const { id } = await t.make({ keys: [{ label: "Hades", key: "K1" }], bonus_role_id: "B", bonus_entries: 5 });
    await t.svc.enter(id, { userId: "a", roleIds: [] });
    await t.svc.enter(id, { userId: "b", roleIds: ["B"] });
    assert.deepEqual(t.db.listEntries(id).map(e => e.entries), [1, 5]);
    // rand() always returns 0, so the first entrant wins; with a roll of 1 the weighted b wins
    const t2 = rig();
    t2.svc; // (a separate service with a different roll)
    const svc = createGiveawayService({ db: t.db, vault: t.vault, discord: { memberOk: async () => true, post: async () => ({ id: "9" }), edit: async () => {}, dm: async () => {}, findChannelByName: async () => null }, now: t.now, rand: () => 3 });
    t.advance(3 * HOUR);
    await svc.end(id);
    assert.equal(t.db.listKeys(id)[0].winner_id, "b");
});

async function won(t, opts) {
    const { id } = await t.make(opts);
    await t.enterAll(id, ["a", "b", "c"]);
    t.advance(3 * HOUR);
    await t.svc.tick();
    return id;
}

test("claim: only winners, key handed over, follow-up scheduled; claiming again works until confirmed", async () => {
    const t = rig();
    const id = await won(t);
    assert.throws(() => t.svc.prepareClaim(id, "stranger"), /not a winner/);
    const first = t.db.listKeys(id)[0];
    const c = t.svc.prepareClaim(id, first.winner_id);
    assert.equal(c.plain, "AAAAA-BBBBB-CCCCC");
    assert.match(JSON.stringify(keyMessage(c.giveaway, c.key.label, c.plain)), /AAAAA-BBBBB-CCCCC/);
    assert.equal(keyMessage(c.giveaway, "x", "k", { fallback: true }).content, "Your DMs are closed, Here's your prize:");
    await t.svc.delivered(c.key.id, "dm");
    assert.equal(t.db.getKey(c.key.id).status, "delivered");
    assert.equal(t.svc.prepareClaim(id, first.winner_id).plain, "AAAAA-BBBBB-CCCCC"); // lost the message? claim again
});

test("confirming wipes the key and posts a vouch in the vouches channel", async () => {
    const t = rig();
    const id = await won(t);
    const k = t.db.listKeys(id)[0];
    await assert.rejects(() => t.svc.confirm(k.id, k.winner_id), /Claim key/); // must claim first
    await t.svc.delivered(k.id, "dm");
    await assert.rejects(() => t.svc.confirm(k.id, "someone-else"), /not for you/);
    const r = await t.svc.confirm(k.id, k.winner_id);
    assert.equal(r.vouched, true);
    const vouch = t.posts.find(p => p.channelId === "vouch-chan");
    assert.match(vouch.payload.embeds[0].description, new RegExp(`<@${k.winner_id}> confirmed that their \\*\\*Hades\\*\\* key redeemed successfully`));
    assert.deepEqual(vouch.payload.allowedMentions, { parse: [] });
    const after = t.db.getKey(k.id);
    assert.deepEqual([after.status, after.has_key], ["confirmed", false]);
    assert.throws(() => t.svc.prepareClaim(id, k.winner_id), /already confirmed/);
});

test("the vouch channel can be set per giveaway or per server, and a missing one is not fatal", async () => {
    const t = rig({ vouches: null });
    const id = await won(t, { vouch_channel_id: "mine" });
    const k = t.db.listKeys(id)[0];
    await t.svc.delivered(k.id, "dm");
    await t.svc.confirm(k.id, k.winner_id);
    assert.ok(t.posts.some(p => p.channelId === "mine"));

    const t2 = rig({ vouches: null });
    const id2 = await won(t2);
    t2.db.setGiveawaySettings("G", { vouch_channel_id: "server-default" });
    const k2 = t2.db.listKeys(id2)[0];
    await t2.svc.delivered(k2.id, "dm");
    await t2.svc.confirm(k2.id, k2.winner_id);
    assert.ok(t2.posts.some(p => p.channelId === "server-default"));

    const t3 = rig({ vouches: null });
    const id3 = await won(t3);
    const k3 = t3.db.listKeys(id3)[0];
    await t3.svc.delivered(k3.id, "dm");
    assert.equal((await t3.svc.confirm(k3.id, k3.winner_id)).vouched, false);
});

test("follow-up: a DM after 10 minutes, a channel message when DMs are closed, one reminder after a day", async () => {
    const t = rig({ dmFails: new Set(["a"]) });
    const { id } = await t.make({ keys: [{ label: "Hades", key: "K1" }] });
    await t.enterAll(id, ["a"]);
    t.advance(3 * HOUR);
    await t.svc.tick();
    const k = t.db.listKeys(id)[0];
    await t.svc.delivered(k.id, "channel");
    assert.equal((await t.svc.tick()).prompts, 0); // too early
    t.advance(11 * 60_000);
    const before = t.posts.length;
    assert.equal((await t.svc.tick()).prompts, 1);
    const prompt = t.posts.at(-1);
    assert.equal(t.posts.length, before + 1);
    assert.match(prompt.payload.content, /<@a> please confirm/);
    assert.equal(prompt.payload.components[0].components[0].custom_id, `gw_confirm:${k.id}`);
    t.advance(25 * HOUR);
    assert.equal((await t.svc.tick()).prompts, 1); // the reminder
    t.advance(25 * HOUR);
    assert.equal((await t.svc.tick()).prompts, 0); // and then it stops
});

test("a key that did not work is reported to the host and can be replaced", async () => {
    const t = rig();
    const id = await won(t);
    const k = t.db.listKeys(id)[0];
    await t.svc.delivered(k.id, "dm");
    const r = await t.svc.reportProblem(k.id, k.winner_id);
    assert.equal(r.hostTold, true);
    assert.equal(t.db.getKey(k.id).status, "problem");
    assert.throws(() => t.svc.prepareClaim(id, k.winner_id), /reported a problem/);
    await assert.rejects(() => t.svc.replaceKey(id, k.winner_id, "two words"), UserError);
    await t.svc.replaceKey(id, k.winner_id, "NEW-KEY-12345");
    assert.equal(t.svc.prepareClaim(id, k.winner_id).plain, "NEW-KEY-12345");
    assert.ok(t.dms.some(d => d.userId === k.winner_id && /replaced your key/.test(JSON.stringify(d.payload))));
});

test("unclaimed prizes pass to someone else after the claim window, and stop after 3 tries", async () => {
    const t = rig();
    const { id } = await t.make({ keys: [{ label: "Hades", key: "K1" }], claim_hours: 1 });
    await t.enterAll(id, ["a", "b", "c", "d", "e"]);
    t.advance(3 * HOUR);
    await t.svc.tick();
    const seen = [t.db.listKeys(id)[0].winner_id];
    for (let i = 0; i < 2; i++) {
        t.advance(2 * HOUR);
        assert.equal((await t.svc.tick()).forfeited, 1);
        const w = t.db.listKeys(id)[0].winner_id;
        assert.ok(!seen.includes(w), "a new person, not one who already forfeited");
        seen.push(w);
    }
    assert.match(t.posts.at(-1).payload.content, /New winner/);
    t.advance(2 * HOUR);
    await t.svc.tick(); // third forfeit: no more redraws
    assert.equal(t.db.listKeys(id)[0].status, "available");
});

test("reroll: a specific winner is replaced, or prizes without a winner are drawn", async () => {
    const t = rig();
    const id = await won(t);
    const first = t.db.listKeys(id)[0];
    const r = await t.svc.reroll(id, { userId: first.winner_id });
    assert.notEqual(r.winners[0].userId, first.winner_id);
    await assert.rejects(() => t.svc.reroll(id, {}), /Every prize already has a winner/);
    await assert.rejects(() => t.svc.reroll(id, { userId: "nobody" }), /did not win/);
});

test("cancel: the host gets unused keys back and the post is closed", async () => {
    const t = rig();
    const { id } = await t.make();
    await t.enterAll(id, ["a"]);
    const r = await t.svc.cancel(id);
    assert.equal(r.unused, 2);
    assert.equal(t.db.getGiveaway(id).status, "cancelled");
    assert.ok(t.edits.some(e => /cancelled/.test(JSON.stringify(e.payload))));
    await assert.rejects(() => t.svc.cancel(id), /already over/);
});

test("old keys are purged even if nobody confirmed", async () => {
    const t = rig();
    const id = await won(t);
    const k = t.db.listKeys(id)[0];
    await t.svc.delivered(k.id, "dm");
    t.advance(15 * 86400_000);
    await t.svc.tick();
    assert.equal(t.db.getKey(k.id).has_key, false);
});

test("deleting your data removes entries and returns waiting prizes to the host", async () => {
    const t = rig();
    const id = await won(t);
    const k = t.db.listKeys(id)[0];
    assert.ok(t.db.hasGiveawayData(k.winner_id));
    t.db.ensureUser(k.winner_id);
    t.db.deleteUser(k.winner_id);
    assert.equal(t.db.getEntry(id, k.winner_id), undefined);
    assert.equal(t.db.getKey(k.id).status, "available");
});

test("the giveaway post respects customisation", () => {
    const g = { id: 5, host_id: "h", title: "T", description: "D", color: 0x123456, image_url: "https://i.example/x.png", thumbnail_url: "http://insecure.example/t.png", button_label: "Join now!", ping_role_id: "P", status: "active", ends_at: 2e12, guild_id: "G", channel_id: "C", claim_hours: 48, bonus_entries: 1 };
    const p = giveawayPayload(g, [{ label: "Hades" }], 0, "active");
    assert.equal(p.embeds[0].color, 0x123456);
    assert.equal(p.embeds[0].image.url, "https://i.example/x.png");
    assert.equal(p.embeds[0].thumbnail, undefined); // only https images are used
    assert.equal(p.components[0].components[0].label, "Join now!");
    assert.equal(p.content, "<@&P>");
});

test("videos and GIFs: video links go in the message text, GIFs stay in the embed", async () => {
    const { isVideoLink, parseImageUrl } = await import("../src/gwparse.js");
    const { giveawayPayload } = await import("../src/gwrender.js");
    for (const u of ["https://x.com/a.mp4", "https://x.com/a.webm?x=1", "https://www.youtube.com/watch?v=abc", "https://youtu.be/abc", "https://tenor.com/view/x-123", "https://clips.twitch.tv/Abc"]) assert.equal(isVideoLink(u), true, u);
    for (const u of ["https://x.com/a.gif", "https://i.imgur.com/a.png", "https://cdn.discordapp.com/attachments/1/2/a.gif", "https://x.com/a"]) assert.equal(isVideoLink(u), false, u);
    assert.throws(() => parseImageUrl("https://x.com/a.mp4", "thumbnail"), /small image/);
    assert.ok(parseImageUrl("https://x.com/a.mp4", "image"));
    const base = { id: 1, title: "T", host_id: "1", ends_at: 1e12, status: "active", ping_role_id: "9" };
    const vid = giveawayPayload({ ...base, image_url: "https://x.com/a.mp4" }, [{ label: "A" }], 0);
    assert.equal(vid.embeds[0].image, undefined);
    assert.match(vid.content, /<@&9>\nhttps:\/\/x\.com\/a\.mp4/);
    const gif = giveawayPayload({ ...base, image_url: "https://x.com/a.gif" }, [{ label: "A" }], 0);
    assert.equal(gif.embeds[0].image.url, "https://x.com/a.gif");
    assert.equal(gif.content, "<@&9>");
});

test("scheduled giveaway posts only when its time comes", async () => {
    const t = rig();
    const r = await t.make({ start_in_ms: 3 * HOUR });
    assert.equal(r.scheduled, true);
    assert.equal(t.posts.length, 0);
    assert.equal(t.db.getGiveaway(r.id).status, "scheduled");
    await t.svc.tick();
    assert.equal(t.posts.length, 0);
    t.advance(3 * HOUR + 1000);
    const done = await t.svc.tick();
    assert.equal(done.started, 1);
    assert.equal(t.posts.length, 1);
    const g = t.db.getGiveaway(r.id);
    assert.equal(g.status, "active");
    assert.equal(g.ends_at, t.now() + 2 * HOUR);
    await t.svc.enter(r.id, { userId: "u1", roleIds: [] });
});

test("a scheduled giveaway can be cancelled and returns its keys", async () => {
    const t = rig();
    const r = await t.make({ start_in_ms: HOUR });
    const out = await t.svc.cancel(r.id);
    assert.equal(out.unused, 2);
    assert.equal(t.db.getGiveaway(r.id).status, "cancelled");
});

test("a series splits the prizes across scheduled rounds", async () => {
    const t = rig();
    const keys = ["A", "B", "C", "D"].map(l => ({ label: l, key: `${l}${l}${l}${l}-${l}${l}${l}${l}` }));
    await assert.rejects(() => t.make({ keys, rounds: 2, repeat_ms: HOUR }), /at least as long/);
    const r = await t.make({ keys, rounds: 2, repeat_ms: 5 * HOUR });
    assert.equal(r.ids.length, 2);
    assert.equal(t.posts.length, 1); // round one starts now
    const rows = r.ids.map(id => t.db.getGiveaway(id));
    assert.deepEqual(rows.map(g => g.status), ["active", "scheduled"]);
    assert.match(rows[1].title, /round 2 of 2/);
    assert.equal(t.db.listKeys(r.ids[1]).length, 2);
    t.advance(5 * HOUR + 1000);
    await t.svc.tick();
    assert.equal(t.db.getGiveaway(r.ids[1]).status, "active");
});

test("booster-only giveaways turn away everyone else", async () => {
    const t = rig();
    const r = await t.make({ require_boost: true });
    await assert.rejects(() => t.svc.enter(r.id, { userId: "u1", roleIds: [] }), /boosters/);
    const ok = await t.svc.enter(r.id, { userId: "u2", roleIds: [], boosting: true });
    assert.equal(ok.status, "entered");
    assert.match(giveawayPayload(t.db.getGiveaway(r.id), t.db.listKeys(r.id), 0, "active").embeds[0].fields.map(f => f.value).join(" "), /boosters only/);
});

test("a global giveaway is shown in other servers and DMs, draws from entrants anywhere, and closes every copy", async () => {
    const r = rig({ gone: new Set(["from-elsewhere"]) }); // "gone" would fail a membership check in the home server
    r.db.setGiveawaySettings("G2", { giveaway_channel_id: "C2" });
    r.db.setGuildChannel("G3", "C3", "x");
    const dests = r.db.giveawayDestinations().map(d => d.channel_id).sort();
    assert.deepEqual(dests, ["C2", "C3"]);

    const made = await r.make({ keys: [{ label: "Hades", key: "AAAAA-BBBBB-CCCCC" }] });
    const done = r.svc.spread(made.id, { channelIds: ["C", "C2", "C3"], dmUsers: ["u1", "u2"], delayMs: 0, sleep: async () => {} });
    assert.equal((await done).total, 4); // the home channel is skipped
    await new Promise(res => setTimeout(res, 20));
    assert.equal(r.svc.spreadStatus(made.id).sent, 4);
    assert.equal(r.db.getGiveaway(made.id).is_global, 1);
    assert.equal(r.posts.filter(p => p.channelId === "C2" || p.channelId === "C3").length, 2);
    assert.equal(r.dms.length, 2);

    await r.enterAll(made.id, ["from-elsewhere"]);
    const ended = await r.svc.end(made.id);
    assert.equal(ended.winners.length, 1);
    assert.equal(ended.winners[0].userId, "from-elsewhere"); // not dropped by the home-server membership check
    assert.ok(r.edits.length >= 3); // home post plus the copies were closed
    assert.ok(r.posts.some(p => p.channelId === "C2" && p.payload.embeds)); // winners shown in the other server
});
