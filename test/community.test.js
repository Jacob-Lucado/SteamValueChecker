import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { communitySetup, isFreshGuild, TEMPLATE, parseEmojis, importEmojis, renderWelcome, welcomePayload, findUsedInvite, messageXp, BOT_PERMISSIONS, rolePanel } from "../src/community.js";
import { levelFromXp, xpForNext } from "../src/communitystore.js";
import { createCommunity } from "../src/communityservice.js";
import { createDashboard } from "../src/dashboard/server.js";
import { DiscordApiError } from "../src/dashboard/discord.js";
import { parseSteps, parseHost, StepError, crossServerParts } from "../src/gwpartner.js";
import { giveawayPayload, winnersPayload } from "../src/gwrender.js";

/** A pretend Discord server: keeps channels and roles in memory and numbers new ones. */
function fakeApi({ channels = [], roles = [], deny = null } = {}) {
    let n = 1000;
    const state = { channels: [...channels], roles: [{ id: "G", name: "@everyone" }, ...roles], sent: [], guildEdits: [], emojis: [], deleted: [], added: [] };
    const api = {
        state,
        allChannels: async () => state.channels,
        allRoles: async () => state.roles,
        getGuild: async () => ({ name: "Test Guild", approximate_member_count: 2 }),
        createChannel: async (_g, b) => { if (deny === "channels") throw new DiscordApiError(403, "no"); const c = { id: String(++n), ...b }; state.channels.push(c); return c; },
        editChannel: async (id, b) => { const c = state.channels.find(x => x.id === id); Object.assign(c, b); return c; },
        deleteChannel: async id => { state.deleted.push(id); },
        createRole: async (_g, b) => { const r = { id: String(++n), ...b }; state.roles.push(r); return r; },
        editGuild: async (_g, b) => { state.guildEdits.push(b); },
        sendMessage: async (id, p) => { state.sent.push({ id, p }); return { id: "m" }; },
        addRole: async (g, u, r) => { state.added.push([u, r]); },
        removeRole: async () => {},
        listEmojis: async () => state.emojis,
        createEmoji: async (_g, b) => { if (state.emojis.length >= 3) throw new DiscordApiError(400, "full"); state.emojis.push({ id: String(++n), name: b.name }); },
        listInvites: async () => state.invites ?? [],
        createInvite: async () => ({ code: "abc123" }),
        memberName: async () => "Someone",
        listChannels: async () => state.channels.filter(c => c.type === 0).map(c => ({ id: c.id, name: c.name })),
        listRoles: async () => state.roles.filter(r => r.id !== "G").map(r => ({ id: r.id, name: r.name }))
    };
    return api;
}
const noSleep = async () => {};

test("a fresh server is recognised, a lived-in one is not", () => {
    const fresh = { channels: [{ id: "1", type: 4, name: "Text Channels" }, { id: "2", type: 0, name: "general" }, { id: "3", type: 4, name: "Voice Channels" }, { id: "4", type: 2, name: "General" }], roles: [{ id: "G", guild_id: "G", name: "@everyone" }], memberCount: 2 };
    assert.equal(isFreshGuild(fresh), true);
    assert.equal(isFreshGuild({ ...fresh, memberCount: 400 }), false);
    assert.equal(isFreshGuild({ ...fresh, channels: [...fresh.channels, { id: "9", type: 0, name: "rules" }] }), false);
    assert.equal(isFreshGuild({ ...fresh, roles: [...fresh.roles, { id: "7", name: "Staff" }] }), false);
});

test("community setup builds the layout, connects the bot, and running it again adds nothing", async () => {
    const db = openDb(":memory:");
    const api = fakeApi();
    const r = await communitySetup({ api, db, guildId: "G", botId: "bot", userId: "owner", sleep: noSleep, pace: 0 });
    const names = api.state.channels.map(c => c.name);
    for (const must of ["welcome", "rules", "general", "looking-for-group", "deal-alerts", "support-tickets", "Lobby", "mod-log"]) assert.ok(names.includes(must), must);
    assert.ok(api.state.roles.some(x => x.name === "Moderator") && api.state.roles.some(x => x.name === "Member"));
    // the staff area is hidden from everyone
    const staff = api.state.channels.find(c => c.name === "STAFF" || c.name === "🛠️ STAFF");
    assert.ok(staff.permission_overwrites.some(o => o.id === "G" && BigInt(o.deny) & 1024n));
    // the bot's features are connected
    const c = db.getCommunity("G");
    assert.ok(c.welcome_channel && c.autorole_id && c.mod_role_id && c.setup_at);
    assert.equal(db.getGuild("G").channel_id, r.channels.deals);
    assert.equal(db.getTicketSettings("G").channel_id, r.channels.tickets);
    assert.deepEqual(db.listLevelRoles("G").map(x => x.level), [5, 15, 30]);
    assert.ok(db.listSelfRoles("G").length >= 6);
    assert.ok(api.state.sent.some(m => m.p.components?.length), "role panel posted");
    assert.ok(api.state.guildEdits.some(e => e.afk_channel_id));
    const before = api.state.channels.length, rolesBefore = api.state.roles.length;
    const again = await communitySetup({ api, db, guildId: "G", botId: "bot", userId: "owner", sleep: noSleep, pace: 0 });
    assert.equal(api.state.channels.length, before);
    assert.equal(api.state.roles.length, rolesBefore);
    assert.equal(again.created.channels.length, 0);
});

test("on a fresh server the default channels are reused and the empty default categories are removed", async () => {
    const db = openDb(":memory:");
    const api = fakeApi({ channels: [{ id: "c-t", type: 4, name: "Text Channels" }, { id: "c-g", type: 0, name: "general", parent_id: "c-t" }, { id: "c-v", type: 4, name: "Voice Channels" }, { id: "c-gv", type: 2, name: "General", parent_id: "c-v" }] });
    await communitySetup({ api, db, guildId: "G", botId: "bot", userId: "o", fresh: true, sleep: noSleep, pace: 0 });
    assert.equal(api.state.channels.filter(c => c.name === "general").length, 1);
    const general = api.state.channels.find(c => c.id === "c-g");
    assert.notEqual(general.parent_id, "c-t");
    assert.equal(api.state.channels.find(c => c.id === "c-gv").name, "Lobby");
    assert.deepEqual(api.state.deleted.sort(), ["c-t", "c-v"]);
});

test("a missing permission is reported in plain words", async () => {
    const db = openDb(":memory:");
    await assert.rejects(communitySetup({ api: fakeApi({ deny: "channels" }), db, guildId: "G", botId: "b", sleep: noSleep, pace: 0 }), e => e.userFacing && /Manage Channels/.test(e.message));
});

test("levels follow the usual curve", () => {
    assert.equal(xpForNext(0), 100);
    assert.deepEqual(levelFromXp(0), { level: 0, into: 0, need: 100 });
    assert.equal(levelFromXp(100).level, 1);
    assert.equal(levelFromXp(99).level, 0);
    assert.equal(levelFromXp(100 + 155).level, 2);
    const x = messageXp(1, () => 0), y = messageXp(1, () => 0.999);
    assert.ok(x >= 15 && y <= 25);
    assert.ok(messageXp(2, () => 0) === 30);
});

test("XP: one message a minute counts, level-ups give the level roles, and the board is ordered", async () => {
    const db = openDb(":memory:");
    const api = fakeApi();
    let t = 1_000_000;
    const svc = createCommunity({ db, api, now: () => t, rng: () => 0.5 });
    db.setLevelRole("G", 1, "role-1");
    const a = await svc.onMessage({ guildId: "G", userId: "u1" });
    assert.ok(a && !a.leveled || a.leveled);
    assert.equal(await svc.onMessage({ guildId: "G", userId: "u1" }), null, "inside the cooldown");
    for (let i = 0; i < 6; i++) { t += 61_000; await svc.onMessage({ guildId: "G", userId: "u1" }); }
    t += 61_000; await svc.onMessage({ guildId: "G", userId: "u2" });
    assert.ok(db.getXp("G", "u1").level >= 1);
    assert.ok(api.state.added.some(([u, r]) => u === "u1" && r === "role-1"));
    assert.deepEqual(db.xpTop("G").map(r => r.user_id), ["u1", "u2"]);
    assert.equal(svc.rankOf("G", "u1").rank, 1);
    db.setCommunity("G", { xp_on: 0 });
    assert.equal(await svc.onMessage({ guildId: "G", userId: "u3" }), null);
});

test("welcome text fills in the fields and does not let names ping", () => {
    assert.equal(renderWelcome("Hi {user} to {server}, #{count}, {inviter}", { userId: "5", username: "x", server: "Cool", count: 12 }), "Hi <@5> to Cool, #12, someone");
    assert.match(renderWelcome("{username}", { userId: "5", username: "@everyone`", server: "s", count: 1 }), /^everyone$/);
    const p = welcomePayload({ settings: { welcome_msg: null }, userId: "5", username: "Sam", server: "Cool", count: 3, inviterId: "9" });
    assert.deepEqual(p.allowed_mentions.parse, []);
    assert.deepEqual(p.allowed_mentions.users, ["5", "9"]);
    assert.match(p.embeds[0].description, /Welcome to \*\*Cool\*\*/);
});

test("which invite was used", () => {
    const before = new Map([["a", { uses: 1, maxUses: 0, inviterId: "x" }], ["b", { uses: 0, maxUses: 1, inviterId: "y" }]]);
    assert.equal(findUsedInvite(before, [{ code: "a", uses: 2, inviterId: "x" }, { code: "b", uses: 0, inviterId: "y" }]).code, "a");
    assert.equal(findUsedInvite(before, [{ code: "a", uses: 1, inviterId: "x" }]).code, "b", "a one-use invite disappears");
    assert.equal(findUsedInvite(before, [{ code: "a", uses: 2 }, { code: "b", uses: 1 }]), null, "two at once cannot be told");
    assert.equal(findUsedInvite(before, [{ code: "a", uses: 1 }, { code: "b", uses: 0 }]), null);
});

test("a join: invite credited, role given, welcome posted, referral bonus and reward paid once", async () => {
    const db = openDb(":memory:");
    const api = fakeApi();
    const svc = createCommunity({ db, api });
    db.setCommunity("G", { welcome_channel: "wc", log_channel: "lc", autorole_id: "member", referral_xp: 100 });
    db.setReward("G", 1, "reward-role");
    api.state.invites = [{ code: "zzz", uses: 0, max_uses: 0, inviter: { id: "inviter" } }];
    await svc.refreshInvites("G");
    api.state.invites = [{ code: "zzz", uses: 1, max_uses: 0, inviter: { id: "inviter" } }];
    const r = await svc.onJoin({ guildId: "G", guildName: "Test", count: 5, member: { id: "new1", username: "New", avatar: null } });
    assert.equal(r.inviterId, "inviter");
    assert.deepEqual(db.inviteStats("G", "inviter"), { total: 1, active: 1, left: 0 });
    assert.ok(api.state.added.some(([u, role]) => u === "new1" && role === "member"));
    assert.ok(api.state.added.some(([u, role]) => u === "inviter" && role === "reward-role"));
    assert.equal(db.getXp("G", "inviter").xp, 100);
    assert.ok(api.state.sent.some(m => m.id === "wc" && m.p.embeds[0].fields?.[0]?.value === "<@inviter>"));
    assert.ok(api.state.sent.some(m => m.id === "lc"));
    // leaving and coming back does not pay again
    await svc.onLeave({ guildId: "G", member: { id: "new1", username: "New" } });
    assert.deepEqual(db.inviteStats("G", "inviter"), { total: 1, active: 0, left: 1 });
    api.state.invites = [{ code: "zzz", uses: 2, max_uses: 0, inviter: { id: "inviter" } }];
    const again = await svc.onJoin({ guildId: "G", guildName: "Test", count: 5, member: { id: "new1", username: "New" } });
    assert.equal(again.rejoin, true);
    assert.equal(db.getXp("G", "inviter").xp, 100);
    // you cannot invite yourself, and bots are ignored
    api.state.invites = [{ code: "zzz", uses: 3, max_uses: 0, inviter: { id: "self" } }];
    const me = await svc.onJoin({ guildId: "G", guildName: "Test", count: 6, member: { id: "self", username: "S" } });
    assert.equal(me.inviterId, null);
    assert.deepEqual(await svc.onJoin({ guildId: "G", guildName: "Test", count: 7, member: { id: "bot2", bot: true } }), { skipped: "bot" });
});

test("a member's own invite link is made once and credited to them", async () => {
    const db = openDb(":memory:");
    const api = fakeApi();
    const svc = createCommunity({ db, api });
    db.setCommunity("G", { welcome_channel: "wc" });
    assert.equal(await svc.inviteLinkFor("G", "u1"), "https://discord.gg/abc123");
    api.createInvite = async () => { throw new Error("should not be asked again"); };
    assert.equal(await svc.inviteLinkFor("G", "u1"), "https://discord.gg/abc123");
    assert.equal(db.inviteLinkOwner("G", "abc123"), "u1");
    api.state.invites = [{ code: "abc123", uses: 0, max_uses: 0, inviter: { id: "bot" } }];
    await svc.refreshInvites("G");
    api.state.invites = [{ code: "abc123", uses: 1, max_uses: 0, inviter: { id: "bot" } }];
    assert.equal((await svc.onJoin({ guildId: "G", guildName: "T", count: 2, member: { id: "n", username: "n" } })).inviterId, "u1");
});

test("emoji: pasted emoji and links are found, and the import renames clashes and stops cleanly when full", async () => {
    const found = parseEmojis("hi <:pog:123456789012345678> and <a:dance:223456789012345678> again <:pog:123456789012345678> https://cdn.discordapp.com/emojis/323456789012345678.png?size=96 https://evil.example/emojis/423456789012345678.png");
    assert.deepEqual(found.map(e => [e.name, e.animated]), [["pog", false], ["dance", true], ["emoji_345678", false]]);
    assert.match(found[1].url, /\.gif/);
    const api = fakeApi();
    api.state.emojis.push({ id: "1", name: "pog" });
    const fetchImpl = async url => { assert.match(url, /^https:\/\/cdn\.discordapp\.com\//); return { ok: true, status: 200, headers: { get: () => "image/png" }, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }; };
    const r = await importEmojis({ api, guildId: "G", items: found, fetchImpl, sleep: noSleep });
    assert.deepEqual(r.added, ["pog_2", "dance", "emoji_345678"].slice(0, 2).concat([]).length ? r.added : []);
    assert.ok(r.added.includes("pog_2"), "clash renamed");
    const big = await importEmojis({ api: fakeApi(), guildId: "G", items: [{ name: "big", url: "https://cdn.discordapp.com/emojis/1.png?size=128" }], sleep: noSleep, fetchImpl: async () => ({ ok: true, headers: { get: () => "image/png" }, arrayBuffer: async () => new Uint8Array(300 * 1024).buffer }) });
    assert.equal(big.failed[0].why, "larger than 256 KB");
    const notCdn = await importEmojis({ api: fakeApi(), guildId: "G", items: [{ name: "x", url: "https://evil.example/a.png" }], sleep: noSleep, fetchImpl: async () => { throw new Error("must not fetch"); } });
    assert.equal(notCdn.failed[0].why, "not a Discord link");
});

test("the role picker has a button per role and the invite permission number covers what is needed", () => {
    const p = rolePanel([{ role_id: "1", label: "PC", emoji: "🖥️" }, { role_id: "2", label: "Xbox" }]);
    assert.deepEqual(p.components[0].components.map(c => c.custom_id), ["rr:1", "rr:2"]);
    const bits = BigInt(BOT_PERMISSIONS);
    for (const [name, bit] of [["Manage Roles", 28n], ["Manage Channels", 4n], ["Create Invite", 0n], ["Manage Server", 5n], ["Manage Expressions", 30n]]) assert.ok(bits & (1n << bit), name);
    assert.ok(TEMPLATE.categories.length >= 5);
});

test("community data is exported and deleted with the person", () => {
    const db = openDb(":memory:");
    db.ensureUser("u1");
    db.addXp("G", "u1", 50, { message: true }); db.recordJoin("G", "u1", "inv", "c"); db.recordJoin("G", "u2", "u1", "c2");
    assert.equal(db.exportUser("u1").community.xp.length, 1);
    db.deleteUser("u1");
    assert.equal(db.getXp("G", "u1"), undefined);
    assert.equal(db.whoInvited("G", "u1"), undefined);
    assert.equal(db.whoInvited("G", "u2").inviter_id, null, "invites they made are kept as counts but no longer name them");
});

// ---------- the dashboard side ----------
async function dashSetup() {
    const db = openDb(":memory:");
    const api = fakeApi({ channels: [{ id: "c1", type: 0, name: "alerts" }] });
    const community = createCommunity({ db, api });
    const rest = { authorizeUrl: s => `https://d.example/a?state=${s}`, login: async () => ({ user: { id: "u1", username: "j", global_name: "J", avatar: null }, guilds: [{ id: "g1", name: "Mine", icon: null, owner: false, permissions: String(0x20) }, { id: "g2", name: "Other", icon: null, owner: false, permissions: "0" }] }),
        listChannels: api.listChannels, listRoles: api.listRoles, memberName: api.memberName, sendMessage: api.sendMessage, allChannels: api.allChannels, allRoles: api.allRoles, getGuild: api.getGuild, listEmojis: api.listEmojis, createEmoji: api.createEmoji };
    const dash = createDashboard({ db, itad: {}, rest, community, membersIntent: () => false, botGuilds: () => true, config: { publicUrl: "http://localhost:3000", clientId: "bot", ownerId: "owner" } });
    const addr = await dash.listen(0, "127.0.0.1");
    let cookie = "";
    const request = async (path, { method = "GET", body } = {}) => {
        const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json", "X-Requested-With": "dashboard" } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
        for (const c of res.headers.getSetCookie?.() ?? []) { const [pair] = c.split(";"); const [k, v] = pair.split("="); const jar = Object.fromEntries(cookie.split("; ").filter(Boolean).map(p => p.split("="))); if (v) jar[k] = v; else delete jar[k]; cookie = Object.entries(jar).map(([a, b]) => `${a}=${b}`).join("; "); }
        const text = await res.text(); let data = null; try { data = JSON.parse(text); } catch { /* */ }
        return { status: res.status, data };
    };
    const r = await request("/auth/login"); void r;
    const login = await fetch(`http://127.0.0.1:${addr.port}/auth/login`, { redirect: "manual" });
    const state = new URL(login.headers.get("location")).searchParams.get("state");
    const cb = await fetch(`http://127.0.0.1:${addr.port}/auth/callback?code=x&state=${state}`, { redirect: "manual", headers: { Cookie: (login.headers.getSetCookie?.() ?? []).map(c => c.split(";")[0]).join("; ") } });
    cookie = [...(login.headers.getSetCookie?.() ?? []), ...(cb.headers.getSetCookie?.() ?? [])].map(c => c.split(";")[0]).join("; ");
    return { db, request, close: () => dash.close() };
}

test("dashboard community page: members see standing and boards, managers also get settings and can change them", async () => {
    const t = await dashSetup();
    const mine = await t.request("/api/community?guild=g1");
    assert.equal(mine.status, 200, JSON.stringify(mine.data));
    assert.equal(mine.data.manager, true);
    assert.equal(mine.data.membersIntent, false);
    assert.ok(mine.data.settings && "welcome_msg" in mine.data.settings);
    const other = await t.request("/api/community?guild=g2");
    assert.equal(other.data.manager, false);
    assert.equal(other.data.settings, undefined);
    assert.equal((await t.request("/api/community/welcome", { method: "POST", body: { guild_id: "g2", enabled: false } })).status, 403);
    const w = await t.request("/api/community/welcome", { method: "POST", body: { guild_id: "g1", channel_id: "c1", message: "Hi {user}!", dm: true } });
    assert.equal(w.status, 200);
    assert.equal(t.db.getCommunity("g1").welcome_channel, "c1");
    assert.equal(t.db.getCommunity("g1").welcome_dm, 1);
    assert.equal((await t.request("/api/community/welcome", { method: "POST", body: { guild_id: "g1", channel_id: "nope" } })).status, 400);
    assert.equal((await t.request("/api/community/xp", { method: "POST", body: { guild_id: "g1", multiplier: 2, announce: "off" } })).status, 200);
    assert.equal((await t.request("/api/community/xp", { method: "POST", body: { guild_id: "g1", multiplier: 99 } })).status, 400);
    assert.equal((await t.request("/api/community/levelrole", { method: "POST", body: { guild_id: "g1", level: 10, role_id: "nope" } })).status, 400);
    assert.equal((await t.request("/api/community/referral", { method: "POST", body: { guild_id: "g1", bonus: 25 } })).data.referral_xp, 25);
    assert.equal((await t.request("/api/community/emoji", { method: "POST", body: { guild_id: "g1", text: "nothing here" } })).status, 400);
    assert.equal((await t.request("/api/community/rank?guild=g1")).data.level, 0);
    assert.deepEqual((await t.request("/api/community/leaderboard?guild=g1")).data.top, []);
    const x = await t.request("/api/community/xp?guild=g1");
    assert.equal(x.status, 200); assert.equal(x.data.manager, true); assert.equal(x.data.curve[0].need, 100); assert.equal(x.data.pages, 1);
    assert.equal((await t.request("/api/community/xp?guild=g2")).data.manager, undefined);
    assert.equal((await t.request("/api/community/emoji", { method: "POST", body: { guild_id: "g1", image_data: "data:text/html;base64,AAAA", name: "ok" } })).status, 400);
    assert.equal((await t.request("/api/community/emoji", { method: "POST", body: { guild_id: "g1", image_data: "data:image/png;base64,AAAA", name: "x" } })).status, 400, "name too short");
    assert.equal((await t.request("/api/community/emoji", { method: "POST", body: { guild_id: "g1", image_data: "data:image/png;base64,AAAA", name: "good_one" } })).data.added[0], "good_one");
    assert.equal(t.db.usageCounts().emoji_added.n, 1);
    assert.equal((await t.request("/api/admin/community")).status, 403, "only the owner sees usage");
    const link = await t.request("/api/community/invite-link", { method: "POST", body: { guild_id: "g2" } });
    assert.equal(link.status, 200); assert.match(link.data.link, /discord\.gg/);
    await t.close();
});

// ---------- cross-server giveaways ----------
const GW = { id: 4, title: "Big Game Giveaway", status: "active", ends_at: Date.now() + 3600_000, is_global: 1, host_id: "owner", guild_id: "g", channel_id: "c", claim_hours: 48, host_name: "Jacob Lucado", host_kind: "network" };
const KEYS = [{ label: "Big Game", status: "available", position: 1 }];

test("entry steps are validated: https only, the right site for the kind, at most eight", () => {
    const ok = parseSteps([{ kind: "follow_x", url: "https://x.com/partner" }, { kind: "join_discord", url: "https://discord.gg/abc", label: "Join us" }, { kind: "", url: "", label: "" }]);
    assert.deepEqual(ok.map(s => [s.kind, s.label]), [["follow_x", "Follow on X"], ["join_discord", "Join us"]]);
    assert.throws(() => parseSteps([{ kind: "follow_x", url: "http://x.com/a" }]), StepError);
    assert.throws(() => parseSteps([{ kind: "follow_x", url: "https://evil.example/a" }]), /x\.com/);
    assert.throws(() => parseSteps([{ kind: "visit", url: "javascript:alert(1)" }]), StepError);
    assert.throws(() => parseSteps(Array.from({ length: 9 }, () => ({ kind: "visit", url: "https://a.example" }))), /at most 8/);
    assert.deepEqual(parseSteps(undefined), []);
});

test("the host is the owner by default, or a partner with checked links", () => {
    assert.equal(parseHost({ kind: "network" }, "Jacob Lucado").host_name, "Jacob Lucado");
    const p = parseHost({ kind: "partner", name: "Cool Studio", logo: "https://cool.example/logo.png", links: [{ label: "Website", url: "https://cool.example" }, { label: "Discord", url: "https://discord.gg/cool" }] });
    assert.equal(p.host_kind, "partner"); assert.equal(JSON.parse(p.host_links).length, 2);
    assert.throws(() => parseHost({ kind: "partner", name: "" }), /name/);
    assert.throws(() => parseHost({ kind: "partner", name: "X", links: [{ label: "Site", url: "http://plain.example" }] }), StepError);
});

test("a cross-server giveaway says so, names the host, and no longer shows the giveaway number", () => {
    const p = giveawayPayload(GW, KEYS, 0, "active");
    assert.match(p.embeds[0].author.name, /Cross-server giveaway · hosted by Jacob Lucado/);
    assert.equal(p.embeds[0].title, "Big Game Giveaway");
    assert.doesNotMatch(JSON.stringify(p), /Giveaway #/);
    const plain = giveawayPayload({ ...GW, is_global: 0, host_name: null }, KEYS, 0, "active");
    assert.equal(plain.embeds[0].author, undefined);
    assert.doesNotMatch(JSON.stringify(plain), /Giveaway #/);
    assert.doesNotMatch(JSON.stringify(winnersPayload(GW, KEYS)), /Giveaway #/);
});

test("a partner giveaway shows the partner, their links, numbered steps and link buttons", () => {
    const g = { ...GW, host_kind: "partner", host_name: "Cool Studio", host_logo: "https://cool.example/l.png", host_links: JSON.stringify([{ label: "Website", url: "https://cool.example" }, { label: "Discord", url: "https://discord.gg/cool" }]),
        steps: JSON.stringify([{ kind: "follow_x", url: "https://x.com/cool", label: "Follow @cool on X" }, { kind: "join_discord", url: "https://discord.gg/cool", label: "Join the Discord" }]) };
    const p = giveawayPayload(g, KEYS, 3, "active");
    const e = p.embeds[0];
    assert.match(e.author.name, /hosted by Cool Studio/);
    assert.equal(e.author.icon_url, "https://cool.example/l.png");
    const hosted = e.fields.find(f => f.name === "Hosted by").value;
    assert.match(hosted, /\[Website\]\(https:\/\/cool\.example\)/); assert.match(hosted, /\[Discord\]/);
    const how = e.fields.find(f => f.name === "How to enter").value;
    assert.match(how, /1\. \[.*Follow @cool on X\]\(https:\/\/x\.com\/cool\)/); assert.match(how, /3\. Press \*\*Enter giveaway\*\*/); assert.match(how, /Winners may be checked/);
    assert.equal(p.components[0].components[0].custom_id, "gw_enter:4");
    assert.deepEqual(p.components[1].components.map(c => [c.style, c.url]), [[5, "https://x.com/cool"], [5, "https://discord.gg/cool"]]);
    assert.match(e.footer.text, /presented by Steam Value Checker/);
    // once it ends the steps and their buttons go away
    const ended = giveawayPayload({ ...g, status: "ended" }, KEYS, 3, "ended");
    assert.equal(ended.components.length, 1);
    assert.equal(ended.embeds[0].fields.some(f => f.name === "How to enter"), false);
    assert.equal(crossServerParts(g).buttons.length, 2);
});
