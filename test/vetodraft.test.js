import test from "node:test";
import assert from "node:assert/strict";
import { startVeto, veto, skip, remaining, currentPlayer, vetoEmbed, vetoComponents, SKIP_AFTER_MS } from "../src/vetodraft.js";

const R = (n, over = {}) => ({ people: ["a", "b", "c"], allOwn: Array.from({ length: n }, (_, i) => ({ id: "g" + i, title: "Game " + i, coop: i % 2 === 0 })), almost: [], ...over });
const T0 = 1_800_000_000_000, fixed = () => 0.5;

test("a draft needs at least three games and two people", () => {
    assert.equal(startVeto(R(2)), null);
    assert.equal(startVeto(R(5, { people: ["a"] })), null);
    assert.equal(startVeto(R(2, { almost: [{ id: "x", title: "X", coop: false }] }), { now: T0 }).games.length, 3, "almost-everyone games fill in");
});

test("it keeps eight games at most and prefers co-op ones", () => {
    const s = startVeto(R(20), { rand: fixed, now: T0 });
    assert.equal(s.games.length, 8);
    assert.equal(s.games.filter(g => g.coop).length, 8, "ten co-op games exist, so all eight picked are co-op");
});

test("only the player on turn can strike, in order, until one game is left", () => {
    const s = startVeto(R(4), { rand: fixed, now: T0 });
    const [p0, p1, p2] = [0, 1, 2].map(i => s.players[i]);
    assert.equal(veto(s, p1, s.games[0].id, T0).ok, false);
    assert.equal(veto(s, "stranger", s.games[0].id, T0).ok, false);
    assert.equal(veto(s, p0, s.games[0].id, T0).ok, true);
    assert.equal(currentPlayer(s), p1);
    assert.equal(veto(s, p1, s.games[0].id, T0).ok, false, "already struck");
    assert.equal(veto(s, p1, s.games[1].id, T0).ok, true);
    assert.equal(veto(s, p2, s.games[2].id, T0).ok, true);
    assert.equal(s.winner, s.games[3].id); assert.equal(remaining(s).length, 1);
    assert.equal(veto(s, p0, s.games[3].id, T0).ok, false, "over");
    assert.match(vetoEmbed(s).title, /Tonight: Game 3/); assert.deepEqual(vetoComponents(s), []);
});

test("a quiet player can be skipped only after five minutes", () => {
    const s = startVeto(R(5), { rand: fixed, now: T0 });
    const first = currentPlayer(s), other = s.players.find(p => p !== first);
    assert.match(skip(s, other, T0 + 60_000).error, /5 min|4 min/);
    assert.equal(skip(s, "stranger", T0 + SKIP_AFTER_MS).ok, false);
    assert.equal(skip(s, other, T0 + SKIP_AFTER_MS).ok, true);
    assert.notEqual(currentPlayer(s), first); assert.equal(remaining(s).length, 5, "nothing was struck");
    assert.equal(s.log.at(-1).title, null);
    assert.match(vetoEmbed(s).fields[0].value, /was skipped/);
});

test("the select menu lists only the games still on the board, within Discord's limits", () => {
    const s = startVeto(R(8), { rand: fixed, now: T0 });
    veto(s, currentPlayer(s), s.games[0].id, T0);
    const menu = vetoComponents(s)[0].components[0];
    assert.equal(menu.options.length, 7);
    assert.ok(menu.options.every(o => o.label.length <= 100 && o.value.length <= 100));
});

test("a draft times out", () => {
    const s = startVeto(R(4), { rand: fixed, now: T0 });
    assert.match(veto(s, currentPlayer(s), s.games[0].id, T0 + 7 * 3600_000).error, /timed out/);
});

test("pressing the menu in Discord strikes the game, pings the next player and ends with a winner", async () => {
    const { openDb } = await import("../src/db.js");
    const { createHandlers } = await import("../src/handlers.js");
    const db = openDb(":memory:");
    const s = startVeto(R(3), { rand: fixed, now: Date.now() });
    db.setMeta("veto:m1", JSON.stringify(s));
    const h = createHandlers({ db, itad: {} });
    const out = [], follow = [];
    const pick = (user, value) => h.handleVetoMove({ message: { id: "m1" }, user: { id: user }, customId: "gn_vetopick", values: [value], isStringSelectMenu: () => true, update: async p => out.push(p), reply: async p => out.push({ reply: p }), followUp: async p => { follow.push(p); return { delete: async () => {} }; } });
    await pick("stranger", "g0");
    assert.match(out.at(-1).reply.content, /people who were in the channel/);
    const [p0, p1] = s.players;
    await pick(p1, "g0");
    assert.match(out.at(-1).reply.content, /turn/);
    await pick(p0, "g0");
    assert.match(out.at(-1).embeds[0].fields[0].value, /struck \*\*Game 0\*\*/);
    assert.match(follow.at(-1).content, new RegExp(`<@${p1}> you're up`));
    await pick(p1, "g1");
    assert.match(out.at(-1).embeds[0].title, /Tonight: Game 2/); assert.equal(out.at(-1).components.length, 0);
    assert.equal(follow.length, 1, "no ping once there is a winner");
    await h.handleVetoMove({ message: { id: "gone" }, user: { id: p0 }, customId: "gn_vetoskip", isStringSelectMenu: () => false, reply: async p => out.push({ reply: p }) });
    assert.match(out.at(-1).reply.content, /no longer available/);
});

test("old veto drafts are pruned with the polls", async () => {
    const { openDb } = await import("../src/db.js");
    const db = openDb(":memory:");
    db.setMeta("veto:old", JSON.stringify({ until: 1 })); db.setMeta("veto:new", JSON.stringify({ until: Date.now() + 60_000 }));
    db.prunePolls();
    assert.equal(db.getMeta("veto:old"), null); assert.ok(db.getMeta("veto:new"));
});
