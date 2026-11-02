import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { chooseMeme, memeEmbed, createMemes, postMeme, tickMemes } from "../src/memes.js";

const good = (n, o = {}) => ({ postLink: `https://redd.it/${n}`, subreddit: "memes", title: `Meme ${n}`, url: `https://i.redd.it/${n}.png`, nsfw: false, spoiler: false, ups: 500, ...o });

test("only safe, fresh, image-host memes with enough upvotes are chosen", () => {
    const list = [good("a", { nsfw: true }), good("b", { spoiler: true }), good("c", { url: "https://evil.example/c.png" }), good("d", { url: "https://i.redd.it/d.mp4" }), good("e", { ups: 3 }), good("f", { title: "porn" }), good("seen"), good("ok")];
    assert.equal(chooseMeme(list, new Set(["https://redd.it/seen"]), () => 0).postLink, "https://redd.it/ok");
    assert.equal(chooseMeme([good("a", { nsfw: true })]), null);
    assert.equal(chooseMeme(null), null);
    const e = memeEmbed(good("ok"));
    assert.equal(e.image.url, "https://i.redd.it/ok.png"); assert.match(e.footer.text, /r\/memes · 👍 500/);
});

function rig({ now0 = 10_000_000_000, answers } = {}) {
    const db = openDb(":memory:"); let clock = now0; const sent = [];
    const api = { sendMessage: async (ch, p) => { sent.push([ch, p]); return { id: "m" + sent.length }; }, listChannels: async () => [{ id: "chMemes", name: "😂-memes", type: 0 }, { id: "chOther", name: "general", type: 0 }] };
    let n = 0;
    const fetchImpl = async () => ({ ok: true, json: async () => ({ memes: answers ? answers(n++) : [good("p" + n++)] }) });
    return { db, api, sent, memes: createMemes({ fetchImpl, rnd: () => 0 }), now: () => clock, advance: ms => { clock += ms; } };
}

test("a meme is posted on the timer, never repeats, and the channel is found by name in set-up servers", async () => {
    const r = rig();
    r.db.setCommunity("g1", { setup_at: 1 });
    r.db.setCommunity("g2", {}); // never ran setup: left alone
    const has = () => true, args = { db: r.db, api: r.api, memes: r.memes, now: r.now, has, sleep: async () => {} };
    assert.equal(await tickMemes(args), 1);
    assert.equal(r.sent.length, 1); assert.equal(r.sent[0][0], "chMemes"); assert.equal(r.db.getCommunity("g1").meme_channel, "chMemes");
    assert.equal(await tickMemes(args), 0, "not due yet");
    r.advance(61 * 60_000);
    assert.equal(await tickMemes(args), 1); assert.equal(r.sent.length, 2);
    assert.notEqual(r.sent[0][1].embeds[0].url, r.sent[1][1].embeds[0].url, "a different post");
    r.db.setCommunity("g1", { meme_hours: 6 }); r.advance(3 * 3_600_000);
    assert.equal(await tickMemes(args), 0, "every 6 hours now");
    r.db.setCommunity("g1", { meme_on: 0 }); r.advance(10 * 3_600_000);
    assert.equal(await tickMemes(args), 0, "turned off");
});

test("when nothing fresh can be found it tries again in ten minutes, and /now explains", async () => {
    const r = rig({ answers: () => [] });
    r.db.setCommunity("g1", { setup_at: 1, meme_channel: "c1" });
    const args = { db: r.db, api: r.api, memes: r.memes, now: r.now, has: () => true, sleep: async () => {} };
    assert.equal(await tickMemes(args), 0);
    r.advance(11 * 60_000); assert.equal(await tickMemes(args), 0, "retried (and still nothing)");
    await assert.rejects(postMeme({ db: r.db, api: r.api, memes: r.memes, guildId: "g1", now: r.now }), /fresh meme/);
    await assert.rejects(postMeme({ db: r.db, api: r.api, memes: r.memes, guildId: "g9" }), /No meme channel/);
});

test("memes only go to servers the bot is in, and a failed post waits a full interval", async () => {
    const r = rig();
    r.db.setCommunity("g1", { setup_at: 1, meme_channel: "c1" });
    assert.equal(await tickMemes({ db: r.db, api: r.api, memes: r.memes, now: r.now, has: () => false, sleep: async () => {} }), 0);
    const bad = { ...r.api, sendMessage: async () => { throw new Error("403"); } };
    assert.equal(await tickMemes({ db: r.db, api: bad, memes: r.memes, now: r.now, has: () => true, sleep: async () => {} }), 0);
    r.advance(30 * 60_000);
    assert.equal(await tickMemes({ db: r.db, api: r.api, memes: r.memes, now: r.now, has: () => true, sleep: async () => {} }), 0, "waits the full hour after a failure");
});
