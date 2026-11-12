import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { pollOptions, pollState, castVote, pollTally, pollEmbed, pollButtons } from "../src/gamenight.js";

const games = n => Array.from({ length: n }, (_, i) => ({ id: `g${i}`, title: `Game ${i}` }));

test("game night vote: up to five options, one vote each that can be moved, closes after six hours", () => {
    const opts = pollOptions({ allOwn: games(9), almost: [] }, () => 0.3);
    assert.equal(opts.length, 5); assert.equal(new Set(opts.map(o => o.id)).size, 5);
    assert.equal(pollOptions({ allOwn: [], almost: games(3) }).length, 3);
    const t0 = 1_000_000, s = pollState(opts, t0);
    assert.ok(castVote(s, "a", 0, t0 + 1)); assert.ok(castVote(s, "b", 0, t0 + 2)); assert.ok(castVote(s, "a", 2, t0 + 3));
    assert.deepEqual(pollTally(s), [1, 0, 1, 0, 0]);
    assert.equal(castVote(s, "c", 9, t0 + 4), false); assert.equal(castVote(s, "c", -1, t0 + 4), false);
    assert.equal(castVote(s, "c", 1, t0 + 7 * 3600_000), false);
    assert.match(pollEmbed(s, t0 + 10).description, /Tap a game to vote/); assert.match(pollEmbed(s, t0 + 7 * 3600_000).description, /closed/);
    assert.equal(pollButtons(opts)[0].components.length, 5); assert.equal(pollButtons(opts, false)[0].components[0].disabled, true);
    assert.match(pollButtons(opts)[0].components[1].custom_id, /^gn_vote:1$/);
});

test("game night vote: old polls are pruned a day after they close", () => {
    const db = openDb(":memory:");
    db.setMeta("poll:old", JSON.stringify({ until: Date.now() - 3 * 86400_000 })); db.setMeta("poll:new", JSON.stringify({ until: Date.now() + 3600_000 }));
    assert.equal(db.prunePolls(), 1); assert.equal(db.getMeta("poll:old"), null); assert.ok(db.getMeta("poll:new"));
});

test("game night vote: pressing a button records the vote and redraws the poll", async () => {
    const { createHandlers } = await import("../src/handlers.js");
    const db = openDb(":memory:");
    db.setMeta("poll:m1", JSON.stringify(pollState(games(3))));
    const h = createHandlers({ db, itad: {} });
    const out = [];
    const press = (user, idx, msg = "m1") => h.handlePollVote({ message: { id: msg }, user: { id: user }, customId: `gn_vote:${idx}`, update: async p => out.push(p), reply: async p => out.push({ reply: p }) });
    await press("a", 1); await press("b", 1); await press("a", 2);
    assert.deepEqual(pollTally(JSON.parse(db.getMeta("poll:m1"))), [0, 1, 1]);
    assert.match(out.at(-1).embeds[0].description, /Game 1\*\*: 1 vote/);
    await press("a", 0, "gone");
    assert.match(out.at(-1).reply.content, /no longer available/);
});

test("clearing old polls also clears the channel pointers that led to them", () => {
    const db = openDb(":memory:");
    db.setMeta("poll:old", JSON.stringify({ until: 1 })); db.setMeta("pollch:c1", "old");
    db.setMeta("poll:new", JSON.stringify({ until: Date.now() + 60_000 })); db.setMeta("pollch:c2", "new");
    db.prunePolls();
    assert.equal(db.getMeta("pollch:c1"), null); assert.equal(db.getMeta("pollch:c2"), "new");
});
