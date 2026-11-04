import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { createTrivia, maskTitle, factsFrom, POINTS } from "../src/trivia.js";

const names = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India", "Juliet", "Kilo", "Lima", "Mike", "November", "Oscar", "Papa"];
const pool = names.map((_, i) => 1000 + i);
const fakeFetch = async url => {
    const id = Number(new URL(url).searchParams.get("appids")), name = names[id - 1000];
    return { ok: true, json: async () => ({ [id]: { success: true, data: { name, release_date: { date: "Mar 3, 2019" }, genres: [{ description: "Action" }], developers: ["Studio " + name], short_description: `${name} is a game about running very fast through corridors.`, screenshots: [{ path_full: "https://x/s.jpg" }], header_image: "https://x/h.jpg" } } }) };
};
function setup(extra = {}) {
    const db = openDb(":memory:");
    const sent = [], edits = [];
    const t = createTrivia({ db, fetchImpl: fakeFetch, pool, stageMs: 5, breakMs: 5, sendMessage: async (c, p) => { sent.push({ c, p }); return { id: "m" + sent.length }; }, editMessage: async (c, m, p) => { edits.push({ c, m, p }); }, ...extra });
    return { db, t, sent, edits };
}
const until = async (fn, ms = 3000) => { const end = Date.now() + ms; while (!fn()) { if (Date.now() > end) throw new Error("timed out"); await new Promise(r => setTimeout(r, 5)); } };

test("trivia: the name is blanked out of the blurb", () => {
    assert.ok(!/portal/i.test(maskTitle("Portal 2: Aperture awaits. Portal 2 is great.", "Portal 2: Aperture")));
    assert.ok(!/hades/i.test(maskTitle("Hades is a rogue-like. <b>HADES</b> again.", "Hades")));
    assert.equal(factsFrom(1, { name: "X", release_date: { date: "soon" }, genres: [{ description: "A" }], short_description: "y".repeat(40) }), null, "needs a real year");
});

test("trivia: plays a full game, scores by how early the right answer came, and saves the board", async () => {
    const { db, t, sent, edits } = setup({ stageMs: 150 });
    await t.start({ guildId: "g1", channelId: "c1", rounds: 3, by: "u0" });
    await assert.rejects(() => t.start({ guildId: "g1", channelId: "c1" }), /already going/);
    let round = 1;
    while (round <= 3) {
        await until(() => sent.some(s => s.p.components?.[0]?.components?.[0]?.custom_id === `trivia:${round}:0`));
        const msg = sent.filter(s => s.p.components).at(round - 1).p;
        const labels = msg.components.flatMap(r => r.components.map(b => b.label));
        assert.equal(new Set(labels).size, 4, "four different options");
        assert.equal(msg.embeds[0].description.includes("running very fast"), false, "blurb only appears in the last stage");
        // Four players each tap a different option while the first clues are up, so exactly one is right every round.
        assert.match(t.answer({ guildId: "g1", round, idx: 0, userId: "u1" }), /Locked in/);
        assert.match(t.answer({ guildId: "g1", round, idx: 1, userId: "u1" }), /already locked/);
        for (const i of [1, 2, 3]) t.answer({ guildId: "g1", round, idx: i, userId: "u" + (i + 1) });
        await until(() => edits.filter(e => e.p.components?.length === 0).length >= round);
        round++;
    }
    await until(() => !t.active("g1"));
    assert.match(t.answer({ guildId: "g1", round: 1, idx: 0, userId: "u3" }), /over/);
    const results = sent.at(-1).p.embeds[0];
    assert.match(results.title, /results/);
    const top = db.triviaTop("g1");
    assert.equal(top.reduce((n, r) => n + r.points, 0), 3 * POINTS[0], "one 3-point answer per round");
    assert.equal(top.reduce((n, r) => n + r.wins, 0), 1, "one winner");
    assert.equal(db.triviaRank("g1", "u1").played, 1);
    assert.equal(t.topEmbed("g1").title.includes("leaderboard"), true);
});

test("trivia: stop ends the game and keeps what was scored; a failed first post frees the server", async () => {
    const { t, db } = setup({ stageMs: 50 });
    await t.start({ guildId: "g2", channelId: "c2", rounds: 3 });
    await until(() => t.active("g2"));
    t.stop("g2");
    await until(() => !t.active("g2"));
    assert.throws(() => t.stop("g2"), /no trivia game/);
    assert.deepEqual(db.triviaTop("g2"), []);
    const bad = setup({ sendMessage: async () => { throw new Error("403"); } });
    await assert.rejects(() => bad.t.start({ guildId: "g3", channelId: "c" }), /can't post/);
    assert.equal(bad.t.active("g3"), null);
});

test("trivia: gives up politely when Steam can't be reached", async () => {
    const { t } = setup({ fetchImpl: async () => ({ ok: false }) });
    await assert.rejects(() => t.start({ guildId: "g4", channelId: "c" }), /couldn't reach Steam/);
    assert.equal(t.active("g4"), null);
});
