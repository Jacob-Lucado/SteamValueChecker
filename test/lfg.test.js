import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { parseWhen, zonedMs, createLfgService } from "../src/lfg.js";
import { lfgEmbed, lfgComponents } from "../src/lfgrender.js";

const NOW = Date.UTC(2026, 10, 3, 18, 0); // Tue 3 Nov 2026, 18:00 UTC = 13:00 in New York (EST)
const NY = "America/New_York";

test("times are read in the person's time zone", () => {
    assert.equal(parseWhen("now", { now: NOW }), NOW);
    assert.equal(parseWhen("in 90 minutes", { now: NOW }), NOW + 90 * 60_000);
    assert.equal(parseWhen("in 2 hours", { now: NOW }), NOW + 7200_000);
    assert.equal(parseWhen("8pm", { tz: NY, now: NOW }), Date.UTC(2026, 10, 4, 1, 0)); // 20:00 EST today
    assert.equal(parseWhen("noon", { tz: NY, now: NOW }), null);
    assert.equal(parseWhen("12:00", { tz: NY, now: NOW }), Date.UTC(2026, 10, 4, 17, 0)); // 12:00 already passed, so tomorrow
    assert.equal(parseWhen("tomorrow 19:30", { tz: NY, now: NOW }), Date.UTC(2026, 10, 5, 0, 30));
    assert.equal(parseWhen("friday 9pm", { tz: NY, now: NOW }), Date.UTC(2026, 10, 7, 2, 0));
    assert.equal(parseWhen("2026-11-07 20:00", { tz: NY, now: NOW }), Date.UTC(2026, 10, 8, 1, 0));
    assert.equal(parseWhen("tonight", { now: NOW }), null);
    assert.equal(parseWhen("", { now: NOW }), null);
});

test("daylight saving is handled when converting wall time", () => {
    assert.equal(zonedMs("2026-07-01", 20 * 60, NY), Date.UTC(2026, 6, 2, 0, 0)); // EDT, UTC-4
    assert.equal(zonedMs("2026-12-01", 20 * 60, NY), Date.UTC(2026, 11, 2, 1, 0)); // EST, UTC-5
});

function rig() {
    const db = openDb(":memory:");
    const sent = [], edits = [];
    let n = 0, failEvent = false;
    const discord = {
        post: async (channel, payload) => { sent.push({ channel, payload }); return { id: "m" + ++n }; },
        edit: async (channel, id, payload) => { edits.push({ channel, id, payload }); },
        createEvent: async () => { if (failEvent) throw new Error("Missing Permissions"); return { id: "ev1" }; }
    };
    let t = NOW;
    const svc = createLfgService({ db, discord, now: () => t });
    return { db, svc, sent, edits, setNow: v => { t = v; }, failEvents: () => { failEvent = true; } };
}
const base = { guildId: "g", channelId: "c", creatorId: "host", game: "Deep Rock", startsAt: NOW + 3600_000, slots: 3 };

test("a post starts with the host in it, and people can join until it is full", async () => {
    const { db, svc, sent, edits } = rig();
    const { post } = await svc.create(base);
    assert.deepEqual(db.lfgMembers(post.id), ["host"]);
    assert.equal(sent.length, 1);
    assert.equal(db.getLfg(post.id).message_id, "m1");
    assert.equal((await svc.join(post.id, "a")).result, "joined");
    assert.equal((await svc.join(post.id, "a")).result, "already");
    await svc.join(post.id, "b");
    await assert.rejects(svc.join(post.id, "c"), /full/);
    assert.equal(edits.length, 2, "the post is updated when someone joins, not for repeats");
    const e = lfgEmbed(db.getLfg(post.id), db.lfgMembers(post.id));
    assert.match(e.title, /^Full: /);
    assert.equal(lfgComponents(db.getLfg(post.id), db.lfgMembers(post.id))[0].components[0].disabled, true);
});

test("leaving, closing and who may close", async () => {
    const { db, svc } = rig();
    const { post } = await svc.create(base);
    await svc.join(post.id, "a");
    await svc.leave(post.id, "a");
    await assert.rejects(svc.leave(post.id, "a"), /not in/);
    await assert.rejects(svc.close(post.id, "stranger"), /Only the person/);
    await svc.close(post.id, "mod", { canManage: true });
    await assert.rejects(svc.join(post.id, "b"), /closed/);
    assert.deepEqual(lfgComponents(db.getLfg(post.id), []), []);
});

test("input is checked", async () => {
    const { svc } = rig();
    await assert.rejects(svc.create({ ...base, game: "  " }), /which game/);
    await assert.rejects(svc.create({ ...base, slots: 1 }), /2 to 20/);
    await assert.rejects(svc.create({ ...base, startsAt: NaN }), /couldn't read/);
    await assert.rejects(svc.create({ ...base, startsAt: NOW - 3600_000 }), /passed/);
    await assert.rejects(svc.create({ ...base, startsAt: NOW + 40 * 86400_000 }), /30 days/);
    for (let i = 0; i < 3; i++) await svc.create(base);
    await assert.rejects(svc.create(base), /3 open posts/);
});

test("a Discord event is optional, and a refusal does not lose the post", async () => {
    const { db, svc, failEvents } = rig();
    const ok = await svc.create({ ...base, event: true });
    assert.equal(db.getLfg(ok.post.id).event_id, "ev1");
    failEvents();
    const bad = await svc.create({ ...base, creatorId: "other", event: true });
    assert.match(bad.eventError, /Manage Events/);
    assert.ok(db.getLfg(bad.post.id).message_id);
});

test("the group is reminded once at the start, and the post closes a few hours later", async () => {
    const { db, svc, sent, setNow } = rig();
    const { post } = await svc.create(base);
    await svc.join(post.id, "a");
    setNow(NOW + 3600_000 + 1000);
    assert.deepEqual(await svc.tick(), { reminded: 1, expired: 0 });
    assert.match(sent.at(-1).payload.content, /Deep Rock.*<@host> <@a>/);
    assert.deepEqual(await svc.tick(), { reminded: 0, expired: 0 });
    setNow(NOW + 3600_000 + 4 * 3600_000);
    assert.deepEqual(await svc.tick(), { reminded: 0, expired: 1 });
    assert.equal(db.getLfg(post.id).status, "closed");
});

test("a lone host is not pinged, and deleting your data removes you from groups", async () => {
    const { db, svc, sent, setNow } = rig();
    const { post } = await svc.create(base);
    setNow(NOW + 3600_000 + 1000);
    const before = sent.length;
    await svc.tick();
    assert.equal(sent.length, before);
    const { post: p2 } = await svc.create({ ...base, creatorId: "h2", startsAt: NOW + 7200_000 });
    await svc.join(p2.id, "gone");
    db.ensureUser("gone", "g");
    assert.equal(db.exportUser("gone").lfg_posts.length, 1);
    db.deleteUser("gone");
    assert.ok(!db.lfgMembers(p2.id).includes("gone"));
});
