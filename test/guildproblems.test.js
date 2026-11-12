import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { reportProblem, listProblems, clearProblems, whyFailed } from "../src/guildproblems.js";
import { createCommunity } from "../src/communityservice.js";
import { createModeration } from "../src/moderation.js";
import { DiscordApiError } from "../src/dashboard/discord.js";

test("failures are explained in plain words, grouped, throttled and dismissable", () => {
    assert.match(whyFailed(new DiscordApiError(403, "no")), /missing a permission/);
    assert.match(whyFailed({ status: 404 }), /no longer exists/);
    const db = openDb(":memory:");
    reportProblem(db, "G1", "autorole", "give the auto role", new DiscordApiError(403, "no"), 1_000_000);
    reportProblem(db, "G1", "autorole", "give the auto role", new DiscordApiError(403, "no"), 1_000_500); // inside the throttle: not written again
    reportProblem(db, "G1", "welcome", "post the welcome message", new DiscordApiError(404, "gone"), 1_200_000);
    reportProblem(db, "G1", "autorole", "give the auto role", new DiscordApiError(403, "no"), 1_300_000);
    const list = listProblems(db, "G1");
    assert.deepEqual(list.map(p => p.key), ["autorole", "welcome"], "newest first, one line per problem");
    assert.equal(list[0].count, 2); assert.deepEqual(listProblems(db, "G2"), []);
    assert.equal(clearProblems(db, "G1", "welcome"), 1); assert.equal(listProblems(db, "G1").length, 1);
    clearProblems(db, "G1"); assert.deepEqual(listProblems(db, "G1"), []);
    assert.doesNotThrow(() => reportProblem(null, "G", "k", "x"));
});

test("a role the bot can't give, and a mod log it can't write to, show up as problems", async () => {
    const db = openDb(":memory:");
    const api = { addRole: async () => { throw new DiscordApiError(403, "Missing Permissions"); }, sendMessage: async () => { throw new DiscordApiError(403, "no"); }, listInvites: async () => [], getGuild: async () => ({ name: "T", owner_id: "1" }) };
    db.setCommunity("G", { autorole_id: "900000000000000050", mod_log_channel: "900000000000000051" });
    const community = createCommunity({ db, api });
    await community.onJoin({ guildId: "G", guildName: "T", member: { id: "900000000000000060", username: "x", bot: false }, count: 5 });
    const mod = createModeration({ db, api, botId: () => "9" });
    await mod.note({ guildId: "G", actorId: "900000000000000002", userId: "900000000000000060", text: "hi" });
    const keys = listProblems(db, "G").map(p => p.key).sort();
    assert.deepEqual(keys, ["autorole", "modlog"]);
});
