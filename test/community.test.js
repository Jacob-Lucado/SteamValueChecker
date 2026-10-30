import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { botInviteUrl, rulesPayload, communitySetup, isFreshGuild, TEMPLATE, parseEmojis, importEmojis, renderWelcome, welcomePayload, findUsedInvite, messageXp, BOT_PERMISSIONS, rolePanel } from "../src/community.js";
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
        editRole: async (_g, id, b) => { if (state.denyEditRole) throw new DiscordApiError(403, "no"); Object.assign(state.roles.find(x => x.id === id), b); },
        createRole: async (_g, b) => { if (state.denyPermRoles && b.permissions !== "0") throw new DiscordApiError(403, "Missing Permissions"); const r = { id: String(++n), ...b }; state.roles.push(r); return r; },
        editGuild: async (_g, b) => { state.guildEdits.push(b); },
        sendMessage: async (id, p) => { state.sent.push({ id, p }); return { id: "m" + state.sent.length }; },
        editMessage: async (id, mid, p) => { if (state.denyEdit) throw new DiscordApiError(404, "gone"); state.edits = [...(state.edits ?? []), { id, mid, p }]; },
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
    const api = fakeApi({ channels: [{ id: "c1", type: 0, name: "alerts" }], roles: [{ id: "r1", name: "A" }, { id: "r2", name: "B" }] });
    const community = createCommunity({ db, api });
    const connections = [];
    const rest = { authorizeUrl: (s, o) => `https://d.example/a?state=${s}${o?.linkedRoles ? "&linked=1" : ""}`, setRoleConnection: async (tok, body) => { connections.push({ tok, body }); }, login: async (_c, o) => ({ ...(o?.withToken ? { accessToken: "tok" } : {}), user: { id: "u1", username: "j", global_name: "J", avatar: null }, guilds: [{ id: "g1", name: "Mine", icon: null, owner: false, permissions: String(0x20) }, { id: "g2", name: "Other", icon: null, owner: false, permissions: "0" }] }),
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
    return { db, request, connections, api, base: `http://127.0.0.1:${addr.port}`, close: () => dash.close() };
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
    assert.match(plain.embeds[0].author.name, /GIVEAWAY/);
    assert.match(JSON.stringify(plain), /Giveaway #/); // a server's own giveaway keeps its number for /giveaway end and friends
    assert.doesNotMatch(JSON.stringify(winnersPayload(GW, KEYS)), /Giveaway #/);
});

test("a partner giveaway shows the partner, their links, numbered steps and link buttons", () => {
    const g = { ...GW, host_kind: "partner", host_name: "Cool Studio", host_logo: "https://cool.example/l.png", host_links: JSON.stringify([{ label: "Website", url: "https://cool.example" }, { label: "Discord", url: "https://discord.gg/cool" }]),
        steps: JSON.stringify([{ kind: "follow_x", url: "https://x.com/cool", label: "Follow @cool on X" }, { kind: "join_discord", url: "https://discord.gg/cool", label: "Join the Discord" }]) };
    const p = giveawayPayload(g, KEYS, 3, "active");
    const e = p.embeds[0];
    assert.match(e.author.name, /hosted by Cool Studio/);
    assert.equal(e.author.icon_url, "https://cool.example/l.png");
    const hosted = e.fields.find(f => /Hosted by/.test(f.name)).value;
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

// ---------- Steam verification and Linked Roles ----------
test("Steam Verified: setup makes the role and #verify, and the role is only given to people who proved their Steam account", async () => {
    const db = openDb(":memory:"), api = fakeApi();
    const r = await communitySetup({ api, db, guildId: "G", botId: "bot", userId: "o", sleep: noSleep, pace: 0 });
    assert.ok(api.state.roles.some(x => x.name === "Steam Verified"));
    assert.ok(r.channels.verify);
    assert.equal(db.getCommunity("G").verified_role_id, r.roles.verified);
    const panel = api.state.sent.find(m => m.id === r.channels.verify).p;
    assert.equal(panel.components[0].components[0].custom_id, "sv_verify");
    const svc = createCommunity({ db, api });
    db.ensureUser("u1");
    assert.equal(await svc.grantVerified("G", "u1"), "not_verified");
    db.setSteamLink("u1", "76561198000000001", { verified: false });
    assert.equal(await svc.grantVerified("G", "u1"), "not_verified", "a pasted link is not proof");
    db.setSteamLink("u1", "76561198000000001", { verified: true });
    assert.equal(await svc.grantVerified("G", "u1"), "granted");
    assert.ok(api.state.added.some(([u, role]) => u === "u1" && role === r.roles.verified));
    // already verified people get it when they join
    api.state.added.length = 0;
    await svc.onJoin({ guildId: "G", guildName: "T", count: 3, member: { id: "u1", username: "j" } });
    assert.ok(api.state.added.some(([u, role]) => u === "u1" && role === r.roles.verified));
    assert.equal(await createCommunity({ db, api }).grantVerified("other", "u1"), "no_role");
});

test("Linked Roles: the member's Steam details are what Discord is told, and only a verified Steam link says verified", async () => {
    const { connectionPayload, METADATA } = await import("../src/linkedroles.js");
    const db = openDb(":memory:");
    db.ensureUser("u1");
    assert.equal(connectionPayload(db, "u1"), null);
    db.setSteamLink("u1", "76561198000000001", { verified: true }); db.setSteamWho("u1", "Jacob Lucado", null);
    db.syncSteamGames("u1", [{ itad_id: "a", title: "A", minutes: 600 }, { itad_id: "b", title: "B", minutes: 120 }], {});
    const p = connectionPayload(db, "u1");
    assert.equal(p.platform_name, "Steam"); assert.equal(p.platform_username, "Jacob Lucado");
    assert.deepEqual(p.metadata, { steam_verified: true, games_owned: 2, hours_played: 12 });
    db.setSteamLink("u1", "76561198000000002", { verified: false }); // a different, pasted ID is not proof
    assert.equal(connectionPayload(db, "u1").metadata.steam_verified, false);
    assert.deepEqual(METADATA.map(m => m.type), [7, 2, 2]);
    assert.ok(METADATA.every(m => /^[a-z0-9_]{1,50}$/.test(m.key) && m.name.length <= 100 && m.description.length <= 200));
});

test("Linked Roles sign-in: no Steam proof sends them to Steam first, then the connection is made; the normal sign-in is unchanged", async () => {
    const t = await dashSetup();
    const jar = [];
    const get = async (path, redirect = "manual") => { const res = await fetch(t.base + path, { redirect, headers: { Cookie: jar.join("; ") } }); for (const c of res.headers.getSetCookie?.() ?? []) { const [pair] = c.split(";"); const [k, v] = pair.split("="); const i = jar.findIndex(x => x.startsWith(k + "=")); if (i >= 0) jar.splice(i, 1); if (v) jar.push(pair); } return res; };
    let res = await get("/auth/linked");
    assert.equal(res.status, 302);
    const loc = new URL(res.headers.get("location"));
    assert.equal(loc.searchParams.get("linked"), "1", "asks for the extra permission");
    res = await get(`/auth/callback?code=x&state=${loc.searchParams.get("state")}`);
    assert.equal(res.headers.get("location"), "/auth/steam", "not proven yet: Steam first");
    assert.equal(t.connections.length, 0);
    // Steam proof arrives (the sign-in itself is covered elsewhere), then the flow is run again and connects
    t.db.setSteamLink("u1", "76561198000000001", { verified: true });
    res = await get("/auth/linked");
    const loc2 = new URL(res.headers.get("location"));
    res = await get(`/auth/callback?code=x&state=${loc2.searchParams.get("state")}`);
    assert.equal(res.headers.get("location"), "/#/steam?roles=1");
    assert.equal(t.connections[0].tok, "tok");
    assert.equal(t.connections[0].body.metadata.steam_verified, true);
    const status = await fetch(t.base + "/api/steam/linkedroles", { headers: { Cookie: jar.join("; ") } });
    assert.equal((await status.json()).verified, true);
    // a plain sign-in asks for no extra permission and makes no connection
    const plain = await fetch(t.base + "/auth/login", { redirect: "manual" });
    assert.equal(new URL(plain.headers.get("location")).searchParams.get("linked"), null);
    await t.close();
});

test("new members get a private welcome with the bot's features and the dashboard link, once, and a closed DM breaks nothing", async () => {
    const { welcomeDmPayload } = await import("../src/community.js");
    const db = openDb(":memory:"), api = fakeApi();
    const r = await communitySetup({ api, db, guildId: "G", botId: "bot", userId: "o", sleep: noSleep, pace: 0 });
    assert.equal(db.getCommunity("G").welcome_dm, 1, "a built server sends the private welcome");
    const dms = [];
    const svc = createCommunity({ db, api, dm: async (id, p) => { dms.push({ id, p }); }, dashboardUrl: "https://dash.example" });
    await svc.onJoin({ guildId: "G", guildName: "Test", count: 5, member: { id: "new1", username: "N" } });
    assert.equal(dms.length, 1);
    const e = dms[0].p.embeds[0];
    assert.match(e.title, /Welcome to Test/); assert.ok(e.fields.length >= 4);
    assert.equal(dms[0].p.components[0].components[0].url, "https://dash.example");
    await svc.onLeave({ guildId: "G", member: { id: "new1", username: "N" } });
    await svc.onJoin({ guildId: "G", guildName: "Test", count: 6, member: { id: "new1", username: "N" } });
    assert.equal(dms.length, 1, "coming back does not repeat it");
    const closed = createCommunity({ db, api, dm: async () => { throw new Error("Cannot send messages to this user"); } });
    await closed.onJoin({ guildId: "G", guildName: "Test", count: 7, member: { id: "new2", username: "M" } });
    assert.ok(db.usageCounts().welcome_dm_failed);
    assert.deepEqual(welcomeDmPayload({ server: "S" }).components, [], "no dashboard, no button");
    assert.ok(e.fields.every(f => f.name.length <= 256 && f.value.length <= 1024) && JSON.stringify(e).length < 6000);
});

test("everything setup offers is actually connected: ping roles, Friday digest, sale posts, giveaway managers and the bot log", async () => {
    const { createNotifier } = await import("../src/notify.js");
    const db = openDb(":memory:"), api = fakeApi();
    const r = await communitySetup({ api, db, guildId: "G", botId: "bot", userId: "o", sleep: noSleep, pace: 0 });
    const c = db.getCommunity("G");
    assert.ok(c.requests_channel, "the feature requests forum is connected");
    const role = n => api.state.roles.find(x => x.name === n).id;
    assert.deepEqual([c.ping_deals, c.ping_free, c.ping_giveaway, c.ping_lfg], [role("Deal pings"), role("Free game pings"), role("Giveaway pings"), role("LFG pings")]);
    const g = db.getGuild("G");
    assert.equal(g.weekly_digest, 1); assert.equal(g.sale_feed, 1); assert.equal(g.free_feed, 1); assert.equal(g.channel_id, r.channels.deals);
    assert.equal(db.getGiveawaySettings("G").manager_role_id, r.roles.mod);
    assert.ok(api.state.sent.some(m => m.id === r.channels.botlogs && /Setup finished/.test(m.p.content)), "bot notices channel is used");
    // feeds ping only the opt-in role, and only for the kind that has one
    const posts = [];
    const n = createNotifier({ db, discord: { sendDm: async () => { }, sendChannel: async (id, p) => { posts.push({ id, p }); } } });
    await n.postGuild("G", { embeds: [{ title: "Free" }] }, "free");
    assert.equal(posts[0].p.content, `<@&${c.ping_free}>`); assert.deepEqual(posts[0].p.allowedMentions, { roles: [c.ping_free] });
    await n.postGuild("G", { embeds: [{ title: "Digest" }] });
    assert.equal(posts[1].p.content, undefined); assert.deepEqual(posts[1].p.allowedMentions, { parse: [] });
    db.setCommunity("G", { ping_deals: null });
    await n.postGuild("G", { embeds: [] }, "deals");
    assert.deepEqual(posts[2].p.allowedMentions, { parse: [] }, "no role set means no ping");
});

test("the dashboard saves ping roles for managers and rejects roles that do not exist", async () => {
    const t = await dashSetup();
    const ok = await t.request("/api/community/pings", { method: "POST", body: { guild_id: "g1", free: "r1", lfg: "r2" } });
    assert.equal(ok.status, 200); assert.equal(t.db.getCommunity("g1").ping_free, "r1");
    const bad = await t.request("/api/community/pings", { method: "POST", body: { guild_id: "g1", free: "nope" } });
    assert.equal(bad.status, 400);
    await t.close();
});

test("setup builds the support channels, a branded rules post, and points announcements at #announcements", async () => {
    const db = openDb(":memory:"), api = fakeApi();
    const r = await communitySetup({ api, db, guildId: "G", botId: "bot", userId: "o", sleep: noSleep, pace: 0, baseUrl: "https://dash.test/" });
    assert.ok(r.channels.help && r.channels.bugs && r.channels.announcements);
    const at = id => api.state.sent.filter(m => m.id === id).map(m => m.p);
    assert.equal(at(r.channels.help)[0].components[0].components[0].custom_id, "tk_open:0");
    assert.equal(at(r.channels.bugs)[0].components[0].components[0].custom_id, "tk_bug");
    const rules = at(r.channels.rules)[0].embeds[0];
    assert.equal(rules.thumbnail.url, "https://dash.test/logo.png"); assert.equal(rules.image.url, "https://dash.test/banner.png");
    assert.ok(rules.description.split("**").length > 14, "has the common rules");
    assert.match(rules.fields[1].value, new RegExp(r.channels.help));
    const c = db.getCommunity("G");
    assert.equal(c.announce_channel, r.channels.announcements); assert.equal(c.rules_channel, r.channels.rules);
    assert.equal(db.getTicketSettings("G").channel_id, r.channels.tickets);
    assert.equal(rulesPayloadNoBase().embeds[0].image, undefined);
    assert.ok(api.state.sent.some(m => m.id === r.channels.botlogs && /report-a-bug|bug reports/.test(m.p.content)));
    function rulesPayloadNoBase() { return rulesPayload({ server: "X" }); }
});

test("announcement designer: validates, builds the embed, and only pings what was chosen", async () => {
    const { buildAnnouncement } = await import("../src/announce.js");
    assert.throws(() => buildAnnouncement({}), /title or a message/);
    assert.throws(() => buildAnnouncement({ title: "x", image: "http://insecure.test/a.png" }), /https/);
    assert.throws(() => buildAnnouncement({ title: "x", button_label: "Go" }), /button/);
    assert.throws(() => buildAnnouncement({ title: "x", ping: "role" }), /role/);
    assert.throws(() => buildAnnouncement({ title: "x", color: "nope" }), /colour/);
    const a = buildAnnouncement({ title: "Hello", body: "World", color: "#ff0000", footer: "f", author: "a", ping: "role", role_id: "77", button_label: "Go", button_url: "https://x.test", thumbnail: "server",
        fields: [{ name: "n", value: "v", inline: true }, { name: "", value: "skip" }], timestamp: true }, { serverIcon: "https://i.test/i.png" });
    const e = a.payload.embeds[0];
    assert.equal(e.color, 0xff0000); assert.equal(e.thumbnail.url, "https://i.test/i.png"); assert.equal(e.fields.length, 1); assert.ok(e.timestamp);
    assert.equal(a.payload.content, "<@&77>"); assert.deepEqual(a.payload.allowed_mentions, { roles: ["77"] });
    assert.equal(a.payload.components[0].components[0].url, "https://x.test/");
    assert.deepEqual(buildAnnouncement({ body: "hi" }).payload.allowed_mentions, { parse: [] });
    assert.deepEqual(buildAnnouncement({ body: "hi", ping: "everyone" }).payload.allowed_mentions, { parse: ["everyone"] });
});

test("dashboard: managers post announcements, set places, rules and support; others cannot", async () => {
    const t = await dashSetup();
    const post = (path, body) => t.request(path, { method: "POST", body: { guild_id: "g1", ...body } });
    assert.equal((await t.request("/api/community/announce", { method: "POST", body: { guild_id: "g2", title: "x", channel_id: "c1" } })).status, 403);
    assert.equal((await post("/api/community/announce", { title: "x" })).status, 400, "needs a channel");
    const ok = await post("/api/community/announce", { title: "Maintenance", body: "Tonight", channel_id: "c1", color: "#00ff00" });
    assert.equal(ok.status, 200); assert.equal(ok.data.history[0].title, "Maintenance");
    assert.equal((await post("/api/community/announce", { title: "again", channel_id: "c1" })).status, 429);
    assert.equal((await post("/api/community/places", { announce_channel: "c1", rules_channel: "c1" })).status, 200);
    assert.equal(t.db.getCommunity("g1").announce_channel, "c1");
    assert.equal((await post("/api/community/places", { announce_channel: "nope" })).status, 400);
    assert.equal((await post("/api/community/places", { honeypot_channel: "nope" })).status, 400);
    assert.equal((await post("/api/community/places", { honeypot_channel: "c1" })).status, 200);
    assert.equal(t.db.getCommunity("g1").honeypot_channel, "c1");
    assert.equal((await post("/api/community/rules", { text: "**1.** Be nice", post: true })).data.posted, true);
    assert.equal((await post("/api/community/rules", { text: "x".repeat(3001) })).status, 400);
    assert.equal((await post("/api/community/support", { ticket_channel: "c1", staff_role_id: "r1" })).status, 200);
    assert.equal(t.db.getTicketSettings("g1").staff_role_id, "r1");
    const ov = (await t.request("/api/community?guild=g1")).data;
    assert.equal(ov.support.ticket_channel, "c1"); assert.equal(ov.announcements.length, 1); assert.ok(ov.defaultRules);
    await t.close();
});

test("owner broadcasts go to each server's #announcements channel, falling back to its alert channel, and say who they are from", async () => {
    const { noticeEmbed } = await import("../src/broadcast.js");
    const db = openDb(":memory:");
    db.setGuildChannel("A", "alert-a", "u"); db.setGuildChannel("B", "alert-b", "u");
    db.setCommunity("B", { announce_channel: "ann-b" }); db.setCommunity("C", { announce_channel: "ann-c" });
    assert.deepEqual(db.broadcastTargets().channels.sort(), ["alert-a", "ann-b", "ann-c"]);
    const e = noticeEmbed("Downtime", "Tonight");
    assert.match(e.author.name, /developer/i); assert.match(e.footer.text, /not from this server/i);
});

test("people the bot owner invites get a green Beta Tester role, created if missing and reused after", async () => {
    const db = openDb(":memory:"), api = fakeApi();
    const svc = createCommunity({ db, api, ownerId: "boss" });
    const join = async (id, inviter, uses) => {
        api.state.invites = [{ code: "k", uses: uses - 1, max_uses: 0, inviter: { id: inviter } }]; await svc.refreshInvites("G");
        api.state.invites = [{ code: "k", uses, max_uses: 0, inviter: { id: inviter } }];
        return svc.onJoin({ guildId: "G", guildName: "T", count: uses, member: { id, username: id } });
    };
    await join("friend1", "boss", 1);
    const beta = api.state.roles.find(r => r.name === "Beta Tester");
    assert.equal(beta.color, 0x2ecc71);
    assert.ok(api.state.added.some(([u, r]) => u === "friend1" && r === beta.id));
    await join("friend2", "boss", 2);
    assert.equal(api.state.roles.filter(r => r.name === "Beta Tester").length, 1, "reused, not duplicated");
    assert.ok(api.state.added.some(([u, r]) => u === "friend2" && r === beta.id));
    await join("stranger", "someone-else", 3);
    assert.ok(!api.state.added.some(([u]) => u === "stranger"), "only the owner's invites count");
    const other = createCommunity({ db: openDb(":memory:"), api });
    assert.equal(await other.onJoin({ guildId: "G", guildName: "T", count: 1, member: { id: "x", username: "x" } }).then(r => r.inviterId), null);
});

test("the add-to-server link has the bot scopes and every permission, ", async () => {
    const u = new URL(botInviteUrl("123"));
    assert.equal(u.searchParams.get("scope"), "bot applications.commands"); assert.equal(u.searchParams.get("client_id"), "123");
    const bits = BigInt(u.searchParams.get("permissions"));
    for (const [name, bit] of [["View Channel", 10n], ["Send Messages", 11n], ["Embed Links", 14n], ["Manage Roles", 28n], ["Manage Channels", 4n], ["Kick", 1n], ["Ban", 2n], ["Manage Messages", 13n], ["Timeout", 40n], ["Mention Everyone", 17n], ["Manage Server", 5n]]) assert.ok(bits & (1n << bit), name);
    // the bot never edits or makes a role for itself: Discord already makes the one for its integration
    const db = openDb(":memory:"); const api = fakeApi({ roles: [{ id: "br", name: "Steam Value Checker", managed: true, tags: { bot_id: "bot" }, color: 0, hoist: false }] });
    await communitySetup({ api, db, guildId: "G", botId: "bot", userId: "o", sleep: noSleep, pace: 0 });
    assert.equal(api.state.roles.find(r => r.id === "br").hoist, false);
    assert.equal(api.state.roles.filter(r => r.name === "Steam Value Checker").length, 1);
});

test("#leaderboard: made by setup, one message that is edited, refreshed when due, on demand, and re-posted if deleted", async () => {
    const { tickLeaderboards, refreshLeaderboard, leaderboardEmbed } = await import("../src/leaderboard.js");
    const db = openDb(":memory:"), api = fakeApi();
    const r = await communitySetup({ api, db, guildId: "G", botId: "bot", userId: "o", sleep: noSleep, pace: 0, baseUrl: "https://dash.test" });
    const c = db.getCommunity("G");
    assert.equal(c.lb_channel, r.channels.leaderboard); assert.equal(c.lb_hours, 5); assert.ok(c.lb_message_id, "first board posted");
    const readonly = api.state.channels.find(x => x.id === r.channels.leaderboard);
    assert.ok(BigInt(readonly.permission_overwrites[0].deny) & (1n << 11n), "members cannot post");
    const first = api.state.sent.find(m => m.id === r.channels.leaderboard).p.embeds[0];
    assert.match(first.title, /XP Leaderboard/); assert.match(first.footer.text, /every 5 hours/); assert.equal(first.thumbnail.url, "https://dash.test/logo.png");
    // members rank: medals, level and XP, in order
    db.addXp("G", "a", 500); db.addXp("G", "b", 90); db.recordJoin("G", "n1", "a", "c");
    let t = 1_000_000_000_000; db.setCommunity("G", { lb_at: t });
    assert.equal(await tickLeaderboards({ db, api, now: () => t + 4 * 3600_000, sleep: noSleep }), 0, "not due at 4 hours");
    assert.equal(await tickLeaderboards({ db, api, now: () => t + 5 * 3600_000, sleep: noSleep }), 1, "due at 5 hours");
    const edit = api.state.edits.at(-1);
    assert.equal(edit.mid, c.lb_message_id, "edits the same message");
    assert.match(edit.p.embeds[0].description, /🥇 \*\*Someone\*\*[\s\S]*🥈/); assert.ok(edit.p.embeds[0].fields.some(f => /Top inviters/.test(f.name)));
    // the interval is per server
    db.setCommunity("G", { lb_hours: 1, lb_at: t });
    assert.equal(await tickLeaderboards({ db, api, now: () => t + 3600_000, sleep: noSleep }), 1);
    // on demand, even when not due; message deleted -> posts a fresh one
    api.state.denyEdit = true; const before = db.getCommunity("G").lb_message_id;
    const out = await refreshLeaderboard({ db, api, guildId: "G" });
    assert.equal(out.posted, true); assert.notEqual(db.getCommunity("G").lb_message_id, before);
    // a server without a board is skipped, and a failing one does not stop the others
    db.setCommunity("H", { welcome_on: 1 });
    await assert.rejects(refreshLeaderboard({ db, api, guildId: "H" }), /No leaderboard channel/);
    assert.equal(leaderboardEmbed({}).description, "Nobody has earned XP yet. Start chatting!");
});

test("dashboard: managers set the leaderboard channel and hours and refresh it now", async () => {
    const t = await dashSetup();
    const post = body => t.request("/api/community/leaderboard", { method: "POST", body: { guild_id: "g1", ...body } });
    assert.equal((await t.request("/api/community/leaderboard", { method: "POST", body: { guild_id: "g2", hours: 3 } })).status, 403);
    assert.equal((await post({ hours: 99 })).status, 400);
    assert.equal((await post({ refresh: true })).status, 400, "needs a channel first");
    const ok = await post({ channel_id: "c1", hours: 3, refresh: true });
    assert.equal(ok.status, 200); assert.equal(ok.data.refreshed, true); assert.equal(t.db.getCommunity("g1").lb_hours, 3); assert.ok(t.db.getCommunity("g1").lb_message_id);
    assert.equal((await post({ refresh: true })).status, 429, "refresh cooldown");
    await t.close();
});

test("setup still builds the server when my role lacks the Moderator permissions, and the invite link asks for them", async () => {
    for (const bit of [7, 22, 23, 24, 27]) assert.ok(BigInt(BOT_PERMISSIONS) & (1n << BigInt(bit)), `invite includes permission bit ${bit}`);
    const api = fakeApi(); api.state.denyPermRoles = true;
    const r = await communitySetup({ api, db: openDb(":memory:"), guildId: "G", botId: "bot", userId: "o", sleep: noSleep, pace: 0 });
    assert.ok(r.created.roles.includes("Moderator") && r.created.channels.length > 5);
    assert.ok(r.notes.some(n => /Moderator role was made without its permissions/.test(n)));
});

test("setup says exactly which permission my role is missing, before building anything", async () => {
    const api = fakeApi({ roles: [{ id: "br", name: "Steam Value Checker", managed: true, permissions: String(1n << 4n) }] }); // Manage Channels, but not Manage Roles
    api.getMember = async () => ({ roles: ["br"] });
    await assert.rejects(() => communitySetup({ api, db: openDb(":memory:"), guildId: "G", botId: "bot", sleep: noSleep, pace: 0 }), e => e.userFacing && /missing: Manage Roles\b/.test(e.message) && /Steam Value Checker/.test(e.message));
    assert.equal(api.state.channels.length, 0, "nothing was built");
    // Administrator covers everything; a role that has both passes
    const ok = fakeApi({ roles: [{ id: "br", name: "Bot", managed: true, permissions: String((1n << 4n) | (1n << 28n)) }] });
    ok.getMember = async () => ({ roles: ["br"] });
    const r = await communitySetup({ api: ok, db: openDb(":memory:"), guildId: "G", botId: "bot", sleep: noSleep, pace: 0 });
    assert.ok(r.created.channels.length > 5);
});

test("a refused step is named, with what Discord said", async () => {
    const api = fakeApi(); api.state.denyChannels = true;
    api.createChannel = async () => { throw new DiscordApiError(403, "no", "Missing Permissions (code 50013)"); };
    await assert.rejects(() => communitySetup({ api, db: openDb(":memory:"), guildId: "G", botId: "bot", sleep: noSleep, pace: 0 }), e => /could not create the .* category/.test(e.message) && /Missing Permissions \(code 50013\)/.test(e.message));
});

test("/rank, /levels and /invites answer with picture cards, and fall back to the plain embed when drawing fails", async () => {
    const { createCommunityHandlers } = await import("../src/communityhandlers.js");
    const { createCommunity } = await import("../src/communityservice.js");
    const db = openDb(":memory:"), api = fakeApi();
    const service = createCommunity({ db, api });
    db.setCommunity?.("G", { xp_on: 1 });
    db.addXp("G", "u1", 120, { message: true }); db.addXp("G", "u2", 60, { message: true });
    const h = createCommunityHandlers({ db, api, service, fetchImpl: async () => { throw new Error("offline"); } });
    const user = { id: "u1", username: "jacob", globalName: "Jacob", bot: false, displayAvatarURL: () => "https://cdn.discordapp.com/avatars/1/a.png" };
    const mk = (commandName, sub = null, extra = {}) => { const out = {}; return { out, commandName, inGuild: () => true, guildId: "G", guild: { name: "Game Junkies", members: { cache: new Map() }, roles: { cache: new Map() } }, user, client: { users: { fetch: async id => ({ id, username: id, displayAvatarURL: () => null }) } },
        options: { getUser: () => null, getSubcommand: () => sub }, deferred: false, replied: false,
        deferReply: async () => { out.deferred = true; }, editReply: async p => { out.reply = p; }, reply: async p => { out.reply = p; }, ...extra }; };
    for (const [cmd, sub, file] of [["rank", null, "rank.png"], ["levels", null, "leaderboard.png"], ["invites", "top", "top-inviters.png"], ["invites", "show", "invites.png"]]) {
        const i = mk(cmd, sub); await h.handleCommand(i);
        const f = i.out.reply.files?.[0];
        assert.ok(f && f.name === file, `${cmd} ${sub} sent a picture`);
        assert.equal(f.attachment.subarray(1, 4).toString(), "PNG");
    }
    // drawing breaks -> the plain embed still answers
    const broken = mk("rank", null, { editReply: async () => { throw new Error("upload failed"); } });
    broken.deferred = true; // the interaction is already acknowledged, so the fallback edits it
    broken.editReply = async p => { if (p.files) throw new Error("upload failed"); broken.out.reply = p; };
    await h.handleCommand(broken);
    assert.match(broken.out.reply.embeds[0].title, /Level \d/);
});

test("broadcast posts to a server's channel are addressed to that server", async () => {
    const { noticeEmbed, createBroadcaster } = await import("../src/broadcast.js");
    const e = noticeEmbed("T", "B", "https://x.test", { name: "Friends Server", icon: "https://cdn.test/i.png" });
    assert.match(e.author.name, /Friends Server/);
    assert.match(e.footer.text, /Sent to Friends Server/);
    assert.equal(e.thumbnail.url, "https://x.test/creator.png");
    const sent = [];
    const db = { broadcastTargets: () => ({ users: [], channels: ["c1", "c2"] }), broadcastChannelGuilds: () => new Map([["c1", "g1"]]), startBroadcast: () => 1, progressBroadcast() {} };
    const b = createBroadcaster({ publicUrl: "https://x.test", db, sendDm: async () => {}, sendChannel: async (id, p) => sent.push([id, p.embeds[0]]), ownerId: "o", guildInfo: id => (id === "g1" ? { name: "Friends Server" } : null), delayMs: 0, sleep: async () => {} });
    b.start({ title: "T", body: "B", audience: "channels" });
    for (let i = 0; i < 20 && sent.length < 2; i++) await new Promise(r => setTimeout(r, 5));
    assert.match(sent.find(x => x[0] === "c1")[1].author.name, /Friends Server/);
    assert.doesNotMatch(sent.find(x => x[0] === "c2")[1].author.name, /For /);
});

test("broadcast banner is drawn per server and falls back to the shared one on failure", async () => {
    const { createBroadcaster } = await import("../src/broadcast.js");
    const { guildBannerSvg, toPng } = await import("../src/communitycards.js");
    assert.equal(toPng(guildBannerSvg({ name: "Game Junkies" })).subarray(1, 4).toString(), "PNG");
    const run = async guildBanner => {
        const sent = [];
        const db = { broadcastTargets: () => ({ users: [], channels: ["c1"] }), broadcastChannelGuilds: () => new Map([["c1", "g1"]]), startBroadcast: () => 1, progressBroadcast() {} };
        createBroadcaster({ publicUrl: "https://x.test", db, sendDm: async () => {}, sendChannel: async (_i, p) => sent.push(p), ownerId: "o", guildInfo: () => ({ name: "Game Junkies" }), guildBanner, delayMs: 0, sleep: async () => {} })
            .start({ title: "T", body: "B", audience: "channels" });
        for (let i = 0; i < 20 && !sent.length; i++) await new Promise(r => setTimeout(r, 5));
        return sent[0];
    };
    const ok = await run(async () => ({ attachment: Buffer.from("x"), name: "for-your-server.png" }));
    assert.equal(ok.files[0].name, "for-your-server.png");
    assert.equal(ok.embeds[0].image.url, "attachment://for-your-server.png");
    const bad = await run(async () => { throw new Error("nope"); });
    assert.equal(bad.files, undefined);
    assert.equal(bad.embeds[0].image.url, "https://x.test/banner.png");
});

test("feature requests forum: posts per server with a status tag, kept in step, removed with the request", async () => {
    const { openDb } = await import("../src/db.js");
    const { publishRequest, refreshRequest, removeRequestPosts, backfillForum } = await import("../src/requestsync.js");
    const db = openDb(":memory:");
    db.setCommunity("g1", { requests_channel: "f1" }); db.setCommunity("g2", { requests_channel: "f2" }); db.setCommunity("g3", {});
    const calls = [], tags = [{ id: "t1", name: "Under review" }]; let n = 0;
    const api = {
        getChannel: async () => ({ available_tags: tags }),
        editChannel: async (id, body) => { calls.push(["edit", id, body]); if (body.available_tags) { const all = body.available_tags.map((t, i) => ({ id: t.id ?? "n" + i, name: t.name })); tags.splice(0, tags.length, ...all); return { available_tags: all }; } return {}; },
        createForumPost: async (ch, body) => { calls.push(["post", ch, body]); return { id: "th" + ++n }; },
        editMessage: async (c, m, body) => calls.push(["msg", c, m, body]),
        deleteChannel: async id => calls.push(["del", id])
    };
    const opt = { db, api, sleep: async () => {}, base: "https://x.test" };
    const id = db.addRequest({ userId: "u1", userName: "Sam", title: "Dark mode", body: "please" });
    assert.equal(await publishRequest({ ...opt, id }), 2, "one post per server with a forum");
    assert.equal(await publishRequest({ ...opt, id }), 0, "never twice");
    const post = calls.find(c => c[0] === "post");
    assert.equal(post[2].name, "Dark mode");
    assert.deepEqual(post[2].applied_tags, ["t1"]);
    assert.equal(post[2].message.embeds[0].fields[0].value, "Under review");
    // a status change adds the missing tag, moves it, and rewrites the first message
    db.setRequestStatus(id, "in_development", "Started");
    assert.equal(await refreshRequest({ ...opt, id }), 2);
    const moved = calls.filter(c => c[0] === "edit" && c[2].applied_tags);
    assert.equal(moved.length, 2);
    assert.notDeepEqual(moved[0][2].applied_tags, ["t1"]);
    const rewritten = calls.filter(c => c[0] === "msg");
    assert.match(rewritten[0][3].embeds[0].description, /Started/);
    assert.equal(rewritten[0][1], rewritten[0][2], "a forum post's first message shares the post's id");
    // a new forum gets recent requests
    db.setCommunity("g4", { requests_channel: "f4" });
    assert.equal(await backfillForum({ ...opt, guildId: "g4" }), 1);
    await removeRequestPosts({ ...opt, id });
    assert.equal(calls.filter(c => c[0] === "del").length, 3);
});

test("community setup template includes a feature requests forum", async () => {
    const { TEMPLATE } = await import("../src/community.js");
    const c = TEMPLATE.categories.flatMap(x => x.channels ?? []).find(x => x.key === "requests");
    assert.ok(c && c.forum && c.name === "feature-requests");
});

test("running setup again on a built server adds only what is new and changes nothing else", async () => {
    const db = openDb(":memory:"), api = fakeApi();
    await communitySetup({ api, db, guildId: "G", botId: "bot", userId: "o", sleep: noSleep, pace: 0 });
    // The server as it stood before the feature requests forum existed, then the owner made their own changes.
    const forum = api.state.channels.find(c => c.name === "feature-requests");
    api.state.channels.splice(api.state.channels.indexOf(forum), 1);
    db.setCommunity("G", { requests_channel: null, setup_keys: null });
    api.state.channels.find(c => c.name === "memes").name = "dank-memes";                 // renamed
    api.state.channels.splice(api.state.channels.findIndex(c => c.name === "clips-and-screenshots"), 1); // deleted
    const other = api.state.channels.find(c => c.name === "general").id;
    db.setCommunity("G", { welcome_channel: other, xp_mult: 2 });                          // a setting they chose
    const before = JSON.stringify(api.state.channels.map(c => [c.id, c.name, c.permission_overwrites]));
    const sent = api.state.sent.length, roles = api.state.roles.length;
    const r = await communitySetup({ api, db, guildId: "G", botId: "bot", userId: "o", sleep: noSleep, pace: 0 });
    assert.equal(r.updated, true);
    assert.deepEqual(r.created.channels, ["feature-requests"]);
    assert.equal(api.state.channels.find(c => c.name === "feature-requests").type, 15);
    assert.equal(db.getCommunity("G").requests_channel, api.state.channels.find(c => c.name === "feature-requests").id);
    assert.equal(db.getCommunity("G").welcome_channel, other, "their welcome channel stays");
    assert.equal(db.getCommunity("G").xp_mult, 2);
    assert.ok(!api.state.channels.some(c => c.name === "clips-and-screenshots" || c.name === "memes"), "renamed and deleted channels are not rebuilt");
    assert.equal(JSON.stringify(api.state.channels.filter(c => c.name !== "feature-requests").map(c => [c.id, c.name, c.permission_overwrites])), before, "existing channels untouched");
    assert.equal(api.state.sent.length, sent, "nothing is posted again");
    assert.equal(api.state.roles.length, roles, "no roles added");
    // and once it has been added, a third run changes nothing at all
    const again = await communitySetup({ api, db, guildId: "G", botId: "bot", userId: "o", sleep: noSleep, pace: 0 });
    assert.deepEqual(again.created.channels, []);
    assert.match(again.notes.join(" "), /already there/);
});

test("/setup run again reuses its category and only adds the missing forum", async () => {
    const { autoSetup } = await import("../src/setup.js");
    const db = openDb(":memory:"), made = [], chans = []; let n = 0;
    const api = { allChannels: async () => chans, createChannel: async (_g, b) => { made.push(b); const c = { id: String(++n), ...b }; chans.push(c); return c; }, sendMessage: async () => ({}) };
    db.setGuildChannel("G", "a", "u"); db.setTicketSettings("G", { channelId: "t", staffRoleId: null }); db.setGiveawaySettings("G", { vouch_channel_id: "v" });
    chans.push({ id: "cat", type: 4, name: "Steam Value Checker" });
    const r = await autoSetup({ api, db, guildId: "G", botId: "bot", userId: "u" });
    assert.deepEqual(made.map(m => m.name), ["feature-requests"], "no second category, no other channels");
    assert.equal(made[0].parent_id, "cat");
    assert.equal(r.created.length, 1);
});

test("trap channel: made by setup with a warning notice and description; posting there bans, staff and bots are spared", async () => {
    const { honeypotHit, HONEYPOT_NAME } = await import("../src/honeypot.js");
    const db = openDb(":memory:"), api = fakeApi();
    await communitySetup({ api, db, guildId: "G", botId: "bot", userId: "o", sleep: noSleep, pace: 0 });
    const ch = api.state.channels.find(c => c.name === HONEYPOT_NAME);
    assert.ok(ch && /do NOT type here/.test(ch.topic) && /banned automatically/.test(ch.topic), "the description says it");
    assert.equal(db.getCommunity("G").honeypot_channel, ch.id);
    const notice = api.state.sent.find(x => x.id === ch.id);
    assert.match(notice.p.embeds[0].title, /DO NOT TYPE/);
    assert.match(notice.p.embeds[0].description, /banned automatically/);
    // the trap
    const bans = [];
    const moderation = { ban: async a => { bans.push(a); } };
    const hit = o => honeypotHit({ db, moderation, guildId: "G", botId: "bot", channelId: ch.id, userId: "spam", ...o });
    assert.equal(await hit({}), "banned");
    assert.deepEqual([bans[0].userId, bans[0].actorId, bans[0].deleteDays], ["spam", "bot", 1]);
    assert.equal(await hit({ staff: true }), "ignored");
    assert.equal(await hit({ isBot: true }), "ignored");
    assert.equal(await hit({ channelId: "other" }), "ignored", "other channels are never touched");
    assert.equal(bans.length, 1);
    // a refused ban still removes the message
    let removed = 0;
    const refused = await honeypotHit({ db, moderation: { ban: async () => { throw new Error("hierarchy"); } }, guildId: "G", botId: "bot", channelId: ch.id, userId: "x", deleteMessage: async () => { removed++; } });
    assert.equal(refused, "failed"); assert.equal(removed, 1);
    // a server built earlier gets it from a second run, once, without other changes
    const old = openDb(":memory:"), oapi = fakeApi();
    await communitySetup({ api: oapi, db: old, guildId: "H", botId: "bot", userId: "o", sleep: noSleep, pace: 0 });
    const trap = oapi.state.channels.find(c => c.name === HONEYPOT_NAME);
    oapi.state.channels.splice(oapi.state.channels.indexOf(trap), 1);
    old.setCommunity("H", { honeypot_channel: null, setup_keys: null });
    const sentBefore = oapi.state.sent.length;
    const r = await communitySetup({ api: oapi, db: old, guildId: "H", botId: "bot", userId: "o", sleep: noSleep, pace: 0 });
    assert.deepEqual(r.created.channels, [HONEYPOT_NAME]);
    assert.equal(oapi.state.sent.length, sentBefore + 1, "only the warning notice is posted");
    assert.ok(old.getCommunity("H").honeypot_channel);
});

test("/feature: request opens a form, submitting saves and posts it, list and vote work, limits apply", async () => {
    const { createRequestHandlers, FR } = await import("../src/requesthandlers.js");
    const db = openDb(":memory:"), published = [];
    const ui = createRequestHandlers({ db, publicUrl: "https://x.test", publish: async id => { published.push(id); } });
    const replies = [];
    const cmd = (sub, opts = {}) => ({ user: { id: "u1", username: "Sam" }, options: { getSubcommand: () => sub, getString: k => opts[k] ?? null, getInteger: k => opts[k] ?? null },
        showModal: async m => replies.push(["modal", m]), reply: async r => replies.push(["reply", r]), deferred: false, replied: false });
    await ui.handleCommand(cmd("request"));
    assert.equal(replies[0][1].custom_id, FR.modal);
    const modal = (title, body = "") => ({ user: { id: "u1", username: "Sam" }, fields: { getTextInputValue: k => (k === "title" ? title : body) }, deferReply: async function () { this.deferred = true; }, deferred: false, replied: false, editReply: async c => replies.push(["edit", c]) });
    await ui.handleModal(modal("Dark mode for cards", "please"));
    assert.match(replies.at(-1)[1], /request \*\*#1\*\*/); assert.deepEqual(published, [1]);
    await ui.handleModal(modal("ab"));
    assert.match(replies.at(-1)[1].content, /at least 4/);
    for (let n = 0; n < 4; n++) await ui.handleModal(modal("Another idea " + n));
    await ui.handleModal(modal("One too many"));
    assert.match(replies.at(-1)[1].content, /waiting at once/);
    // another member votes, list shows the count, voting again takes it back
    const v = (id) => ({ ...cmd("vote", { id }), user: { id: "u2", username: "Riley" }, reply: async r => replies.push(["reply", r]) });
    await ui.handleCommand(v(1)); assert.match(replies.at(-1)[1].content, /Voted/);
    await ui.handleCommand({ ...cmd("list"), user: { id: "u2" } });
    assert.match(replies.at(-1)[1].embeds[0].description, /#1\*\* Dark mode for cards\n└ Under review · ▲ 2 \(you voted\)/);
    await ui.handleCommand(v(1)); assert.match(replies.at(-1)[1].content, /Took back/);
    await ui.handleCommand(v(99)); assert.match(replies.at(-1)[1].content, /can't find/);
    db.setRequestStatus(1, "shipped", "Live now");
    await ui.handleCommand(cmd("list", { status: "shipped" }));
    assert.match(replies.at(-1)[1].embeds[0].description, /Shipped/);
});
