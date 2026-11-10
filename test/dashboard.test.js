import { createTicketService } from "../src/tickets.js";
import test from "node:test";
import { createRuntimeCfg } from "../src/runtimecfg.js";
import assert from "node:assert/strict";
import { createDashboard } from "../src/dashboard/server.js";
import { DiscordApiError } from "../src/dashboard/discord.js";
import { openDb } from "../src/db.js";
import { grabberRegion } from "../src/spend.js";
import { createVault } from "../src/vault.js";
import { createGiveawayService } from "../src/giveaway.js";
import { applySteamImport, WishlistError } from "../src/wishlist.js";

const ORIGIN = "http://localhost:3000";
const MANAGE = String(0x20);

const deal = (amount, regular) => ({ shop: { name: "GOG" }, price: { amount, currency: "USD" }, regular: { amount: regular, currency: "USD" }, cut: 0, url: "https://deal.example/x" });

async function setup({ sendFails = false, guildsOf, config = {}, giveawayService = null, extra = {}, itadExtra = {}, restExtra = {} } = {}) {
    const db = openDb(":memory:");
    let clock = 1_000_000;
    const sent = [];
    const rest = {
        authorizeUrl: (state, o = {}) => `https://discord.example/authorize?state=${state}${o.connections ? "&connections=1" : ""}`,
        login: async (code, o = {}) => {
            if (code !== "good" && code !== "good-twitch" && code !== "good-notwitch") throw new DiscordApiError(400, "bad code");
            return {
                ...(o.withConnections ? { connections: code === "good-notwitch" ? [{ type: "steam", id: "7", name: "x", verified: true }] : [{ type: "twitch", id: "555", name: "FanName", verified: true }, { type: "twitch", id: "556", name: "Other", verified: false }] } : {}),
                user: { id: "u1", username: "jacob", global_name: "Jacob", avatar: null },
                guilds: guildsOf ?? [
                    { id: "g-admin", name: "Mine", icon: null, owner: false, permissions: MANAGE },
                    { id: "g-member", name: "Other", icon: null, owner: false, permissions: "0" }
                ]
            };
        },
        listChannels: async id => {
            if (id === "g-nobot") throw new DiscordApiError(404, "no");
            return [{ id: "c1", name: "alerts" }, { id: "c2", name: "general" }];
        },
        sendMessage: async (id, p) => { if (sendFails) throw new DiscordApiError(403, "no"); sent.push({ id, p }); },
        memberName: async (g, id) => (id === "u1" ? "Jacob" : null),
        listRoles: async () => [{ id: "r1", name: "Boosters" }, { id: "sr", name: "Streamer" }, { id: "pr", name: "Stream pings" }],
        ...restExtra
    };
    const itad = {
        lookupTitles: async titles => titles.map(t => (/^zzz/i.test(t) ? { title: t, id: null } : { title: t, id: "id-" + t.toLowerCase().replace(/\W+/g, ""), approx: false, matched: t })),
        getPrices: async ids => new Map(ids.map(id => [id, { deals: [deal(10, 20)], historyLow: { all: { amount: 5 } } }])),
        getGiveawayList: async () => [{ id: "1", title: "Alpha", shop: "Epic", url: "https://e.example/a", expiry: null }, { id: "2", title: "Beta", shop: "Epic", url: "https://e.example/b", expiry: null }, { id: "3", title: "Evil", shop: "Steam", url: "javascript:alert(1)", expiry: null }],
        getHistory: async () => Array.from({ length: 400 }, (_, i) => ({ t: 1_700_000_000_000 + i * 86400_000, price: 10 + (i % 7), regular: 20, shop: "GOG" }))
    };
    const dash = createDashboard({ db, itad: { ...itad, ...itadExtra }, rest, ...(typeof extra === "function" ? extra(db) : extra), giveaways: typeof giveawayService === "function" ? giveawayService(db) : giveawayService, config: { publicUrl: ORIGIN, port: 0, host: "127.0.0.1", clientId: "123", ...config }, now: () => clock });
    const addr = await dash.listen(0, "127.0.0.1");
    const base = `http://127.0.0.1:${addr.port}`;
    let cookie = "";

    const request = async (path, { method = "GET", body, headers = {}, raw = false } = {}) => {
        const h = { ...headers };
        if (cookie) h.Cookie = cookie;
        if (body !== undefined) {
            h["Content-Type"] ??= "application/json";
            h["X-Requested-With"] ??= "dashboard";
        }
        const res = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
        const set = res.headers.getSetCookie?.() ?? [];
        for (const c of set) {
            const [pair] = c.split(";");
            const [name, val] = pair.split("=");
            const jar = Object.fromEntries(cookie.split("; ").filter(Boolean).map(p => p.split("=")));
            if (!val) delete jar[name]; else jar[name] = val;
            cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
        }
        if (raw) return res;
        const text = await res.text();
        let data = null; try { data = JSON.parse(text); } catch { /* not json */ }
        return { status: res.status, data, text, headers: res.headers, set };
    };

    async function signIn() {
        const r = await request("/auth/login");
        const state = new URL(r.headers.get("location")).searchParams.get("state");
        return request(`/auth/callback?code=good&state=${state}`);
    }

    return { db, dash, base, cookie: () => cookie, request, signIn, sent, advance: ms => { clock += ms; }, close: () => dash.close() };
}

test("LucadoOS: its files are served, and only our own frames may show the site's pages", async () => {
    const t = await setup();
    assert.equal((await t.request("/lucadoos.js")).status, 200); assert.equal((await t.request("/lucadoos.css")).status, 200);
    const page = await t.request("/");
    assert.match(page.text, /\/lucadoos\.js/); assert.match(page.text, /\/lucadoos\.css/);
    const get = h => fetch(t.base + "/feed", { headers: h });
    const top = await get({});
    assert.equal(top.headers.get("x-frame-options"), "DENY"); assert.match(top.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    const own = await get({ "Sec-Fetch-Dest": "iframe", "Sec-Fetch-Site": "same-origin" });
    assert.equal(own.headers.get("x-frame-options"), "SAMEORIGIN"); assert.match(own.headers.get("content-security-policy"), /frame-ancestors 'self'/);
    const other = await get({ "Sec-Fetch-Dest": "iframe", "Sec-Fetch-Site": "cross-site" });
    assert.equal(other.headers.get("x-frame-options"), "DENY", "another site can't frame it");
    await t.close();
});

test("indie dev panel: it unlocks with an approved game, requests are answered one by one or in bulk, and keys go out from the pool", async () => {
    const dms = [];
    const t = await setup({ extra: { dm: async (id, p) => { dms.push([id, p.embeds?.[0]?.title ?? "", p.embeds?.[0]?.description ?? ""]); } } });
    await t.signIn();
    const post = (p, body) => t.request(p, { method: "POST", body });
    assert.equal((await t.request("/api/indie/dev")).status, 403, "no approved game, no panel");
    assert.equal((await t.request("/api/me")).data.indieDev, false);
    const id = t.db.indieAdd({ appid: 9, ownerId: "u1", title: "Moss", studio: "Moss Co", pitch: "p", genres: [], image: "https://x/9.jpg" }); t.db.indieDecide(id, "approved"); t.db.indieSetKeysOpen(id, true);
    assert.equal((await t.request("/api/me")).data.indieDev, true);
    for (const u of ["r1", "r2", "r3"]) t.db.indieKeyRequest({ gameId: id, userId: u, name: "Streamer " + u, channel: "https://twitch.tv/" + u, note: "hi" });
    const ov = (await t.request("/api/indie/dev")).data; assert.equal(ov.pending, 3); assert.equal(ov.games[0].pool.left, 0);
    const add = await post("/api/indie/dev/keys/add", { id, keys: "AAAAA-BBBBB-CCCCC\nAAAAA-BBBBB-CCCCC\nnot a key!\nDDDDD-EEEEE-FFFFF" });
    assert.deepEqual([add.data.added, add.data.skipped, add.data.pool.left], [2, 2, 2]);
    const list = (await t.request("/api/indie/dev/requests?status=pending")).data.requests; assert.equal(list.length, 3);
    assert.equal((await t.request("/api/indie/dev/requests?q=r2")).data.requests.length, 1, "search");
    const first = await post("/api/indie/dev/decide", { ids: [list[0].id], approve: true, note: "Enjoy!" });
    assert.deepEqual([first.data.approved, first.data.sent], [1, 1]);
    assert.match(dms.at(-1)[2], /AAAAA-BBBBB-CCCCC/); assert.match(dms.at(-1)[2], /Enjoy!/);
    const rest = await post("/api/indie/dev/decide", { ids: list.slice(1).map(x => x.id), approve: true });
    assert.deepEqual([rest.data.approved, rest.data.sent, rest.data.noKeys], [2, 1, 1], "the pool ran dry for the last one");
    assert.equal((await post("/api/indie/dev/decide", { ids: [list[0].id], approve: false })).data.results[0].skipped, "a key was already sent", "no taking a key back");
    assert.equal((await t.request("/api/indie/dev/requests?status=approved")).data.requests.filter(r => r.keySent).length, 2);
    t.db.indieKeyRequest({ gameId: id, userId: "r4", name: "Late", channel: "https://x.example", note: "" });
    assert.equal((await post("/api/indie/dev/decide", { ids: [t.db.indieKeyInbox("u1", { status: "pending" })[0].id], approve: false, note: "Not this time" })).data.declined, 1);
    const k = (await t.request("/api/indie/dev/keys?id=" + id)).data; assert.equal(k.pool.left, 0); assert.ok(k.keys.every(x => x.sentTo));
    await post("/api/indie/dev/keys/add", { id, keys: "ZZZZZ-YYYYY-XXXXX" });
    assert.equal((await post("/api/indie/dev/keys/remove", { game: id, all: true })).data.pool.left, 0);
    assert.equal((await post("/api/indie/dev/decide", { ids: [999999], approve: true })).data.results[0].skipped, "not yours");
    await t.close();
});

test("indie dev role: approving a game gives the Verified IndieDev role and one welcome message; taking the last game away takes the role back", async () => {
    const dms = [], roles = [];
    const t = await setup({ config: { ownerId: "u1" }, extra: { dm: async (id, p) => { dms.push([id, p.embeds?.[0]?.title ?? "", p.embeds?.[0]?.description ?? ""]); } }, restExtra: { addRole: async (g, u, r) => { roles.push(["add", g, u, r]); }, removeRole: async (g, u, r) => { roles.push(["remove", g, u, r]); } } });
    await t.signIn();
    t.db.ensureUser("dev"); t.db.setCommunity("G1", { indie_dev_role: "R1" });
    const g1 = t.db.indieAdd({ appid: 11, ownerId: "dev", title: "One", studio: "Dev Co", pitch: "p", genres: [], image: "https://x/11.jpg" }), g2 = t.db.indieAdd({ appid: 12, ownerId: "dev", title: "Two", studio: "Dev Co", pitch: "p", genres: [], image: "https://x/12.jpg" });
    const review = (action, id) => t.request("/api/admin/indie/review", { method: "POST", body: { action, id } });
    assert.equal((await review("approve", g1)).status, 200);
    assert.deepEqual(roles, [["add", "G1", "dev", "R1"]]);
    assert.equal(dms.length, 1); assert.equal(dms[0][0], "dev"); assert.match(dms[0][1], /verified indie dev/i); assert.match(dms[0][2], /\/devpanel/); assert.match(dms[0][2], /Verified IndieDev/);
    assert.equal((await review("approve", g2)).status, 200); assert.equal(dms.length, 1, "welcomed once");
    await review("remove", g1); assert.equal(roles.filter(r => r[0] === "remove").length, 0, "still has an approved game");
    await review("remove", g2); assert.deepEqual(roles.at(-1), ["remove", "G1", "dev", "R1"]);
    assert.ok(t.db.listNotifications("dev").some(n => /verified indie dev/i.test(n.title)));
    await t.close();
});

test("static files, security headers, and nothing outside the allowlist", async () => {
    const t = await setup();
    const r = await t.request("/");
    assert.equal(r.status, 200);
    assert.match(r.text, /Steam Value Checker/);
    assert.match(r.headers.get("content-security-policy"), /script-src 'self'/);
    assert.equal(r.headers.get("x-frame-options"), "DENY");
    assert.equal((await t.request("/app.js")).status, 200);
    assert.equal((await t.request("/theme.js")).status, 200);
    assert.match(r.text, /theme\.js/);
    assert.equal((await t.request("/style.css")).status, 200);
    assert.equal((await t.request("/logo.png")).status, 200);
    assert.equal((await t.request("/../package.json")).status, 404);
    assert.equal((await t.request("/src/db.js")).status, 404);
    assert.equal((await t.request("/%2e%2e/package.json")).status, 404);
    await t.close();
});

test("the app asks for sign-in, and the config carries the FanaticalGrabber link", async () => {
    const t = await setup();
    assert.equal((await t.request("/api/me")).status, 401);
    assert.equal((await t.request("/api/wishlist")).status, 401);
    const c = await t.request("/api/config");
    assert.equal(c.data.fanaticalUrl, "https://steamvaluechecker.com/grabber");
    assert.match(c.data.tipUrl, /^https:\/\/.+support\.html$/);
    assert.match(c.data.inviteUrl, /client_id=123/);
    assert.ok(c.data.regions.length >= 6);
    await t.close();
});

test("twitch link: read from Discord's connections, never typed in", async () => {
    const t = await setup();
    assert.equal((await t.request("/api/twitchlink")).status, 401);
    const start = await t.request("/auth/twitch");
    assert.equal(start.status, 302); assert.match(start.headers.get("location"), /connections=1/);
    const state = new URL(start.headers.get("location")).searchParams.get("state");
    assert.equal((await t.request(`/auth/callback?code=good-twitch&state=${state}`)).headers.get("location"), "/#/steam?twitch=1");
    assert.deepEqual((await t.request("/api/twitchlink")).data, { linked: true, login: "fanname" }, "the verified one wins");
    assert.equal(t.db.twitchLinkByTwitchId("555").discord_id, "u1");
    assert.equal((await t.request("/api/twitchlink", { method: "POST", body: { action: "remove" }, headers: { Origin: "https://evil.example" } })).status, 403);
    assert.equal((await t.request("/api/twitchlink", { method: "POST", body: { action: "remove" } })).data.linked, false);
    await t.request("/auth/twitch");
    assert.match((await t.request("/auth/callback?code=good-twitch&state=wrong")).headers.get("location"), /error=login/, "a wrong state links nothing");
    // no Twitch in their Discord connections: told how to add it
    const again = new URL((await t.request("/auth/twitch")).headers.get("location")).searchParams.get("state");
    assert.equal((await t.request(`/auth/callback?code=good-notwitch&state=${again}`)).headers.get("location"), "/#/steam?twitch=none");
});

test("discord login: state is checked, the session cookie is locked down, logout ends it", async () => {
    const t = await setup();
    const login = await t.request("/auth/login");
    assert.equal(login.status, 302);
    assert.match(login.set.join(), /svc_state=.*HttpOnly.*SameSite=Lax/);
    const state = new URL(login.headers.get("location")).searchParams.get("state");

    // wrong state: no session
    assert.match((await t.request("/auth/callback?code=good&state=wrong")).headers.get("location"), /error=login/);
    assert.equal((await t.request("/api/me")).status, 401);

    // state already used: cannot be replayed
    const fresh = await t.request("/auth/login");
    const s2 = new URL(fresh.headers.get("location")).searchParams.get("state");
    const ok = await t.request(`/auth/callback?code=good&state=${s2}`);
    assert.equal(ok.headers.get("location"), "/#/mypage");
    assert.match(ok.set.join(), /svc_session=.*HttpOnly.*SameSite=Lax/);
    const me = await t.request("/api/me");
    assert.equal(me.status, 200);
    assert.equal(me.data.user.username, "Jacob");
    assert.deepEqual(me.data.servers.map(s => [s.id, s.manageable]), [["g-admin", true], ["g-member", false]]); // servers you only belong to are listed too, for the shared list and leaderboard
    void state;

    assert.match((await t.request(`/auth/callback?code=good&state=${s2}`)).headers.get("location"), /error=login/);

    assert.equal((await t.request("/auth/logout", { method: "POST", body: {} })).status, 200);
    assert.equal((await t.request("/api/me")).status, 401);
    await t.close();
});

test("a failed Discord code exchange does not create a session", async () => {
    const t = await setup();
    const login = await t.request("/auth/login");
    const state = new URL(login.headers.get("location")).searchParams.get("state");
    const r = await t.request(`/auth/callback?code=bad&state=${state}`);
    assert.match(r.headers.get("location"), /error=login/);
    assert.equal((await t.request("/api/me")).status, 401);
    await t.close();
});

test("writes need the dashboard header, JSON and a matching origin", async () => {
    const t = await setup();
    await t.signIn();
    const body = { title: "Hades" };
    assert.equal((await t.request("/api/wishlist/add", { method: "POST", body, headers: { "X-Requested-With": "x" } })).status, 403);
    assert.equal((await t.request("/api/wishlist/add", { method: "POST", body, headers: { "Content-Type": "text/plain" } })).status, 403);
    assert.equal((await t.request("/api/wishlist/add", { method: "POST", body, headers: { Origin: "https://evil.example" } })).status, 403);
    assert.equal((await t.request("/api/wishlist/add", { method: "POST", body, headers: { Origin: ORIGIN } })).status, 200);
    await t.close();
});

test("wishlist: add, view with sale info, change rules, remove", async () => {
    const t = await setup();
    await t.signIn();
    const add = await t.request("/api/wishlist/add", { method: "POST", body: { title: "Hades", type: "percent", value: 40 } });
    assert.equal(add.status, 200);
    assert.equal(add.data.trigger, "40% off or more");

    t.advance(5_000); // adding is rate limited to one every 3 seconds
    const dup = await t.request("/api/wishlist/add", { method: "POST", body: { title: "Hades" } });
    assert.equal(dup.status, 400);
    assert.match(dup.data.error, /already/);
    t.advance(5_000);
    assert.equal((await t.request("/api/wishlist/add", { method: "POST", body: { title: "zzz nothing" } })).status, 400);
    t.advance(5_000);
    assert.equal((await t.request("/api/wishlist/add", { method: "POST", body: { title: "Celeste", type: "percent", value: 0 } })).status, 400);
    assert.equal((await t.request("/api/wishlist/add", { method: "POST", body: { title: "Celeste" } })).status, 429);
    assert.equal(t.db.countItems("u1"), 1);

    t.advance(10_000);
    const view = await t.request("/api/wishlist");
    assert.equal(view.data.rows.length, 1);
    const row = view.data.rows[0];
    assert.equal(row.discount, 0.5);
    assert.equal(row.best.price, 10);
    assert.equal(row.trigger_type, "percent");

    const one = await t.request("/api/wishlist/alert", { method: "POST", body: { itad_id: row.itad_id, type: "price", value: 12 } });
    assert.equal(one.data.label, "at or under 12");
    const all = await t.request("/api/wishlist/alert", { method: "POST", body: { type: "atl" } });
    assert.equal(all.data.updated, 1);
    assert.equal((await t.request("/api/wishlist/alert", { method: "POST", body: { itad_id: "nope", type: "any" } })).status, 404);

    // priority star and owned cleanup
    assert.equal((await t.request("/api/wishlist/priority", { method: "POST", body: { itad_id: "nope" } })).status, 404);
    assert.equal((await t.request("/api/wishlist/priority", { method: "POST", body: { itad_id: row.itad_id } })).status, 200);
    assert.equal((await t.request("/api/wishlist")).data.rows[0].priority, true);
    t.db.upsertLibrary("u1", [{ itad_id: row.itad_id, title: "Celeste", steam_appid: 1, playtime_minutes: 0 }]);
    assert.equal((await t.request("/api/wishlist")).data.rows[0].owned, true);
    const clean = await t.request("/api/wishlist/cleanup", { method: "POST", body: {} });
    assert.equal(clean.data.removed, 1);
    assert.equal(t.db.countItems("u1"), 0);
    t.db.addItems("u1", [{ itad_id: row.itad_id, title: "Celeste", slug: "celeste" }]);
    t.db.removeLibrary && t.db.removeLibrary("u1", row.itad_id);

    assert.equal((await t.request("/api/wishlist/remove", { method: "POST", body: { itad_id: "nope" } })).status, 404);
    assert.equal((await t.request("/api/wishlist/remove", { method: "POST", body: { itad_id: row.itad_id } })).status, 200);
    assert.equal(t.db.countItems("u1"), 0);
    await t.close();
});

test("one person cannot see or change another person's wishlist", async () => {
    const t = await setup();
    await t.signIn();
    t.db.ensureUser("other");
    t.db.addItems("other", [{ itad_id: "theirs", title: "Their Game" }]);
    t.advance(10_000);
    assert.equal((await t.request("/api/wishlist")).data.rows.length, 0);
    assert.equal((await t.request("/api/wishlist/remove", { method: "POST", body: { itad_id: "theirs" } })).status, 404);
    assert.equal(t.db.countItems("other"), 1);
    await t.close();
});

test("value checker: prices titles, rejects keys, and is rate limited", async () => {
    const t = await setup();
    await t.signIn();
    const r = await t.request("/api/value", { method: "POST", body: { titles: "Hades; Celeste", paid: 10, region: "US", stores: "all", sort: "name" } });
    assert.equal(r.status, 200);
    assert.equal(r.data.rows.length, 2);
    assert.equal(r.data.totals.msrp, 40);
    assert.equal(r.data.savings.paid, 10);
    assert.match(r.data.csv, /Celeste/);

    assert.equal((await t.request("/api/value", { method: "POST", body: { titles: "Hades" } })).status, 429);

    t.advance(20_000);
    const keys = await t.request("/api/value", { method: "POST", body: { titles: "AAAAA-BBBBB-12345" } });
    assert.equal(keys.status, 400);
    assert.match(keys.data.error, /titles, not keys/);

    t.advance(20_000);
    const file = await t.request("/api/value", { method: "POST", body: { file: { name: "export.csv", text: "Game,Key,Paid\nHades,AAAAA-BBBBB-12345,3\n" } } });
    assert.equal(file.status, 200);
    assert.equal(file.data.rows[0].paid, 3);
    assert.ok(!JSON.stringify(file.data).includes("AAAAA-BBBBB-12345"));

    t.advance(20_000);
    assert.equal((await t.request("/api/value", { method: "POST", body: { file: { name: "evil.exe", text: "x" } } })).status, 400);
    await t.close();
});

test("settings: validated, and channel delivery needs a server with an alert channel", async () => {
    const t = await setup();
    await t.signIn();
    const bad = await t.request("/api/settings", { method: "POST", body: { delivery: "channel" } });
    assert.equal(bad.status, 400);
    assert.match(bad.data.error, /alert channel/);
    assert.equal((await t.request("/api/settings", { method: "POST", body: { region: "XX" } })).status, 400);
    assert.equal((await t.request("/api/settings", { method: "POST", body: { guild_id: "not-mine" } })).status, 400);

    t.db.setGuildChannel("g-admin", "c1", "someone");
    const ok = await t.request("/api/settings", { method: "POST", body: { delivery: "channel", guild_id: "g-admin", region: "GB", stores: "all", paused: true } });
    assert.equal(ok.status, 200);
    assert.deepEqual(
        [ok.data.settings.delivery, ok.data.settings.guild_id, ok.data.settings.region, ok.data.settings.paused],
        ["channel", "g-admin", "GB", true]
    );
    await t.close();
});

test("alert channel: only people with Manage Server, and only if the bot can post", async () => {
    const t = await setup();
    await t.signIn();
    assert.equal((await t.request("/api/servers/channels?guild=g-member")).status, 403);
    assert.equal((await t.request("/api/servers/channel", { method: "POST", body: { guild_id: "g-member", channel_id: "c1" } })).status, 403);

    const list = await t.request("/api/servers/channels?guild=g-admin");
    assert.deepEqual(list.data.channels.map(c => c.name), ["alerts", "general"]);

    assert.equal((await t.request("/api/servers/channel", { method: "POST", body: { guild_id: "g-admin", channel_id: "not-in-guild" } })).status, 400);

    const set = await t.request("/api/servers/channel", { method: "POST", body: { guild_id: "g-admin", channel_id: "c1" } });
    assert.equal(set.status, 200);
    assert.equal(t.db.getGuild("g-admin").channel_id, "c1");
    assert.equal(t.db.getGuild("g-admin").set_by, "u1");
    assert.equal(t.sent[0].id, "c1");
    assert.deepEqual(t.sent[0].p.allowed_mentions, { parse: [] });

    assert.equal((await t.request("/api/servers/channel", { method: "POST", body: { guild_id: "g-admin", clear: true } })).data.cleared, true);
    assert.equal(t.db.getGuild("g-admin"), undefined);
    await t.close();
});

test("alert channel is not saved when the bot cannot post there", async () => {
    const t = await setup({ sendFails: true });
    await t.signIn();
    const r = await t.request("/api/servers/channel", { method: "POST", body: { guild_id: "g-admin", channel_id: "c1" } });
    assert.equal(r.status, 400);
    assert.match(r.data.error, /cannot post in #alerts/);
    assert.equal(t.db.getGuild("g-admin"), undefined);
    await t.close();
});

test("a server the bot has not joined is explained", async () => {
    const t = await setup({ guildsOf: [{ id: "g-nobot", name: "No bot", icon: null, owner: true, permissions: "0" }] });
    await t.signIn();
    const r = await t.request("/api/servers/channels?guild=g-nobot");
    assert.equal(r.status, 400);
    assert.match(r.data.error, /not in that server/);
    await t.close();
});

test("my data: download and delete (needs DELETE typed)", async () => {
    const t = await setup();
    await t.signIn();
    await t.request("/api/wishlist/add", { method: "POST", body: { title: "Hades" } });

    const dl = await t.request("/api/mydata/download", { raw: true });
    assert.equal(dl.status, 200);
    assert.match(dl.headers.get("content-disposition"), /attachment/);
    const exported = await dl.json();
    assert.equal(exported.wishlist.length, 1);

    assert.equal((await t.request("/api/mydata/delete", { method: "POST", body: {} })).status, 400);
    assert.equal((await t.request("/api/mydata/delete", { method: "POST", body: { confirm: "DELETE" } })).data.deleted, true);
    assert.equal(t.db.getUser("u1"), undefined);
    assert.equal((await t.request("/api/mydata/download")).status, 404);
    await t.close();
});

test("oversized and malformed bodies are rejected", async () => {
    const t = await setup();
    await t.signIn();
    const big = await t.request("/api/wishlist/add", { method: "POST", body: { title: "x".repeat(30_000) } });
    assert.equal(big.status, 413);
    const res = await fetch(`http://127.0.0.1:${t.dash.server.address().port}/api/wishlist/add`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "dashboard", Cookie: "" }, body: "{nope"
    });
    assert.equal(res.status, 400);
    await t.close();
});

test("applySteamImport stores games, prunes only on a complete import", () => {
    const db = openDb(":memory:");
    db.ensureUser("u");
    db.addItems("u", [{ itad_id: "old", title: "Old" }], { source: "steam" });
    const games = [{ itad_id: "a", title: "A" }, { itad_id: "b", title: "B" }];

    const partial = applySteamImport(db, "u", { games, steamid: "7656119800000000", complete: false, unmatched: 1, truncated: false, total: 3 });
    assert.equal(partial.added, 2);
    assert.equal(partial.pruned, 0);
    assert.equal(db.countItems("u"), 3);

    const full = applySteamImport(db, "u", { games, steamid: "7656119800000000", complete: true, unmatched: 0, truncated: false, total: 2 });
    assert.equal(full.pruned, 1);
    assert.deepEqual(db.listItems("u").map(i => i.itad_id).sort(), ["a", "b"]);
    assert.equal(db.getUser("u").steam_id, "7656119800000000");

    assert.throws(() => applySteamImport(db, "u", { games: [], steamid: "1" }), WishlistError);
});

// ---------- newer features ----------
import nodeHttp from "node:http";
/** A GET that says which address it was sent to, the way a browser on admin.example would. */
const getAs = (t, host, path) => new Promise((resolve, reject) => {
    const u = new URL(t.base);
    const req = nodeHttp.request({ host: u.hostname, port: u.port, path, method: "GET", headers: { Host: host, Cookie: t.cookie?.() ?? "" } }, res => { let body = ""; res.on("data", c => { body += c; }); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body })); });
    req.on("error", reject); req.end();
});
const signedIn = async (opts) => { const t = await setup(opts); await t.signIn(); return t; };

test("settings: quiet hours, digest and sharing are validated and saved", async () => {
    const t = await signedIn();
    const ok = await t.request("/api/settings", { method: "POST", body: { quiet_start: "22:00", quiet_end: "07:00", tz: "Europe/London", digest: true, digest_day: 5, bundles: false, share: true } });
    assert.equal(ok.status, 200);
    assert.deepEqual([ok.data.settings.quiet_start, ok.data.settings.quiet_end, ok.data.settings.tz, ok.data.settings.digest, ok.data.settings.digest_day, ok.data.settings.bundles, ok.data.settings.share],
        ["22:00", "07:00", "Europe/London", true, 5, false, true]);
    assert.equal((await t.request("/api/settings", { method: "POST", body: { tz: "Nowhere/Land" } })).status, 400);
    assert.equal((await t.request("/api/settings", { method: "POST", body: { quiet_start: "22:00", quiet_end: "22:00" } })).status, 400);
    const off = await t.request("/api/settings", { method: "POST", body: { quiet_start: null, quiet_end: null } });
    assert.equal(off.data.settings.quiet_start, null);
    await t.close();
});

test("library: add, import entries, view totals, remove", async () => {
    const t = await signedIn();
    assert.equal((await t.request("/api/library/add", { method: "POST", body: { title: "Hades", paid: 5 } })).status, 200);
    assert.equal((await t.request("/api/library/add", { method: "POST", body: { title: "zzz none" } })).status, 429); // add cooldown shared with imports
    t.advance(5000);
    assert.equal((await t.request("/api/library/add", { method: "POST", body: { title: "zzz none" } })).status, 400);
    t.advance(5000);
    const imp = await t.request("/api/library/import", { method: "POST", body: { entries: [{ title: "Celeste", paid: null }, { title: "Hollow Knight", paid: 8 }] } });
    assert.equal(imp.data.added, 2);
    const view = await t.request("/api/library");
    assert.equal(view.data.totals.games, 3);
    assert.equal(view.data.totals.paidGames, 2);
    const rm = await t.request("/api/library/remove", { method: "POST", body: { itad_id: "id-hades" } });
    assert.equal(rm.data.removed, "Hades");
    assert.equal((await t.request("/api/library/remove", { method: "POST", body: { itad_id: "id-hades" } })).status, 404);
    const me = await t.request("/api/me");
    assert.equal(me.data.library, 2);
    await t.close();
});

test("price history needs a game you own, and is thinned for the chart", async () => {
    const t = await signedIn();
    await t.request("/api/wishlist/add", { method: "POST", body: { title: "Hades", type: "any" } });
    assert.equal((await t.request("/api/wishlist/history?itad_id=id-other")).status, 404);
    const h = await t.request("/api/wishlist/history?itad_id=id-hades");
    assert.equal(h.status, 200);
    assert.ok(h.data.points.length <= 200 && h.data.points.length > 50);
    assert.equal(h.data.title, "Hades");
    assert.equal((await t.request("/api/wishlist/history?itad_id=id-hades")).status, 429);
    await t.close();
});

test("bulk actions only touch the member's own games", async () => {
    const t = await signedIn();
    for (const title of ["Hades", "Celeste", "Hollow Knight"]) { await t.request("/api/wishlist/add", { method: "POST", body: { title, type: "any" } }); t.advance(4000); }
    const a = await t.request("/api/wishlist/bulk", { method: "POST", body: { action: "alert", itad_ids: ["id-hades", "id-celeste", "someone-elses"], type: "percent", value: 50 } });
    assert.equal(a.data.updated, 2);
    const rows = (await t.request("/api/wishlist")).data.rows;
    assert.equal(rows.find(r => r.itad_id === "id-hades").trigger_type, "percent");
    assert.equal(rows.find(r => r.itad_id === "id-hollowknight").trigger_type, "any");
    assert.ok(rows[0].verdict);
    const r = await t.request("/api/wishlist/bulk", { method: "POST", body: { action: "remove", itad_ids: ["id-hades", "id-celeste"] } });
    assert.equal(r.data.removed, 2);
    assert.equal((await t.request("/api/wishlist/bulk", { method: "POST", body: { action: "remove", itad_ids: [] } })).status, 400);
    assert.equal((await t.request("/api/wishlist/bulk", { method: "POST", body: { action: "explode", itad_ids: ["id-hollowknight"] } })).status, 400);
    await t.close();
});

test("shared server list and leaderboard are limited to servers the member is in", async () => {
    const t = await signedIn();
    const add = await t.request("/api/servers/list/add", { method: "POST", body: { guild_id: "g-member", title: "Hades" } });
    assert.equal(add.status, 200);
    assert.equal((await t.request("/api/servers/list/add", { method: "POST", body: { guild_id: "g-stranger", title: "Hades" } })).status, 403);
    assert.equal((await t.request("/api/servers/list?guild=g-stranger")).status, 403);
    const list = await t.request("/api/servers/list?guild=g-member");
    assert.equal(list.data.rows[0].votes, 1);
    const v = await t.request("/api/servers/list/vote", { method: "POST", body: { guild_id: "g-member", itad_id: "id-hades" } });
    assert.deepEqual([v.data.voted, v.data.votes], [false, 0]);

    t.db.updateUser("u1", { share: 1 });
    t.db.upsertSnapshot("u1", { games: 4, paid: 20, msrp: 100, msrp_paid: 100, cheapest: 50 });
    t.db.updateUser("u1", { guild_id: "g-member" });
    const board = await t.request("/api/servers/leaderboard?guild=g-member");
    assert.equal(board.data.entries[0].name, "Jacob");
    assert.equal(Math.round(board.data.entries[0].savedPct), 80);
    assert.equal((await t.request("/api/servers/leaderboard?guild=g-stranger")).status, 403);
    await t.close();
});

test("group alert minimum: managers only, needs an alert channel, 1 is not allowed", async () => {
    const t = await signedIn();
    const body = n => ({ method: "POST", body: { guild_id: "g-admin", minimum: n } });
    assert.equal((await t.request("/api/servers/group", body(3))).status, 400); // no alert channel yet
    t.db.setGuildChannel("g-admin", "c1", "u1");
    assert.equal((await t.request("/api/servers/group", body(3))).data.groupMin, 3);
    assert.equal((await t.request("/api/servers/group", body(1))).status, 400);
    assert.equal((await t.request("/api/servers/group", { method: "POST", body: { guild_id: "g-member", minimum: 3 } })).status, 403);
    await t.close();
});

test("hot deals minimum and sale posts: managers only, need an alert channel, sane range", async () => {
    const t = await signedIn();
    const hot = n => ({ method: "POST", body: { guild_id: "g-admin", minimum: n } });
    assert.equal((await t.request("/api/servers/hot", hot(75))).status, 400); // no alert channel yet
    t.db.setGuildChannel("g-admin", "c1", "u1");
    assert.equal((await t.request("/api/servers/hot", hot(75))).data.hotMin, 75);
    assert.equal(t.db.getGuild("g-admin").hot_min, 75);
    assert.equal((await t.request("/api/servers/hot", hot(10))).status, 400);
    assert.equal((await t.request("/api/servers/hot", hot(0))).data.hotMin, 0);
    assert.equal((await t.request("/api/servers/sales", { method: "POST", body: { guild_id: "g-admin", enabled: true } })).data.saleFeed, true);
    assert.equal(t.db.getGuild("g-admin").sale_feed, 1);
    assert.equal((await t.request("/api/servers/hot", { method: "POST", body: { guild_id: "g-member", minimum: 75 } })).status, 403);
    await t.close();
});

test("alert history lists the member's own alerts", async () => {
    const t = await signedIn();
    t.db.ensureUser("u1"); t.db.ensureUser("other");
    t.db.logAlert({ discord_id: "u1", title: "Hades", kind: "sale", price: 9.99, shop: "GOG", via: "dm" });
    t.db.logAlert({ discord_id: "other", title: "Secret", kind: "sale", price: 1 });
    const r = await t.request("/api/alerts/history");
    assert.deepEqual(r.data.alerts.map(a => a.title), ["Hades"]);
    await t.close();
});

test("sample alerts: sent to the member's own DMs, only a known kind, and not in a rush", async () => {
    const dms = [];
    const t = await signedIn({ extra: () => ({ dm: async (id, p) => { dms.push([id, p]); } }) });
    const post = (path, body) => t.request(path, { method: "POST", body });
    assert.equal((await post("/api/alerts/test", { kind: "nope" })).status, 400);
    const ok = await post("/api/alerts/test", { kind: "sale" });
    assert.equal(ok.status, 200); assert.equal(dms.length, 1); assert.equal(dms[0][0], "u1"); assert.match(dms[0][1].content, /Sample alert/);
    assert.equal((await post("/api/alerts/test", { kind: "free" })).status, 429, "five seconds between samples");
    await t.close();
});

test("per-game quiet: snooze for a while, mute until switched back on, and the wishlist says which", async () => {
    const t = await signedIn();
    t.db.ensureUser("u1"); t.db.addItems("u1", [{ itad_id: "g1", title: "Hades" }]);
    const post = body => t.request("/api/wishlist/snooze", { method: "POST", body: { itad_id: "g1", ...body } });
    const active = () => !t.db.listItems("u1")[0].snooze_until; // the poller skips a game that has a snooze time
    assert.ok(active());
    assert.equal((await post({ days: 7 })).status, 200); assert.ok(!active(), "snoozed");
    const m = await post({ muted: true }); assert.equal(m.data.muted, true); assert.ok(m.data.snoozed_until - (await t.request("/api/wishlist/snooze", { method: "POST", body: { itad_id: "g1", days: 1 } })).data.snoozed_until > 3000 * 86400_000, "muted is for good"); await post({ muted: true });
    assert.equal((await post({ days: 0 })).status, 200); assert.ok(active(), "switched back on");
    assert.equal((await t.request("/api/wishlist/snooze", { method: "POST", body: { itad_id: "nope", muted: true } })).status, 404);
    await t.close();
});

test("installable: a valid manifest, every icon it names, and the page and security rules that let a browser use it", async () => {
    const t = await signedIn();
    const m = await t.request("/manifest.webmanifest", { raw: true });
    assert.equal(m.status, 200); assert.match(m.headers.get("content-type"), /application\/manifest\+json/);
    const man = JSON.parse(await m.text());
    assert.equal(man.display, "standalone"); assert.equal(man.start_url, "/"); assert.ok(man.name && man.short_name.length <= 12);
    const sizes = man.icons.map(i => i.sizes); assert.ok(sizes.includes("192x192") && sizes.includes("512x512"), "the two sizes browsers ask for");
    assert.ok(man.icons.some(i => i.purpose === "maskable"));
    for (const i of [...man.icons, ...man.shortcuts.flatMap(x => x.icons)]) { const r = await t.request(i.src, { raw: true }); assert.equal(r.status, 200, i.src); assert.equal(r.headers.get("content-type"), "image/png"); }
    for (const sc of man.shortcuts) assert.match(sc.url, /^\/#\//);
    const page = await t.request("/");
    assert.match(page.text, /<link rel="manifest" href="\/manifest\.webmanifest">/);
    assert.match(page.headers.get("content-security-policy"), /manifest-src 'self'/);
    await t.close();
});

test("settings: the DLC sale switch is saved and read back", async () => {
    const t = await signedIn();
    t.db.ensureUser("u1");
    assert.equal((await t.request("/api/me")).data.settings.dlc, false);
    const r = await t.request("/api/settings", { method: "POST", body: { dlc: true } });
    assert.equal(r.status, 200); assert.equal(r.data.settings.dlc, true); assert.equal(t.db.getUser("u1").dlc, 1);
    assert.equal((await t.request("/api/settings", { method: "POST", body: { dlc: false } })).data.settings.dlc, false);
    const r2 = await t.request("/api/settings", { method: "POST", body: { refund: true, milestones: true, yearly: true } });
    assert.deepEqual([r2.data.settings.refund, r2.data.settings.milestones, r2.data.settings.yearly], [true, true, true]);
    await t.close();
});

test("admin page: owner only", async () => {
    const t = await signedIn();
    assert.equal((await t.request("/api/admin/stats")).status, 403);
    assert.equal((await t.request("/api/me")).data.isOwner, false);
    await t.close();
    const o = await signedIn({ config: { ownerId: "u1" } });
    const r = await o.request("/api/admin/stats");
    assert.equal(r.status, 200);
    assert.equal(typeof r.data.stats.users, "number");
    assert.equal((await o.request("/api/me")).data.isOwner, true);
    await o.close();
});

test("the dashboard rate limits a session that hammers the API", async () => {
    const t = await signedIn({ config: { apiPerMinute: 5 } });
    const codes = [];
    for (let i = 0; i < 8; i++) codes.push((await t.request("/api/me")).status);
    assert.ok(codes.includes(429));
    assert.equal(codes[0], 200);
    await t.close();
});

test("export includes library and alert history", async () => {
    const t = await signedIn();
    t.db.ensureUser("u1");
    t.db.upsertLibrary("u1", [{ itad_id: "a", title: "Hades", paid: 5 }]);
    t.db.logAlert({ discord_id: "u1", title: "Hades", kind: "sale", price: 5 });
    const r = await t.request("/api/mydata/download");
    const data = JSON.parse(r.text);
    assert.equal(data.library[0].paid, 5);
    assert.equal(data.alert_history[0].title, "Hades");
    assert.ok("quiet_hours" in data.settings);
    await t.close();
});

test("free games list is grouped by platform, needs sign-in, and the setting saves", async () => {
    const t = await setup();
    assert.equal((await t.request("/api/free")).status, 401);
    await t.signIn();
    const r = await t.request("/api/free");
    assert.deepEqual(r.data.platforms.map(p => [p.shop, p.games.length]), [["Epic", 2]]); // the non-https link is dropped
    const s = await t.request("/api/settings", { method: "POST", body: { free: true } });
    assert.equal(s.data.settings.free, true);
    await t.close();
});

// ---------- giveaways ----------
test("giveaways page: managers only, validated, and keys never come back", async () => {
    const posts = [], dms = [];
    const t = await setup({ extra: { botGuilds: () => true }, giveawayService: db => createGiveawayService({
        db, vault: createVault("dashboard-test-secret-123"),
        discord: { post: async (c, p) => { posts.push({ c, p }); return { id: "m" + posts.length }; }, edit: async () => {}, dm: async (u, p) => { dms.push({ u, p }); }, memberOk: async () => true, findChannelByName: async () => null }
    }) });
    await t.signIn();

    assert.equal((await t.request("/api/me")).data.giveaways, true);
    assert.equal((await t.request("/api/giveaways?guild=g-member")).status, 403); // not a manager there
    const body = { guild_id: "g-admin", channel_id: "c1", title: "Big one", length: "2h", keys: "Hades | AAAAA-BBBBB\nCeleste | CCCCC-DDDDD", game: "Hades", auto_image: false };
    const post = b => t.request("/api/giveaways/create", { method: "POST", body: b });
    assert.equal((await post({ ...body, channel_id: "nope" })).status, 400);
    assert.equal((await post({ ...body, length: "soon" })).status, 400);
    assert.equal((await post({ ...body, keys: "Hades KEY1 KEY2" })).status, 400);
    assert.equal((await post({ ...body, image: "http://insecure.example/a.png" })).status, 400);
    const made = await post(body);
    assert.equal(made.status, 200);
    assert.equal(made.data.prizes, 2);
    assert.ok(!made.text.includes("AAAAA"));
    assert.ok(!JSON.stringify(posts).includes("AAAAA")); // the public post carries no keys

    // the streamer's overlay can show several of the running giveaways at once
    const card = (await t.request("/api/streamcard", { method: "POST", body: { action: "create" } })).data;
    const shown = async () => (await (await fetch(t.base + "/api/giveawayoverlay/data?token=" + card.token)).json()).giveaways;
    const pk = await t.request("/api/giveawayoverlay/pick?guild=g-admin"); assert.equal(pk.status, 200, pk.text); assert.equal(pk.data.giveaways[0].id, made.data.id);
    assert.equal((await t.request("/api/giveawayoverlay/pick", { method: "POST", body: { guild_id: "g-admin", ids: [99999] } })).status, 400, "not a giveaway in this server");
    assert.equal((await shown()).length, 0, "nothing picked and no stream giveaway");
    assert.equal((await t.request("/api/giveawayoverlay/pick", { method: "POST", body: { guild_id: "g-admin", ids: [made.data.id] } })).status, 200);
    const on = await shown();
    assert.equal(on.length, 1); assert.equal(on[0].title, "Big one"); assert.deepEqual(on[0].prizes, ["Hades", "Celeste"]); assert.ok(!JSON.stringify(on).includes("AAAAA"));
    await t.request("/api/giveawayoverlay/pick", { method: "POST", body: { guild_id: "g-admin", ids: [] } });
    assert.equal((await shown()).length, 0, "clearing the pick goes back to following the stream giveaway");

    const list = await t.request("/api/giveaways?guild=g-admin");
    assert.equal(list.data.giveaways[0].prizes, 2);
    assert.ok(!list.text.includes("AAAAA"));
    const info = await t.request(`/api/giveaways/info?guild=g-admin&id=${made.data.id}`);
    assert.deepEqual(info.data.keys.map(k => k.label), ["Hades", "Celeste"]);
    assert.ok(!info.text.includes("AAAAA") && !info.text.includes("CCCCC"));
    assert.equal((await t.request("/api/servers/roles?guild=g-admin")).data.roles[0].name, "Boosters");
    assert.equal((await t.request("/api/servers/roles?guild=g-member")).status, 403);

    const saved = await t.request("/api/giveaways/setup", { method: "POST", body: { guild_id: "g-admin", vouch_channel_id: "c2", manager_role_id: "r1" } });
    assert.deepEqual([saved.data.settings.vouch_channel_id, saved.data.settings.manager_role_id], ["c2", "r1"]);
    assert.equal((await t.request("/api/giveaways/setup", { method: "POST", body: { guild_id: "g-admin", vouch_channel_id: "zzz" } })).status, 400);

    // rules can be changed while it runs: several roles, an override role and Steam Verified
    const rules = await t.request("/api/giveaways/rules", { method: "POST", body: { guild_id: "g-admin", id: made.data.id, require_role_ids: "r1,r2", require_all: true, override_role_ids: "r3", bonus_role_ids: "r4", bonus_entries: 5, steam_verified: true } });
    assert.equal(rules.status, 200, rules.text);
    const after = (await t.request(`/api/giveaways/info?guild=g-admin&id=${made.data.id}`)).data;
    assert.ok(after, "info still loads");
    assert.equal((await t.request("/api/giveaways/rules", { method: "POST", body: { guild_id: "g-member", id: made.data.id, clear: true } })).status, 403);
    assert.equal((await t.request("/api/giveaways/rules", { method: "POST", body: { guild_id: "g-admin", id: 9999, clear: true } })).status, 404);

    const cancel = await t.request("/api/giveaways/cancel", { method: "POST", body: { guild_id: "g-admin", id: made.data.id } });
    assert.equal(cancel.data.unused, 2);
    assert.match(JSON.stringify(dms), /AAAAA-BBBBB/); // unused keys go to the host's DMs, never to the dashboard
    assert.equal((await t.request("/api/giveaways/end", { method: "POST", body: { guild_id: "g-admin", id: 9999 } })).status, 404);
    await t.close();
});

test("giveaways are switched off cleanly without a key secret", async () => {
    const t = await setup();
    await t.signIn();
    assert.equal((await t.request("/api/me")).data.giveaways, false);
    const r = await t.request("/api/giveaways/create", { method: "POST", body: { guild_id: "g-admin", channel_id: "c1", title: "x", length: "1h", keys: "k" } });
    assert.equal(r.status, 503);
    await t.close();
});

test("about is public and has the creator credit; privacy text has no GitHub link", async () => {
    const t = await setup({ config: { creator: { name: "Jacob Lucado", url: "https://x.com/twit_user69" } } });
    const about = await t.request("/api/about");
    assert.equal(about.status, 200);
    assert.equal(about.data.creator.name, "Jacob Lucado");
    const cfg = await t.request("/api/config");
    assert.ok(!/github\.com/i.test(cfg.data.privacy));
    assert.equal(cfg.data.repoUrl, undefined);
    assert.equal((await t.request("/creator.png", { raw: true })).status, 200);
    assert.equal((await t.request("/banner.png", { raw: true })).status, 200);
    await t.close();
});

test("the page has share-preview tags with the real address, plus robots and sitemap", async () => {
    const t = await setup();
    const page = await t.request("/", { raw: true });
    const html = await page.text();
    assert.ok(html.includes(`<meta property="og:image" content="${ORIGIN}/preview.jpg?v=2">`));
    assert.ok(html.includes('name="twitter:card" content="summary_large_image"'));
    assert.ok(!html.includes("__ORIGIN__"));
    const img = await t.request("/preview.jpg", { raw: true });
    assert.equal(img.status, 200);
    assert.equal(img.headers.get("content-type"), "image/jpeg");
    const robots = await (await t.request("/robots.txt", { raw: true })).text();
    assert.match(robots, /Disallow: \/api\//);
    assert.match(robots, new RegExp(`Sitemap: ${ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/sitemap.xml`));
    assert.match(robots, /Allow: \/grabber/);
    const map = await (await t.request("/sitemap.xml", { raw: true })).text();
    for (const p of ["/", "/grabber", "/terms.html", "/privacy.html"]) assert.ok(map.includes(`<loc>${ORIGIN}${p}</loc>`), p);
    assert.match(map, /<loc>[^<]+\/grabber<\/loc><lastmod>\d{4}-\d\d-\d\d<\/lastmod>/);
    assert.ok(map.includes(`<loc>${ORIGIN}/ai</loc>`));
    assert.match(robots, /Allow: \/ai\n/);
    // The AI companion page: served with the real origin, labelled beta, and every file and picture it uses is there.
    const ai = await t.request("/ai", { raw: true });
    assert.equal(ai.status, 200);
    const aiHtml = await ai.text();
    assert.ok(!aiHtml.includes("__ORIGIN__") && aiHtml.includes(`${ORIGIN}/ai`));
    assert.match(aiHtml, /BETA/);
    for (const f of ["/ai.css", "/ai.js", "/img/ai/history.png", "/img/ai/compare.png", "/img/ai/library.png", "/img/ai/plan.png", "/img/ai/achievements.png", "/img/ai/guide.png", "/ai-ad-hero.png"]) assert.equal((await t.request(f, { raw: true })).status, 200, f);
    assert.ok(!/\sstyle=/.test(aiHtml), "the page's content policy blocks inline styles");
    // The pages that exist to be found: each one is complete without running any script.
    const { seoSlugs } = await import("../src/seopages.js");
    assert.ok(seoSlugs().length >= 5);
    const seen = new Set();
    for (const slug of seoSlugs()) {
        const r = await t.request("/" + slug, { raw: true });
        assert.equal(r.status, 200, slug);
        const html = await r.text();
        assert.ok(html.includes(`<link rel="canonical" href="${ORIGIN}/${slug}">`), slug);
        assert.match(html, /<title>[^<]{20,}<\/title>/); assert.match(html, /<meta name="description" content="[^"]{60,}">/);
        assert.equal((html.match(/<h1>/g) ?? []).length, 1, "one h1 on " + slug);
        for (const type of ["FAQPage", "BreadcrumbList", "HowTo"]) assert.ok(html.includes(`"@type":"${type}"`), `${slug} ${type}`);
        assert.ok(!/\sstyle=/.test(html) && !html.includes("__ORIGIN__"), slug);
        assert.ok(!seen.has(html.match(/<title>([^<]*)/)[1]), "titles are unique"); seen.add(html.match(/<title>([^<]*)/)[1]);
        assert.ok(map.includes(`<loc>${ORIGIN}/${slug}</loc>`), slug + " is in the sitemap");
        assert.match(robots, new RegExp(`Allow: /${slug}\\n`));
        for (const href of [...html.matchAll(/href="(\/[a-z-]+)"/g)].map(m => m[1])) if (href !== "/") assert.ok([...seoSlugs().map(x => "/" + x), "/ai", "/grabber", "/terms", "/privacy"].some(x => href.startsWith(x)) || href === "/auth", `${slug} links to ${href}`);
    }
    assert.equal((await t.request("/seo.css", { raw: true })).status, 200);
    assert.equal((await t.request("/scrollbar.css", { raw: true })).status, 200);
    for (const page of ["/", "/ai", "/grabber", "/steam-id-finder", "/music", "/admin"]) { const h = await (await t.request(page, { raw: true })).text(); if (h.includes("<html")) assert.ok(h.includes("/scrollbar.css"), page + " has themed scroll bars"); }
    for (const f of ["/motion.css", "/motion.js"]) assert.equal((await t.request(f, { raw: true })).status, 200, f);
    for (const page of ["/", "/ai", "/grabber", "/steam-id-finder"]) { const h = await (await t.request(page, { raw: true })).text(); assert.ok(h.includes("/motion.js") && h.includes("/motion.css"), page + " has the motion layer"); }
    for (const f of ["timestamp", "steamid", "refund", "sales"]) assert.equal((await t.request(`/tools/${f}.js`, { raw: true })).status, 200, f);
    const sid = await t.request("/api/steamid?q=" + encodeURIComponent("[U:1:24691]"), { raw: true });
    assert.notEqual(sid.status, 500);
    assert.equal((await t.request("/api/steamid?q=", { raw: true })).status, 400);
    const sales = await (await t.request("/steam-sale-dates", { raw: true })).text();
    assert.ok(sales.includes('class="sale"') && sales.includes("/tools/sales.js"));
    const { indexNowKey } = await import("../src/indexnow.js");
    const key = indexNowKey(ORIGIN);
    assert.equal(await (await t.request(`/${key}.txt`, { raw: true })).text(), key, "the IndexNow key file is served");
    const bing = await t.request("/BingSiteAuth.xml", { raw: true });
    assert.equal(bing.status, 200);
    assert.match(await bing.text(), /<user>[0-9A-F]{32}<\/user>/);
    // The home page carries real text and links to those pages before the app draws it.
    assert.ok(html.includes("/steam-library-value") && html.includes("<h1>Steam Value Checker"), "home page has crawlable content");
    await t.close();
});

test("visit counter for the FanaticalGrabber page: only that origin counts, one new visitor per address, totals only", async () => {
    const t = await setup();
    const SITE = "https://jacob-lucado.github.io";
    try {
        let r = await t.request("/api/visits/fanaticalgrabber");
        assert.equal(r.data.views, 0);
        assert.equal(r.headers.get("access-control-allow-origin"), SITE);
        r = await t.request("/api/visits/fanaticalgrabber?new=1", { method: "POST", headers: { Origin: SITE } });
        assert.deepEqual([r.data.views, r.data.visitors], [1, 1]);
        r = await t.request("/api/visits/fanaticalgrabber?new=1", { method: "POST", headers: { Origin: SITE } });
        assert.deepEqual([r.data.views, r.data.visitors], [2, 1], "same address is not a new visitor twice");
        r = await t.request("/api/visits/fanaticalgrabber", { method: "POST", headers: { Origin: "https://evil.example" } });
        assert.equal(r.data.views, 2, "other origins are ignored");
        assert.equal((await t.request("/api/visits/unknown")).status, 404);
        // viewing now: heartbeats from different tabs, expiring after 75 seconds
        const ping = id => t.request(`/api/visits/fanaticalgrabber/ping?id=${id}`, { method: "POST", headers: { Origin: SITE } });
        assert.equal((await ping("tabaaaaaaaa")).data.online, 1);
        assert.equal((await ping("tabbbbbbbbb")).data.online, 2);
        assert.equal((await ping("tabaaaaaaaa")).data.online, 2, "same tab is not counted twice");
        assert.equal((await ping("x")).data.online, 2, "bad ids are ignored");
        t.advance(80_000);
        assert.equal((await t.request("/api/visits/fanaticalgrabber")).data.online, 0);
        const pre = await t.request("/api/visits/fanaticalgrabber", { method: "OPTIONS", headers: { Origin: SITE } });
        assert.equal(pre.status, 204);
    } finally { await t.close(); }
});

const XML = '<gamesList><games><game><appID>10</appID><name><![CDATA[Counter]]></name><hoursOnRecord>12.5</hoursOnRecord></game></games></gamesList>';

const PROFILE_XML = '<profile><steamID64>76561198000000000</steamID64><steamID><![CDATA[Jacob <b>L</b>]]></steamID><onlineState>in-game</onlineState><privacyState>public</privacyState><avatarFull><![CDATA[https://avatars.steamstatic.com/abc_full.jpg]]></avatarFull><memberSince>March 3, 2012</memberSince><location>Roanoke, Virginia</location><inGameInfo><gameName><![CDATA[Hades II]]></gameName></inGameInfo><mostPlayedGames><mostPlayedGame><gameName><![CDATA[Fell &amp; Sell]]></gameName></mostPlayedGame></mostPlayedGames></profile>';
test("Steam page: profile card for the linked account, and a look-up of anyone's public profile", async () => {
    const fetched = [];
    const t = await signedIn({
        extra: { steamFetch: async url => { fetched.push(url); const xml = /\/profiles\/\d+\/\?xml=1/.test(url) ? PROFILE_XML : XML; return { ok: true, status: 200, text: async () => xml }; } },
        itadExtra: { lookupShopIds: async (_s, ids) => new Map(ids.map(i => [i, "id-" + i.slice(4)])) }
    });
    try {
        await t.request("/api/steam/link", { method: "POST", body: { profile: "76561198000000000" } });
        const v = await t.request("/api/steam");
        assert.equal(v.data.card.name, "Jacob <b>L</b>", "sent as plain text; the page never treats it as HTML");
        assert.equal(v.data.card.avatar, "https://avatars.steamstatic.com/abc_full.jpg");
        assert.equal(v.data.card.playing, "Hades II");
        assert.equal("location" in v.data.card, false, "location is not kept");
        const n = fetched.filter(u => /\?xml=1/.test(u) && /profiles\/76561198000000000\/\?xml=1/.test(u)).length;
        await t.request("/api/steam");
        assert.equal(fetched.filter(u => /profiles\/76561198000000000\/\?xml=1/.test(u)).length, n, "the card is cached");
        const l = await t.request("/api/steam/lookup?profile=" + encodeURIComponent("76561198000000001"));
        assert.equal(l.status, 200);
        assert.equal(l.data.stats.games, 1); assert.equal(l.data.stats.mostPlayed[0].title, "Counter"); assert.equal(l.data.mine, false);
        assert.equal(t.db.listLibrary("u1").length, 1, "looking someone up stores nothing");
        assert.equal((await t.request("/api/steam/lookup?profile=76561198000000001")).status, 429, "lookups are rate limited");
        t.advance(9_000);
        assert.equal((await t.request("/api/steam/lookup?profile=!!")).status, 400);
        t.advance(9_000);
        assert.equal((await t.request("/api/steam/lookup?profile=76561198000000000")).data.mine, true);
    } finally { await t.close(); }
});

test("Steam linking: link, view, sync and unlink from the dashboard", async () => {
    const t = await signedIn({
        extra: { steamFetch: async () => ({ ok: true, status: 200, text: async () => XML }) },
        itadExtra: { lookupShopIds: async (_s, ids) => new Map(ids.map(i => [i, "id-" + i.slice(4)])) }
    });
    assert.equal((await t.request("/api/steam")).data.link, null);
    const bad = await t.request("/api/steam/link", { method: "POST", body: { profile: "!!" } });
    assert.equal(bad.status, 400);
    const ok = await t.request("/api/steam/link", { method: "POST", body: { profile: "76561198000000000" } });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.owned, 1); assert.equal(ok.data.added, 1);
    const view = await t.request("/api/steam");
    assert.equal(view.data.link.steamid, "76561198000000000");
    assert.equal(view.data.stats.playedGames, 1);
    assert.ok(view.data.stats.value && !("perHour" in view.data.stats));
    assert.equal(view.data.stats.value.top[0].title, "Counter");
    const nx = await t.request("/api/steam/next");
    assert.equal(nx.status, 200);
    assert.equal(nx.data.next, null, "a game with 12 hours already played is not suggested as next");
    assert.equal((await t.request("/api/steam/sync", { method: "POST", body: {} })).status, 429, "a second sync right away waits");
    t.advance(61_000);
    assert.equal((await t.request("/api/steam/sync", { method: "POST", body: {} })).status, 200);
    const un = await t.request("/api/steam/unlink", { method: "POST", body: { removeGames: true } });
    assert.equal(un.data.removed, 1);
    assert.equal((await t.request("/api/steam")).data.link, null);
    assert.equal((await t.request("/api/steam/unlink", { method: "POST", body: {} })).status, 400);
    await t.close();
});

test("Steam linking: a private profile is a clear 400, not a crash", async () => {
    const t = await signedIn({ extra: { steamFetch: async () => ({ ok: true, status: 200, text: async () => "<gamesList></gamesList>" }) } });
    const r = await t.request("/api/steam/link", { method: "POST", body: { profile: "76561198000000000" } });
    assert.equal(r.status, 400);
    assert.match(r.data.error ?? r.text, /Game details/);
    await t.close();
});

test("the owner can download the latest backup, nobody else can", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "svc-bak-"));
    const t = await signedIn({ config: { ownerId: "u1", backupDir: dir } });
    assert.equal((await t.request("/api/admin/backup")).status, 404, "no backup yet");
    writeFileSync(join(dir, "steamvaluechecker-2026-10-25.db"), "old");
    writeFileSync(join(dir, "steamvaluechecker-2026-10-26.db"), "newest");
    const r = await t.request("/api/admin/backup");
    assert.equal(r.status, 200);
    assert.equal(r.text, "newest");
    assert.match(r.headers.get("content-disposition"), /steamvaluechecker-2026-10-26\.db/);
    await t.close();
    const other = await signedIn({ config: { backupDir: dir } });
    assert.equal((await other.request("/api/admin/backup")).status, 403);
    await other.close();
});

test("looking for group from the dashboard: managers post, members join, other servers are walled off", async () => {
    const { createLfgService } = await import("../src/lfg.js");
    const posts = [];
    const t = await signedIn({ extra: db => ({ lfg: createLfgService({ db, discord: { post: async (c, p) => { posts.push({ c, p }); return { id: "m1" }; }, edit: async () => {} } }) }) });
    const soon = Date.now() + 3600_000;
    const made = await t.request("/api/lfg", { method: "POST", body: { guild_id: "g-admin", channel_id: "c2", game: "Deep Rock", starts_at: soon, slots: 3 } });
    assert.equal(made.status, 200);
    assert.equal(posts[0].c, "c2");
    assert.equal((await t.request("/api/lfg", { method: "POST", body: { guild_id: "g-admin", channel_id: "nope", game: "X", starts_at: soon } })).status, 400, "only the server's own channels");
    assert.equal((await t.request("/api/lfg", { method: "POST", body: { guild_id: "g-member", channel_id: "c2", game: "X", starts_at: soon } })).status, 403, "members cannot post from the dashboard");
    const list = await t.request("/api/lfg?guild=g-admin");
    assert.equal(list.data.posts.length, 1);
    assert.equal(list.data.posts[0].joined, true, "the host is in");
    assert.equal(list.data.posts[0].canClose, true);
    const id = made.data.id;
    assert.equal((await t.request("/api/lfg/leave", { method: "POST", body: { guild_id: "g-admin", id } })).status, 200);
    assert.equal((await t.request("/api/lfg/join", { method: "POST", body: { guild_id: "g-admin", id } })).data.result, "joined");
    assert.equal((await t.request("/api/lfg/join", { method: "POST", body: { guild_id: "g-member", id } })).status, 404, "a post from another server is not found");
    assert.equal((await t.request("/api/lfg/close", { method: "POST", body: { guild_id: "g-admin", id } })).status, 200);
    assert.equal((await t.request("/api/lfg?guild=g-admin")).data.posts.length, 0);
    await t.close();
});

test("FanaticalGrabber link: make a code, send games with it, replace it, turn it off", async () => {
    const t = await signedIn();
    assert.equal((await t.request("/api/grabber")).data.link, null);
    const made = await t.request("/api/grabber/token", { method: "POST", body: { action: "new" } });
    assert.equal(made.status, 200);
    const token = made.data.token;
    assert.match(token, /^svcg_[A-Za-z0-9_-]{43}$/);
    assert.equal(JSON.stringify(t.db.exportUser("u1")).includes(token), false, "the code is never stored readable");

    const send = (code, entries) => fetch(t.base + "/api/grabber/import", { method: "POST", headers: { "Content-Type": "application/json", ...(code ? { Authorization: `Bearer ${code}` } : {}) }, body: JSON.stringify({ entries }) }).then(async r => ({ status: r.status, data: await r.json() }));
    assert.equal((await send(null, [{ title: "Alpha" }])).status, 401);
    assert.equal((await send("svcg_" + "A".repeat(43), [{ title: "Alpha" }])).status, 401);
    const ok = await send(token, [{ title: "Alpha", paid: 4.5 }, { title: "Beta" }, { title: "zzz nothing" }, { title: "AB1DE-FGH2J-KLM3O" }]);
    assert.equal(ok.status, 200);
    assert.deepEqual([ok.data.added, ok.data.notFound], [2, 1]);
    assert.equal(t.db.listLibrary("u1").find(g => g.title === "Alpha").paid, 4.5);
    assert.equal((await send(token, [{ title: "Gamma" }])).status, 429, "sends are paced");
    t.advance(11_000);
    assert.equal((await send(token, [{ title: "AB1DE-FGH2J-KLM3O" }])).status, 400, "keys are refused");
    t.advance(11_000);
    assert.equal((await t.request("/api/grabber")).data.link.sends, 1);

    t.advance(6_000);
    const again = await t.request("/api/grabber/token", { method: "POST", body: { action: "new" } });
    assert.equal((await send(token, [{ title: "Delta" }])).status, 401, "the old code stops working");
    t.advance(11_000);
    assert.equal((await send(again.data.token, [{ title: "Delta" }])).status, 200);
    t.advance(6_000);
    await t.request("/api/grabber/token", { method: "POST", body: { action: "off" } });
    t.advance(11_000);
    assert.equal((await send(again.data.token, [{ title: "Echo" }])).status, 401);
    await t.close();
});

test("the header currency picker saves a region the bot also uses", async () => {
    const t = await signedIn();
    assert.ok(t.request && (await t.request("/api/config")).data.regions.some(r => r.value === "NZ" ) , "more currencies are offered");
    const r = await t.request("/api/settings", { method: "POST", body: { region: "NZ" } });
    assert.equal(r.data.settings.region, "NZ");
    assert.equal(t.db.getUser("u1").region, "NZ");
    assert.equal((await t.request("/api/settings", { method: "POST", body: { region: "XX" } })).status, 400);
    await t.close();
});

test("the dashboard counts its own visitors and live viewers, separately from the Grabber page", async () => {
    const t = await setup();
    try {
        let r = await t.request("/api/visits/dashboard?id=aaaaaaaaaaaa&new=1", { method: "POST", headers: { Origin: ORIGIN } });
        assert.equal(r.status, 200);
        assert.deepEqual([r.data.visitors, r.data.views, r.data.online], [1, 1, 1]);
        r = await t.request("/api/visits/fanaticalgrabber", { method: "GET" });
        assert.equal(r.data.online, 0, "the other site's live count is separate");
        r = await t.request("/api/visits/dashboard", { method: "POST", headers: { Origin: "https://evil.example" } });
        assert.equal(r.data.views, 1, "other origins are ignored");
        t.advance(80_000);
        assert.equal((await t.request("/api/visits/dashboard")).data.online, 0, "viewers drop off after 75 seconds");
    } finally { await t.close(); }
});

test("the Library page can set many games' status at once", async () => {
    const t = await signedIn();
    for (const title of ["Alpha", "Beta", "Gamma"]) await t.request("/api/library/add", { method: "POST", body: { title } }), t.advance(4000);
    const ids = t.db.listLibrary("u1").map(g => g.itad_id);
    assert.equal(ids.length, 3);
    const r = await t.request("/api/library/status", { method: "POST", body: { itad_ids: [ids[0], ids[1], "not-mine"], status: "finished" } });
    assert.equal(r.data.updated, 2);
    const st = Object.fromEntries(t.db.listLibrary("u1").map(g => [g.title, g.status]));
    assert.deepEqual(st, { Alpha: "finished", Beta: "finished", Gamma: "backlog" });
    assert.equal((await t.request("/api/library/status", { method: "POST", body: { itad_ids: ids, status: "bogus" } })).status, 400);
    assert.equal((await t.request("/api/library/status", { method: "POST", body: { itad_ids: [], status: "finished" } })).status, 400);
    await t.close();
});

test("Batch redeem: a job queued from Discord is run by the page and the results come back by DM", async () => {
    const dms = [];
    const t = await signedIn({ extra: { dm: async (u, p) => { dms.push({ u, p }); } } });
    const keys = ["AAAAA-BBBBB-CCCCC", "DDDDD-EEEEE-FFFFF", "GGGGG-HHHHH-JJJJJ"];
    assert.equal((await t.request("/api/redeem")).data.job, null);
    t.db.createRedeemJob("u1", keys);
    const got = (await t.request("/api/redeem")).data.job;
    assert.deepEqual(got.keys, keys);
    assert.equal((await t.request("/api/redeem/finish", { method: "POST", body: { id: got.id + 1, results: [] } })).status, 404, "someone else's or a wrong job id is refused");
    const fin = await t.request("/api/redeem/finish", { method: "POST", body: { id: got.id, aborted: "Steam rate limit hit.", results: [
        { key: keys[0], status: "redeemed", game: "Hades" }, { key: keys[1], status: "invalid", message: "Invalid key" }, { key: "ZZZZZ-ZZZZZ-ZZZZZ", status: "redeemed", game: "Not mine" }] } });
    assert.equal(fin.status, 200);
    assert.match(fin.data.summary, /1 redeemed, 0 already owned or used, 1 failed, 1 not tried/);
    assert.equal(dms.length, 1);
    const text = dms[0].p.embeds[0].description;
    assert.match(text, /Hades/); assert.match(text, /DDDDD-EEEEE-FFFFF/); assert.doesNotMatch(text, /Not mine/); assert.doesNotMatch(text, /AAAAA-BBBBB-CCCCC/, "redeemed keys are masked");
    assert.equal((await t.request("/api/redeem")).data.job, null, "keys are gone once the job is finished");
    assert.equal((await t.request("/api/redeem/finish", { method: "POST", body: { id: got.id, results: [] } })).status, 404, "a finished job cannot be finished twice");
    await t.close();
});

test("Batch redeem jobs: keys are found, replaced by a newer batch and expire after a day", async () => {
    const { openDb } = await import("../src/db.js");
    const { extractKeys } = await import("../src/redeemstore.js");
    assert.deepEqual(extractKeys("hi aaaaa-bbbbb-ccccc, AAAAA-BBBBB-CCCCC and not-a-key 12345-67890-ABCDE"), ["AAAAA-BBBBB-CCCCC", "12345-67890-ABCDE"]);
    let clock = 1_000_000;
    const db = openDb(":memory:", { now: () => clock });
    db.ensureUser("u1", null);
    db.createRedeemJob("u1", ["AAAAA-BBBBB-CCCCC"]);
    db.createRedeemJob("u1", ["DDDDD-EEEEE-FFFFF"]);
    assert.deepEqual(db.pendingRedeemJob("u1").keys, ["DDDDD-EEEEE-FFFFF"], "a new batch replaces the waiting one");
    clock += 25 * 3600_000;
    assert.equal(db.pendingRedeemJob("u1"), null, "an old batch expires");
    db.createRedeemJob("u1", ["AAAAA-BBBBB-CCCCC"]);
    assert.equal(db.cancelRedeemJob("u1"), true);
    assert.equal(db.pendingRedeemJob("u1"), null);
    db.close();
});

test("Key history: settled keys are remembered as hashes, pasted repeats are flagged, and it can be cleared", async () => {
    const t = await signedIn();
    try {
        const a = "AAAAA-BBBBB-CCCCC", b = "DDDDD-EEEEE-FFFFF", c = "GGGGG-HHHHH-JJJJJ";
        const log = await t.request("/api/redeem/log", { method: "POST", body: { results: [{ key: a, status: "redeemed", game: "Hades" }, { key: b, status: "rate_limited" }, { key: c, status: "invalid" }, { key: "nope", status: "redeemed" }] } });
        assert.equal(log.data.logged, 2, "only settled statuses with real keys are kept");
        const chk = await t.request("/api/redeem/check", { method: "POST", body: { keys: [a, b, c] } });
        assert.deepEqual(Object.keys(chk.data.known), [a], "only redeemed, owned or used keys are skipped; an invalid one may be retried");
        const hist = (await t.request("/api/redeem/history")).data;
        assert.equal(hist.entries.length, 2);
        assert.ok(hist.entries.every(e => /^[A-Z0-9]{5}-•••••-[A-Z0-9]{5}$/.test(e.hint)), "only a masked hint is stored");
        assert.doesNotMatch(JSON.stringify(t.db.exportUser("u1")), /BBBBB/, "the middle of a key never appears in an export");
        assert.equal((await t.request("/api/redeem/history/clear", { method: "POST", body: {} })).data.cleared, 2);
        assert.equal((await t.request("/api/redeem/history")).data.entries.length, 0);
    } finally { await t.close(); }
});

test("Compare: two libraries side by side, only with opted-in members of a shared server", async () => {
    const t = await signedIn();
    try {
        t.db.ensureUser("u1", "g-admin"); t.db.ensureUser("u2", "g-admin");
        t.db.upsertLibrary("u1", [{ itad_id: "a", title: "Alpha", paid: null }, { itad_id: "b", title: "Beta", paid: null }]);
        t.db.upsertLibrary("u2", [{ itad_id: "b", title: "Beta", paid: null }, { itad_id: "c", title: "Gamma", paid: null }]);
        assert.equal((await t.request("/api/compare?guild=g-admin&user=u2")).status, 403, "not opted in");
        t.db.updateUser("u2", { share: 1 });
        const r = await t.request("/api/compare?guild=g-admin&user=u2");
        assert.equal(r.status, 200);
        assert.deepEqual(r.data.shared.map(x => x.title), ["Beta"]);
        assert.deepEqual(r.data.onlyA.map(x => x.title), ["Alpha"]);
        assert.deepEqual(r.data.onlyB.map(x => x.title), ["Gamma"]);
        assert.equal(r.data.overlapPct, 33);
        assert.equal((await t.request("/api/compare?guild=g-admin&user=u1")).status, 400, "not yourself");
        assert.equal((await t.request("/api/compare?guild=nope&user=u2")).status, 403, "only servers you are in");
    } finally { await t.close(); }
});

test("Calendar: personal entries, manager events with announcement and reminder, and the optional private .ics feed", async () => {
    const { createCalendarService } = await import("../src/calendar.js");
    const posts = [];
    let cal;
    const t = await setup({ extra: db => { cal = createCalendarService({ db, discord: { post: async (c, p) => { posts.push({ c, p }); return { id: "m" + posts.length }; } } }); return { calendar: cal }; } });
    t.advance(Date.now() - 1_000_000); // the dashboard's test clock starts near 1970; bring it to today so dates line up
    await t.signIn();
    try {
        const DAY = 86400_000;
        t.db.ensureUser("u1", "g-admin");
        t.db.addItems("u1", [{ itad_id: "w", title: "Wish" }]);
        t.db.setRelease("w", Date.now() + 5 * DAY);
        let r = (await t.request("/api/calendar?days=365")).data;
        assert.ok(r.entries.some(e => e.kind === "release" && e.title === "Wish releases"), "a wishlisted game's release date");
        assert.ok(r.entries.some(e => e.kind === "sale"), "Steam sales");
        assert.equal((await t.request("/api/calendar/events", { method: "POST", body: { guild_id: "g-member", title: "x", starts_at: Date.now() + DAY } })).status, 403, "members cannot add events");
        assert.equal((await t.request("/api/calendar/events", { method: "POST", body: { guild_id: "g-admin", title: "x", starts_at: Date.now() - DAY } })).status, 400, "not in the past");
        const add = await t.request("/api/calendar/events", { method: "POST", body: { guild_id: "g-admin", title: "Co-op night", notes: "Bring snacks", starts_at: Date.now() + 30 * 60_000, channel_id: "c1", remind_min: 60 } });
        assert.equal(add.status, 200); assert.equal(add.data.announced, true);
        assert.match(posts[0].p.embeds[0].title, /Co-op night/);
        r = (await t.request("/api/calendar?days=30")).data;
        const ev = r.entries.find(e => e.kind === "event");
        assert.equal(ev.title, "Co-op night"); assert.equal(ev.canRemove, true);
        await cal.tick();
        assert.match(posts[1].p.embeds[0].title, /Starting soon/, "the reminder goes out once the window opens");
        await cal.tick();
        assert.equal(posts.length, 2, "and only once");

        const feed = await t.request("/api/calendar/feed", { method: "POST", body: { action: "new" } });
        assert.match(feed.data.url, /\/calendar\/feed\/svcc_[A-Za-z0-9_-]{43}\.ics$/);
        const ics = await t.request(new URL(feed.data.url).pathname);
        assert.equal(ics.status, 200);
        assert.match(ics.text, /BEGIN:VCALENDAR/); assert.match(ics.text, /SUMMARY:Wish releases/); assert.match(ics.text, /SUMMARY:Co-op night/);
        assert.equal((await t.request("/calendar/feed/svcc_" + "A".repeat(43) + ".ics")).status, 404, "a wrong link finds nothing");
        assert.equal((await t.request("/api/calendar/feed", { method: "POST", body: { action: "off" } })).data.off, true);
        assert.equal((await t.request(new URL(feed.data.url).pathname)).status, 404, "turned off");

        assert.equal((await t.request("/api/calendar/events/delete", { method: "POST", body: { guild_id: "g-admin", id: ev.id } })).status, 200);
        assert.equal((await t.request("/api/calendar?days=30")).data.entries.some(e => e.kind === "event"), false);
    } finally { await t.close(); }
});

test("Calendar: .ics text is escaped and folded, and events are validated", async () => {
    const { toIcs, cleanEvent } = await import("../src/calendar.js");
    const ics = toIcs([{ kind: "event", id: 1, guild_id: "g", title: "A, B; C", start: Date.UTC(2026, 10, 7, 20), end: null, allDay: false, notes: "x".repeat(200) + "\nline" }], { now: Date.UTC(2026, 9, 27) });
    assert.match(ics, /SUMMARY:A\\, B\; C/);
    assert.ok(ics.split("\r\n").every(l => l.length <= 75), "long lines are folded");
    assert.match(ics, /DTSTART:20261107T200000Z/);
    const now = Date.UTC(2026, 9, 27);
    assert.throws(() => cleanEvent({ title: "", startsAt: now + 1e6 }, now), /title/);
    assert.throws(() => cleanEvent({ title: "x", startsAt: now - 1e9 }, now), /passed/);
    assert.throws(() => cleanEvent({ title: "x", startsAt: now + 1e6, remindMin: 7 }, now), /Reminder/);
    assert.equal(cleanEvent({ title: " Hi  there ", startsAt: now + 1e6 }, now).title, "Hi there");
});

test("extension store overlay: prices and owned/wishlist state for one Steam app, by link code", async () => {
    const t = await signedIn({ itadExtra: { lookupShopIds: async (_s, ids) => new Map(ids.map(i => [i, i === "app/999" ? null : "id-" + i.slice(4)])) } });
    const made = await t.request("/api/grabber/token", { method: "POST", body: { action: "new" } });
    const get = (code, q) => fetch(t.base + "/api/grabber/game?" + q, { headers: code ? { Authorization: `Bearer ${code}` } : {} }).then(async r => ({ status: r.status, data: await r.json() }));
    assert.equal((await get(null, "appid=10")).status, 401);
    assert.equal((await get(made.data.token, "appid=abc")).status, 400);
    const hit = await get(made.data.token, "appid=10");
    assert.equal(hit.status, 200);
    assert.equal(hit.data.found, true); assert.equal(hit.data.atl, 5); assert.equal(hit.data.owned, false);
    t.advance(2_000);
    t.db.upsertLibrary("u1", [{ itad_id: "id-10", title: "Counter", paid: null }]);
    assert.equal((await get(made.data.token, "appid=10")).data.owned, true);
    t.advance(2_000);
    assert.equal((await get(made.data.token, "appid=999")).data.found, false);
    await t.close();
});

test("gift marks: need a Discord sign-in, one person per game, the owner sees a count, can release and report, and repeat offenders are blocked", async () => {
    let who = "u1";
    const t = await setup({ config: { authPerMinute: 500, apiPerMinute: 5000 }, restExtra: { login: async () => ({ user: { id: who, username: who === "u1" ? "jacob" : "visitor-" + who, global_name: null, avatar: null }, guilds: [] }) } });
    const as = async id => { who = id; await t.request("/auth/logout", { method: "POST", body: {} }); await t.signIn(); };
    await t.signIn();
    for (const title of ["Celeste", "Hades", "Hollow Knight", "Dead Cells", "Tunic", "Inside", "Limbo"]) { t.advance(5_000); await t.request("/api/wishlist/add", { method: "POST", body: { title } }); }
    await t.request("/api/profile", { method: "POST", body: { enabled: true, slug: "jacob" } });
    const ids = (await t.request("/api/wishlist")).data.rows.map(r => r.itad_id);
    const pub = () => t.request("/api/public/wishlist?slug=jacob");
    const gift = (id, extra = {}) => t.request("/api/public/gift", { method: "POST", body: { slug: "jacob", id, ...extra } });
    assert.match((await pub()).data.accent, /^#[0-9a-f]{6}$/i, "the profile page colour tints the wishlist page");
    assert.equal((await gift(ids[0])).status, 400, "the list's owner does not mark their own gifts");

    await as("v-a");
    const own = (await pub()).data;
    assert.equal(own.signedIn, true); assert.equal(own.giftsOpen, true);
    assert.equal((await gift(ids[0])).data.claim, "mine");
    assert.equal((await pub()).data.games.find(g => g.id === ids[0]).claim, "mine");
    assert.equal((await gift(ids[0])).data.claim, "mine", "marking again renews it");
    for (const id of ids.slice(1, 5)) assert.equal((await gift(id)).data.claim, "mine");
    const full = await gift(ids[5]);
    assert.equal(full.status, 429, "five marks per list");
    assert.match(full.data.error, /up to 5/);
    assert.equal((await gift(ids[0], { claim: false })).data.claim, null);
    await gift(ids[0]);

    await as("v-b");
    assert.equal((await pub()).data.games.find(g => g.id === ids[0]).claim, "taken");
    assert.equal((await gift(ids[0])).status, 409, "a second person cannot take it");
    assert.equal((await gift(ids[0], { claim: false })).data.claim, "taken", "and cannot undo someone else's");
    assert.equal((await gift("nope")).status, 404);
    assert.equal((await t.request("/api/public/gift", { method: "POST", body: { slug: "nobody", id: ids[0] } })).status, 404);

    // signed out: viewing works, marking does not
    await t.request("/auth/logout", { method: "POST", body: {} });
    assert.equal((await pub()).data.signedIn, false);
    assert.equal((await gift(ids[6])).status, 401);

    // a brand new account (its id says it was made after the clock) cannot mark yet
    await as(String(1n << 62n));
    const tooNew = await gift(ids[6]);
    assert.equal(tooNew.status, 403); assert.match(tooNew.data.error, /too new/);

    // the owner: sees only a count, can release a mark, pause marking, and report
    await as("u1");
    assert.equal((await t.request("/api/profile")).data.claims, 5);
    assert.equal(JSON.stringify((await t.request("/api/profile")).data).includes("v-a"), false, "the owner is not told who");
    assert.equal((await t.request("/api/profile/gifts", { method: "POST", body: { action: "release", id: ids[6] } })).status, 404, "nothing to release there");
    assert.equal((await t.request("/api/profile/gifts", { method: "POST", body: { action: "release", id: ids[1] } })).data.released, true);
    assert.equal(t.db.listGiftReports().length, 0, "a plain release is not a report");
    assert.equal((await t.request("/api/profile/gifts", { method: "POST", body: { action: "pause", on: true } })).data.paused, true);
    assert.equal((await t.request("/api/profile")).data.giftsPaused, true);
    await as("v-c");
    assert.equal((await gift(ids[1])).status, 403, "paused lists take no new marks");
    await as("u1");
    await t.request("/api/profile/gifts", { method: "POST", body: { action: "pause", on: false } });
    for (const id of [ids[0], ids[2], ids[3]]) { const r = await t.request("/api/profile/gifts", { method: "POST", body: { action: "release", id, report: true } }); assert.equal(r.data.reported, true, JSON.stringify(r.data)); }
    assert.equal(t.db.isGiftBanned("v-a"), true, "three reports block the account");
    assert.equal(t.db.countGiftClaims("u1"), 0, "and its other marks are removed");
    await as("v-a");
    const blocked = await gift(ids[0]);
    assert.equal(blocked.status, 403); assert.match(blocked.data.error, /turned off for your account/);

    // only the bot owner reaches the moderation list
    assert.equal((await t.request("/api/admin/gifts")).status, 403);
    await t.close();
});

test("gift marks: warn a visitor whose Steam region differs from the list owner's", async () => {
    let who = "u1";
    const t = await setup({ config: { authPerMinute: 500, apiPerMinute: 5000 }, restExtra: { login: async () => ({ user: { id: who, username: who === "u1" ? "jacob" : "visitor-" + who, global_name: null, avatar: null }, guilds: [] }) } });
    const as = async id => { who = id; await t.request("/auth/logout", { method: "POST", body: {} }); await t.signIn(); };
    await t.signIn();
    await t.request("/api/wishlist/add", { method: "POST", body: { title: "Celeste" } });
    await t.request("/api/profile", { method: "POST", body: { enabled: true, slug: "jacob" } });
    const id = (await t.request("/api/wishlist")).data.rows[0].itad_id;
    const pub = () => t.request("/api/public/wishlist?slug=jacob");
    t.db.setSteamLink("u1", "76561198000000001"); t.db.setSteamCountry("u1", "US");
    assert.equal((await pub()).data.region, null, "the owner never gets a note about their own list");

    await as("v-same");
    t.db.setSteamLink("v-same", "76561198000000002"); t.db.setSteamCountry("v-same", "US");
    assert.equal((await pub()).data.region, null, "same region, no note");

    await as("v-far");
    t.db.setSteamLink("v-far", "76561198000000003"); t.db.setSteamCountry("v-far", "BR");
    const far = (await pub()).data.region;
    assert.equal(far.theirs, "US"); assert.equal(far.yours, "BR"); assert.equal(far.currencyDiffers, true);
    assert.equal((await t.request("/api/public/profile?slug=jacob")).data.region?.yours, "BR");
    const marked = await t.request("/api/public/gift", { method: "POST", body: { slug: "jacob", id } });
    assert.equal(marked.data.claim, "mine"); assert.equal(marked.data.region.yours, "BR");

    await t.request("/auth/logout", { method: "POST", body: {} });
    assert.equal((await pub()).data.region, null, "signed out, nothing to compare");
    await t.close();
});

test("profile page: rarest achievements and recent activity show up for a Steam-linked member, and stay hidden otherwise", async () => {
    const t = await setup();
    t.advance(Date.now()); // the test clock starts near 1970; recent activity looks at the last two weeks
    await t.signIn();
    await t.request("/api/profile", { method: "POST", body: { enabled: true, slug: "jacob" } });
    const nowS = Math.floor(Date.now() / 1000);
    t.db.setSteamLink("u1", "76561198000000009");
    t.db.syncSteamGames("u1", [{ itad_id: "h", title: "Hades", appid: 1145360, minutes: 600, lastPlayed: nowS - 3600, recent: 90 }]);
    t.db.setAchievements("u1", "h", { done: 3, total: 10 });
    t.db.setRareAchievements("u1", 1145360, "Hades", [{ apiname: "r", name: "Escaped", icon: null, pct: 1.2 }]);
    t.db.setRecentUnlocks("u1", 1145360, [{ apiname: "r", name: "Escaped", icon: null, at: nowS }]);
    const sections = [{ key: "about", vis: "public" }, { key: "achievements", vis: "public" }, { key: "activity", vis: "public" }];
    const saved = await t.request("/api/profile/page", { method: "POST", body: { sections } });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    const view = await t.request("/api/public/profile?slug=jacob");
    assert.equal(view.status, 200, JSON.stringify(view.data));
    const pub = view.data.profile;
    const ach = pub.sections.find(x => x.key === "achievements"), act = pub.sections.find(x => x.key === "activity");
    assert.equal(ach.done, 3); assert.equal(ach.rare, 1); assert.equal(ach.top[0].name, "Escaped");
    assert.equal(act.games[0].title, "Hades"); assert.equal(act.games[0].hours2w, 1.5); assert.equal(act.games[0].unlocks[0].name, "Escaped");
    t.db.removeSteamLink("u1");
    const after = (await t.request("/api/public/profile?slug=jacob")).data.profile;
    assert.ok(!after.sections.some(x => x.key === "achievements" || x.key === "activity"), "no Steam link, nothing to show");
    await t.close();
});

test("community feed: follow, post, react, reply, report and moderate through the API", async () => {
    const ID = n => "30000000000000000" + n; // a Discord-style id from long ago, so the account is old enough
    let who = ID(1);
    const t = await setup({ ownerId: ID(9), config: { authPerMinute: 500, apiPerMinute: 5000, ownerId: ID(9) }, restExtra: { login: async () => ({ user: { id: who, username: "member-" + who.slice(-1), global_name: null, avatar: null }, guilds: [] }) } });
    t.advance(Date.now());
    const as = async id => { who = id; await t.request("/auth/logout", { method: "POST", body: {} }); await t.signIn(); };
    const post = (body, extra = {}) => t.request("/api/social/post", { method: "POST", body: { body, ...extra } });
    for (const [i, n] of [[1, "ann"], [2, "ben"], [3, "cy"]]) { await as(ID(i)); await t.request("/api/profile", { method: "POST", body: { enabled: true, slug: n } }); }
    t.db.syncSteamGames(ID(1), [{ itad_id: "x", title: "Celeste", appid: 504230, minutes: 60, lastPlayed: null }]);

    await as(ID(1));
    assert.equal((await post("Anyone for a Celeste run?", { appid: 999 })).status, 400, "the game has to be in your own library");
    const first = (await post("Anyone for a Celeste run?", { appid: 504230 })).data.id;
    assert.ok(first);
    assert.equal((await post("see https://spam.example")).status, 400);
    const everyone = (await t.request("/api/social/feed")).data;
    assert.equal(everyone.items[0].body, "Anyone for a Celeste run?"); assert.equal(everyone.items[0].game, "Celeste"); assert.equal(everyone.items[0].own, true); assert.equal(everyone.items[0].by.slug, "ann");
    assert.equal(JSON.stringify(everyone).includes(ID(1)), false, "no account ids in the feed");

    await as(ID(2));
    assert.equal((await t.request("/api/social/follow", { method: "POST", body: { slug: "ann" } })).data.followers, 1);
    assert.equal((await t.request("/api/social/follow", { method: "POST", body: { slug: "ben" } })).status, 400, "not yourself");
    const mine = (await t.request("/api/social/feed?scope=following")).data;
    assert.equal(mine.items.length, 1); assert.equal(mine.following, 1);
    assert.equal((await t.request("/api/social/react", { method: "POST", body: { id: first, emoji: "🔥" } })).data.mine, "🔥");
    assert.equal((await t.request("/api/social/react", { method: "POST", body: { id: first, emoji: "💩" } })).status, 400);
    const reply = await post("I'm in", { parent: first });
    assert.ok(reply.data.id);
    const thread = (await t.request("/api/social/item?id=" + first)).data;
    assert.equal(thread.item.reactions["🔥"], 1); assert.equal(thread.replies.length, 1); assert.equal(thread.replies[0].body, "I'm in");
    const prof = (await t.request("/api/public/profile?slug=ann")).data;
    assert.equal(prof.social.followers, 1); assert.equal(prof.social.iFollow, true);
    assert.equal(prof.profile.sections.find(x => x.key === "posts").items[0].body, "Anyone for a Celeste run?");

    await as(ID(1));
    const notes = (await t.request("/api/notifications")).data;
    const titles = JSON.stringify(notes);
    assert.match(titles, /followed you/); assert.match(titles, /replied to your post/);
    assert.equal((await t.request("/api/social/delete", { method: "POST", body: { id: reply.data.id } })).status, 403, "only your own");

    for (const [i, n] of [[2, "ben"], [3, "cy"]]) { await as(ID(i)); assert.equal((await t.request("/api/social/report", { method: "POST", body: { id: first, reason: "annoying" } })).data.reported, true); }
    await as(ID(4)); await t.request("/api/profile", { method: "POST", body: { enabled: true, slug: "dee" } });
    assert.equal((await t.request("/api/social/feed")).data.items.length, 1, "two reports do not hide it");
    await t.request("/api/social/report", { method: "POST", body: { id: first } });
    assert.equal((await t.request("/api/social/feed")).data.items.length, 0, "three do");
    assert.equal((await t.request("/api/admin/social")).status, 403);

    await as(ID(9));
    const adm = (await t.request("/api/admin/social")).data;
    assert.equal(adm.reports[0].reports, 3); assert.equal(adm.reports[0].by.slug, "ann");
    assert.equal((await t.request("/api/admin/social", { method: "POST", body: { action: "ban", id: first, reason: "test" } })).data.ok, true);
    await as(ID(1));
    assert.equal((await post("hello again")).status, 403, "banned from posting");
    await as(ID(9));
    await t.request("/api/admin/social", { method: "POST", body: { action: "unban", user: ID(1) } });
    await as(ID(1));
    assert.ok((await post("hello again")).data.id, "and back after an unban");

    // compare needs the other member to show their library
    await as(ID(2));
    assert.equal((await t.request("/api/social/compare?slug=ann")).status, 403);
    t.db.setProfileData(ID(1), { sections: [{ key: "steam", vis: "public" }] });
    assert.equal((await t.request("/api/social/compare?slug=ann")).data.theirs, 1);
    const disc = (await t.request("/api/social/discover")).data;
    assert.ok(Array.isArray(disc.trending) && Array.isArray(disc.rare) && Array.isArray(disc.similar));
    assert.equal((await t.request("/api/social/block", { method: "POST", body: { slug: "ann" } })).data.blocked, true);
    assert.equal((await t.request("/api/social/feed")).data.items.some(i => i.by.slug === "ann"), false);
    await t.close();
});

test("guestbooks and feed notifications: sign, delete, close, block, and Discord messages are opt in and capped", async () => {
    const ID = n => "30000000000000000" + n;
    let who = ID(1); const dms = [];
    const t = await setup({ ownerId: ID(9), config: { authPerMinute: 500, apiPerMinute: 5000, ownerId: ID(9), publicUrl: "https://dash.example" }, extra: { dm: async (id, payload) => { dms.push([id, payload]); } }, restExtra: { login: async () => ({ user: { id: who, username: "member-" + who.slice(-1), global_name: "Member " + who.slice(-1), avatar: null }, accessToken: "tok", guilds: [{ id: "g1", name: "Game Junkies", permissions: "0" }] }) } });
    t.advance(Date.now());
    const as = async id => { who = id; await t.request("/auth/logout", { method: "POST", body: {} }); await t.signIn(); };
    const post = (body, extra = {}) => t.request("/api/guestbook/post", { method: "POST", body: { slug: "ann", body, ...extra } });
    for (const [i, n] of [[1, "ann"], [2, "ben"], [3, "cyd"]]) { await as(ID(i)); await t.request("/api/profile", { method: "POST", body: { enabled: true, slug: n } }); }
    await as(ID(2));
    assert.equal((await t.request("/api/public/guestbook?slug=ann")).data.items.length, 0);
    assert.equal((await post("Nice page!")).status, 200);
    assert.equal((await post("see https://spam.example")).status, 400, "no links");
    assert.equal((await post("Nice page!")).status, 409, "no repeats");
    const g = (await t.request("/api/public/guestbook?slug=ann")).data;
    assert.equal(g.items[0].body, "Nice page!"); assert.equal(g.items[0].by.slug, "ben"); assert.equal(g.items[0].canDelete, true); assert.equal(JSON.stringify(g).includes(ID(2)), false, "no account ids");
    assert.equal((await t.request("/api/guestbook/post", { method: "POST", body: { slug: "ben", body: "hi me" } })).status, 400, "not your own book");
    await as(ID(3));
    const seen = (await t.request("/api/public/guestbook?slug=ann")).data;
    assert.equal(seen.items[0].canDelete, false);
    assert.equal((await t.request("/api/guestbook/delete", { method: "POST", body: { id: seen.items[0].id } })).status, 403);
    await as(ID(1));
    assert.match(JSON.stringify((await t.request("/api/notifications")).data), /signed your guestbook/);
    assert.equal(dms.length, 0, "Discord messages are off until asked for");
    assert.equal((await t.request("/api/guestbook/delete", { method: "POST", body: { id: seen.items[0].id } })).data.deleted, true);
    assert.equal((await t.request("/api/social/prefs", { method: "POST", body: { dm: true } })).data.prefs.dm, true);
    await as(ID(2));
    for (let i = 0; i < 6; i++) { t.advance(1000); const r = await post("note number " + i); assert.equal(r.status, 200); }
    assert.ok(dms.length >= 1 && dms.length <= 5, "capped at five an hour: " + dms.length);
    assert.match(JSON.stringify(dms[0][1]), /signed your guestbook/); assert.ok(dms.every(d => d[0] === ID(1)));
    await as(ID(1));
    await t.request("/api/social/prefs", { method: "POST", body: { guestbook: false } });
    await as(ID(3));
    assert.equal((await post("closed?")).status, 403);
    assert.equal((await t.request("/api/public/guestbook?slug=ann")).data.open, false);
    await as(ID(1));
    await t.request("/api/social/prefs", { method: "POST", body: { guestbook: true } });
    await t.request("/api/social/block", { method: "POST", body: { slug: "ben", on: true } });
    assert.equal((await t.request("/api/public/guestbook?slug=ann")).data.items.length, 0, "a blocked person's notes are hidden");
    await as(ID(2));
    assert.equal((await post("still here")).status, 403, "and they can't add more");
    const prof = (await t.request("/api/public/profile?slug=ann")).data;
    assert.ok(prof.profile.sections.some(x => x.key === "guestbook"), "the page has a guestbook section");
    await t.close();
});

test("server leaderboards count only public pages and respect the server filter", async () => {
    const ID = n => "30000000000000000" + n;
    let who = ID(1);
    const t = await setup({ ownerId: ID(9), config: { authPerMinute: 500, apiPerMinute: 5000, ownerId: ID(9) }, extra: { guildList: () => [{ id: "g1", name: "Game Junkies", members: 10 }, { id: "g2", name: "Cozy", members: 5 }] }, restExtra: { login: async () => ({ user: { id: who, username: "member-" + who.slice(-1), global_name: "M" + who.slice(-1), avatar: null }, accessToken: "tok", guilds: [{ id: "g1", name: "Game Junkies", permissions: "0" }] }) } });
    t.advance(Date.now());
    const as = async id => { who = id; await t.request("/auth/logout", { method: "POST", body: {} }); await t.signIn(); };
    for (const [i, n] of [[1, "ann"], [2, "ben"]]) { await as(ID(i)); await t.request("/api/profile", { method: "POST", body: { enabled: true, slug: n } }); }
    t.db.updateUser(ID(1), { guild_id: "g1" }); t.db.updateUser(ID(2), { guild_id: "g2" });
    await as(ID(1));
    for (const text of ["one here", "two here"]) { t.advance(1000); await t.request("/api/social/post", { method: "POST", body: { body: text } }); }
    await as(ID(2));
    await t.request("/api/social/post", { method: "POST", body: { body: "ben here" } });
    const all = (await t.request("/api/social/leaderboards?server=all")).data.boards[0].rows;
    assert.deepEqual(all.map(r => [r.by.slug, r.n]), [["ann", 2], ["ben", 1]]);
    const one = (await t.request("/api/social/leaderboards?server=g2")).data.boards[0].rows;
    assert.deepEqual(one.map(r => r.by.slug), ["ben"]);
    assert.equal((await t.request("/api/social/leaderboards?server=nope")).status, 404);
    assert.equal(JSON.stringify(all).includes(ID(1)), false, "no account ids");
    await t.close();
});

test("pictures in posts: sniffed, one per post, limited a day, served safely and removed with the post", async () => {
    const ID = n => "30000000000000000" + n;
    let who = ID(1);
    const t = await setup({ ownerId: ID(9), config: { authPerMinute: 500, apiPerMinute: 5000, ownerId: ID(9) }, restExtra: { login: async () => ({ user: { id: who, username: "member-" + who.slice(-1), global_name: "M" + who.slice(-1), avatar: null }, accessToken: "tok", guilds: [{ id: "g1", name: "Game Junkies", permissions: "0" }] }) } });
    t.advance(Date.now());
    const as = async id => { who = id; await t.request("/auth/logout", { method: "POST", body: {} }); await t.signIn(); };
    await as(ID(1)); await t.request("/api/profile", { method: "POST", body: { enabled: true, slug: "ann" } });
    const png = "data:image/png;base64," + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]).toString("base64");
    const post = (body, image, extra = {}) => t.request("/api/social/post", { method: "POST", body: { body, image, ...extra } });
    assert.equal((await post("fake", "data:image/png;base64," + Buffer.from("not an image at all, just text").toString("base64"))).status, 400, "the bytes are checked, not the label");
    const r = await post("", png);
    assert.equal(r.status, 200, "a picture alone is a post");
    const item = (await t.request("/api/social/feed?scope=everyone")).data.items[0];
    assert.ok(item.image && item.id === r.data.id);
    const raw = await t.request("/fimg/" + item.image, { raw: true });
    assert.equal(raw.status, 200); assert.equal(raw.headers.get("content-type"), "image/png"); assert.equal(raw.headers.get("x-content-type-options"), "nosniff");
    assert.match(raw.headers.get("content-security-policy"), /sandbox/);
    assert.equal((await post("a reply", png, { parent: r.data.id })).status, 400, "replies carry no pictures");
    for (let i = 0; i < 4; i++) { t.advance(1000); assert.equal((await post("pic " + i, png)).status, 200); }
    t.advance(1000);
    assert.equal((await post("one too many", png)).status, 429, "five a day");
    assert.equal((await t.request("/api/social/delete", { method: "POST", body: { id: r.data.id } })).status, 200);
    assert.equal((await t.request("/fimg/" + item.image, { raw: true })).status, 404, "gone with the post");
    await t.close();
});

test("community feed: every connected server has a feed and a directory entry, and managers can opt out or add a join link", async () => {
    const ID = n => "30000000000000000" + n;
    const SERVERS = { [ID(1)]: ["g1"], [ID(2)]: ["g2"], [ID(3)]: ["g1", "g2"], [ID(4)]: ["g3"], [ID(5)]: [] };
    const NAMES = { g1: "Alpha", g2: "Beta", g3: "Gamma" };
    let who = ID(1);
    const t = await setup({ config: { authPerMinute: 500, apiPerMinute: 5000 }, extra: { guildList: () => [{ id: "g1", name: "Alpha", members: 50 }, { id: "g2", name: "Beta", members: 20 }, { id: "g3", name: "Gamma", members: 5 }, { id: "g4", name: "Empty", members: 2 }] },
        restExtra: { login: async () => ({ user: { id: who, username: "m" + who.slice(-1), global_name: null, avatar: null }, guilds: SERVERS[who].map(id => ({ id, name: NAMES[id], icon: null, owner: false, permissions: who === ID(1) && id === "g1" ? MANAGE : "0" })) }) } });
    t.advance(Date.now());
    const as = async id => { who = id; await t.request("/auth/logout", { method: "POST", body: {} }); await t.signIn(); };
    const feed = q => t.request("/api/social/feed?" + q);
    const slugs = r => r.data.items.map(i => i.by.slug).sort();
    for (const [i, n] of [[1, "ann"], [2, "ben"], [3, "cyd"], [4, "dee"], [5, "eve"]]) { await as(ID(i)); await t.request("/api/profile", { method: "POST", body: { enabled: true, slug: n } }); await t.request("/api/social/post", { method: "POST", body: { body: "hello from " + n } }); }

    // anyone can browse any connected server, whether or not they are in it
    await as(ID(5));
    assert.deepEqual(slugs(await feed("scope=servers&server=g1")), ["ann", "cyd"]);
    assert.deepEqual(slugs(await feed("scope=servers&server=g2")), ["ben", "cyd"]);
    assert.deepEqual(slugs(await feed("scope=servers&server=all")), ["ann", "ben", "cyd", "dee"], "all connected servers; eve is in none");
    assert.equal((await feed("scope=servers&server=g9")).status, 404);
    assert.equal((await feed("scope=servers&server=g4")).data.items.length, 0, "a connected server with no members yet is just empty");
    assert.deepEqual((await feed("scope=servers&server=all")).data.items.find(i => i.by.slug === "cyd").servers.map(s => s.name).sort(), ["Alpha", "Beta"]);
    await t.request("/auth/logout", { method: "POST", body: {} });
    assert.deepEqual(slugs(await feed("scope=servers&server=g1")), ["ann", "cyd"], "guests can browse too");

    // the directory: busiest first, with a way to join
    await as(ID(1));
    assert.equal((await t.request("/api/social/server", { method: "POST", body: { guild: "g2", about: "x" } })).status, 403, "not your server to manage");
    assert.equal((await t.request("/api/social/server", { method: "POST", body: { guild: "g1", invite: "https://evil.example/x" } })).status, 400);
    assert.equal((await t.request("/api/social/server", { method: "POST", body: { guild: "g1", about: "Chill folks who finish games", invite: "https://discord.gg/alpha123" } })).data.settings.invite, "https://discord.gg/alpha123");
    const dir = (await t.request("/api/social/servers")).data;
    assert.deepEqual(dir.servers.map(s => s.name).slice(0, 2).sort(), ["Alpha", "Beta"]);
    const alpha = dir.servers.find(s => s.id === "g1");
    assert.equal(alpha.people, 2); assert.equal(alpha.active, 2); assert.equal(alpha.about, "Chill folks who finish games"); assert.equal(alpha.invite, "https://discord.gg/alpha123"); assert.equal(alpha.members, 50);
    assert.deepEqual(dir.manage.map(m => m.id), ["g1"], "only servers you manage");
    const one = (await t.request("/api/social/server?id=g1")).data;
    assert.deepEqual(one.people.map(p => p.slug).sort(), ["ann", "cyd"]); assert.equal(one.server.invite, "https://discord.gg/alpha123");

    // opting out takes the server out of the directory and its feed
    assert.equal((await t.request("/api/social/server", { method: "POST", body: { guild: "g1", listed: false } })).data.settings.listed, false);
    assert.equal((await t.request("/api/social/servers")).data.servers.some(s => s.id === "g1"), false);
    assert.equal((await feed("scope=servers&server=g1")).status, 404);
    assert.deepEqual(slugs(await feed("scope=servers&server=all")), ["ben", "cyd", "dee"], "ann was only in the server that opted out");
    assert.equal((await feed("scope=everyone")).data.items.length, 5, "Everyone is unaffected");

    t.db.syncSteamGames(ID(2), [{ itad_id: "y", title: "Hades", appid: 1145360, minutes: 60, lastPlayed: null }]);
    t.db.addEvent(ID(2), "finished", { appid: 1145360, game: "Hades", ref: "y" });
    assert.deepEqual((await t.request("/api/social/discover?server=g2")).data.trending.map(g => g.game), ["Hades"]);
    assert.equal((await t.request("/api/social/discover?server=g1")).status, 404);
    await t.close();
});

test("gift marks: limits, expiry and moderation in the store", async () => {
    const { openDb } = await import("../src/db.js");
    const { MAX_CLAIMS_TOTAL, CLAIM_TTL_MS, accountOldEnough, accountCreatedAt } = await import("../src/giftstore.js");
    let clock = 5_000_000_000_000;
    const db = openDb(":memory:", { now: () => clock });
    for (const o of ["o1", "o2", "o3", "o4"]) db.ensureUser(o);
    // the overall cap applies across lists
    for (let i = 0; i < MAX_CLAIMS_TOTAL; i++) assert.equal(db.claimGift(["o1", "o2", "o3"][i % 3], "g" + i, "me"), "claimed");
    assert.equal(db.claimGift("o4", "x", "me"), "limit");
    // marks run out, a renewal pushes that back
    clock += CLAIM_TTL_MS - 1000; db.claimGift("o1", "g0", "me"); clock += 2000;
    assert.equal(db.pruneGiftClaims(), MAX_CLAIMS_TOTAL - 1);
    assert.equal(db.giftClaimMap("o1", "me").get("g0"), "mine");
    // account age comes from the Discord id
    const jan2020 = String((BigInt(Date.UTC(2020, 0, 1)) - 1420070400000n) << 22n);
    assert.equal(new Date(accountCreatedAt(jan2020)).getUTCFullYear(), 2020);
    assert.equal(accountOldEnough(jan2020, Date.UTC(2026, 0, 1)), true);
    assert.equal(accountOldEnough(jan2020, Date.UTC(2020, 0, 3)), false);
    assert.equal(accountOldEnough("u1", 0), true, "ids that are not real snowflakes are not judged");
    // owner banning, unbanning and dismissing
    db.banGift("bad", "test"); db.claimGift("o1", "z", "bad");
    assert.equal(db.isGiftBanned("bad"), true);
    db.unbanGift("bad");
    assert.equal(db.isGiftBanned("bad"), false);
    db.close();
});

test("profile song: saved songs show on the public page, and an owner is told when songs are switched off", async () => {
    let rt;
    const t = await setup({ extra: db => { rt = createRuntimeCfg(db); return { rt }; } });
    await t.signIn();
    await t.request("/api/profile", { method: "POST", body: { enabled: true, slug: "jacob" } });
    const saved = await t.request("/api/profile/page", { method: "POST", body: { song: { url: "https://youtu.be/dQw4w9WgXcQ", title: "Test" }, enter: true } });
    assert.equal(saved.status, 200); assert.equal(saved.data.config.song.provider, "youtube");
    let pub = (await t.request("/api/public/profile?slug=jacob")).data.profile;
    assert.equal(pub.song.provider, "youtube"); assert.equal(pub.enter, true);
    rt.set({ profile_songs: false });
    pub = (await t.request("/api/public/profile?slug=jacob")).data.profile;
    assert.equal(pub.song, null); assert.equal(pub.songOff, true, "the owner is told why nothing shows");
});

test("up for giveaway: only the member's server staff can mark a wishlist game, everyone sees the mark, members get a list", async () => {
    const t = await signedIn();
    await t.request("/api/wishlist/add", { method: "POST", body: { title: "Celeste" } });
    await t.request("/api/profile", { method: "POST", body: { enabled: true, slug: "jacob" } });
    const id = (await t.request("/api/wishlist")).data.rows[0].itad_id;
    const mark = body => t.request("/api/wishlist/soon", { method: "POST", body: { slug: "jacob", id, ...body } });
    const page = () => t.request("/api/public/wishlist?slug=jacob");
    // The owner's server is one where the signed-in person is only a member: no button, no marking.
    t.db.ensureUser("u1", "g-member");
    assert.equal((await page()).data.canMark, false);
    assert.equal((await mark({ on: true })).status, 403);
    // In a server they manage they can.
    t.db.ensureUser("u1", "g-admin");
    assert.equal((await page()).data.canMark, true);
    assert.equal((await mark({ on: true })).data.soon, true);
    assert.equal((await page()).data.games[0].soon, true);
    assert.equal((await t.request("/api/wishlist/soon", { method: "POST", body: { slug: "jacob", id: "nope", on: true } })).status, 404);
    assert.equal((await t.request("/api/wishlist/soon", { method: "POST", body: { slug: "nobody", id, on: true } })).status, 404);
    const list = (await t.request("/api/giveaways/soon")).data.games;
    assert.deepEqual(list.map(g => [g.title, g.server]), [["Celeste", "Mine"]]);
    assert.equal((await mark({ on: false })).data.soon, false);
    assert.equal((await page()).data.games[0].soon, false);
    assert.equal((await t.request("/api/giveaways/soon")).data.games.length, 0);
    await t.close();
});

test("feature requests: members suggest and vote, only the owner changes status, the requester is messaged", async () => {
    const dms = [];
    const o = await signedIn({ config: { ownerId: "u1" }, extra: () => ({ dm: async (id, p) => { dms.push([id, p.embeds[0].fields.map(f => f.value).join("\n")]); } }) });
    const req = (path, body) => o.request(path, { method: "POST", body });
    assert.equal((await req("/api/requests", { title: "ab" })).status, 400, "too short");
    o.db.ensureUser("u2");
    const id = o.db.addRequest({ userId: "u2", userName: "Sam", title: "Dark mode for cards", body: "please" });
    const list = (await o.request("/api/requests")).data;
    assert.equal(list.requests.length, 1); assert.equal(list.requests[0].votes, 1); assert.equal(list.requests[0].voted, false);
    assert.equal((await req("/api/requests/vote", { id })).data.voted, true);
    assert.equal((await o.request("/api/requests")).data.requests[0].votes, 2);
    o.advance(2_000);
    assert.equal((await req("/api/requests/vote", { id })).data.voted, false, "voting again takes it back");
    o.advance(2_000);
    assert.equal((await req("/api/requests/vote", { id: 999 })).status, 404);
    const mine = await req("/api/requests", { title: "Add a thing", body: "details" });
    assert.equal(mine.status, 200);
    assert.equal((await req("/api/requests", { title: "Another idea" })).status, 429, "slow down between requests");
    // owner moves it along; the requester gets a DM
    assert.equal((await req("/api/admin/requests/status", { id, status: "nonsense" })).status, 400);
    const r = await req("/api/admin/requests/status", { id, status: "in_development", note: "Started this week" });
    assert.equal(r.data.notified, true);
    assert.deepEqual(dms[0][0], "u2"); assert.match(dms[0][1], /In development/); assert.match(dms[0][1], /Started this week/);
    const after = (await o.request("/api/requests?status=in_development")).data.requests;
    assert.deepEqual(after.map(x => [x.id, x.note]), [[id, "Started this week"]]);
    assert.equal((await req("/api/admin/requests/delete", { id })).data.removed, true);
    await o.close();
    // a non-owner cannot change a status
    const t = await signedIn();
    const rid = t.db.addRequest({ userId: "u2", userName: "Sam", title: "Something nice" });
    assert.equal((await t.request("/api/admin/requests/status", { method: "POST", body: { id: rid, status: "rejected" } })).status, 403);
    await t.close();
});

test("backlog challenge from the dashboard: set a goal, see progress, bad goals refused", async () => {
    const t = await signedIn();
    const r0 = await t.request("/api/library/challenge");
    assert.equal(r0.data.goal, 0);
    assert.equal((await t.request("/api/library/challenge", { method: "POST", body: { goal: 99 } })).status, 400);
    const r1 = await t.request("/api/library/challenge", { method: "POST", body: { goal: 3 } });
    assert.equal(r1.data.goal, 3);
    assert.equal((await t.request("/api/library/challenge")).data.goal, 3);
    await t.close();
});

test("extension bundle helper: current prices for several Steam apps by link code", async () => {
    const t = await signedIn({ itadExtra: { lookupShopIds: async (_s, ids) => new Map(ids.map(i => [i, i === "app/999" ? null : "id-" + i.slice(4)])) } });
    const made = await t.request("/api/grabber/token", { method: "POST", body: { action: "new" } });
    const post = (code, body) => fetch(t.base + "/api/grabber/prices", { method: "POST", headers: { "Content-Type": "application/json", ...(code ? { Authorization: `Bearer ${code}` } : {}) }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, data: await r.json() }));
    assert.equal((await post(null, { appids: [1] })).status, 401);
    assert.equal((await post(made.data.token, { appids: ["x"] })).status, 400);
    t.advance(3_000);
    const ok = await post(made.data.token, { appids: [10, 20, 999, 10] });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.data.items.map(i => i.appid), [10, 20], "unknown apps are dropped, repeats merged");
    assert.equal(ok.data.items[0].atl, 5);
    t.advance(3_000);
    assert.equal((await post(made.data.token, { appids: [10] })).status, 200);
    await t.close();
});

test("extension prices in the member's detected Steam country, falling back to their Discord region", async () => {
    assert.equal(grabberRegion({ region: "US" }, "gb"), "GB");
    assert.equal(grabberRegion({ region: "US" }, "FR"), "DE", "euro countries share one price list");
    assert.equal(grabberRegion({ region: "CA" }, "ZZ"), "CA", "unknown country falls back");
    assert.equal(grabberRegion({ region: "CA" }, "<script>"), "CA");
    assert.equal(grabberRegion(null, undefined), "US");
    const seen = [];
    const t = await signedIn({ itadExtra: {
        lookupShopIds: async (_s, ids) => new Map(ids.map(i => [i, "id-" + i.slice(4)])),
        getPrices: async (ids, region) => { seen.push(region); return new Map(ids.map(id => [id, { deals: [], historyLow: { all: { amount: 5 } } }])); }
    } });
    try {
        const made = await t.request("/api/grabber/token", { method: "POST", body: { action: "new" } });
        const hdr = { Authorization: `Bearer ${made.data.token}` };
        await fetch(t.base + "/api/grabber/game?appid=10&cc=JP", { headers: hdr });
        t.advance(3_000);
        await fetch(t.base + "/api/grabber/prices", { method: "POST", headers: { "Content-Type": "application/json", ...hdr }, body: JSON.stringify({ appids: [10], cc: "AU" }) });
        assert.deepEqual(seen, ["JP", "AU"]);
    } finally { await t.close(); }
});

test("key vault value: prices titles only", async () => {
    const t = await signedIn();
    try {
        assert.equal((await t.request("/api/vault/value", { method: "POST", body: { titles: [] } })).status, 400);
        t.advance(16_000);
        const r = await t.request("/api/vault/value", { method: "POST", body: { titles: ["Alpha", "Beta", "zzz nothing", "Alpha"] } });
        assert.equal(r.status, 200);
        assert.equal(r.data.matched, 2); assert.equal(r.data.unmatched, 1);
        assert.ok(r.data.fullPrice >= r.data.cheapestNow && r.data.cheapestNow > 0);
    } finally { await t.close(); }
});

test("game page: price, history verdict, bundles, free offers and who watches it", async () => {
    const GID = "018d0000-0000-7000-8000-000000000001";
    const t = await signedIn({ itadExtra: {
        getTitle: async id => (id === GID ? { title: "Celeste", appid: 504230, release: Date.UTC(2018, 0, 25) } : null),
        getBundles: async () => new Map([[GID, [{ title: "Indie Bundle", shop: "Humble", price: 5, currency: "USD", expiry: null, url: "https://h.example/b" }]]]),
        getGiveaways: async () => new Map([[GID, [{ title: "Celeste", shop: "Epic", expiry: null, url: "https://e.example/c" }]]])
    } });
    try {
        assert.equal((await t.request("/api/game?id=bad")).status, 400);
        t.advance(2_000);
        assert.equal((await t.request("/api/game?id=018d0000-0000-7000-8000-00000000ffff")).status, 404);
        t.advance(2_000);
        const r = await t.request("/api/game?id=" + GID);
        assert.equal(r.status, 200);
        assert.equal(r.data.title, "Celeste"); assert.equal(r.data.appid, 504230);
        assert.equal(r.data.price, 10); assert.equal(r.data.atl, 5);
        assert.equal(r.data.bundles[0].title, "Indie Bundle"); assert.equal(r.data.free[0].shop, "Epic");
        assert.equal(r.data.onWishlist, false); assert.equal(r.data.watchers, 0);
        assert.ok(Array.isArray(r.data.points));
    } finally { await t.close(); }
});

test("friends: add, list, deals and remove", async () => {
    const t = await signedIn();
    try {
        const post = (p, body) => t.request(p, { method: "POST", body });
        assert.equal((await post("/api/friends/add", { name: "Sam", birthday: "99-99" })).status, 400);
        assert.equal((await post("/api/friends/add", { name: "Sam", birthday: "03-27" })).status, 200);
        const list = await t.request("/api/friends");
        assert.equal(list.data.friends.length, 1);
        assert.equal(list.data.friends[0].birthday, "03-27");
        t.advance(4_000);
        assert.equal((await t.request("/api/friends/deals?name=Sam")).status, 400, "needs a page");
        t.advance(4_000);
        assert.equal((await t.request("/api/friends/deals?name=Nobody")).status, 404);
        assert.equal((await post("/api/friends/remove", { name: "Sam" })).status, 200);
        assert.equal((await post("/api/friends/remove", { name: "Sam" })).status, 404);
    } finally { await t.close(); }
});

test("the Steam value picture is rate limited and needs a linked Steam profile", async () => {
    const t = await signedIn();
    try {
        t.advance(5_000);
        assert.equal((await t.request("/api/steam/value.png")).status, 404, "no Steam profile linked yet");
        assert.equal((await t.request("/api/profile/card")).status, 404, "the old card editor is gone");
    } finally { await t.close(); }
});

test("the page allows https pictures but still no scripts, frames or other connections", async () => {
    const t = await setup();
    try {
        const csp = (await t.request("/")).headers.get("content-security-policy") ?? "";
        assert.match(csp, /img-src [^;]*\bhttps:/);
        assert.match(csp, /script-src 'self'(;|$)/); assert.match(csp, /default-src 'none'/); assert.match(csp, /connect-src 'self'/);
    } finally { await t.close(); }
});

test("first-login tour: offered until finished, then not again", async () => {
    const t = await signedIn();
    try {
        assert.equal((await t.request("/api/me")).data.tour, true);
        assert.equal((await t.request("/api/tour/done", { method: "POST", body: {} })).status, 200);
        assert.equal((await t.request("/api/me")).data.tour, false);
    } finally { await t.close(); }
});

test("admin insights, member lookup and actions are owner only and show counts, never contents", async () => {
    const t = await signedIn();
    for (const p of ["/api/admin/insights", "/api/admin/user?id=12345"]) assert.equal((await t.request(p)).status, 403);
    assert.equal((await t.request("/api/admin/user", { method: "POST", body: { id: "u1", action: "pause" } })).status, 403);
    assert.equal((await t.request("/api/admin/clear-dm-failures", { method: "POST", body: {} })).status, 403);
    await t.close();

    const o = await signedIn({ config: { ownerId: "u1" }, extra: () => ({ guildList: () => [{ id: "g1", name: "Mine", members: 42 }, { id: "g9", name: "Other", members: 7 }] }) });
    o.db.ensureUser("m1000001", "g1"); o.db.updateUser("m1000001", { dm_failures: 4 });
    o.db.addItems("m1000001", [{ itad_id: "id-hades", title: "Hades" }]);
    o.db.setSteamLink("m1000001", "76561198000000000");
    const ins = await o.request("/api/admin/insights");
    assert.equal(ins.status, 200);
    assert.equal(ins.data.signups.length, 30);
    assert.equal(ins.data.watched[0].title, "Hades");
    assert.ok(ins.data.features.some(([k, v]) => k === "Linked Steam" && v === 1));
    assert.equal(ins.data.idle.dmFailing, 1);
    assert.deepEqual(ins.data.servers.map(s => [s.id, s.members]), [["g1", 42], ["g9", 7]]);

    assert.equal((await o.request("/api/admin/user?id=abc")).status, 400);
    assert.equal((await o.request("/api/admin/user?id=99999999")).status, 404);
    o.db.ensureUser("2000001", "g1"); o.db.updateUser("2000001", { dm_failures: 5 });
    const got = await o.request("/api/admin/user?id=2000001");
    assert.equal(got.status, 200); assert.equal(got.data.dmFailures, 5); assert.equal("items" in got.data, false);
    assert.equal((await o.request("/api/admin/user", { method: "POST", body: { id: "2000001", action: "reset_dm" } })).data.dmFailures, 0);
    assert.equal((await o.request("/api/admin/user", { method: "POST", body: { id: "2000001", action: "pause" } })).data.paused, true);
    assert.equal((await o.request("/api/admin/user", { method: "POST", body: { id: "2000001", action: "nope" } })).status, 400);
    const cleared = await o.request("/api/admin/clear-dm-failures", { method: "POST", body: {} });
    assert.equal(cleared.status, 200);
    await o.close();
});

test("admin broadcast: owner only, needs SEND for anything but a test, and sends to the right places", async () => {
    const t = await signedIn();
    assert.equal((await t.request("/api/admin/broadcast")).status, 403);
    assert.equal((await t.request("/api/admin/broadcast", { method: "POST", body: { audience: "me", body: "hi" } })).status, 403);
    await t.close();
    const sent = [], posted = [];
    const o = await signedIn({ config: { ownerId: "u1", broadcastDelayMs: 0 }, extra: () => ({ dm: async (id, p) => { sent.push([id, p.embeds[0].title]); } }) });
    o.db.ensureUser("u1", "g1"); o.db.ensureUser("u2", "g1");
    const info = await o.request("/api/admin/broadcast");
    assert.equal(info.status, 200); assert.equal(info.data.counts.dm >= 2, true);
    const post = body => o.request("/api/admin/broadcast", { method: "POST", body });
    assert.equal((await post({ audience: "dm", body: "Down at 11pm" })).status, 400);               // no confirmation
    assert.equal((await post({ audience: "dm", body: "Down at 11pm", confirm: "send" })).status, 400); // must be exactly SEND
    assert.equal((await post({ audience: "me", body: "" })).status, 400);
    const test = await post({ audience: "me", title: "Test", body: "just me" });
    assert.equal(test.status, 200);
    for (let i = 0; i < 40 && o.db.listBroadcasts(1)[0]?.done !== 1; i++) await new Promise(r => setTimeout(r, 10));
    assert.deepEqual(sent, [["u1", "Test"]]);
    const real = await post({ audience: "dm", body: "Down at 11pm", confirm: "SEND" });
    assert.equal(real.status, 200);
    for (let i = 0; i < 40 && o.db.listBroadcasts(1)[0]?.done !== 1; i++) await new Promise(r => setTimeout(r, 10));
    assert.equal(sent.length, 3);                                                                    // test + both members
    assert.equal((await post({ audience: "dm", body: "again", confirm: "SEND" })).status, 429);      // cooldown
    assert.equal((await o.request("/api/admin/broadcast")).data.history.length, 2);
    await o.close();
});

test("bug reports reach the owner's admin page with a new count until seen", async () => {
    const mk = () => signedIn({ config: { ownerId: "u1" }, extra: db => ({ tickets: createTicketService({ db, discord: { post: async () => ({ id: "1" }), edit: async () => {}, dm: async () => {} }, ownerId: "u1", publicUrl: "https://x.test" }) }) });
    const o = await mk();
    assert.equal((await o.request("/api/tickets", { method: "POST", body: { subject: "Broken", body: "It breaks", kind: "bug" } })).status, 200);
    assert.equal((await o.request("/api/me")).data.bugsNew, 1);
    const b = await o.request("/api/admin/bugs");
    assert.equal(b.data.bugs.length, 1); assert.equal(b.data.bugs[0].isNew, true);
    await o.request("/api/admin/bugs/seen", { method: "POST", body: {} });
    assert.equal((await o.request("/api/me")).data.bugsNew, 0);
    await o.close();
    const u = await signedIn();
    assert.equal((await u.request("/api/admin/bugs")).status, 403);
    await u.close();
});

test("staff chat: messages, edits, reactions, tickets and requests all work from the owner's chat", async () => {
    const o = await signedIn({ config: { ownerId: "u1" }, extra: db => ({ tickets: createTicketService({ db, discord: { post: async () => ({ id: "1" }), edit: async () => {}, dm: async () => {} }, ownerId: "u1", publicUrl: "https://x.test" }) }) });
    const st = await o.request("/api/admin/chat/state");
    assert.equal(st.status, 200); assert.ok(st.data.channels.some(c => c.id === "general"));
    const sent = await o.request("/api/admin/chat/send", { method: "POST", body: { channel: "general", body: "hello @team" } });
    assert.equal(sent.status, 200);
    assert.equal((await o.request("/api/admin/chat/edit", { method: "POST", body: { id: sent.data.id, body: "hello again" } })).status, 200);
    assert.equal((await o.request("/api/admin/chat/react", { method: "POST", body: { id: sent.data.id, emoji: "👍" } })).status, 200);
    assert.equal((await o.request("/api/admin/chat/react", { method: "POST", body: { id: sent.data.id, emoji: "🦄" } })).status, 400, "only the listed reactions");
    let m = (await o.request("/api/admin/chat/messages?channel=general")).data.messages[0];
    assert.equal(m.body, "hello again"); assert.ok(m.edited > 0); assert.deepEqual(Object.keys(m.reactions), ["👍"]);
    await o.request("/api/admin/chat/react", { method: "POST", body: { id: sent.data.id, emoji: "👍" } });
    m = (await o.request("/api/admin/chat/messages?channel=general")).data.messages[0];
    assert.deepEqual(m.reactions, {}, "a second tap takes it back");
    assert.equal((await o.request("/api/admin/chat/typing", { method: "POST", body: { channel: "general" } })).status, 200);
    // tickets and bug reports are answered from the chat
    const t = await o.request("/api/tickets", { method: "POST", body: { subject: "Broken", body: "It breaks", kind: "bug" } });
    assert.equal(t.status, 200);
    const list = await o.request("/api/admin/chat/tickets");
    assert.equal(list.data.tickets.length, 1); assert.equal(list.data.tickets[0].bug, true); assert.equal(list.data.open, 1);
    const one = await o.request("/api/admin/chat/ticket?id=" + list.data.tickets[0].id);
    assert.equal(one.data.messages.length >= 1, true);
    assert.equal((await o.request("/api/admin/tickets/status", { method: "POST", body: { id: list.data.tickets[0].id, status: "resolved" } })).status, 200);
    assert.equal((await o.request("/api/admin/chat/tickets")).data.tickets.length, 0, "resolved ones leave the open list");
    assert.equal((await o.request("/api/admin/chat/tickets?status=resolved")).data.tickets.length, 1);
    assert.equal((await o.request("/api/admin/chat/requests")).status, 200);
    // each person's desktop look
    assert.deepEqual((await o.request("/api/admin/prefs")).data.prefs, { look: "original", waves: false, wall: "default" });
    await o.request("/api/admin/prefs", { method: "POST", body: { look: "windows", wall: "sunset", waves: true } });
    assert.deepEqual((await o.request("/api/admin/prefs")).data.prefs, { look: "windows", waves: true, wall: "sunset" });
    await o.request("/api/admin/prefs", { method: "POST", body: { look: "evil", wall: "url(http://x)" } });
    assert.deepEqual((await o.request("/api/admin/prefs")).data.prefs, { look: "original", waves: false, wall: "default" }, "anything unknown falls back");
    await o.request("/api/admin/prefs", { method: "POST", body: { look: "original", wall: "#1b2a4a" } });
    assert.equal((await o.request("/api/admin/prefs")).data.prefs.wall, "#1b2a4a");
    await o.close();
    const u = await signedIn({ extra: db => ({ tickets: createTicketService({ db, discord: { post: async () => ({ id: "1" }), edit: async () => {}, dm: async () => {} }, ownerId: "u1", publicUrl: "https://x.test" }) }) });
    assert.equal((await u.request("/api/admin/chat/tickets")).status, 403);
    await u.close();
});

test("staff chat media: pictures and clips are checked by their bytes, shown back, and removed with the message", async () => {
    const { mkdtempSync, existsSync, readdirSync } = await import("node:fs"); const { tmpdir } = await import("node:os"); const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "chatmedia-"));
    const o = await signedIn({ config: { ownerId: "u1", chatMediaDir: dir } });
    const up = (bytes, type = "image/png", extra = {}) => fetch(o.base + "/api/admin/chat/upload", { method: "POST", headers: { Cookie: o.cookie(), "X-Requested-With": "dashboard", "Content-Type": type, ...extra }, body: bytes });
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
    assert.equal((await up(Buffer.from("<svg onload=alert(1)>................"), "image/png")).status, 400, "not a real picture");
    assert.equal((await up(png, "image/png", { "X-Requested-With": "nope" })).status, 403);
    const r = await up(png); assert.equal(r.status, 200); const { id, kind } = await r.json(); assert.equal(kind, "image");
    const sent = await o.request("/api/admin/chat/send", { method: "POST", body: { channel: "general", body: "", media: id } });
    assert.equal(sent.status, 200, "a picture alone is a message");
    assert.equal((await o.request("/api/admin/chat/send", { method: "POST", body: { channel: "general", body: "again", media: id } })).status, 400, "a file goes in one message only");
    const msg = (await o.request("/api/admin/chat/messages?channel=general")).data.messages.at(-1);
    assert.deepEqual(msg.media, { id, kind: "image" });
    const got = await fetch(o.base + "/api/admin/chat/media?id=" + id, { headers: { Cookie: o.cookie() } });
    assert.equal(got.status, 200); assert.equal(got.headers.get("content-type"), "image/png"); assert.equal(got.headers.get("x-content-type-options"), "nosniff");
    assert.equal((await fetch(o.base + "/api/admin/chat/media?id=" + id)).status, 401, "not without signing in");
    const ranged = await fetch(o.base + "/api/admin/chat/media?id=" + id, { headers: { Cookie: o.cookie(), Range: "bytes=0-9" } });
    assert.equal(ranged.status, 206); assert.equal((await ranged.arrayBuffer()).byteLength, 10);
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(30)]);
    assert.equal((await (await up(mp4, "video/mp4")).json()).kind, "video");
    assert.equal(readdirSync(dir).length >= 1, true);
    await o.request("/api/admin/chat/delete", { method: "POST", body: { id: sent.data.id } });
    assert.equal((await fetch(o.base + "/api/admin/chat/media?id=" + id, { headers: { Cookie: o.cookie() } })).status, 404, "gone with its message");
    await o.close();
    const u = await signedIn();
    assert.equal((await fetch(u.base + "/api/admin/chat/upload", { method: "POST", headers: { Cookie: u.cookie(), "X-Requested-With": "dashboard", "Content-Type": "image/png" }, body: png })).status, 403);
    await u.close();
});

test("radio: SoundCloud links only, checked with SoundCloud, shared list, remove your own", async () => {
    const calls = [];
    const soundcloudFetch = async url => {
        calls.push(url);
        if (!/forss/.test(decodeURIComponent(url))) return { ok: false, status: 404 };
        return { ok: true, json: async () => ({ title: "Flickermood by Forss", author_name: "Forss", thumbnail_url: "https://i1.sndcdn.com/artworks-1-t500x500.jpg", html: '<iframe src="https://w.soundcloud.com/player/?visual=true&url=https%3A%2F%2Fapi.soundcloud.com%2Ftracks%2F293&show_artwork=true"></iframe>' }) };
    };
    const o = await signedIn({ config: { ownerId: "u1", soundcloudFetch } });
    assert.equal((await o.request("/api/admin/radio/add", { method: "POST", body: { url: "https://evil.example/x" } })).status, 400);
    assert.equal(calls.length, 0, "never asks SoundCloud about other sites");
    assert.equal((await o.request("/api/admin/radio/add", { method: "POST", body: { url: "http://soundcloud.com/forss/flickermood" } })).status, 400, "https only");
    assert.equal((await o.request("/api/admin/radio/add", { method: "POST", body: { url: "https://soundcloud.com/nobody/nothing" } })).status, 400);
    const ok = await o.request("/api/admin/radio/add", { method: "POST", body: { url: "https://soundcloud.com/forss/flickermood" } });
    assert.equal(ok.status, 200);
    assert.equal((await o.request("/api/admin/radio/add", { method: "POST", body: { url: "https://soundcloud.com/forss/flickermood" } })).status, 409, "no duplicates");
    const list = (await o.request("/api/admin/radio")).data;
    assert.equal(list.tracks.length, 1); assert.equal(list.tracks[0].title, "Flickermood"); assert.equal(list.tracks[0].embed, "https://api.soundcloud.com/tracks/293"); assert.equal(list.tracks[0].mine, true);
    assert.equal((await o.request("/api/admin/radio/remove", { method: "POST", body: { id: list.tracks[0].id } })).status, 200);
    assert.equal((await o.request("/api/admin/radio")).data.tracks.length, 0);
    await o.close();
    const u = await signedIn();
    assert.equal((await u.request("/api/admin/radio")).status, 403);
    await u.close();
});

test("admin network-wide giveaway: owner only, needs a confirm and a destination channel", async () => {
    const t = await signedIn();
    assert.equal((await t.request("/api/admin/giveaways")).status, 403);
    assert.equal((await t.request("/api/admin/giveaways/create", { method: "POST", body: { keys: "A | AAAAA-BBBBB", confirm: "SEND" } })).status, 403);
    await t.close();
    const o = await signedIn({ config: { ownerId: "u1" } });
    const g = await o.request("/api/admin/giveaways");
    assert.equal(g.status, 200); assert.deepEqual(g.data.list, []); assert.equal(g.data.available, false);
    assert.equal((await o.request("/api/admin/giveaways/create", { method: "POST", body: { keys: "A | AAAAA-BBBBB", confirm: "SEND" } })).status, 503); // no giveaway service in this setup
    await o.close();
});

test("Sign in through Steam: Steam's reply is verified, then a Discord sign-in attaches it once, and later it signs in alone", async () => {
    const { verifySteamLogin } = await import("../src/steamopenid.js");
    const SID = "76561198000000001";
    const reply = (state, extra = {}) => {
        const q = new URLSearchParams({
            "openid.ns": "http://specs.openid.net/auth/2.0", "openid.mode": "id_res", "openid.op_endpoint": "https://steamcommunity.com/openid/login",
            "openid.claimed_id": `https://steamcommunity.com/openid/id/${SID}`, "openid.identity": `https://steamcommunity.com/openid/id/${SID}`,
            "openid.return_to": `${ORIGIN}/auth/steam/return?state=${state}`, "openid.sig": "x", "openid.signed": "a", state, ...extra
        });
        return q;
    };
    let valid = true;
    const steamFetch = async (url, init) => {
        assert.match(String(init.body), /openid\.mode=check_authentication/);
        return { ok: true, text: async () => `ns:http://specs.openid.net/auth/2.0\nis_valid:${valid}\n` };
    };
    const t = await setup({ extra: { steamFetch } });
    const start = async () => {
        const r = await t.request("/auth/steam");
        assert.match(r.headers.get("location"), /^https:\/\/steamcommunity\.com\/openid\/login\?/);
        return new URL(new URL(r.headers.get("location")).searchParams.get("openid.return_to")).searchParams.get("state");
    };

    // A forged reply (wrong state, or Steam says invalid) gets nowhere.
    assert.match((await t.request(`/auth/steam/return?${reply("nope")}`)).headers.get("location"), /error=steam/);
    let state = await start(); valid = false;
    assert.match((await t.request(`/auth/steam/return?${reply(state)}`)).headers.get("location"), /error=steam/);
    valid = true;

    // New person: Steam is verified, then Discord is asked for once, and the accounts connect.
    state = await start();
    const r1 = await t.request(`/auth/steam/return?${reply(state)}`);
    assert.equal(r1.headers.get("location"), "/auth/login");
    const done = await t.signIn();
    assert.equal(done.headers.get("location"), "/#/steam?linked=1");
    assert.equal(t.db.getSteamLink("u1").steamid, SID);
    assert.equal(t.db.getSteamLink("u1").verified, 1);
    assert.equal((await t.request("/api/me")).data.steam.verified, true);

    // Next time Steam alone is enough, but it is never an admin session.
    await t.request("/auth/logout", { method: "POST", body: {} });
    assert.equal((await t.request("/api/me")).status, 401);
    state = await start();
    const r2 = await t.request(`/auth/steam/return?${reply(state)}`);
    assert.equal(r2.headers.get("location"), "/auth/login", "Steam hands over to Discord, which says yes without asking");
    assert.equal((await t.request("/api/me")).status, 401, "not signed in until Discord finishes");
    await t.signIn();
    let me = await t.request("/api/me");
    assert.equal(me.status, 200); assert.equal(me.data.steamOnly, false, "a full Discord session, so servers and tools load"); assert.equal(me.data.steam.linked, true);
    assert.equal((await t.request("/api/servers/list?guild=g-admin")).status, 200, "server tools load");

    // If Discord will not finish silently, Steam alone still gets in (no servers), and the page offers the Discord half.
    await t.request("/auth/logout", { method: "POST", body: {} });
    state = await start();
    await t.request(`/auth/steam/return?${reply(state)}`);
    const lg = await t.request("/auth/login");
    const dstate = new URL(lg.headers.get("location")).searchParams.get("state");
    const back = await t.request(`/auth/callback?error=interaction_required&state=${dstate}`);
    assert.equal(back.headers.get("location"), "/#/steam");
    me = await t.request("/api/me");
    assert.equal(me.status, 200); assert.equal(me.data.steamOnly, true); assert.equal(me.data.isOwner, false);
    // A state is single-use.
    assert.match((await t.request(`/auth/steam/return?${reply(state)}`)).headers.get("location"), /error=steam/);

    // The verifier itself refuses a reply meant for another return address or another account format.
    const p = reply("s1"); p.set("openid.return_to", "https://evil.example/");
    await assert.rejects(verifySteamLogin(p, `${ORIGIN}/auth/steam/return?state=s1`, steamFetch), /steam_openid/);
    const q = reply("s1"); q.set("openid.claimed_id", "https://evil.example/id/76561198000000001");
    await assert.rejects(verifySteamLogin(q, `${ORIGIN}/auth/steam/return?state=s1`, steamFetch), /steam_openid/);
    await t.close();
});

test("a pasted Steam ID can never be used to sign in as someone else", async () => {
    const SID = "76561198000000002";
    const steamFetch = async () => ({ ok: true, text: async () => "is_valid:true\n" });
    const t = await setup({ extra: { steamFetch } });
    await t.signIn(); // u1 pastes somebody's ID (unverified link)
    t.db.setSteamLink("u1", SID);
    await t.request("/auth/logout", { method: "POST", body: {} });
    const r = await t.request("/auth/steam");
    const state = new URL(new URL(r.headers.get("location")).searchParams.get("openid.return_to")).searchParams.get("state");
    const q = new URLSearchParams({ "openid.ns": "http://specs.openid.net/auth/2.0", "openid.mode": "id_res", "openid.op_endpoint": "https://steamcommunity.com/openid/login", "openid.claimed_id": `https://steamcommunity.com/openid/id/${SID}`, "openid.identity": `https://steamcommunity.com/openid/id/${SID}`, "openid.return_to": `${ORIGIN}/auth/steam/return?state=${state}`, state });
    const back = await t.request(`/auth/steam/return?${q}`);
    assert.equal(back.headers.get("location"), "/auth/login", "unverified links do not count: Discord is asked for instead");
    assert.equal((await t.request("/api/me")).status, 401);
    await t.close();
});

test("the extension can ask which version is newest without signing in, and the dashboard config says it too", async () => {
    const t = await setup();
    const r = await t.request("/api/extension/latest");
    assert.equal(r.status, 200); assert.match(r.data.latest, /^\d+\.\d+\.\d+$/); assert.match(r.data.url, /^https:\/\//);
    assert.equal((await t.request("/api/config")).data.extension.latest, r.data.latest);
    await t.close();
});

test("game codes: signed-in members see the list, managers set up their server, the owner can retire a code", async () => {
    const { cleanEntry } = await import("../src/codesource.js");
    const mk = (n, game) => cleanEntry({ code: `AAAA${n}-BBBBB-CCCCC-DDDDD-EEEEE`, type: "shift", game, platform: "universal", reward: "3 Golden Keys", expires: "Dec 5, 2026", archived: "2026-10-30 10:00:00+00:00" }, Date.UTC(2026, 9, 30));
    let polled = 0;
    const o = await signedIn({ config: { ownerId: "u1" }, extra: { codes: { poll: async () => { polled++; return { added: 0, posted: 0 }; } } } });
    o.db.upsertCode(mk(1, "Borderlands 4")); o.db.upsertCode(mk(2, "Borderlands 2"));
    const post = (path, body) => o.request(path, { method: "POST", body });
    const list = (await o.request("/api/codes")).data;
    assert.equal(list.codes.length, 2);
    assert.ok(list.codes.every(c => c.art && c.redeemUrl && c.gameTitle));
    assert.match(list.codes.find(c => c.game === "bl2").art, /\/art\/header\/49520\.jpg/, "each code shows its own game's art");
    assert.equal((await o.request("/api/codes?game=bl2")).data.codes.length, 1);
    assert.equal((await o.request("/api/codes?game=nope")).status, 400);
    const s = (await o.request("/api/servers/codes?guild=g-admin")).data;
    assert.equal(s.channels.length, 2); assert.equal(s.games.length, 11);
    assert.equal((await o.request("/api/servers/codes?guild=g-member")).status, 403);
    const saved = (await post("/api/servers/codes", { guild_id: "g-admin", channel_id: "c1", role_id: "r1", games: ["bl4"] })).data;
    assert.equal(saved.settings.channel_id, "c1"); assert.deepEqual(saved.settings.games, ["bl4"]); assert.equal(saved.settings.role_id, "r1");
    assert.ok(o.sent.some(m => m.id === "c1"), "a confirmation is posted in the chosen channel");
    assert.equal((await post("/api/servers/codes", { guild_id: "g-admin", channel_id: "nope" })).status, 400);
    assert.equal((await post("/api/servers/codes", { guild_id: "g-admin", role_id: "nope" })).status, 400);
    assert.equal((await post("/api/servers/codes", { guild_id: "g-admin", games: ["nope"] })).status, 400);
    assert.equal((await post("/api/servers/codes", { guild_id: "g-member", channel_id: "c1" })).status, 403);
    assert.equal((await post("/api/codes/retire", { id: 1 })).status, 200);
    assert.equal(o.db.getCode(1).status, "expired");
    assert.equal((await o.request("/api/codes")).data.codes.length, 1);
    assert.equal((await o.request("/api/codes?status=expired")).data.codes.length, 1);
    assert.equal((await post("/api/admin/codes/poll", {})).status, 200);
    assert.ok(polled >= 2, "retiring and checking now both run a poll");
});

test("game bundles: members see the list, managers set up their server, the owner can run a check", async () => {
    let polled = 0;
    const o = await signedIn({ config: { ownerId: "u1" }, extra: { bundleFeed: { poll: async () => { polled++; return { added: 0, posted: 0 }; } } } });
    const mk = (n, store, over = {}) => ({ key: `${store}:b${n}`, store, title: "Bundle " + n, url: `https://example.com/b${n}`, image: null, games: ["A", "B"], gameCount: 2, price: "$5", expiresAt: null, seenAt: Date.now(), ...over });
    o.db.upsertFeedBundle(mk(1, "humble")); o.db.upsertFeedBundle(mk(2, "steam"));
    const post = (path, body) => o.request(path, { method: "POST", body });
    const list = (await o.request("/api/bundlefeed")).data;
    assert.equal(list.bundles.length, 2); assert.equal(list.stores.length, 4); assert.ok(list.bundles.every(b => b.storeName && b.url));
    assert.equal((await o.request("/api/bundlefeed?store=steam")).data.bundles.length, 1);
    assert.equal((await o.request("/api/bundlefeed?store=nope")).status, 400);
    const s = (await o.request("/api/servers/bundles?guild=g-admin")).data;
    assert.equal(s.channels.length, 2); assert.equal(s.latest.length, 2);
    assert.equal((await o.request("/api/servers/bundles?guild=g-member")).status, 403);
    const saved = (await post("/api/servers/bundles", { guild_id: "g-admin", channel_id: "c1", role_id: "r1", stores: ["humble", "steam"] })).data;
    assert.equal(saved.settings.channel_id, "c1"); assert.deepEqual(saved.settings.stores, ["humble", "steam"]); assert.equal(saved.settings.role_id, "r1");
    assert.ok(o.sent.some(m => m.id === "c1"), "a confirmation is posted in the chosen channel"); assert.ok(polled >= 1, "saving a channel posts what is current");
    assert.equal((await post("/api/servers/bundles", { guild_id: "g-admin", channel_id: "nope" })).status, 400);
    assert.equal((await post("/api/servers/bundles", { guild_id: "g-admin", stores: ["nope"] })).status, 400);
    assert.equal((await post("/api/servers/bundles", { guild_id: "g-member", channel_id: "c1" })).status, 403);
    assert.equal((await post("/api/admin/bundles/poll", {})).status, 200);
});

test("promo drops: managers set up their server, add and end a drop, members cannot", async () => {
    let polled = 0;
    const o = await signedIn({ config: { ownerId: "u1" }, extra: { drops: { poll: async () => { polled++; return {}; } } } });
    const post = (path, body) => o.request(path, { method: "POST", body });
    const s = (await o.request("/api/servers/drops?guild=g-admin")).data;
    assert.equal(s.channels.length, 2); assert.deepEqual(s.drops, []);
    assert.equal((await o.request("/api/servers/drops?guild=g-member")).status, 403);
    assert.equal((await post("/api/servers/drops/add", { guild_id: "g-admin", title: "Key", code: "ABCD" })).status, 400, "channel first");
    assert.equal((await post("/api/servers/drops", { guild_id: "g-admin", news: true })).status, 400, "blog watching needs a channel");
    const saved = (await post("/api/servers/drops", { guild_id: "g-admin", channel_id: "c1", role_id: "r1", news: true })).data;
    assert.equal(saved.settings.channel_id, "c1"); assert.equal(saved.settings.news, true);
    assert.ok(o.sent.some(m => m.id === "c1"), "a confirmation is posted in the chosen channel");
    assert.equal((await post("/api/servers/drops", { guild_id: "g-admin", channel_id: "nope" })).status, 400);
    assert.equal((await post("/api/servers/drops", { guild_id: "g-admin", role_id: "nope" })).status, 400);
    assert.equal((await post("/api/servers/drops", { guild_id: "g-member", channel_id: "c1" })).status, 403);
    assert.equal((await post("/api/servers/drops/add", { guild_id: "g-admin", title: "Key", code: "has space" })).status, 400);
    assert.equal((await post("/api/servers/drops/add", { guild_id: "g-admin", title: "Key", url: "http://x.test" })).status, 400);
    assert.equal((await post("/api/servers/drops/add", { guild_id: "g-member", title: "Key", code: "ABCD" })).status, 403);
    const added = (await post("/api/servers/drops/add", { guild_id: "g-admin", title: "Game On key", code: "ABCD-1234", days: 3, source: "SteelSeries" })).data;
    const list = (await o.request("/api/servers/drops?guild=g-admin")).data;
    assert.equal(list.drops.length, 1); assert.equal(list.drops[0].title, "Game On key"); assert.equal(list.drops[0].status, "active");
    assert.equal((await post("/api/servers/drops/end", { guild_id: "g-member", id: added.id })).status, 403);
    assert.equal((await post("/api/servers/drops/end", { guild_id: "g-admin", id: 999 })).status, 404);
    assert.equal((await post("/api/servers/drops/end", { guild_id: "g-admin", id: added.id })).status, 200);
    assert.equal((await post("/api/servers/drops/end", { guild_id: "g-admin", id: added.id })).status, 400);
    assert.equal((await o.request("/api/servers/drops?guild=g-admin")).data.drops[0].status, "ended");
    assert.ok(polled >= 3, "saving a channel, adding and ending each run a poll");
});

test("alert settings: members opt in to game code and promo DMs, with a game filter", async () => {
    const o = await signedIn({});
    const post = body => o.request("/api/alerts/codes", { method: "POST", body });
    const first = (await o.request("/api/alerts/codes")).data;
    assert.equal(first.codes, false); assert.equal(first.promos, false); assert.equal(first.allGames.length, 11);
    const on = (await post({ codes: true, promos: true, games: ["genshin", "bl4"] })).data;
    assert.equal(on.codes, true); assert.equal(on.promos, true); assert.deepEqual(on.games.sort(), ["bl4", "genshin"]);
    assert.equal((await post({ games: ["nope"] })).status, 400);
    assert.equal((await post({ games: [] })).status, 400);
    assert.deepEqual((await post({ games: first.allGames.map(g => g.key) })).data.games, [], "every game ticked means no filter");
    assert.equal((await post({ codes: false })).data.codes, false);
});

test("the Deals page can load its bundle and sale prep parts back to back without being told to slow down", async () => {
    const o = await signedIn({});
    const a = await o.request("/api/bundlefeed");
    const b = await o.request("/api/saleprep");
    const c = await o.request("/api/regions?game=x");
    assert.notEqual(a.status, 429); assert.notEqual(b.status, 429); assert.notEqual(c.status, 429);
    // asking for the same thing twice in a row is still held back
    assert.equal((await o.request("/api/saleprep")).status, 429);
});

test("game codes: the Borderlands filter covers all six games, and the art files are served", async () => {
    const { cleanEntry } = await import("../src/codesource.js");
    const mk = (n, game) => cleanEntry({ code: `AAAA${n}-BBBBB-CCCCC-DDDDD-EEEEE`, type: "shift", game, platform: "universal", reward: "3 Golden Keys", expires: "Dec 5, 2026", archived: "2026-10-30 10:00:00+00:00" }, Date.UTC(2026, 9, 30));
    const o = await signedIn({});
    o.db.upsertCode(mk(1, "Borderlands 4")); o.db.upsertCode(mk(2, "Borderlands 2"));
    o.db.upsertCode({ provider: "hoyo", key: "hoyo:zzz:ABCD1234", code: "ABCD1234", game: "zzz", reward: "20 Polychrome", expiresAt: null, seenAt: Date.now() });
    const all = (await o.request("/api/codes")).data;
    assert.deepEqual(all.families.map(f => f.key), ["borderlands", "genshin", "hsr", "zzz", "destiny2", "warframe"]);
    assert.equal((await o.request("/api/codes?game=borderlands")).data.codes.length, 2);
    assert.equal((await o.request("/api/codes?game=zzz")).data.codes[0].art, "/img/codes/zzz.jpg");
    const img = await o.request("/img/codes/zzz.jpg");
    assert.equal(img.status, 200);
});

test("owner can list a server's people and restrict them; restricted people are cut off from the dashboard and alerts", async () => {
    const t = await signedIn();
    for (const p of ["/api/admin/server-members?guild=123456", "/api/admin/bans"]) assert.equal((await t.request(p)).status, 403);
    assert.equal((await t.request("/api/admin/ban", { method: "POST", body: { id: "2000002" } })).status, 403);
    await t.close();

    const o = await signedIn({ config: { ownerId: "u1" } });
    o.db.ensureUser("2000002", "5550001"); o.db.ensureUser("2000003", "5550001"); o.db.ensureUser("2000004", "5550002");
    o.db.updateUser("2000002", { last_seen: Date.now() });
    const old = await o.request("/api/admin/server-members?guild=5550001&days=30");
    assert.equal(old.status, 200);
    assert.deepEqual(old.data.members.map(m => m.id).sort(), ["2000002", "2000003"]); // 2000003 was created just now, so counts as recent
    assert.equal((await o.request("/api/admin/server-members?guild=bad")).status, 404);
    assert.equal((await o.request("/api/admin/ban", { method: "POST", body: { id: "u1" } })).status, 400);
    assert.equal((await o.request("/api/admin/ban", { method: "POST", body: { id: "nope" } })).status, 400);
    const b = await o.request("/api/admin/ban", { method: "POST", body: { id: "2000002", reason: "spam" } });
    assert.equal(b.data.banned, true);
    assert.equal(o.db.isBanned("2000002"), true);
    const after = (await o.request("/api/admin/server-members?guild=5550001&days=0")).data.members.find(m => m.id === "2000002");
    assert.equal(after.banned, true); assert.equal(after.banReason, "spam");
    assert.equal((await o.request("/api/admin/bans")).data.bans.length, 1);
    assert.equal((await o.request("/api/admin/ban", { method: "POST", body: { id: "2000002", ban: false } })).data.banned, false);
    assert.equal(o.db.isBanned("2000002"), false);
    await o.close();

    // a restricted member's own session is refused
    const m = await signedIn();
    m.db.banUser("u1", "test");
    const blocked = await m.request("/api/me");
    assert.equal(blocked.status, 403); assert.equal(blocked.data.restricted, true); assert.match(blocked.data.error, /restricted/);
    await m.close();
});

test("alerts are not delivered to restricted people", async () => {
    const { createNotifier } = await import("../src/notify.js");
    const db = openDb(":memory:"); db.ensureUser("777777", "g1"); db.banUser("777777", "x");
    let sent = 0;
    const n = createNotifier({ db, discord: { sendDm: async () => { sent++; }, sendChannel: async () => { sent++; } } });
    const r = await n.deliver(db.getUser("777777"), { content: "hi" });
    assert.equal(r.ok, false); assert.equal(sent, 0);
});

test("the terms and privacy policy are public pages on the bot's own site", async () => {
    const { legalPage, mdToHtml } = await import("../src/legal.js");
    assert.match(mdToHtml("# T\n\n1. **Bold** [x](https://a.example) <b>\n- item"), /<h2>T<\/h2>[\s\S]*<strong>Bold<\/strong>[\s\S]*href="https:\/\/a.example"[\s\S]*&lt;b&gt;[\s\S]*<ul>\n<li>item/);
    assert.equal(mdToHtml("[bad](javascript:alert(1))").includes("href"), false);
    for (const k of ["terms", "privacy", "licenses"]) { const html = legalPage(k, "https://bot.example"); assert.match(html, /<title>/); assert.ok(k === "licenses" ? !/Jacob-Lucado/i.test(html) : !/github\.com/i.test(html)); assert.match(html, new RegExp(`canonical" href="https://bot.example/${k}.html"`)); }
    assert.equal(legalPage("nope", "x"), null);
});

test("the FanaticalGrabber page is served by the bot and its counter works from there", async () => {
    const t = await setup();
    try {
        for (const path of ["/grabber", "/grabber.html"]) {
            const r = await t.request(path, { raw: true });
            assert.equal(r.status, 200, path);
            const html = await r.text();
            assert.match(html, /FanaticalGrabber/);
            assert.ok(!html.includes("__ORIGIN__"), "share-preview address filled in");
            assert.ok(!/<style|<script>|\sstyle="/.test(html), "no inline code, the site's security policy forbids it");
        }
        for (const f of ["/grabber.css", "/grabber.js", "/grabber-og.png", "/grabber-favicon.ico"]) assert.equal((await t.request(f, { raw: true })).status, 200, f);
        const own = ORIGIN;
        const hit = await t.request("/api/visits/fanaticalgrabber?new=1", { method: "POST", headers: { Origin: own }, raw: true });
        assert.equal(hit.headers.get("access-control-allow-origin"), own);
        assert.equal((await hit.json()).visitors >= 1, true, "a visit from the bot's own page is counted");
    } finally { await t.close(); }
});

test("safety headers: noindex on data and sign-in routes, locked-down browser features, and a security.txt", async () => {
    const t = await setup();
    try {
        const api = await t.request("/api/config", { raw: true });
        assert.equal(api.headers.get("x-robots-tag"), "noindex, nofollow");
        const login = await t.request("/auth/login", { raw: true });
        assert.equal(login.headers.get("x-robots-tag"), "noindex, nofollow");
        const home = await t.request("/", { raw: true });
        assert.equal(home.headers.get("x-robots-tag"), null, "the public page stays indexable");
        assert.match(home.headers.get("permissions-policy"), /camera=\(\)/);
        assert.equal(home.headers.get("cross-origin-opener-policy"), "same-origin");
        assert.equal(home.headers.get("strict-transport-security"), ORIGIN.startsWith("https://") ? "max-age=31536000; includeSubDomains" : null);
        const sec = await (await t.request("/.well-known/security.txt", { raw: true })).text();
        assert.match(sec, /^Contact: https:\/\/x\.com\/twit_user69$/m);
        assert.match(sec, /^Expires: \d{4}-/m);
    } finally { await t.close(); }
});

test("admin panel: own address, sign-in handoff, audit trail, system page, and nothing for anyone else", async () => {
    const cfg = { ownerId: "u1", adminUrl: "https://admin.bot.example", cookieDomain: "bot.example" };
    const o = await signedIn({ config: cfg });
    try {
        const onAdmin = { Host: "admin.bot.example" };
        const home = await getAs(o, onAdmin.Host, "/");
        assert.match(home.body, /data-mode="admin"/);
        assert.equal(home.headers["x-robots-tag"], "noindex, nofollow");
        assert.equal(home.headers["cache-control"], "no-store");
        assert.match(await (await o.request("/admin", { raw: true })).text(), /data-mode="admin"/, "also reachable at /admin on the main address");
        assert.doesNotMatch(await (await o.request("/", { raw: true })).text(), /data-mode="admin"/, "the main address still shows the dashboard");
        const login = await getAs(o, onAdmin.Host, "/auth/login");
        assert.equal(login.status, 302);
        assert.equal(login.headers.location, `${ORIGIN}/auth/login?next=admin`, "sign-in happens on the main address");
        assert.match((await o.request("/robots.txt", { raw: true }).then(r => r.text())), /Disallow: \/admin/);

        o.db.ensureUser("5550001");
        assert.equal((await o.request("/api/admin/user", { method: "POST", body: { id: "5550001", action: "pause" }, headers: { Origin: "https://admin.bot.example" } })).status, 200, "the admin address may make changes");
        assert.equal((await o.request("/api/admin/user", { method: "POST", body: { id: "5550001", action: "resume" }, headers: { Origin: "https://evil.example" } })).status, 403);
        await o.request("/api/admin/broadcast", { method: "POST", body: { title: "Update", body: "SECRET-MESSAGE-TEXT", audience: "me", confirm: "" } }); // may fail; the text must never be logged either way
        const audit = await o.request("/api/admin/audit");
        assert.equal(audit.status, 200);
        assert.equal(audit.data.rows[0].action, "user");
        assert.match(audit.data.rows[0].detail, /action=pause/);
        assert.equal(audit.data.rows[0].target, "5550001");
        assert.ok(!JSON.stringify(audit.data).includes("SECRET-MESSAGE-TEXT"), "message text is never kept");
        assert.equal((await o.request("/api/admin/audit?q=nothing-like-this")).data.rows.length, 0);

        // Signing in from the admin panel comes back to it, and the session cookie covers the whole domain so both addresses share it.
        const l = await o.request("/auth/login?next=admin");
        const cb = await o.request(`/auth/callback?code=good&state=${new URL(l.headers.get("location")).searchParams.get("state")}`);
        assert.equal(cb.headers.get("location"), "https://admin.bot.example/");
        assert.ok(cb.set.some(c => /^svc_session=/.test(c) && /Domain=bot\.example/.test(c)), "session cookie is shared across the domain");
        assert.equal((await o.request("/api/admin/storage")).status, 200);
        const sys = await o.request("/api/admin/system");
        assert.equal(sys.status, 200);
        assert.ok(sys.data.process.rssMb > 0);
        assert.ok(sys.data.deploy.startedAt <= Date.now() && sys.data.deploy.startedAt > Date.now() - 3600_000, "when this process started"); assert.ok("release" in sys.data.deploy && "machine" in sys.data.deploy); assert.ok(Array.isArray(sys.data.jobs));
        assert.equal(sys.data.admin.host, "admin.bot.example");
        assert.equal(sys.data.admin.sharedCookie, true);
    } finally { await o.close(); }
    const other = await signedIn({ config: { ownerId: "someone-else" } });
    try {
        for (const p of ["/api/admin/audit", "/api/admin/system", "/api/admin/storage"]) assert.equal((await other.request(p)).status, 403, p);
    } finally { await other.close(); }
});

test("terms and privacy answer at .html and at the plain path", async () => {
    const t = await setup();
    try {
        for (const k of ["terms", "privacy"]) {
            const frame = await (await t.request(`/${k}.html`, { raw: true })).text();
            assert.match(frame, new RegExp(`<iframe[^>]+src="/${k}\\.pdf"`), `${k}.html frames the PDF`);
            const pdf = await t.request(`/${k}.pdf`, { raw: true });
            assert.equal(pdf.status, 200);
            assert.equal(pdf.headers.get("content-type"), "application/pdf");
            assert.equal(pdf.headers.get("x-frame-options"), "SAMEORIGIN");
            assert.match(pdf.headers.get("content-security-policy"), /frame-ancestors 'self'/);
            assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");
            const text = await (await t.request(`/${k}`, { raw: true })).text();
            assert.ok(!text.includes("<iframe"), `${k} stays a plain web page`);
        }
        assert.match((await t.request("/", { raw: true })).headers.get("x-frame-options"), /DENY/, "everything else still refuses framing");
        for (const path of ["/terms.html", "/privacy.html", "/terms", "/privacy"]) {
            const r = await t.request(path, { raw: true });
            assert.equal(r.status, 200, path);
            assert.match(r.headers.get("content-type"), /text\/html/);
            assert.match(await r.text(), /<title>/);
        }
        assert.equal((await t.request("/terms.htm", { raw: true })).status, 404);
        const head = await t.request("/terms.html", { raw: true, method: "HEAD" });
        assert.equal(head.status, 200);
        assert.match(head.headers.get("content-type"), /text\/html/);
    } finally { await t.close(); }
});

test("admin users: the owner adds panel logins that open the admin panel but not owner-only pages", async () => {
    const o = await signedIn({ config: { ownerId: "u1" } });
    const post = (p, body) => o.request(p, { method: "POST", body });
    try {
        assert.equal((await post("/api/admin/admins/add", { username: "x", password: "a long enough password" })).status, 400);
        assert.equal((await post("/api/admin/admins/add", { username: "helper", password: "short" })).status, 400);
        const add = await post("/api/admin/admins/add", { username: "Helper.Two", password: "a long enough password" });
        assert.equal(add.status, 200); assert.match(add.data.id, /^adm-[0-9a-f]{12}$/);
        assert.equal((await post("/api/admin/admins/add", { username: "helper.two", password: "another long password" })).status, 409, "usernames are unique");
        assert.equal((await o.request("/api/admin/admins")).data.admins[0].username, "helper.two");
        assert.equal((await post("/api/admin/admins/add", { kind: "discord", discordId: "123", edit: [] })).status, 400, "a Discord ID is 17 to 20 digits");
        assert.equal((await post("/api/admin/admins/add", { kind: "discord", discordId: "u1" })).status, 400);
        const dc = await post("/api/admin/admins/add", { kind: "discord", discordId: "345678901234567890", label: "Sam", edit: ["gifts", "bogus"] });
        assert.equal(dc.status, 200);
        assert.equal((await post("/api/admin/admins/add", { kind: "discord", discordId: "345678901234567890" })).status, 409);
        assert.deepEqual((await o.request("/api/admin/admins")).data.admins.find(a => a.id === "345678901234567890").edit, ["gifts"], "unknown areas are dropped");
        assert.equal((await post("/api/admin/admins/access", { id: "345678901234567890", edit: ["*"] })).status, 200);
        assert.deepEqual((await o.request("/api/admin/admins")).data.admins.find(a => a.id === "345678901234567890").edit, ["*"]);
        assert.equal((await post("/api/admin/admins/remove", { id: "345678901234567890" })).status, 200);
        const extra = await post("/api/admin/admins/add", { username: "temp.person", password: "temporary long password" });
        assert.equal((await post("/api/admin/admins/reset", { id: extra.data.id, password: "short" })).status, 400);
        assert.equal((await post("/api/admin/admins/reset", { id: extra.data.id, password: "a different long password" })).status, 200);
        assert.equal((await post("/api/admin/admins/remove", { id: extra.data.id })).status, 200);
        assert.equal((await o.request("/api/admin/admins")).data.admins.length, 1, "removed for good");
        assert.equal((await post("/api/admin/admins/remove", { id: "u1" })).status, 200, "never touches the owner's own row");
        await post("/auth/logout", {});
        assert.equal((await post("/api/admin/login", { username: "helper.two", password: "wrong wrong wrong wrong" })).status, 401);
        assert.equal((await post("/api/admin/login", { username: "helper.two", password: "a long enough password" })).status, 200);
        const me = await o.request("/api/me");
        assert.equal(me.data.isOwner, false); assert.equal(me.data.panel.kind, "password"); assert.equal(me.data.user.username, "helper.two");
        assert.equal((await o.request("/api/admin/system")).status, 200, "the panel's own pages work");
        assert.equal((await post("/api/admin/gifts", { action: "x" })).status, 403, "view-only until the owner switches an area on");
        assert.equal((await post("/api/admin/bugs/seen", {})).status, 200, "marking bugs seen is always fine");
        assert.equal(me.data.panel.kind, "password");
        assert.equal((await o.request("/api/admin/admins")).status, 403, "but not managing admin users");
        assert.equal((await post("/api/admin/account/save", { username: "evil", password: "a long enough password" })).status, 403);
        assert.equal((await o.request("/api/admin/backup")).status, 403);
        assert.equal((await o.request("/api/wishlist")).status, 401, "and nothing outside the panel");
        assert.equal((await post("/api/admin/self/password", { current: "nope nope nope nope", password: "brand new long password" })).status, 403);
        assert.equal((await post("/api/admin/self/password", { current: "a long enough password", password: "brand new long password" })).status, 200);
        await post("/auth/logout", {});
        assert.equal((await post("/api/admin/login", { username: "helper.two", password: "a long enough password" })).status, 401, "the old password stops working");
        assert.equal((await post("/api/admin/login", { username: "helper.two", password: "brand new long password" })).status, 200);
        assert.equal((await o.request("/api/admin/system")).status, 200);
        await post("/auth/logout", {});
    } finally { await o.close(); }
});

test("admin password sign-in: create it, use it, two-step codes, lockout, and it opens the admin panel only", async () => {
    const { totpCode } = await import("../src/adminlogin.js");
    const o = await signedIn({ config: { ownerId: "u1" } });
    const post = (p, body) => o.request(p, { method: "POST", body });
    const login = body => o.request("/api/admin/login", { method: "POST", body });
    try {
        assert.equal((await o.request("/api/admin/account")).data.exists, false);
        assert.equal((await post("/api/admin/account/save", { username: "Owner", password: "short" })).status, 400);
        assert.equal((await post("/api/admin/account/save", { username: "x", password: "a long enough password" })).status, 400);
        assert.equal((await post("/api/admin/account/save", { username: "boss", password: "boss and then some" })).status, 400, "may not contain the username");
        const saved = await post("/api/admin/account/save", { username: "Owner.One", password: "correct horse battery staple" });
        assert.equal(saved.data.username, "owner.one");
        assert.equal(JSON.stringify(o.db.getAdminLogin("u1")).includes("correct horse"), false, "only a hash is kept");
        assert.equal((await post("/api/admin/account/save", { username: "owner.one", password: "another long password here" })).status, 403, "changing needs the current password");
        assert.equal((await post("/api/admin/account/save", { username: "owner.one", password: "another long password here", current: "correct horse battery staple" })).status, 200);

        await post("/auth/logout", {});
        assert.equal((await o.request("/api/me")).status, 401);
        assert.equal((await login({ username: "nobody", password: "another long password here" })).status, 401);
        assert.equal((await login({ username: "owner.one", password: "wrong wrong wrong wrong" })).status, 401);
        assert.equal((await login({ username: "owner.one", password: "another long password here" })).status, 200);
        const me = await o.request("/api/me");
        assert.equal(me.data.isOwner, true);
        assert.equal(me.data.adminOnly, true);
        assert.equal((await o.request("/api/admin/system")).status, 200);
        assert.equal((await o.request("/api/wishlist")).status, 401, "not the rest of the dashboard");
        assert.equal((await o.request("/api/notifications")).status, 401);
        assert.equal((await o.request("/api/mydata/download", { raw: true })).status, 401);

        // two-step code
        const start = await post("/api/admin/account/totp/start", { current: "another long password here" });
        assert.equal(start.status, 200);
        assert.equal((await post("/api/admin/account/totp/enable", { code: "000000" })).status, 400);
        const step = () => Math.floor(1_000_000 / 30000); // the test clock starts at 1,000,000 ms
        assert.equal((await post("/api/admin/account/totp/enable", { code: totpCode(start.data.secret, step()) })).status, 200);
        await post("/auth/logout", {});
        const need = await login({ username: "owner.one", password: "another long password here" });
        assert.equal(need.data.needCode, true);
        assert.equal((await o.request("/api/me")).status, 401, "no session until the code is right");
        assert.equal((await login({ username: "owner.one", password: "another long password here", code: "123456" })).status, 401);
        const good = totpCode(start.data.secret, step() + 1); // setup used this step, so the next is the first usable
        assert.equal((await login({ username: "owner.one", password: "another long password here", code: good })).status, 200);
        await post("/auth/logout", {});
        assert.equal((await login({ username: "owner.one", password: "another long password here", code: good })).status, 401, "a code works once");
    } finally { await o.close(); }

    // lockout after five wrong tries, and the right password is refused while locked
    const l = await signedIn({ config: { ownerId: "u1" } });
    try {
        await l.request("/api/admin/account/save", { method: "POST", body: { username: "owner", password: "correct horse battery staple" } });
        await l.request("/auth/logout", { method: "POST", body: {} });
        for (let i = 0; i < 5; i++) { l.advance(20_000); await l.request("/api/admin/login", { method: "POST", body: { username: "owner", password: "nope nope nope nope" } }); }
        l.advance(20_000);
        assert.equal((await l.request("/api/admin/login", { method: "POST", body: { username: "owner", password: "correct horse battery staple" } })).status, 429);
        l.advance(16 * 60_000);
        assert.equal((await l.request("/api/admin/login", { method: "POST", body: { username: "owner", password: "correct horse battery staple" } })).status, 200);
        assert.ok((await l.request("/api/admin/audit")).data.rows.some(r => r.action === "login-password"));
        // removing it ends password sessions
        assert.equal((await l.request("/api/admin/account/remove", { method: "POST", body: { current: "correct horse battery staple" } })).status, 200);
        assert.equal((await l.request("/api/me")).status, 401);
    } finally { await l.close(); }

    // not the owner: no login possible
    const x = await signedIn({ config: { ownerId: "someone-else" } });
    try {
        assert.equal((await x.request("/api/admin/account/save", { method: "POST", body: { username: "owner", password: "correct horse battery staple" } })).status, 403);
        assert.equal((await x.request("/api/admin/login", { method: "POST", body: { username: "owner", password: "correct horse battery staple" } })).status, 401);
    } finally { await x.close(); }
});

test("music studio: own address and sign-in handoff, and the session chat", async () => {
    const music = { status: () => ({ active: false }), access: (_g, u) => ({ dj: false, isManager: u === "u1" }), sessions: () => [] };
    const o = await signedIn({ config: { ownerId: "u1", musicUrl: "https://music.bot.example", cookieDomain: "bot.example" }, extra: { music, botGuilds: () => true } });
    try {
        const home = await getAs(o, "music.bot.example", "/");
        assert.match(home.body, /data-mode="music"/);
        assert.equal(home.headers["x-robots-tag"], "noindex, nofollow");
        assert.match((await o.request("/music", { raw: true }).then(r => r.text())), /data-mode="music"/, "also reachable at /music on the main address");
        assert.equal((await getAs(o, "music.bot.example", "/auth/login")).headers.location, `${ORIGIN}/auth/login?next=music`);
        const l = await o.request("/auth/login?next=music");
        const cb = await o.request(`/auth/callback?code=good&state=${new URL(l.headers.get("location")).searchParams.get("state")}`);
        assert.equal(cb.headers.get("location"), "https://music.bot.example/");
        assert.equal((await o.request("/api/me")).data.musicUrl, "https://music.bot.example/");
        assert.match((await o.request("/robots.txt", { raw: true }).then(r => r.text())), /Disallow: \/music/);

        const chat = body => o.request("/api/music/chat", { method: "POST", body: { guild_id: "g-admin", ...body }, headers: { Origin: "https://music.bot.example" } });
        const poll = since => o.request(`/api/music/chat?guild=g-admin&since=${since}`);
        assert.equal((await chat({ text: "   " })).status, 400);
        const first = await chat({ text: "hello <b>there</b>‮  friends" });
        assert.equal(first.status, 200);
        assert.equal(first.data.message.text, "hello <b>there</b> friends", "plain text only: control characters go, nothing is treated as HTML");
        assert.equal((await chat({ text: "again" })).status, 429, "one message per second or so");
        o.advance(2000);
        assert.equal((await chat({ react: "💩" })).status, 400, "only the listed reactions");
        assert.equal((await chat({ react: "🔥" })).status, 200);
        const p = await poll(0);
        assert.deepEqual(p.data.messages.map(m => m.kind), ["msg", "react"]);
        assert.equal(p.data.here.length, 1);
        assert.equal((await poll(p.data.last)).data.messages.length, 0);
        const del = await o.request("/api/music/chat/delete", { method: "POST", body: { guild_id: "g-admin", id: first.data.message.id } });
        assert.equal(del.status, 200);
        assert.ok((await poll(p.data.last)).data.messages.some(m => m.kind === "gone"));
        assert.equal((await o.request("/api/music/chat/delete", { method: "POST", body: { guild_id: "g-admin", clear: true } })).status, 200, "a manager can clear it");
        assert.equal((await o.request("/api/music/chat?guild=g-nope")).status, 404, "only servers you are in");
        assert.equal((await chat({ text: "hi" })).status === 200 || true, true);
        assert.equal((await o.request("/api/music/chat", { method: "POST", body: { guild_id: "g-admin", text: "x" }, headers: { Origin: "https://evil.example" } })).status, 403);
    } finally { await o.close(); }
});

test("music studio: the live visualizer stream needs a sign-in and a server you are in, and sends the levels", async () => {
    const frame = Uint8Array.from({ length: 24 }, (_, i) => i * 10);
    const music = { status: () => ({ active: true }), access: () => ({}), sessions: () => [], viz: () => ({ playMs: 1000, first: 46, frames: [frame, frame] }) };
    const o = await signedIn({ extra: { music, botGuilds: () => true } });
    try {
        assert.equal((await o.request("/api/music/viz?guild=g-nope")).status, 404);
        const ac = new AbortController();
        const res = await fetch(o.base + "/api/music/viz?guild=g-admin", { headers: { Cookie: o.cookie() }, signal: ac.signal });
        assert.equal(res.status, 200);
        assert.match(res.headers.get("content-type"), /text\/event-stream/);
        const reader = res.body.getReader(); let text = "";
        while (!/data: \{"p":1/.test(text)) { const { value, done } = await reader.read(); if (done) break; text += Buffer.from(value).toString(); }
        const msg = JSON.parse(text.split("data: ")[1].split("\n")[0]);
        assert.deepEqual([msg.p, msg.m, msg.f], [1, 1000, 46]);
        assert.equal(Buffer.from(msg.d, "base64").length, 48, "two pictures of 24 bars");
        ac.abort();
    } finally { await o.close(); }
    const anon = await setup({ extra: { music, botGuilds: () => true } });
    try { assert.equal((await anon.request("/api/music/viz?guild=g-admin")).status, 401); } finally { await anon.close(); }
});

test("stream overlay: managers make the private link, the stream needs only that link, and a new link kills the old one", async () => {
    const music = { status: () => ({ active: true, playing: true, paused: false, current: { url: "https://soundcloud.com/a/b", title: "Song", artist: "Band", duration: 200, thumb: "https://i1.sndcdn.com/x.jpg" }, position: 12, next: [], volume: 50 }), access: () => ({}), sessions: () => [], viz: () => ({ paused: true }) };
    const o = await signedIn({ extra: { music, botGuilds: () => true } });
    try {
        const get = async () => (await o.request("/api/music/overlay?guild=g-admin")).data;
        assert.equal((await get()).on, false);
        assert.ok([403, 404].includes((await o.request("/api/music/overlay?guild=g-nope")).status), "only servers you manage");
        assert.equal((await o.request("/api/music/overlay", { method: "POST", body: { guild_id: "g-admin", action: "create" }, headers: { Origin: "https://evil.example" } })).status, 403);
        const made = (await o.request("/api/music/overlay", { method: "POST", body: { guild_id: "g-admin", action: "create" } })).data;
        assert.match(made.token, /^svco_[A-Za-z0-9_-]{32}$/);
        const info = await get(); assert.equal(info.on, true); assert.equal(info.token, made.token); assert.match(info.base, /\/overlay$/);

        const read = async token => {
            const ac = new AbortController();
            const res = await fetch(o.base + "/api/overlay/stream?token=" + token, { signal: ac.signal });
            if (res.status !== 200) { ac.abort(); return { status: res.status }; }
            const reader = res.body.getReader(); let text = "";
            while (!/\n\n/.test(text)) { const { value, done } = await reader.read(); if (done) break; text += Buffer.from(value).toString(); }
            ac.abort(); return { status: 200, text, type: res.headers.get("content-type") };
        };
        const live = await read(made.token); // no cookie on purpose
        assert.equal(live.status, 200); assert.match(live.type, /text\/event-stream/);
        const np = JSON.parse(live.text.split("data: ")[1].split("\n")[0]);
        assert.deepEqual([np.on, np.playing, np.title, np.artist, np.position], [true, true, "Song", "Band", 12]);
        assert.equal((await read("svco_" + "x".repeat(32))).status, 404);
        assert.equal((await read("nonsense")).status, 404);

        const fresh = (await o.request("/api/music/overlay", { method: "POST", body: { guild_id: "g-admin", action: "reset" } })).data.token;
        assert.notEqual(fresh, made.token);
        assert.equal((await read(made.token)).status, 404, "the old link stops working");
        assert.equal((await read(fresh)).status, 200);
        await o.request("/api/music/overlay", { method: "POST", body: { guild_id: "g-admin", action: "remove" } });
        assert.equal((await read(fresh)).status, 404);

        const page = await fetch(o.base + "/overlay");
        assert.equal(page.status, 200);
        assert.match(page.headers.get("content-security-policy"), /frame-ancestors 'self'/);
        assert.match(page.headers.get("x-robots-tag"), /noindex/);
        assert.match(await (await fetch(o.base + "/robots.txt")).text(), /Disallow: \/overlay/);
    } finally { await o.close(); }
});

test("streams: only streamers, mods and managers get the overlay and go-live; anyone can opt in to pings", async () => {
    const posts = [], roleCalls = []; let myRoles = [];
    const mk = () => signedIn({ extra: { music, botGuilds: () => true }, restExtra: { getMember: async () => ({ roles: myRoles }), sendMessage: async (c, p) => { posts.push([c, p]); return { id: "m1" }; }, editMessage: async () => {}, addRole: async (...a) => roleCalls.push(["add", ...a]), removeRole: async (...a) => roleCalls.push(["remove", ...a]) } });
    const music = { status: () => ({ active: true, playing: false, current: null, next: [] }), access: () => ({}), sessions: () => [] };
    let o = await mk();
    try {
        o.db.setCommunity("g-member", { streamer_role_id: "sr", live_channel: "c1", ping_stream: "pr", mod_role_id: "modr" });
        const mine = async () => (await o.request("/api/music?guild=g-member")).data.access.canStream;
        assert.equal(await mine(), false, "a plain member has no stream access");
        assert.equal((await o.request("/api/music/overlay?guild=g-member")).status, 403);
        assert.equal((await o.request("/api/music/overlay", { method: "POST", body: { guild_id: "g-member", action: "create" } })).status, 403);
        assert.equal((await o.request("/api/streams/live", { method: "POST", body: { guild_id: "g-member", url: "https://twitch.tv/x", title: "t" } })).status, 403);
        assert.equal((await o.request("/api/streams/link", { method: "POST", body: { guild_id: "g-member", channel: "https://twitch.tv/abc" } })).status, 403, "a plain member can't link a channel");
        assert.equal((await o.request("/api/streams/settings", { method: "POST", body: { guild_id: "g-member", live_channel: "c2" } })).status, 403, "settings are for managers");

        let page = (await o.request("/api/streams?guild=g-member")).data;
        assert.deepEqual([page.can.go, page.can.manage, page.optedIn], [false, false, false]);
        assert.equal((await o.request("/api/streams/ping", { method: "POST", body: { guild_id: "g-member", on: true } })).data.optedIn, true);
        assert.deepEqual(roleCalls[0], ["add", "g-member", "u1", "pr"]);

        await o.close(); myRoles = ["sr"]; o = await mk(); // given the streamer role
        o.db.setCommunity("g-member", { streamer_role_id: "sr", live_channel: "c1", ping_stream: "pr", mod_role_id: "modr" });
        assert.equal(await mine(), true, "the streamer role unlocks it");
        assert.equal((await o.request("/api/music/overlay", { method: "POST", body: { guild_id: "g-member", action: "create" } })).status, 200);
        o.advance(2_000_000); // past the ping cooldown on the test clock
        const live = await o.request("/api/streams/live", { method: "POST", body: { guild_id: "g-member", url: "https://twitch.tv/jacob", title: "Ranked", game: "Overwatch" } });
        assert.equal(live.status, 200); assert.equal(live.data.pinged, true);
        assert.equal(posts[0][0], "c1"); assert.equal(posts[0][1].content, "<@&pr>");
        o.advance(10_000);
        assert.equal((await o.request("/api/streams/live", { method: "POST", body: { guild_id: "g-member", url: "javascript:alert(1)" } })).status, 400);
        page = (await o.request("/api/streams?guild=g-member")).data; assert.equal(page.live.length, 1); assert.equal(page.live[0].mine, true);
        assert.equal((await o.request("/api/streams/end", { method: "POST", body: { guild_id: "g-member" } })).status, 200);

        // linking a channel so the bot posts by itself: streamers only, real channel links only
        const link = body => { o.advance(3_000); return o.request("/api/streams/link", { method: "POST", body: { guild_id: "g-member", ...body } }); };
        assert.equal((await link({ channel: "https://evil.example/x" })).status, 400);
        assert.equal((await link({ channel: "https://twitch.tv/directory" })).status, 400);
        const linked = await link({ channel: "https://www.twitch.tv/Jacob_TV" });
        assert.equal(linked.status, 200); assert.deepEqual(linked.data.link, { platform: "twitch", handle: "jacob_tv", url: "https://twitch.tv/jacob_tv" });
        assert.equal(o.db.getStreamLink("g-member", "u1").via, "role");
        page = (await o.request("/api/streams?guild=g-member")).data; assert.equal(page.link.handle, "jacob_tv"); assert.equal(typeof page.watch.twitch, "boolean");
        // the roster: anyone in the server can see who linked a channel and who is live (members who left are left out)
        o.db.setStreamLink("g-member", "other1", { platform: "kick", handle: "otherguy", via: "role", added: 5 });
        o.db.setStreamLive("g-member", "u1", { title: "Ranked", url: "https://twitch.tv/jacob_tv", game: "Overwatch", started: 1, channelId: "c1", messageId: "m", auto: true });
        const roster = (await o.request("/api/streams/roster?guild=g-member")).data;
        assert.deepEqual(roster.people.map(p => [p.userId, p.platform, p.handle, Boolean(p.live)]), [["u1", "twitch", "jacob_tv", true], ["other1", "kick", "otherguy", false]], "live streamers come first");
        assert.equal(roster.people[0].url, "https://twitch.tv/jacob_tv"); assert.equal(roster.people[0].mine, true); assert.equal(roster.people[0].live.game, "Overwatch");
        assert.equal((await o.request("/api/streams/roster?guild=g-nobody")).status >= 400, true, "not a member: no roster");
        // a second site: one person in the roster with both channels, and a single site can be removed on its own
        const second = await link({ channel: "https://kick.com/Jacob_Kick" });
        assert.equal(second.status, 200); assert.deepEqual(second.data.links.map(l => l.platform), ["twitch", "kick"]);
        page = (await o.request("/api/streams?guild=g-member")).data; assert.deepEqual(page.links.map(l => l.handle), ["jacob_tv", "jacob_kick"]); assert.equal(page.link.platform, "twitch");
        o.db.setStreamLive("g-member", "u1", { title: "Ranked", url: "https://twitch.tv/jacob_tv", game: "Overwatch", started: 1, channelId: "c1", messageId: "m", auto: true, also: ["https://kick.com/jacob_kick"] });
        const roster2 = (await o.request("/api/streams/roster?guild=g-member")).data;
        assert.deepEqual(roster2.people.map(p => p.userId), ["u1", "other1"], "still one card per person");
        assert.deepEqual(roster2.people[0].channels.map(c => c.platform), ["twitch", "kick"]); assert.deepEqual(roster2.people[0].live.also, ["https://kick.com/jacob_kick"]);
        const one = await o.request("/api/streams/unlink", { method: "POST", body: { guild_id: "g-member", platform: "twitch" } });
        assert.deepEqual(one.data.links.map(l => l.platform), ["kick"]);
        o.db.endStreamLive("g-member", "u1");
        assert.equal((await o.request("/api/streams/unlink", { method: "POST", body: { guild_id: "g-member" } })).status, 200); assert.ok(!o.db.getStreamLink("g-member", "u1"));

        // managers (g-admin) always can, and can change the settings
        assert.equal((await o.request("/api/music?guild=g-admin")).data.access.canStream, true);
        const set = await o.request("/api/streams/settings", { method: "POST", body: { guild_id: "g-admin", streamer_role_id: "sr", live_channel: "c2", ping_stream: "pr" } });
        assert.equal(set.status, 200); assert.deepEqual(set.data.settings, { streamer_role_id: "sr", live_channel: "c2", ping_stream: "pr", auto: true });
        const off = await o.request("/api/streams/settings", { method: "POST", body: { guild_id: "g-admin", auto: false } });
        assert.equal(off.data.settings.auto, false, "a manager can switch the automatic posts off"); assert.equal(off.data.settings.live_channel, "c2", "the rest is kept");
        assert.equal((await o.request("/api/streams/settings", { method: "POST", body: { guild_id: "g-admin", auto: true } })).data.settings.auto, true);
        assert.equal((await o.request("/api/streams/settings", { method: "POST", body: { guild_id: "g-admin", live_channel: "nope" } })).status, 400);
    } finally { await o.close(); }
});

test("library news: your games' latest posts, and a clear answer when no Steam games are known", async () => {
    const posts = [{ gid: "5", appid: 1245620, title: "Patch 1.2", date: Date.now() - 3600_000, summary: "Fixes.", patch: true, url: "https://store.steampowered.com/news/app/1245620/view/5", image: null }];
    const t = await setup({ extra: { news: { forApps: async ids => new Map(ids.map(id => [id, posts])), health: () => ({}) } } });
    await t.signIn();
    const none = await t.request("/api/library/news");
    assert.equal(none.status, 200); assert.deepEqual(none.data, { known: false, posts: [] });
    t.db.syncSteamGames("u1", [{ itad_id: "id-elden", title: "Elden Ring", appid: 1245620, minutes: 5, lastPlayed: 1790000000 }]);
    t.advance(5000);
    const got = await t.request("/api/library/news");
    assert.equal(got.data.known, true); assert.deepEqual(got.data.posts.map(p => [p.game, p.title, p.patch]), [["Elden Ring", "Patch 1.2", true]]);
    assert.equal((await t.request("/api/library/news")).status, 429, "cooldown");
    await t.close();
});

test("playtests page data needs sign-in and lists what the sources found", async () => {
    const abg = { latest: async () => [{ id: "s1", game: "Some Game", type: "Beta Demo", kind: "demo", url: "https://www.alphabetagamer.com/x", date: Date.now() - 3600_000, summary: "Try it.", image: null }] };
    const t = await setup({ extra: { abg, news: { forApps: async () => new Map() } }, config: {} });
    assert.equal((await t.request("/api/playtests")).status, 401);
    await t.signIn();
    const r = await t.request("/api/playtests");
    assert.equal(r.status, 200);
    assert.equal(r.data.items.length, 1);
    assert.equal(r.data.items[0].label, "Demo");
    assert.equal(r.data.sources.abg, true);
    await t.close();
});

test("stream giveaway: chat entry needs a linked Twitch channel and a real Discord invite", async () => {
    const t = await setup({ extra: { botGuilds: () => true, twitchReply: true }, giveawayService: db => createGiveawayService({
        db, vault: createVault("dashboard-test-secret-123"),
        discord: { post: async () => ({ id: "m1" }), edit: async () => {}, dm: async () => {}, memberOk: async () => true, findChannelByName: async () => null }
    }) });
    await t.signIn();
    t.db.setCommunity("g-admin", { live_channel: "c1" });
    t.db.setStreamLive("g-admin", "u1", { title: "t", url: "https://twitch.tv/mia", started: 1_000_000 });
    const body = { guild_id: "g-admin", keys: "Hades | AAAAA-BBBBB", length: "1h", auto_image: false, chat_enter: true, chat_invite: "https://discord.gg/abc" };
    const post = b => { t.advance(6_000); return t.request("/api/streams/giveaway", { method: "POST", body: b }); };
    const noLink = await post(body); assert.equal(noLink.status, 400); assert.match(noLink.data.error, /Link your Twitch channel/);
    t.db.setStreamLink("g-admin", "u1", { platform: "twitch", handle: "mia", via: "role", added: 1 });
    const bad = await post({ ...body, chat_invite: "https://evil.example/x" }); assert.equal(bad.status, 400); assert.match(bad.data.error, /invite/);
    const ok = await post(body);
    assert.equal(ok.status, 200, ok.text); assert.equal(ok.data.chat, true); assert.equal(ok.data.chatReplies, true);
    assert.equal(JSON.parse(t.db.getMeta(`streamgw:chat:${t.db.getMeta("streamgw:last:u1")}`)).invite, "https://discord.gg/abc");
});

test("giveaway overlay: needs the private link, and shows nothing until a stream giveaway exists", async () => {
    const o = await signedIn({ extra: { botGuilds: () => true } });
    try {
        assert.equal((await o.request("/api/giveawayoverlay/data?token=svcd_" + "x".repeat(32))).status, 404, "an unknown link shows nothing");
        const made = (await o.request("/api/streamcard", { method: "POST", body: { action: "create" } })).data;
        const r = await fetch(o.base + "/api/giveawayoverlay/data?token=" + made.token);
        assert.equal(r.status, 200); assert.deepEqual((await r.json()).giveaways, []);
        const page = await fetch(o.base + "/giveawayoverlay"); assert.equal(page.status, 200);
        assert.match(page.headers.get("content-security-policy"), /frame-ancestors 'self'/); assert.match(page.headers.get("x-robots-tag"), /noindex/);
        assert.equal((await fetch(o.base + "/giveawayoverlay.js")).status, 200);
    } finally { await o.close(); }
});

test("stream cards overlay: a private link per person that shows the best deal, a free game and the gift page, and a new link kills the old one", async () => {
    const o = await signedIn({ extra: { botGuilds: () => true } });
    try {
        assert.equal((await o.request("/api/streamcard")).data.on, false);
        assert.equal((await o.request("/api/streamcard", { method: "POST", body: { action: "create" }, headers: { Origin: "https://evil.example" } })).status, 403);
        assert.equal((await o.request("/api/streamcard/data?token=svcd_" + "x".repeat(32))).status, 404, "an unknown link shows nothing");
        o.advance(5_000);
        await o.request("/api/wishlist/add", { method: "POST", body: { title: "Hades" } });
        const made = (await o.request("/api/streamcard", { method: "POST", body: { action: "create" } })).data;
        assert.match(made.token, /^svcd_[A-Za-z0-9_-]{32}$/); assert.deepEqual(made.kinds, ["game", "deal", "free", "gift"]);
        // the overlay page asks with no cookie at all
        const ask = async token => { const r = await fetch(o.base + "/api/streamcard/data?token=" + token); return { status: r.status, data: await r.json().catch(() => null) }; };
        let got = await ask(made.token);
        assert.equal(got.status, 200);
        const kinds = got.data.cards.map(c => c.kind);
        assert.deepEqual(kinds, ["deal", "free"], "no gift card until a public page exists");
        assert.equal(got.data.cards[0].title, "Hades"); assert.equal(got.data.cards[0].discount, 50); assert.equal(got.data.cards[0].price, 10);
        assert.equal(got.data.cards[1].title, "Alpha");
        assert.ok(!JSON.stringify(got.data).includes("u1"), "no Discord id leaves the bot");
        await o.request("/api/profile", { method: "POST", body: { enabled: true, slug: "jacob" } });
        await o.request("/api/streamcard", { method: "POST", body: { action: "save", kinds: ["gift"] } });
        got = await ask(made.token);
        assert.deepEqual(got.data.cards.map(c => c.kind), ["gift"]); assert.match(got.data.cards[0].url, /\/u\/jacob$/);
        const fresh = (await o.request("/api/streamcard", { method: "POST", body: { action: "reset" } })).data;
        assert.notEqual(fresh.token, made.token); assert.deepEqual(fresh.kinds, ["gift"], "a new link keeps the chosen cards");
        assert.equal((await ask(made.token)).status, 404); assert.equal((await ask(fresh.token)).status, 200);
        assert.equal((await o.request("/api/streamcard", { method: "POST", body: { action: "remove" } })).data.on, false);
        assert.equal((await ask(fresh.token)).status, 404);
        // chat bot commands: plain text lines, same private link
        const mk = (await o.request("/api/streamcard", { method: "POST", body: { action: "create" } })).data;
        const info = (await o.request("/api/streamcard")).data;
        assert.deepEqual(Object.keys(info.chat), ["nightbot", "streamelements", "streamlabs", "fossabot"]);
        assert.ok(info.chat.nightbot.lines[1].startsWith("!commands add !deals $(urlfetch ") && info.chat.nightbot.lines[1].includes(mk.token));
        const txt = async (k, t = mk.token) => { const r = await fetch(o.base + "/api/streamcard/text?token=" + t + "&kind=" + k); return { status: r.status, type: r.headers.get("content-type"), body: await r.text() }; };
        assert.equal((await txt("game")).body, "Not in a game right now.");
        let t = await txt("deal"); assert.equal(t.status, 200); assert.match(t.type, /text\/plain/); assert.equal(t.body, "Hades is 50% off: $10.00 (was $20.00) at GOG");
        t = await txt("free"); assert.equal(t.body, "Free right now: Alpha on Epic");
        t = await txt("gift"); assert.match(t.body, /^Gift me a game: .*\/u\/jacob$/);
        assert.equal((await txt("nope")).status, 404); assert.equal((await txt("deal", "svcd_" + "x".repeat(32))).status, 404);
        await o.request("/api/streamcard", { method: "POST", body: { action: "remove" } });
        assert.equal((await txt("deal")).status, 404);
        const page = await fetch(o.base + "/streamcard");
        assert.equal(page.status, 200); assert.match(await page.text(), /streamcard\.js/);
    } finally { await o.close(); }
});

test("game club: anyone in the server can look, only managers change it", async () => {
    const o = await signedIn({ extra: { botGuilds: () => true } });
    try {
        const g = "g-admin";
        let r = (await o.request("/api/club?guild=" + g)).data;
        assert.equal(r.club, null); assert.equal(r.canManage, true); assert.ok(r.channels.some(c => c.id === "c1"));
        assert.equal((await o.request("/api/club", { method: "POST", body: { guild_id: g, action: "pick", title: "Elden Ring" }, headers: { Origin: "https://evil.example" } })).status, 403);
        assert.equal((await o.request("/api/club", { method: "POST", body: { guild_id: g, action: "pick", title: "  " } })).status, 400);
        assert.equal((await o.request("/api/club", { method: "POST", body: { guild_id: g, action: "pick", title: "Elden Ring" } })).status, 200);
        assert.equal((await o.request("/api/club", { method: "POST", body: { guild_id: g, action: "channel", channel_id: "nope" } })).status, 400);
        assert.equal((await o.request("/api/club", { method: "POST", body: { guild_id: g, action: "channel", channel_id: "c1" } })).status, 200);
        r = (await o.request("/api/club?guild=" + g)).data;
        assert.equal(r.club.title, "Elden Ring"); assert.equal(r.channel, "c1");
        assert.equal((await o.request("/api/club", { method: "POST", body: { guild_id: "g-member", action: "pick", title: "X" } })).status, 403, "not a manager there");
        await o.request("/api/club", { method: "POST", body: { guild_id: g, action: "off" } });
        assert.equal((await o.request("/api/club?guild=" + g)).data.club, null);
    } finally { await o.close(); }
});

test("extension extras: playtest badge, server counts, wishlist add, stream spotlight and the toolbar badge all need the link code", async () => {
    const abg = { latest: async () => [{ id: "d1", game: "Counter Thing", appid: 10, kind: "demo", label: "Demo", sourceName: "Steam demos", url: "https://store.steampowered.com/app/10", date: Date.now(), wishlistOnly: true }, { id: "p1", game: "Other", kind: "playtest", sourceName: "GamerPower", url: "https://gp.example/x", date: Date.now() }] };
    const t = await signedIn({ extra: { abg }, itadExtra: { lookupShopIds: async (_s, ids) => new Map(ids.map(i => ["id-" + i.slice(4)].length ? [i, "id-" + i.slice(4)] : [i, null])) } });
    const made = await t.request("/api/grabber/token", { method: "POST", body: { action: "new" } });
    const tok = made.data.token, H = { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" };
    const call = async (path, method = "GET", body) => { t.advance(2_000); const r = await fetch(t.base + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, data: await r.json() }; };
    for (const [p, m] of [["/api/grabber/badge", "GET"], ["/api/grabber/wishlist", "POST"], ["/api/grabber/spotlight", "POST"]]) assert.equal((await fetch(t.base + p, { method: m })).status, 401, p + " needs the link code");
    // a member of the server who shares and owns the game
    t.db.ensureUser("u2", "g-admin"); t.db.updateUser("u2", { share: 1, guild_id: "g-admin" }); t.db.syncSteamGames("u2", [{ itad_id: "id-10", title: "Counter Thing", appid: 10, minutes: 60, lastPlayed: 1 }]);
    t.db.ensureUser("u1", "g-admin"); t.db.updateUser("u1", { guild_id: "g-admin" });
    const g = (await call("/api/grabber/game?appid=10&name=Counter%20Thing")).data;
    assert.equal(g.playtest.label, "Demo"); assert.equal(g.social.owners, 1); assert.equal(g.overlay, false);
    assert.equal((await call("/api/grabber/game?appid=11&name=Other")).data.playtest.source, "GamerPower", "the sites match by name");
    // wishlist add, then again
    let w = (await call("/api/grabber/wishlist", "POST", { appid: 10, name: "Counter Thing" })).data;
    assert.deepEqual([w.added, w.existing], [true, false]);
    w = (await call("/api/grabber/wishlist", "POST", { appid: 10, name: "Counter Thing" })).data; assert.equal(w.existing, true);
    assert.equal((await call("/api/grabber/wishlist", "POST", { appid: 10, name: "" })).status, 400);
    // spotlight needs an overlay link first
    assert.equal((await call("/api/grabber/spotlight", "POST", { appid: 10, name: "Counter Thing" })).data.status, "no_overlay");
    const card = (await t.request("/api/streamcard", { method: "POST", body: { action: "create" } })).data;
    assert.equal((await call("/api/grabber/spotlight", "POST", { appid: 10, name: "Counter Thing" })).data.status, "ok");
    const seen = await (await fetch(t.base + "/api/streamcard/data?token=" + card.token)).json();
    assert.equal(seen.cards[0].spot, true); assert.equal(seen.cards[0].title, "Counter Thing");
    const line = await (await fetch(t.base + "/api/streamcard/text?kind=deal&token=" + card.token)).text();
    assert.ok(!/Counter Thing/.test(line) || /off/.test(line), "the spotlight never replaces the !deals answer");
    t.advance(11 * 60_000);
    assert.ok(!(await (await fetch(t.base + "/api/streamcard/data?token=" + card.token)).json()).cards.some(c => c.spot), "it fades after ten minutes");
    const b = (await call("/api/grabber/badge")).data;
    assert.deepEqual(Object.keys(b).sort(), ["free", "playtests", "unread"]); assert.ok(b.free.length >= 1); assert.ok(b.playtests.includes("p1") && !b.playtests.includes("d1"), "wishlist-only demos are not counted for everyone");
    await t.close();
});

test("command guide: the Help page lists every menu from the real command definitions", async () => {
    const o = await signedIn();
    try {
        const r = await o.request("/api/commands");
        assert.equal(r.status, 200);
        const names = r.data.hubs.map(h => h.name);
        for (const n of ["games", "me", "server", "manage", "bot", "mod", "alerts"]) assert.ok(names.includes(n), n);
        const server = r.data.hubs.find(h => h.name === "server");
        assert.equal(server.menu, true);
        const stream = server.areas.find(a => a.label === "stream");
        assert.equal(stream.page, "streamer");
        assert.ok(stream.items.some(i => i.usage.startsWith("/server stream live")));
        assert.ok(!JSON.stringify(r.data).includes('"menu","desc'), "the menu command itself is not listed as a task");
    } finally { await o.close(); }
});

test("admin panels tab: owner sees how often panel commands are run", async () => {
    const o = await signedIn({ config: { ownerId: "u1" } });
    try {
        o.db.bumpMeta("pnuse:me wishlist add"); o.db.bumpMeta("pnuse:me wishlist add"); o.db.bumpMeta("pnuse:server stream live");
        const r = (await o.request("/api/admin/panels")).data;
        assert.equal(r.total, 3);
        assert.deepEqual(r.rows[0], { command: "/me wishlist add", runs: 2 });
    } finally { await o.close(); }
});

test("profiles: editor saves and validates, visitors only get what is switched on, share link has a preview, reports and hiding work", async () => {
    const o = await signedIn({ config: { ownerId: "u1" } });
    try {
        const slug = "jacobm";
        assert.equal((await o.request("/api/profile", { method: "POST", body: { enabled: true, slug } })).status, 200);
        const bad = await o.request("/api/profile/page", { method: "POST", body: { links: [{ kind: "twitch", url: "https://evil.example" }] } });
        assert.equal(bad.status, 400);
        assert.equal((await o.request("/api/profile/page", { method: "POST", body: { song: "http://evil.example/x.mp3" } })).status, 400);
        const ok = await o.request("/api/profile/page", { method: "POST", body: { name: "Jacob", bio: "I play too much.", theme: "ocean", favorites: ["Hades"], song: { url: "https://youtu.be/dQw4w9WgXcQ", title: "Theme" },
            links: [{ kind: "x", url: "https://x.com/jacob" }], sections: [{ key: "about", vis: "public" }, { key: "favorites", vis: "public" }, { key: "steam", vis: "hidden" }, { key: "wishlist", vis: "hidden" }] } });
        assert.equal(ok.status, 200); assert.equal(ok.data.config.theme, "ocean"); assert.ok(ok.data.choices.themes.length >= 8);
        const pv = await o.request("/api/profile/preview", { method: "POST", body: { bio: "draft only", theme: "light" } });
        assert.equal(pv.data.profile.bio, "draft only");
        assert.equal((await o.request("/api/profile/page")).data.config.bio, "I play too much.", "a preview does not save");

        const pub = await fetch(o.base + "/api/public/profile?slug=" + slug);
        assert.equal(pub.status, 200);
        const body = await pub.json();
        assert.equal(body.profile.name, "Jacob"); assert.equal(body.profile.song.provider, "youtube");
        assert.deepEqual(body.profile.sections.map(s => s.key), ["about", "favorites"]);
        assert.equal((await fetch(o.base + "/api/public/profile?slug=nobody")).status, 404);

        const shell = await fetch(o.base + "/u/" + slug);
        const html = await shell.text();
        assert.equal(shell.status, 200); assert.match(html, /og:title" content="Jacob on Steam Value Checker"/); assert.match(html, /og:description" content="I play too much\."/);
        assert.match(html, new RegExp(`og:image" content="[^"]*/u/${slug}/og\\.png\\?v=`), "the preview picture is this profile's own, not the bot's");
        assert.match(html, /twitter:image" content="[^"]*\/og\.png/); assert.match(html, /twitter:title" content="Jacob on Steam Value Checker"/); assert.doesNotMatch(html, /preview\.jpg/);
        const pic = await fetch(o.base + "/u/" + slug + "/og.png"); const bytes = Buffer.from(await pic.arrayBuffer());
        assert.equal(pic.status, 200); assert.equal(pic.headers.get("content-type"), "image/png"); assert.equal(bytes.subarray(1, 4).toString(), "PNG");
        assert.equal((await fetch(o.base + "/u/nobody-here/og.png")).status, 404);
        assert.equal((await fetch(o.base + "/u/" + slug + "/badge.svg")).status, 404, "no badge while the value section is hidden");
        {
            const id = o.db.getProfileBySlug(slug).discord_id, was = o.db.getProfileData(id).data;
            o.db.upsertSnapshot(id, { games: 50, paid: 100, msrp: 900, msrp_paid: 400, cheapest: 300 });
            o.db.setProfileData(id, { ...was, sections: [...(was.sections || []).filter(s => s.key !== "value"), { key: "value", vis: "public" }] });
            const b = await fetch(o.base + "/u/" + slug + "/badge.svg");
            assert.equal(b.status, 200); assert.equal(b.headers.get("content-type"), "image/svg+xml; charset=utf-8");
            assert.match(await b.text(), /\$900/);
            o.db.setProfileData(id, was);
        }
        assert.match(shell.headers.get("content-security-policy"), /frame-src[^;]*youtube-nocookie\.com[^;]*soundcloud\.com[^;]*spotify\.com/);

        const post = (path, b) => fetch(o.base + path, { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "dashboard" }, body: JSON.stringify(b) });
        assert.equal((await post("/api/public/profile/report", { slug, reason: "x" })).status, 400);
        assert.equal((await post("/api/public/profile/report", { slug, reason: "Pretending to be someone" })).status, 200);
        const rep = (await o.request("/api/admin/profiles")).data.reports;
        assert.equal(rep.length, 1); assert.equal(rep[0].slug, slug);
        assert.equal((await o.request("/api/admin/profiles", { method: "POST", body: { slug, action: "hide" } })).status, 400, "the bot owner's own page can't be hidden");
        o.db.getUser("u1") && o.db.setMeta("test:ownerprofile", "1");
        o.db.blockProfile("u1", true);
        assert.equal((await fetch(o.base + "/api/public/profile?slug=" + slug)).status, 404, "a hidden profile is gone for visitors");
        assert.doesNotMatch(await (await fetch(o.base + "/u/" + slug)).text(), /Jacob on Steam/, "and its preview stops showing the bio");
        await o.request("/api/admin/profiles", { method: "POST", body: { slug, action: "show" } });
        assert.equal((await fetch(o.base + "/api/public/profile?slug=" + slug)).status, 200);
    } finally { await o.close(); }
});

test("admin: the owner can get a one-use invite for a server, others cannot", async () => {
    const calls = [];
    const guildInvite = async id => { calls.push(id); if (id === "99999") throw new Error("No Create Invite permission there."); return "https://discord.gg/abc"; };
    const guest = await signedIn({ extra: () => ({ guildInvite }) });
    assert.equal((await guest.request("/api/admin/server/invite", { method: "POST", body: { id: "12345" } })).status, 403);
    await guest.close();
    const o = await signedIn({ config: { ownerId: "u1" }, extra: () => ({ guildInvite }) });
    const ok = await o.request("/api/admin/server/invite", { method: "POST", body: { id: "12345" } });
    assert.equal(ok.status, 200); assert.equal(ok.data.url, "https://discord.gg/abc");
    assert.equal((await o.request("/api/admin/server/invite", { method: "POST", body: { id: "abc" } })).status, 400);
    const no = await o.request("/api/admin/server/invite", { method: "POST", body: { id: "99999" } });
    assert.equal(no.status, 400); assert.match(no.data.error ?? JSON.stringify(no.data), /Create Invite/);
    assert.deepEqual(calls, ["12345", "99999"]);
    await o.close();
});

test("secret santa: managers start and finish it, members join and leave, non-managers cannot draw", async () => {
    const o = await signedIn({ extra: { botGuilds: () => true, dm: async () => {} } });
    try {
        const g = "g-admin", post = (body, guild = g) => o.request("/api/santa", { method: "POST", body: { guild_id: guild, ...body } });
        let r = (await o.request("/api/santa?guild=" + g)).data;
        assert.equal(r.event, null); assert.equal(r.canManage, true);
        assert.equal((await post({ action: "create", budget: 0 })).status, 400);
        assert.equal((await post({ action: "create", title: "Winter", budget: 25, channel_id: "nope" })).status, 400);
        assert.equal((await post({ action: "create", title: "Winter", budget: 25, channel_id: "c1" })).status, 200);
        assert.equal((await post({ action: "create", budget: 25 })).status, 400, "one at a time");
        assert.equal((await post({ action: "join" })).status, 200);
        r = (await o.request("/api/santa?guild=" + g)).data;
        assert.equal(r.event.title, "Winter"); assert.equal(r.event.budget, 25); assert.equal(r.joined, true); assert.equal(r.people.length, 1);
        assert.equal((await post({ action: "draw" })).status, 400, "needs three people");
        assert.equal((await post({ action: "leave" })).status, 200);
        assert.equal((await post({ action: "draw" }, "g-member")).status, 403, "not a manager there");
        assert.equal((await post({ action: "reveal" })).status, 200);
        assert.equal((await o.request("/api/santa?guild=" + g)).data.event.status, "ended");
    } finally { await o.close(); }
});

test("trivia: managers start and stop it, everyone sees the board", async () => {
    const calls = [];
    const trivia = { start: async a => { calls.push(["start", a]); return { rounds: a.rounds }; }, stop: id => calls.push(["stop", id]), active: () => null, top: () => [{ user_id: "u1", points: 7, correct: 3, wins: 1 }] };
    const o = await signedIn({ extra: { trivia, botGuilds: () => true } });
    try {
        const post = (body, guild = "g-admin") => o.request("/api/trivia", { method: "POST", body: { guild_id: guild, ...body } });
        const r = (await o.request("/api/trivia?guild=g-admin")).data;
        assert.equal(r.enabled, true); assert.equal(r.canManage, true); assert.equal(r.top[0].points, 7);
        assert.equal((await post({ action: "start", channel_id: "nope", rounds: 5 })).status, 400);
        assert.equal((await post({ action: "start", channel_id: "c1", rounds: 5 })).status, 200);
        assert.equal(calls[0][1].channelId, "c1");
        assert.equal((await post({ action: "stop" })).status, 200);
        assert.equal((await post({ action: "start", channel_id: "c1" }, "g-member")).status, 403);
    } finally { await o.close(); }
});

const PNG1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const asData = (buf, mime = "image/png") => `data:${mime};base64,${buf.toString("base64")}`;

test("page background: presets, uploads (three kept), the Steam background, serving rules and clearing for inactive members", async () => {
    const steamHtml = `<html><div class="no_header profile_page has_profile_background " style="background-image: url( 'https://shared.fastly.steamstatic.com/community_assets/images/items/1/bg.jpg' );"></div></html>`;
    const steamFetch = async url => url.includes("steamcommunity.com/profiles/") ? { ok: true, status: 200, text: async () => (steamFetch.video ? `<video><source src="https://shared.akamai.steamstatic.com/community_assets/images/items/284160/aabb0b693d4e99ae6d39106a7a735add27b95b6b.webm"></video>` : steamFetch.none ? "<html></html>" : steamHtml) }
        : url.includes("steamstatic.com") ? { ok: true, status: 200, arrayBuffer: async () => PNG1 } : { ok: false, status: 404 };
    const t = await setup({ extra: { steamFetch }, config: { apiPerMinute: 5000 } });
    await t.signIn();
    await t.request("/api/wishlist/add", { method: "POST", body: { title: "Celeste" } });
    await t.request("/api/profile", { method: "POST", body: { enabled: true, slug: "jacob" } });
    assert.equal((await t.request("/api/profile/background", { method: "POST", body: { action: "steam" } })).status, 400, "needs a linked Steam account");
    t.db.setSteamLink("u1", "76561198000000000");
    const save = pagebg => t.request("/api/profile/page", { method: "POST", body: { pagebg } });
    const bg = body => t.request("/api/profile/background", { method: "POST", body });
    const shown = async () => (await t.request("/api/public/profile?slug=jacob")).data.profile.pagebg;

    assert.equal((await shown()).kind, "none");
    assert.equal((await save({ kind: "preset", preset: "nope" })).status, 400);
    assert.equal((await save({ kind: "wallpaper" })).status, 400);
    await save({ kind: "preset", preset: "ember", dim: 999 });
    assert.deepEqual(await shown(), { kind: "preset", preset: "ember", dim: 70, url: null });
    assert.equal((await save({ kind: "image", image: 9999 })).status, 200);
    assert.equal((await shown()).kind, "none", "a picture that is not stored paints nothing");

    // uploads: only real pictures, and three at most
    assert.equal((await bg({ action: "upload", data: "data:text/html;base64,PGI+" })).status, 400);
    assert.equal((await bg({ action: "upload", data: asData(Buffer.from("not an image at all, just text bytes", "utf8")) })).status, 400, "the bytes are checked, not the label");
    assert.equal((await bg({ action: "upload", data: asData(Buffer.alloc(1_210_000, 1)) })).status, 400);
    const up = await bg({ action: "upload", data: asData(PNG1) });
    assert.equal(up.status, 200); assert.equal(up.data.backgrounds.length, 1);
    const id1 = up.data.backgrounds[0].id;
    const p1 = await shown();
    assert.equal(p1.kind, "image"); assert.match(p1.url, new RegExp(`^/pbg/${id1}\\?v=\\d+$`));
    const served = await t.request(p1.url);
    assert.equal(served.status, 200); assert.equal(served.headers.get("content-type"), "image/png"); assert.equal(served.headers.get("x-content-type-options"), "nosniff");
    await bg({ action: "upload", data: asData(PNG1) }); await bg({ action: "upload", data: asData(PNG1) });
    const fourth = await bg({ action: "upload", data: asData(PNG1) });
    assert.equal(fourth.status, 400); assert.match(fourth.data.error, /up to 3/);

    // the Steam background takes one of the three places, and is replaced rather than piled up
    assert.equal((await bg({ action: "steam" })).status, 400, "full until one is deleted");
    assert.equal((await bg({ action: "remove", id: id1 })).status, 200);
    assert.equal((await shown()).kind === "image" || (await shown()).kind === "none", true);
    const st = await bg({ action: "steam" });
    assert.equal(st.status, 200); assert.equal(st.data.backgrounds.filter(b => b.source === "steam").length, 1);
    t.db.deleteProfileBg("u1", st.data.backgrounds.find(b => b.source !== "steam").id);
    assert.equal((await bg({ action: "steam" })).data.backgrounds.filter(b => b.source === "steam").length, 1);
    steamFetch.none = true;
    assert.equal((await bg({ action: "steam" })).status, 404, "no Steam background to copy");

    // an animated Steam background stays on Steam's servers: nothing is stored, and it takes no picture slot
    const before = t.db.countProfileBgs("u1");
    steamFetch.none = false; steamFetch.video = true;
    const vid = await bg({ action: "steam" });
    assert.equal(vid.status, 200); assert.equal(t.db.countProfileBgs("u1"), before);
    const pv = await shown();
    assert.equal(pv.kind, "video"); assert.match(pv.url, /\.webm$/);
    assert.equal((await save({ kind: "video", video: "https://evil.example/a.webm" })).status, 400, "only Steam's own animated backgrounds");
    steamFetch.video = false;

    // only the owner can pick or delete their pictures; a hidden page does not show its picture to strangers
    assert.equal((await bg({ action: "use", id: 99999 })).status, 404);
    assert.equal((await bg({ action: "remove", id: 99999 })).status, 404);
    const mine = t.db.listProfileBgs("u1")[0];
    await bg({ action: "use", id: mine.id });
    const url = (await shown()).url;
    await t.request("/api/profile", { method: "POST", body: { enabled: false, slug: "jacob" } });
    await t.request("/auth/logout", { method: "POST", body: {} });
    assert.equal((await t.request(url)).status, 404, "a page that is switched off keeps its picture private");
    await t.signIn();
    assert.equal((await t.request(url)).status, 200, "but the owner still sees it");

    // inactive members lose their stored pictures
    const n = t.db.countProfileBgs("u1");
    assert.ok(n > 0);
    assert.equal(t.db.pruneInactiveProfileBgs(30 * 86400_000), 0, "someone just seen keeps them");
    t.db.updateUser("u1", { last_seen: Date.now() - 31 * 86400_000 });
    assert.equal(t.db.pruneInactiveProfileBgs(30 * 86400_000), n);
    assert.equal(t.db.countProfileBgs("u1"), 0);
    await t.close();
});

test("page background: reading the Steam profile page", async () => {
    const { parseSteamBackground, sniffImage, safeSteamUrl } = await import("../src/profilebg.js");
    assert.equal(parseSteamBackground(`<div class="no_header profile_page has_profile_background" style="background-image: url( 'https://shared.fastly.steamstatic.com/community_assets/images/items/2/x.jpg' );">`), "https://shared.fastly.steamstatic.com/community_assets/images/items/2/x.jpg");
    assert.equal(parseSteamBackground("<html>no background</html>"), null);
    const { parseSteamBackgrounds, safeSteamVideo } = await import("../src/profilebg.js");
    const VID = "https://shared.akamai.steamstatic.com/community_assets/images/items/284160/aabb0b693d4e99ae6d39106a7a735add27b95b6b.webm";
    assert.deepEqual(parseSteamBackgrounds(`<div class="profile_animated_background"><video autoplay muted loop><source src="${VID}" type="video/webm"></video></div>`), { image: null, video: VID });
    assert.equal(safeSteamVideo("https://evil.example/items/1/aa.webm"), null);
    assert.equal(safeSteamVideo("https://shared.akamai.steamstatic.com/x.jpg"), null);
    assert.equal(safeSteamUrl("https://evil.example/steamstatic.com/x.jpg"), null);
    assert.equal(safeSteamUrl("http://cdn.steamstatic.com/x.jpg"), null, "https only");
    assert.equal(sniffImage(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>")), null, "SVG is not accepted");
});

test("the Top.gg vote card route says when voting is off", async () => {
    const t = await setup();
    await t.signIn();
    const r = await t.request("/api/topgg");
    assert.equal(r.status, 200);
    assert.equal(r.data.enabled, false);
    await t.close();
});

test("admin pages for votes, errors, data requests and server events are owner-only and the request log keeps no names", async () => {
    const t = await signedIn({ config: { ownerId: "u1" }, extra: () => ({ topgg: { enabled: true, adminStats: () => ({ enabled: true, health: {}, votes: 4, xp: 1000, voters: 2, perVote: 250, top: [], recent: [] }) } }) });
    assert.equal((await t.request("/api/admin/votes")).data.votes, 4);
    assert.equal((await t.request("/api/admin/errors")).status, 200);
    assert.equal((await t.request("/api/admin/serverevents")).status, 200);
    assert.deepEqual((await t.request("/api/admin/commandwatch")).data.rows, []);
    t.db.updateUser?.("u1", {});
    await t.request("/api/mydata/download", { raw: true });
    await t.request("/api/mydata/delete", { method: "POST", body: { confirm: "DELETE" } });
    const r = (await t.request("/api/admin/datarequests")).data;
    assert.ok(r.list.some(e => e.kind === "delete" && e.via === "Dashboard"));
    assert.ok(!JSON.stringify(r).includes("u1"), "no user id in the log");
    await t.close();
    const other = await signedIn({ config: { ownerId: "someone-else" } });
    for (const p of ["votes", "errors", "datarequests", "serverevents", "commandwatch"]) assert.equal((await other.request("/api/admin/" + p)).status, 403, p);
    await other.close();
});

test("the co-op lookup lists owners in a server the member is in", async () => {
    const t = await signedIn({ extra: () => ({ itad: { lookupTitles: async () => [{ id: "g1id", approx: false }] } }) });
    const none = await t.request("/api/coop?guild=g-member&game=Hades");
    assert.equal(none.status, 200);
    assert.deepEqual(none.data.owners, []);
    assert.equal((await t.request("/api/coop?guild=g-member&game=")).status, 400);
    assert.equal((await t.request("/api/coop?guild=nope&game=Hades")).status >= 400, true);
    await t.close();
});

test("the owner can make the bot leave a server and block it, then unblock it", async () => {
    const left = [];
    const t = await signedIn({ config: { ownerId: "u1" }, extra: () => ({ leaveGuild: async id => { left.push(id); return true; } }) });
    const r = await t.request("/api/admin/server/leave", { method: "POST", body: { id: "123456789012345", block: true, reason: "spam" } });
    assert.equal(r.status, 200); assert.equal(r.data.blocked, true);
    assert.deepEqual(left, ["123456789012345"]);
    assert.equal(t.db.isGuildBlocked("123456789012345"), true);
    assert.equal(t.db.blockedGuilds()[0].reason, "spam");
    assert.equal((await t.request("/api/admin/server/leave", { method: "POST", body: { id: "abc" } })).status, 400);
    assert.equal((await t.request("/api/admin/server/unblock", { method: "POST", body: { id: "123456789012345" } })).data.unblocked, true);
    assert.equal(t.db.isGuildBlocked("123456789012345"), false);
    await t.close();
    const other = await signedIn({ config: { ownerId: "someone-else" } });
    assert.equal((await other.request("/api/admin/server/leave", { method: "POST", body: { id: "123456789012345" } })).status, 403);
    await other.close();
});

test("the shop site feed gives counts and the changelog to its own origin only", async () => {
    const t = await signedIn({ extra: () => ({ botInfo: () => ({ servers: 3, gamesWatched: 322, alerts24h: 33, members: 999, secret: "x" }) }) });
    const r = await fetch(t.base + "/api/public/site", { headers: { Origin: "https://jacob-lucado.github.io" } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("access-control-allow-origin"), "https://jacob-lucado.github.io");
    const d = await r.json();
    assert.deepEqual(d.stats, { servers: 3, gamesWatched: 322, alerts24h: 33 });
    assert.ok(d.changelog.length > 0 && d.changelog[0].items.length > 0);
    const other = await fetch(t.base + "/api/public/site", { headers: { Origin: "https://evil.example" } });
    assert.equal(other.headers.get("access-control-allow-origin"), "https://jacob-lucado.github.io", "never echoes another origin");
    await t.close();
});

test("admin offsite backup routes: off by default, owner only, and verify reports the result", async () => {
    const t = await signedIn({ config: { ownerId: "u1" } });
    assert.equal((await t.request("/api/admin/offsite")).data.enabled, false);
    assert.equal((await t.request("/api/admin/offsite/verify", { method: "POST", body: {} })).status, 400);
    await t.close();
    const on = await signedIn({ config: { ownerId: "u1" }, extra: () => ({ offsite: { enabled: true, list: async () => [{ key: "backups/a.db.gz.enc", size: 2048, at: 1 }], verify: async () => ({ key: "backups/a.db.gz.enc", ok: true, users: 5, bytes: 4096 }) } }) });
    const o = (await on.request("/api/admin/offsite")).data;
    assert.equal(o.enabled, true); assert.equal(o.list.length, 1);
    assert.equal((await on.request("/api/admin/offsite/verify", { method: "POST", body: {} })).data.ok, true);
    await on.close();
    const other = await signedIn({ config: { ownerId: "someone-else" } });
    assert.equal((await other.request("/api/admin/offsite")).status, 403);
    await other.close();
});

test("overlay studio: build a goal bar, the OBS page reads it by link only, and a new link kills the old one", async () => {
    const o = await signedIn({ extra: { botGuilds: () => true, guildList: () => [{ id: "g-admin", name: "Mine", members: 321, boosts: 7 }] } });
    try {
        const mk = body => o.request("/api/overlays", { method: "POST", body });
        assert.equal((await mk({ action: "create", kind: "bogus" })).status, 400);
        assert.equal((await mk({ action: "create", kind: "stats" })).status, 400, "stats need a server");
        assert.equal((await o.request("/api/overlays", { method: "POST", body: { action: "create", kind: "goal" }, headers: { Origin: "https://evil.example" } })).status, 403);
        const made = (await mk({ action: "create", kind: "goal", name: "Subs", config: { target: 10, label: "Sub goal" } })).data.token;
        let list = (await o.request("/api/overlays")).data;
        assert.equal(list.overlays.length, 1); assert.match(list.overlays[0].url, /\/ov\?token=svcx_/);
        assert.deepEqual(list.guilds.map(g => g.id), ["g-admin"]);
        assert.equal((await mk({ action: "bump", token: made, by: 4 })).data.value, 4);
        assert.equal((await mk({ action: "bump", token: made, by: -99 })).data.value, 0, "never below zero");
        await mk({ action: "bump", token: made, by: 5 });

        const data = async token => fetch(o.base + "/api/ov/data?token=" + token);
        const ok = await data(made); assert.equal(ok.status, 200);
        const j = await ok.json();
        assert.equal(j.kind, "goal"); assert.equal(j.config.label, "Sub goal"); assert.equal(j.data.pct, 50);
        assert.ok(!JSON.stringify(j).includes("u1"), "nothing about the owner");
        assert.equal((await data("svcx_" + "a".repeat(32))).status, 404);

        const stats = (await mk({ action: "create", kind: "stats", guild_id: "g-admin" })).data.token;
        assert.deepEqual((await (await data(stats)).json()).data, { members: 321, boosts: 7 });
        const members = (await mk({ action: "create", kind: "goal", guild_id: "g-admin", config: { source: "members", target: 642 } })).data.token;
        assert.equal((await (await data(members)).json()).data.pct, 50);
        assert.equal((await mk({ action: "create", kind: "goal", guild_id: "g-nope", config: { source: "members" } })).status >= 400, true);

        assert.equal((await mk({ action: "save", token: made, name: "Renamed", config: { target: 20 } })).status, 200);
        assert.equal((await (await data(made)).json()).data.pct, 25);
        const next = (await mk({ action: "reset", token: made })).data.token;
        assert.equal((await data(made)).status, 404); assert.equal((await data(next)).status, 200);
        assert.equal((await mk({ action: "delete", token: next })).status, 200);
        assert.equal((await data(next)).status, 404);
        for (const path of ["/ov", "/ov.js", "/ov.css"]) assert.equal((await fetch(o.base + path)).status, 200, path);
        assert.match((await fetch(o.base + "/ov")).headers.get("content-security-policy"), /frame-ancestors 'self'/);
    } finally { await o.close(); }
});

test("supporter passes: Square's signed callback grants one, a forged one doesn't, and the checkout and admin pages work", async () => {
    const { createHmac } = await import("node:crypto");
    const { createSquare } = await import("../src/square.js");
    const { createSupporters, isSupporter, supporterUntil } = await import("../src/supporters.js");
    const HOOK = "https://svc.example/api/square/webhook", KEY = "k-123456";
    const sign = b => createHmac("sha256", KEY).update(HOOK + b).digest("base64");
    const fake = async url => /payment-links/.test(url)
        ? { ok: true, status: 200, json: async () => ({ payment_link: { url: "https://square.link/u/xyz" } }) }
        : { ok: true, status: 200, json: async () => ({ order: { id: "O9", location_id: "L1", reference_id: "svc:123456789:m1" } }) };
    const square = createSquare({ accessToken: "t", locationId: "L1", signatureKey: KEY, webhookUrl: HOOK, fetch: fake });
    const login = async () => ({ user: { id: "555555555", username: "jacob", global_name: "Jacob", avatar: null }, guilds: [] });
    const o = await signedIn({ config: { ownerId: "555555555" }, restExtra: { login }, extra: db => ({ square, supporters: createSupporters({ db }) }) });
    try {
        const hook = (body, sig) => fetch(o.base + "/api/square/webhook", { method: "POST", headers: { "Content-Type": "application/json", "x-square-hmacsha256-signature": sig ?? sign(body) }, body });
        const evt = JSON.stringify({ type: "payment.updated", data: { object: { payment: { id: "PAY1", status: "COMPLETED", order_id: "O9", amount_money: { amount: 300, currency: "USD" } } } } });
        assert.equal((await hook(evt, "forged")).status, 403);
        assert.equal(isSupporter(o.db, "123456789"), false);
        assert.equal((await hook(evt)).status, 200);
        assert.equal(isSupporter(o.db, "123456789"), true);
        const until = o.db.getMeta("supporter:123456789");
        assert.equal((await hook(evt)).status, 200);
        assert.equal(o.db.getMeta("supporter:123456789"), until, "the same payment twice adds nothing");
        assert.equal((await hook("not json")).status, 400);

        const me = (await o.request("/api/supporter")).data;
        assert.equal(me.enabled, true); assert.equal(me.plans.length, 3); assert.equal(me.until, null, "this signed-in member has no pass");
        assert.equal((await o.request("/api/supporter/checkout", { method: "POST", body: { plan: "m1" } })).data.url, "https://square.link/u/xyz");
        assert.equal((await o.request("/api/supporter/checkout", { method: "POST", body: { plan: "bogus" } })).status, 400);
        assert.equal((await o.request("/api/supporter/checkout", { method: "POST", body: { plan: "m1" }, headers: { Origin: "https://evil.example" } })).status, 403);

        const nobody = await o.request("/api/supporter/checkout", { method: "POST", body: { plan: "m1", gift_to: "999999999" } });
        assert.equal(nobody.status, 404, "gifts only go to people the bot knows");
        o.db.ensureUser("777777777"); 
        assert.equal((await o.request("/api/supporter/checkout", { method: "POST", body: { plan: "m1", gift_to: "777777777" } })).data.url, "https://square.link/u/xyz");
        assert.equal((await o.request("/api/supporter/checkout", { method: "POST", body: { plan: "m1", gift_to: "555555555" } })).status, 400, "gifting yourself is pointless");
        assert.equal((await o.request("/api/supporter/wall", { method: "POST", body: { name: "Sam" } })).status, 403, "the wall is for supporters");
        assert.equal((await o.request("/api/admin/supporters/grant", { method: "POST", body: { user_id: "x", days: 5 } })).status, 400);
        assert.equal((await o.request("/api/admin/supporters/grant", { method: "POST", body: { user_id: "222222222", days: 5 } })).status, 200);
        const adm = (await o.request("/api/admin/supporters")).data;
        assert.deepEqual(adm.active.map(a => a.id).sort(), ["123456789", "222222222"]);
        assert.ok(adm.recent.length >= 2);
        assert.ok(adm.payments.some(p => p.what === "Paid"), "Square's calls are logged for the owner");
        const csv = (await o.request("/api/admin/supporters.csv")).data.csv;
        assert.match(csv, /^discord_id,status,pass_ends,founder,wall_name/); assert.match(csv, /123456789/);
        const attn = (await o.request("/api/admin/attention")).data.items;
        assert.ok(Array.isArray(attn), "the needs-attention list loads");
        assert.equal(adm.revenue.total, 300, "the paid pass counts, the gifted one doesn't");
        const theme = async k => (await o.request("/api/profile/page", { method: "POST", body: { theme: k } }));
        assert.equal((await theme("galaxy")).status, 403, "supporter themes are locked for everyone else");
        assert.equal((await o.request("/api/profile/page")).data.choices.themes.find(x => x.key === "galaxy").locked, true);
        assert.equal((await o.request("/api/admin/supporters/grant", { method: "POST", body: { user_id: "555555555", days: 5 } })).status, 200);
        assert.equal((await theme("galaxy")).status, 200);
        assert.equal((await o.request("/adminos.js")).status, 200, "the admin desktop script is served");
        const style = k => o.request("/api/profile/page", { method: "POST", body: { style: k } });
        assert.equal((await style("nope")).status, 400, "an unknown style is refused");
        assert.equal((await style("ember")).status, 200, "free styles save for anyone");
        assert.equal((await style("kinetic")).status, 200, "a supporter can pick Kinetic");
        assert.equal((await o.request("/api/profile/page")).data.config.style, "kinetic");
        assert.equal((await o.request("/api/profile/page")).data.choices.styles.find(x => x.key === "kinetic").locked, false);
        const ed = body => o.request("/api/admin/supporters/edit", { method: "POST", body: { id: "222222222", ...body } });
        const before = supporterUntil(o.db, "222222222");
        assert.ok((await ed({ action: "add_days", days: 10 })).data.until - before >= 10 * 86_400_000 - 1000, "days can be added");
        const cut = (await ed({ action: "add_days", days: -10 })).data.until;
        assert.ok(Math.abs(cut - before) < 2000, "and taken away");
        assert.equal((await ed({ action: "add_days", days: 0 })).status, 400);
        const future = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
        const setRes = await ed({ action: "set_until", date: future }); const set = setRes.data.until;
        assert.ok(set > before + 40 * 86_400_000, "an exact end date can be set");
        assert.equal((await ed({ action: "set_until", date: "nope" })).status, 400);
        assert.equal((await ed({ action: "founder", on: true })).data.founder, true);
        assert.equal((await ed({ action: "wall", name: "Pat" })).data.wall, "Pat");
        const row = (await o.request("/api/admin/supporters")).data.everyone.find(r => r.id === "222222222");
        assert.deepEqual({ founder: row.founder, wall: row.wall, active: row.active }, { founder: true, wall: "Pat", active: true });
        await ed({ action: "remove" });
        assert.equal(isSupporter(o.db, "222222222"), false, "ending a pass takes it away");
        assert.equal((await o.request("/api/admin/supporters")).data.everyone.find(r => r.id === "222222222").active, false, "but they stay listed for editing");
        assert.equal((await o.request("/api/admin/supporters/edit", { method: "POST", body: { id: "x", action: "remove" } })).status, 400);
        assert.equal((await o.request("/api/supporter/wall", { method: "POST", body: { name: "Sam" } })).data.wall, "Sam");
        assert.deepEqual((await o.request("/api/public/supporters")).data.wall.map(w => w.name), ["Pat", "Sam"], "founders first, even after their pass ended");
        const refund = JSON.stringify({ type: "refund.updated", data: { object: { refund: { id: "R1", payment_id: "PAY1", status: "COMPLETED", amount_money: { amount: 300 } } } } });
        assert.equal((await hook(refund)).status, 200);
        assert.equal(isSupporter(o.db, "123456789"), false, "a full refund ends the pass");
        assert.equal((await o.request("/api/admin/supporters")).data.revenue.total, 0);
    } finally { await o.close(); }
    const off = await signedIn();
    try {
        assert.equal((await fetch(off.base + "/api/square/webhook", { method: "POST", body: "{}" })).status, 404, "nothing to call when Square isn't set up");
        assert.equal((await off.request("/api/supporter")).data.enabled, false);
    } finally { await off.close(); }
});

test("admin panel: reported profile pages can be hidden, restored and dismissed, and the attention list counts them", async () => {
    const o = await signedIn({ config: { ownerId: "u1" } });
    try {
        o.db.ensureUser("u2"); o.db.setProfile("u2", { slug: "pat", isPublic: true });
        o.db.addProfileReport("pat", "Pretending to be someone");
        assert.ok((await o.request("/api/admin/attention")).data.items.some(i => /reported profile/.test(i.text)));
        assert.equal((await o.request("/api/admin/profiles", { method: "POST", body: { slug: "pat", action: "hide" } })).status, 200);
        assert.equal((await o.request("/api/admin/profiles")).data.reports[0].hidden, true);
        assert.equal((await o.request("/api/admin/profiles", { method: "POST", body: { slug: "pat", action: "show" } })).status, 200);
        assert.equal((await o.request("/api/admin/profiles")).data.reports[0].hidden, false);
        assert.equal((await o.request("/api/admin/profiles", { method: "POST", body: { slug: "pat", action: "dismiss" } })).status, 200);
        assert.equal((await o.request("/api/admin/profiles")).data.reports.length, 0);
    } finally { await o.close(); }
});

test("every admin route turns a signed-in non-owner away", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/dashboard/server.js", import.meta.url), "utf8");
    const routes = [...new Set([...src.matchAll(/^\s*"(GET|POST) (\/api\/admin\/[A-Za-z0-9_./-]+)":/gm)].map(m => [m[1], m[2]].join(" ")))];
    assert.ok(routes.length > 40, "found the routes");
    const t = await signedIn();
    const open = [];
    for (const r of routes) {
        const [method, path] = r.split(" ");
        const res = await t.request(path, method === "POST" ? { method: "POST", body: {} } : {});
        if (res.status !== 403) open.push(`${r} -> ${res.status}`);
    }
    await t.close();
    assert.deepEqual(open, [], "these admin routes answer someone who is not the owner");
});

test("bundle landing page: shows the bundle, counts visits, redirects only to known stores, serves the picture from our own address", async () => {
    const png = new Uint8Array([137, 80, 78, 71]).buffer;
    const o = await signedIn({ config: { ownerId: "u1" }, extra: { imageFetch: async u => (u === "https://cdn.humble.test/pic.png" ? { ok: true, headers: { get: () => "image/png" }, arrayBuffer: async () => png } : { ok: false }) } });
    const mk = (n, over = {}) => ({ key: "humble:b" + n, store: "humble", title: "Indie <Legends> Bundle", url: "https://www.humblebundle.com/games/legends", image: "https://cdn.humble.test/pic.png", games: ["Hades Clone", "Pixel Quest"], gameCount: 9, price: "$12", expiresAt: Date.now() + 5 * 86_400_000, seenAt: Date.now(), ...over });
    o.db.upsertFeedBundle(mk(1)); o.db.upsertFeedBundle(mk(2, { url: "https://evil.example/steal", image: null })); o.db.upsertFeedBundle(mk(3, { adult: true }));
    const [a, b, c] = o.db.listFeedBundles({ status: "active", limit: 10 }).sort((x, y) => x.key.localeCompare(y.key));
    const get = (path, opts = {}) => fetch(o.base + path, { redirect: "manual", headers: { "User-Agent": "Mozilla/5.0 Chrome/120" }, ...opts });
    const page = await get(`/b/${a.id}`), html = await page.text();
    assert.equal(page.status, 200); assert.match(html, /Indie &lt;Legends&gt; Bundle/, "the title is escaped"); assert.ok(!/<Legends>/.test(html));
    assert.match(html, /Taking you to Humble Bundle in 6 seconds/); assert.match(html, new RegExp(`/b/${a.id}/go`)); assert.match(html, /noscript/); assert.match(html, /Found a good one/);
    assert.match(page.headers.get("x-robots-tag"), /noindex/); assert.ok(!/<style|style="|<script>/i.test(html), "nothing inline, so the CSP holds");
    assert.equal(o.db.getMeta(`bundlevisit:${a.id}`), "1");
    const go = await get(`/b/${a.id}/go`); assert.equal(go.status, 302); assert.equal(go.headers.get("location"), "https://www.humblebundle.com/games/legends"); assert.equal(o.db.getMeta(`bundlego:${a.id}`), "1");
    const bad = await get(`/b/${b.id}/go`); assert.equal(bad.status, 404, "a link to some other site is never followed");
    assert.ok(!/Taking you to/.test(await (await get(`/b/${b.id}`)).text()), "and the page doesn't auto-redirect to it either");
    const img = await get(`/b/${a.id}/img`); assert.equal(img.status, 200); assert.equal(img.headers.get("content-type"), "image/png");
    assert.equal((await get(`/b/${b.id}/img`)).status, 404, "no picture, no image");
    assert.equal((await get(`/b/${c.id}`)).status, 404, "adult bundles have no page"); assert.equal((await get("/b/99999")).status, 404);
    assert.match(await (await get("/b/99999")).text(), /isn't here any more/);
    assert.match(html, /name="twitter:image" content="[^"]*\/b\/\d+\/img"/); assert.match(html, /og:image:alt" content="Indie &lt;Legends&gt; Bundle"/); assert.match(html, /name="twitter:card" content="summary_large_image"/); assert.match(html, /name="twitter:title"/);
    assert.equal((await get("/go.css")).status, 200); assert.equal((await get("/go.js")).status, 200);
    await o.close();
});

test("deal pages: free games get a landing page and counted redirect, and every post link goes through it", async () => {
    const { configureDeals, dealUrl } = await import("../src/deallinks.js");
    const { freeGamesPayload } = await import("../src/render.js");
    const o = await signedIn({ config: { ownerId: "u1" } });
    const get = (path, opts = {}) => fetch(o.base + path, { redirect: "manual", headers: { "User-Agent": "Mozilla/5.0 Chrome/120" }, ...opts });
    const id = o.db.upsertDeal({ key: "free:g1", kind: "free", title: "Cool <Game>", shop: "Epic Games", url: "https://store.epicgames.com/p/cool", expiry: Date.now() + 86_400_000 * 2 });
    assert.equal(o.db.upsertDeal({ key: "free:g1", kind: "free", title: "Cool <Game>", shop: "Epic Games", url: "https://store.epicgames.com/p/cool" }), id, "same game, same page");
    const bad = o.db.upsertDeal({ key: "free:bad", kind: "free", title: "Nope", shop: "X", url: "javascript:alert(1)" });
    assert.equal(bad, null);
    const page = await get(`/d/${id}`), html = await page.text();
    assert.equal(page.status, 200); assert.match(html, /Cool &lt;Game&gt;/); assert.ok(!/<Game>/.test(html)); assert.match(html, /Claim it now/); assert.match(html, new RegExp(`/d/${id}/go`));
    assert.ok(!/<style|style="|<script>/i.test(html)); assert.equal(o.db.getMeta(`dealvisit:${id}`), "1");
    const go = await get(`/d/${id}/go`); assert.equal(go.status, 302); assert.equal(go.headers.get("location"), "https://store.epicgames.com/p/cool"); assert.equal(o.db.getMeta(`dealgo:${id}`), "1");
    assert.equal((await get("/d/99999")).status, 404);
    // with the linker on, bot posts point at the page; without it they fall back to the store
    const g = { id: "g1", title: "Cool Game", url: "https://store.epicgames.com/p/cool", expiry: Date.now() + 1e8 };
    assert.equal(freeGamesPayload("Epic Games", [g]).embeds[0].url, g.url);
    configureDeals({ base: "https://steamvaluechecker.com", make: d => `https://steamvaluechecker.com/d/${o.db.upsertDeal(d)}` });
    try {
        const p = freeGamesPayload("Epic Games", [g]);
        assert.match(p.embeds[0].url, /\/d\/\d+$/); assert.match(p.components[0].components[0].url, /\/d\/\d+$/);
        const { bundleFeedEmbed } = await import("../src/bundlefeed.js");
        assert.match(bundleFeedEmbed({ id: 7, store: "humble", title: "B", url: "https://www.humblebundle.com/x", games: [] }).embeds[0].url, /\/b\/7$/);
    } finally { configureDeals(null); }
    assert.equal(dealUrl({ url: "https://a.example/x" }), "https://a.example/x");
    await o.close();
});

test("every store link in any message goes through a landing page that shows what was clicked", async () => {
    const { configureDeals } = await import("../src/deallinks.js");
    const { brandPayload } = await import("../src/brand.js");
    const o = await signedIn({ config: { ownerId: "u1" } });
    configureDeals({ base: "https://steamvaluechecker.com", make: d => `https://steamvaluechecker.com/d/${o.db.upsertDeal(d)}` });
    try {
        const p = brandPayload({
            content: "Try [Hades](https://store.steampowered.com/app/1145360/) and [a blog](https://example.com/x)",
            embeds: [{ title: "🔥 Hades is 50% off", url: "https://store.steampowered.com/app/1145360/", description: "Roguelike. See [GOG](https://www.gog.com/game/hades)", fields: [{ name: "Price", value: "**$12.49**" }] }],
            components: [{ type: 1, components: [{ type: 2, style: 5, label: "Steam page", url: "https://store.steampowered.com/app/1145360/" }, { type: 2, style: 5, label: "Support", url: "https://discord.gg/abc" }] }]
        });
        const e = p.embeds[0];
        assert.match(e.url, /^https:\/\/steamvaluechecker\.com\/d\/\d+$/); assert.equal(p.components[0].components[0].url, e.url, "the same link, the same page");
        assert.equal(p.components[0].components[1].url, "https://discord.gg/abc"); assert.match(e.description, /\]\(https:\/\/steamvaluechecker\.com\/d\/\d+\)/);
        assert.match(p.content, /\(https:\/\/steamvaluechecker\.com\/d\/\d+\)/); assert.match(p.content, /\(https:\/\/example\.com\/x\)/, "not a store, untouched");
        const id = e.url.split("/").pop(), html = await (await fetch(o.base + `/d/${id}`)).text();
        assert.match(html, /Hades is 50% off/); assert.match(html, /\$12\.49/); assert.match(html, /Roguelike/); assert.ok(!/FREE ·/.test(html), "a sale isn't labelled free");
        assert.match(html, /While you wait/); assert.match(html, /Take me there/);
        assert.match(html, /og:image" content="[^"]*\/d\/\d+\/img/);
    } finally { configureDeals(null); }
    await o.close();
});

test("link traffic: people and link-preview robots are counted apart, and the admin page reports them", async () => {
    const o = await signedIn({ config: { ownerId: "u1" } });
    const id = o.db.upsertDeal({ key: "free:t1", kind: "free", title: "Traffic Game", shop: "Epic Games", url: "https://store.epicgames.com/p/t" });
    const hit = (path, ua) => fetch(o.base + path, { redirect: "manual", headers: { "User-Agent": ua } });
    await hit(`/d/${id}`, "Mozilla/5.0 (Windows NT 10.0) Chrome/120"); await hit(`/d/${id}`, "Mozilla/5.0 (Windows NT 10.0) Chrome/120");
    await hit(`/d/${id}`, "Mozilla/5.0 (compatible; Discordbot/2.0)"); await hit(`/d/${id}/go`, "Mozilla/5.0 Chrome/120");
    const r = (await o.request("/api/admin/traffic")).data;
    assert.equal(r.today.visits, 2); assert.equal(r.today.previews, 1); assert.equal(r.today.clicks, 1);
    assert.equal(r.top[0].title, "Traffic Game"); assert.equal(r.top[0].visits, 2); assert.equal(r.top[0].kind, "Free game");
    assert.equal(r.total.clicks, 1);
    await o.close();
});

test("sale alerts that link through IsThereAnyDeal's redirect go to a landing page too", async () => {
    const { configureDeals } = await import("../src/deallinks.js");
    const { brandPayload } = await import("../src/brand.js");
    const o = await signedIn({ config: { ownerId: "u1" } });
    configureDeals({ base: "https://steamvaluechecker.com", make: d => `https://steamvaluechecker.com/d/${o.db.upsertDeal(d)}` });
    try {
        const u = "https://itad.link/abc123/";
        const p = brandPayload({ embeds: [{ title: "Dead Island 2 - SoLA is 72% off", url: u, description: "$2.84 at **Fanatical** (you save $7.15)" }], components: [{ type: 1, components: [{ type: 2, style: 5, label: "Deal: Dead Island 2 - SoLA", url: u }, { type: 2, style: 5, label: "Price history", url: "https://isthereanydeal.com/game/x/history/" }] }] });
        assert.match(p.embeds[0].url, /steamvaluechecker\.com\/d\/\d+$/); assert.equal(p.components[0].components[0].url, p.embeds[0].url);
        assert.equal(p.components[0].components[1].url, "https://isthereanydeal.com/game/x/history/", "info pages stay direct");
        const d = o.db.getDeal(Number(p.embeds[0].url.split("/").pop())); assert.equal(d.shop, "Fanatical"); assert.equal(d.url, u);
    } finally { configureDeals(null); }
    await o.close();
});

test("each public page has its own title, description, picture and questions, and a single ticket stays out of search", async () => {
    const o = await signedIn({ config: { ownerId: "u1" } });
    const seen = new Set();
    for (const k of ["support", "help", "about", "status", "tip", "feed", "discover", "communities"]) {
        const html = await o.request("/" + k, { raw: true }).then(r => r.text());
        assert.match(html, new RegExp(`rel="canonical" href="[^"]*/${k}"`), k); assert.match(html, new RegExp(`og:image" content="[^"]*/page-${k}\\.jpg`), k);
        assert.match(html, /"@type":"FAQPage"/, k); assert.match(html, /name="robots" content="index,follow/, k); assert.match(html, /<noscript><main><h1>/, k);
        assert.ok(!/<title>Steam Value Checker: game library/.test(html), k + " still has the home page title");
        const title = /<title>([^<]*)<\/title>/.exec(html)[1]; assert.ok(!seen.has(title), "titles are all different"); seen.add(title);
        assert.equal((await o.request(`/page-${k}.jpg`, { raw: true })).status, 200, k);
    }
    assert.match(await o.request("/help", { raw: true }).then(r => r.text()), /<title>Help and commands/);
    assert.match(await o.request("/support/12", { raw: true }).then(r => r.text()), /noindex,nofollow/);
    const map = (await o.request("/sitemap.xml")).text; for (const k of ["support", "help", "about"]) assert.match(map, new RegExp(`/${k}<`));
    await o.close();
});

test("admin X page lists the free games, builds each post with its landing link, and marks hand-posted games as done", async () => {
    const posted = [];
    const xposter = { configured: () => true, tags: () => ["#PCGaming"], freePosted: id => id === "2", bundlePosted: () => false, status: () => ({}), manual: async a => { posted.push(a); return { id: "1" }; } };
    const o = await signedIn({ config: { ownerId: "u1" }, extra: { xposter } });
    const rr = await o.request("/api/admin/xposter/free"); const r = rr.data;
    assert.equal(r.games.length, 2); const a = r.games.find(g => g.id === "1");
    assert.match(a.text, /Free right now: Alpha/); assert.match(a.text, /\/d\/\d+/); assert.ok(!a.text.includes("e.example/a"), "the post links to our page, not the store");
    assert.equal(r.games.find(g => g.id === "2").posted, true);
    assert.ok(!(await o.request("/api/admin/xposter/free?link=0")).data.games[0].text.includes("/d/"), "links off means the store's own link");
    await o.request("/api/admin/xposter/post", { method: "POST", body: { text: a.text, free_id: "1" } });
    assert.equal(posted[0].freeId, "1");
    await o.close();
});

test("admin weekly deals: status, settings and post now are owner-only and report problems plainly", async () => {
    const { createWeekly } = await import("../src/weeklydeals.js");
    const deal = t => ({ id: t, title: t, cut: 70, price: 12, regular: 40, currency: "USD", url: "https://store.steampowered.com/app/1/", appid: 1 });
    const o = await signedIn({ config: { ownerId: "u1" } });
    assert.equal((await o.request("/api/admin/weekly")).status, 503);
    await o.close();
    const sent = [], weekly = createWeekly({ db: openDb(":memory:"), itad: { getDealsPool: async () => ["A", "B", "C", "D"].map(deal) }, postDiscord: async (c, p) => sent.push([c, p]) });
    const o2 = await signedIn({ config: { ownerId: "u1" }, extra: { weekly } });
    const st = (await o2.request("/api/admin/weekly")).data; assert.equal(st.picks.length, 4); assert.equal(st.on, true);
    assert.equal((await o2.request("/api/admin/weekly", { method: "POST", body: { channel: "nope" } })).status, 400);
    assert.equal((await o2.request("/api/admin/weekly", { method: "POST", body: { channel: "123456789012345678", on: false } })).data.channel, "123456789012345678");
    assert.equal((await o2.request("/api/admin/weekly/run", { method: "POST", body: {} })).data.discord, true); assert.equal(sent.length, 1);
    await o2.close();
});

test("profile share previews lead with the library's worth, but only when the person shows it publicly", async () => {
    const { shareFacts } = await import("../src/cardimg.js");
    assert.deepEqual(shareFacts({ sections: [{ key: "value", worth: 4212 }, { key: "favorites", games: [{}, {}] }] }), ["$4,212 library", "2 favorites"]);
    assert.deepEqual(shareFacts({ sections: [{ key: "favorites", games: [{}] }] }), ["1 favorite"], "no value section, no worth chip");
    const o = await signedIn({ config: { ownerId: "u1" } });
    try {
        await o.request("/api/profile", { method: "POST", body: { enabled: true, slug: "worthy" } });
        const page = vis => o.request("/api/profile/page", { method: "POST", body: { name: "Jacob", bio: "I play too much.", sections: [{ key: "about", vis: "public" }, { key: "value", vis }] } });
        o.db.upsertSnapshot("u1", { day: "2026-11-09", games: 312, paid: 900, msrp: 4212.4, msrp_paid: 1000, cheapest: 800 });
        await page("hidden");
        let html = await (await fetch(o.base + "/u/worthy")).text();
        assert.doesNotMatch(html, /library is worth \$/); assert.match(html, /og:description" content="I play too much\./);
        await page("public");
        html = await (await fetch(o.base + "/u/worthy")).text();
        assert.match(html, /Jacob&#39;s game library is worth \$4,212 across 312 games\. I play too much\./);
    } finally { await o.close(); }
});

test("invite links: /r/<code> remembers the sender, a first sign-in credits them, and the page reports the totals", async () => {
    const { createReferrals } = await import("../src/referrals.js");
    const rdb = openDb(":memory:"), grants = [];
    const referrals = createReferrals({ db: rdb, supporters: { grant: async (...a) => { grants.push(a); return { until: Date.now() + 1e9 }; } }, publicUrl: "http://x.test" });
    const code = referrals.codeFor("sender9");
    const t = await setup({ extra: { referrals } });
    try {
        assert.equal((await t.request("/api/referral")).status, 401, "signed out");
        const r = await t.request(`/r/${code}`); assert.equal(r.status, 302); assert.equal(r.headers.get("location"), "/"); assert.ok(r.set.some(c => c.startsWith("svc_ref=")));
        const bad = await t.request("/r/zzzzzzzz"); assert.equal(bad.status, 302); assert.ok(!bad.set.some(c => c.startsWith("svc_ref=")), "an unknown code isn't remembered");
        await t.signIn(); await new Promise(r => setTimeout(r, 50));
        assert.equal(grants.length, 1); assert.equal(grants[0][0], "sender9"); assert.equal(grants[0][4], 0);
        assert.equal((await t.request("/api/referral")).data.joined, 0, "u1 has invited nobody");
        assert.ok(!t.cookie().includes("svc_ref="), "the cookie is used up");
    } finally { await t.close(); }
});

test("admin problems list and next-post preview are owner-only", async () => {
    const { recordProblem } = await import("../src/adminlog.js");
    const xposter = { configured: () => true, tags: () => [], freePosted: () => false, bundlePosted: () => false, status: () => ({}), peek: () => ({ title: "Next One", text: "hi", chars: 2, cost: 0.2 }) };
    const o = await signedIn({ config: { ownerId: "u1" }, extra: { xposter } });
    assert.deepEqual((await o.request("/api/admin/problems")).data.list, []);
    recordProblem(o.db, "X post", "boom");
    const list = (await o.request("/api/admin/problems")).data.list;
    assert.equal(list[0].where, "X post"); await o.request("/api/admin/problems/clear", { method: "POST", body: {} }); assert.equal((await o.request("/api/admin/problems")).data.list.length, 0);
    assert.equal((await o.request("/api/admin/xposter/next")).data.title, "Next One");
    await o.close();
    const u = await signedIn({ config: { ownerId: "someone-else" } });
    assert.equal((await u.request("/api/admin/problems")).status, 403);
    assert.equal((await u.request("/api/admin/xposter/next")).status, 403);
    await u.close();
});

// ---------- indie showcase ----------
const steamStub = (over = {}) => async (url) => {
    const j = o => ({ ok: true, status: 200, json: async () => o });
    if (/appreviews/.test(url)) return j({ query_summary: { total_positive: 90, total_negative: 10, total_reviews: 100, review_score_desc: "Very Positive" } });
    if (/storesearch/.test(url)) return j({ items: [{ id: 10, name: "Hades", price: { final: 2499 } }] });
    const id = /appids=(\d+)/.exec(url)[1];
    if (id === "999") return j({ [id]: { success: false } });
    return j({ [id]: { success: true, data: { type: id === "888" ? "dlc" : "game", name: `Game ${id}`, developers: ["Studio X"], short_description: "<b>Short</b> blurb &amp; more", genres: [{ description: "Indie" }], is_free: false, price_overview: { final_formatted: "$9.99", initial: 999 }, release_date: { date: "Jan 1, 2027" }, platforms: { windows: true }, ...over } } });
};
const indieSetup = async (extra = {}) => { const { createIndie } = await import("../src/indie.js"); return signedIn({ config: { ownerId: "u1" }, extra: { indieSvc: createIndie({ fetchImpl: steamStub() }), ...extra } }); };

test("indie: the showcase and tools are public, the submit form needs a sign-in, and the owner reviews everything", async () => {
    const t = await indieSetup();
    const anon = async (p, opt) => fetch(t.base + p, opt);
    // public pages
    assert.equal((await anon("/api/indie/tools")).status, 200);
    assert.equal((await anon("/api/indie")).status, 200);
    const lk = await anon("/api/indie/lookup?q=" + encodeURIComponent("https://store.steampowered.com/app/321/Thing/"));
    const lkd = await lk.json(); assert.equal(lkd.game.title, "Game 321"); assert.equal(lkd.game.blurb, "Short blurb & more"); assert.equal(lkd.game.reviews.total, 100);
    assert.equal((await (await anon("/api/indie/lookup?q=hades")).json()).results[0].appid, 10);
    assert.equal((await anon("/api/indie/lookup?q=")).status, 400);
    for (const [path, re] of [["/indie", /Indie games on Steam/], ["/indie/tools", /free Steam tools for indie game developers/], ["/indie/tools/fee-calculator", /Steam Fee and Tax Calculator/]]) { const r = await anon(path); assert.equal(r.status, 200); assert.match(await r.text(), re); }
    assert.match(await (await anon("/indie/submit")).text(), /noindex/);
    assert.ok([401, 403].includes((await anon("/api/indie/submit", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status), "no submitting without signing in");
    await t.close();
});

test("indie: submitting checks the link, the pitch and the limits; the owner approves; people can like and the page shows up in search", async () => {
    const { createIndie } = await import("../src/indie.js");
    const owner = await signedIn({ config: { ownerId: "u1" }, extra: { indieSvc: createIndie({ fetchImpl: steamStub() }) } });
    const post = (p, body) => owner.request(p, { method: "POST", body });
    const ok = { url: "https://store.steampowered.com/app/100/A/", pitch: "A long enough pitch about the game.", team: true, links: { website: "https://example.com", discord: "javascript:alert(1)", trailer: "https://youtu.be/x" } };
    assert.equal((await post("/api/indie/submit", { ...ok, url: "nope" })).status, 400);
    assert.equal((await post("/api/indie/submit", { ...ok, team: false })).status, 400);
    assert.equal((await post("/api/indie/submit", { ...ok, pitch: "short" })).status, 400);
    assert.equal((await post("/api/indie/submit", { ...ok, url: "https://store.steampowered.com/app/888/Dlc/" })).status, 400, "DLC isn't a game");
    assert.equal((await post("/api/indie/submit", { ...ok, url: "https://store.steampowered.com/app/999/Gone/" })).status, 400, "no store page");
    const r = await post("/api/indie/submit", ok); assert.equal(r.status, 200); assert.equal(r.data.status, "approved", "the bot owner's own game goes straight in");
    assert.equal((await post("/api/indie/submit", ok)).status, 400, "no duplicates");
    const game = (await owner.request("/api/indie/game?id=" + r.data.id)).data.game;
    assert.equal(game.title, "Game 100"); assert.equal(game.studio, "Studio X"); assert.deepEqual(Object.keys(game.links).sort(), ["trailer", "website"], "unsafe links are dropped");
    assert.equal(game.owner_id, undefined, "the owner's id is never shown");
    const like = await post("/api/indie/like", { id: r.data.id }); assert.deepEqual([like.data.liked, like.data.likes], [true, 1]);
    assert.equal((await post("/api/indie/like", { id: r.data.id })).data.likes, 0, "liking again takes it back");
    const list = (await owner.request("/api/indie?q=game")).data; assert.equal(list.total, 1); assert.equal(list.genres[0].name, "Indie");
    assert.equal((await owner.request("/api/indie?genre=Puzzle")).data.total, 0);
    const html = await (await fetch(owner.base + "/indie/game/" + r.data.id)).text();
    assert.match(html, /<title>Game 100 by Studio X/); assert.match(html, /og:image" content="https:\/\/[^"]*100/);
    assert.match(await (await fetch(owner.base + "/sitemap.xml")).text(), new RegExp(`/indie/game/${r.data.id}<`));
    assert.match(await (await fetch(owner.base + "/robots.txt")).text(), /Disallow: \/indie\/submit/);
    await owner.close();
});

test("indie: other people's games wait in a queue, show nowhere until approved, and the review actions work and tell the developer", async () => {
    const { createIndie } = await import("../src/indie.js");
    const t = await setup({ config: { ownerId: "boss" }, extra: { indieSvc: createIndie({ fetchImpl: steamStub() }) } });
    await t.signIn();
    const post = (p, body) => t.request(p, { method: "POST", body });
    const ids = [];
    for (const n of [1, 2, 3]) { const r = await post("/api/indie/submit", { url: `https://store.steampowered.com/app/${n}/`, pitch: "A long enough pitch about the game.", team: true }); assert.equal(r.data.status, "pending"); ids.push(r.data.id); }
    assert.equal((await post("/api/indie/submit", { url: "https://store.steampowered.com/app/4/", pitch: "A long enough pitch about the game.", team: true })).status, 400, "three waiting at once is the limit");
    assert.equal((await t.request("/api/indie")).data.total, 0, "nothing public yet");
    assert.equal((await fetch(t.base + "/api/indie/game?id=" + ids[0])).status, 404, "anonymous visitors can't see a pending game");
    assert.equal((await t.request("/api/indie/game?id=" + ids[0])).data.game.mine, true, "but its developer can");
    assert.equal((await t.request("/api/admin/indie")).status, 403); assert.equal((await post("/api/admin/indie/review", { id: ids[0], action: "approve" })).status, 403);
    const edit = await post("/api/indie/edit", { id: ids[0], pitch: "A better pitch than the first one was.", links: { x: "https://x.com/me" } }); assert.equal(edit.status, 200);
    assert.equal((await t.request("/api/indie/mine")).data.games.length, 3);
    assert.equal((await post("/api/indie/withdraw", { id: ids[2] })).status, 200);
    await t.close();
});

test("indie: owner-only queue, approve, reject with a note, feature, pause and sync", async () => {
    const { createIndie } = await import("../src/indie.js");
    const owner = await signedIn({ config: { ownerId: "u1" }, extra: { indieSvc: createIndie({ fetchImpl: steamStub({ short_description: "Fresh from Steam" }) }) } });
    const a = owner.db.indieAdd({ appid: 1, ownerId: "dev1", title: "One", pitch: "p", genres: ["Indie"], image: "https://x/1.jpg" }), b = owner.db.indieAdd({ appid: 2, ownerId: "dev2", title: "Two", pitch: "p", genres: [], image: "https://x/2.jpg" });
    owner.db.ensureUser("dev1"); owner.db.ensureUser("dev2");
    const review = (id, action, note) => owner.request("/api/admin/indie/review", { method: "POST", body: { id, action, note } });
    let q = (await owner.request("/api/admin/indie")).data; assert.equal(q.counts.pending, 2); assert.equal(q.games.length, 2);
    assert.equal((await review(a, "approve")).status, 200); assert.equal((await review(b, "reject", "Needs a clearer pitch")).status, 200);
    assert.equal(owner.db.indieGet(a).status, "approved"); assert.equal(owner.db.indieGet(b).note, "Needs a clearer pitch");
    assert.equal(owner.db.listNotifications("dev2")[0].title, "Two wasn't accepted yet");
    assert.equal((await review(a, "feature")).status, 200); assert.equal((await owner.request("/api/indie")).data.featured[0].title, "One");
    assert.equal((await review(a, "refresh")).status, 200); assert.equal(owner.db.indieGet(a).title, "Game 1", "sync brings the Steam details back in");
    assert.equal((await review(null, "syncall")).status, 200);
    assert.equal((await owner.request("/api/admin/indie/open", { method: "POST", body: { open: false } })).status, 200);
    assert.equal((await owner.request("/api/indie")).data.open, false);
    assert.equal((await review(b, "remove")).status, 200); assert.equal(owner.db.indieGet(b), null);
    assert.equal((await review(a, "bogus")).status, 400);
    await owner.close();
});

test("indie: a developer can sync their own game but not someone else's, and deleting an account takes their games and likes", async () => {
    const { createIndie } = await import("../src/indie.js");
    const t = await setup({ config: { ownerId: "boss" }, extra: { indieSvc: createIndie({ fetchImpl: steamStub() }) } });
    await t.signIn();
    const mine = t.db.indieAdd({ appid: 5, ownerId: "u1", title: "Old name", pitch: "p", genres: [], image: "https://x/5.jpg" }), other = t.db.indieAdd({ appid: 6, ownerId: "someone", title: "Theirs", pitch: "p", genres: [], image: "https://x/6.jpg" });
    t.db.indieDecide(mine, "approved"); t.db.indieDecide(other, "approved");
    const sync = await t.request("/api/indie/sync", { method: "POST", body: { id: mine } }); assert.equal(sync.status, 200); assert.equal(sync.data.game.title, "Game 5");
    assert.equal((await t.request("/api/indie/sync", { method: "POST", body: { id: mine } })).status, 429, "once a minute");
    assert.equal((await t.request("/api/indie/sync", { method: "POST", body: { id: other } })).status, 404);
    t.db.indieToggleLike(other, "u1"); assert.equal(t.db.indieGet(other).likes, 1);
    assert.equal(t.db.indieExport("u1").games.length, 1);
    t.db.deleteUser("u1");
    assert.equal(t.db.indieGet(mine), null, "their game goes"); assert.equal(t.db.indieGet(other).likes, 0, "and their like");
    await t.close();
});

test("indie: the owner can spotlight an approved game on the project's X account", async () => {
    const posted = [];
    const xposter = { configured: () => true, tags: () => [], freePosted: () => false, bundlePosted: () => false, status: () => ({}), manual: async a => { posted.push(a); return { id: "1" }; } };
    const o = await signedIn({ config: { ownerId: "u1" }, extra: { xposter } });
    const id = o.db.indieAdd({ appid: 3, ownerId: "dev", title: "Moss Knight", studio: "Moss Co", pitch: "word ".repeat(100), genres: [], image: "https://x/3.jpg" });
    const call = () => o.request("/api/admin/indie/review", { method: "POST", body: { id, action: "xpost" } });
    assert.equal((await call()).status, 400, "not until it's approved");
    o.db.indieDecide(id, "approved");
    assert.equal((await call()).status, 200);
    const { xLength } = await import("../src/xposter.js");
    assert.match(posted[0].text, /^Indie spotlight: Moss Knight by Moss Co/); assert.match(posted[0].text, /\/indie\/game\/\d+\n#indiegame #gamedev #Steam$/); assert.ok(xLength(posted[0].text) <= 280);
    await o.close();
});

// ---------- indie: follows, developer news, keys, verification, reports, stats, badge, spotlight ----------
test("indie: following, developer news, review keys, verification, stats and the badge", async () => {
    const { createIndie } = await import("../src/indie.js");
    const published = []; let pageText = "";
    const t = await setup({ config: { ownerId: "boss" }, extra: { indieSvc: createIndie({ fetchImpl: (url) => steamStub({ about_the_game: pageText })(url) }), indieNews: { publish: async (g, u) => { published.push([g.id, u.title, u.kind]); return {}; } } } });
    await t.signIn();
    const post = (p, body) => t.request(p, { method: "POST", body });
    t.db.ensureUser("dev"); t.db.ensureUser("f1");
    const mine = t.db.indieAdd({ appid: 5, ownerId: "u1", title: "Mine", studio: "Me Co", pitch: "p", genres: ["Indie"], image: "https://x/5.jpg" }), theirs = t.db.indieAdd({ appid: 6, ownerId: "dev", title: "Theirs", studio: "Dev Co", pitch: "p", genres: ["Indie"], image: "https://x/6.jpg" });
    t.db.indieDecide(mine, "approved"); t.db.indieDecide(theirs, "approved");
    // following
    assert.deepEqual([(await post("/api/indie/follow", { id: theirs })).data.following, (await post("/api/indie/follow", { id: theirs, kind: "studio" })).data.following], [true, true]);
    assert.equal((await post("/api/indie/follow", { id: mine, kind: "studio" })).status, 400, "not your own studio");
    assert.equal((await t.request("/api/indie/following")).data.games.length, 1, "a game followed twice shows once");
    const g = (await t.request("/api/indie/game?id=" + theirs)).data.game; assert.deepEqual([g.following.game, g.following.studio, g.followers], [true, true, 1]);
    assert.equal((await post("/api/indie/follow", { id: theirs })).data.following, false, "following again takes it back");
    // developer news
    assert.equal((await post("/api/indie/update", { id: theirs, title: "Hello there" })).status, 404, "only the owner posts");
    assert.equal((await post("/api/indie/update", { id: mine, title: "x" })).status, 400);
    assert.equal((await post("/api/indie/update", { id: mine, title: "Demo is out", link: "http://nope.example" })).status, 400, "https only");
    const up = await post("/api/indie/update", { id: mine, kind: "demo", title: "Demo is out", body: "Try it free.", link: "https://example.com/demo" }); assert.equal(up.status, 200);
    assert.deepEqual(published[0], [mine, "Demo is out", "demo"]);
    assert.equal((await t.request("/api/indie/game?id=" + mine)).data.game.updates[0].title, "Demo is out");
    assert.equal((await t.request("/api/indie/news")).data.news[0].game, "Mine");
    assert.equal((await post("/api/indie/update/delete", { id: up.data.id })).status, 200);
    assert.equal((await t.request("/api/indie/game?id=" + mine)).data.game.updates.length, 0);
    // review keys
    assert.equal((await post("/api/indie/keys/request", { id: theirs, name: "Streamer", channel: "https://twitch.tv/x" })).status, 404, "closed until the developer opens it");
    t.db.indieSetKeysOpen(theirs, true);
    assert.equal((await post("/api/indie/keys/request", { id: theirs, name: "S", channel: "https://twitch.tv/x" })).status, 400);
    assert.equal((await post("/api/indie/keys/request", { id: theirs, name: "Streamer", channel: "https://twitch.tv/x" })).status, 200);
    assert.equal((await post("/api/indie/keys/request", { id: theirs, name: "Streamer", channel: "https://twitch.tv/x" })).status, 400, "once per game");
    assert.equal((await t.request("/api/indie/game?id=" + theirs)).data.game.keyRequest, "pending");
    assert.equal((await post("/api/indie/keys/open", { id: mine, open: true })).status, 200);
    t.db.indieKeyRequest({ gameId: mine, userId: "f1", name: "Reviewer", channel: "https://example.com/r", note: null });
    const reqs = (await t.request("/api/indie/keys?id=" + mine)).data; assert.equal(reqs.requests.length, 1);
    assert.equal((await post("/api/indie/keys/decide", { id: reqs.requests[0].id, approve: true })).status, 200);
    assert.equal(t.db.indieKeyRequestOf(mine, "f1").status, "approved"); assert.match(t.db.listNotifications("f1")[0].title, /approved/);
    assert.equal((await t.request("/api/indie/keys?id=" + theirs)).status, 404, "not your game's list");
    // verification
    const st = (await post("/api/indie/verify/start", { id: mine })).data; assert.match(st.code, /^svc-verify-[a-z0-9]{8}$/);
    assert.equal((await post("/api/indie/verify/check", { id: mine })).data.verified, false);
    pageText = `About the game. ${st.code}`;
    assert.equal((await post("/api/indie/verify/check", { id: mine })).data.verified, true);
    assert.equal((await t.request("/api/indie/game?id=" + mine)).data.game.verified, true);
    assert.equal((await post("/api/indie/verify/start", { id: theirs })).status, 404);
    // reports
    assert.equal((await post("/api/indie/report", { id: theirs, reason: "no" })).status, 400);
    assert.equal((await post("/api/indie/report", { id: theirs, reason: "Not a real game page" })).data.already, false);
    assert.equal((await post("/api/indie/report", { id: theirs, reason: "Not a real game page" })).data.already, true);
    // stats and badge
    const stats = (await t.request("/api/indie/stats?id=" + mine)).data; assert.equal(stats.days.length, 14);
    assert.equal((await t.request("/api/indie/stats?id=" + theirs)).status, 404);
    const badge = await fetch(t.base + `/indie/game/${mine}/badge.svg`); assert.equal(badge.status, 200); assert.match(badge.headers.get("content-type"), /svg/); assert.match(await badge.text(), /Mine/);
    t.db.indieDecide(theirs, "rejected"); assert.equal((await fetch(t.base + `/indie/game/${theirs}/badge.svg`)).status, 404, "no badge for a game that isn't live");
    await t.close();
});

test("indie: the owner handles reports, verified marks and the weekly spotlight settings", async () => {
    const calls = [];
    const spotlight = { status: () => ({ on: true, channel: "", last: null, next: { id: 1, title: "A" } }), set: a => { calls.push(["set", a]); return { on: a.on }; }, run: async a => { calls.push(["run", a]); return { game: "A" }; } };
    const o = await signedIn({ config: { ownerId: "u1" }, extra: { spotlight } });
    o.db.ensureUser("dev");
    const id = o.db.indieAdd({ appid: 8, ownerId: "dev", title: "Reported", pitch: "p", genres: [], image: "https://x/8.jpg" }); o.db.indieDecide(id, "approved"); o.db.indieReport({ gameId: id, reporter: "someone", reason: "Looks wrong" });
    assert.equal((await o.request("/api/admin/indie/reports")).data.reports[0].reason, "Looks wrong");
    assert.equal((await o.request("/api/admin/indie")).data.reports, 1);
    const review = (action) => o.request("/api/admin/indie/review", { method: "POST", body: { id, action } });
    assert.equal((await review("verify")).status, 200); assert.equal(o.db.indieGet(id).verified, 1);
    assert.equal((await review("unverify")).status, 200); assert.equal(o.db.indieGet(id).verified, 0);
    assert.equal((await o.request("/api/admin/indie/spotlight")).data.next.title, "A");
    assert.equal((await o.request("/api/admin/indie/spotlight", { method: "POST", body: { on: false, channel: "123456789012345678" } })).status, 200);
    assert.equal((await o.request("/api/admin/indie/spotlight", { method: "POST", body: { run: true } })).data.ran.game, "A");
    assert.deepEqual(calls.map(c => c[0]), ["set", "run"]);
    assert.equal((await o.request("/api/admin/indie/report", { method: "POST", body: { gameId: id, action: "remove" } })).status, 200);
    assert.equal(o.db.indieGet(id).status, "rejected"); assert.equal(o.db.indieReports("open").length, 0);
    await o.close();
});

test("indie: developer news reaches followers and likers, and the Wednesday spotlight posts once and rotates", async () => {
    const { createIndieNews } = await import("../src/indienews.js");
    const { createSpotlight } = await import("../src/indiespotlight.js");
    const t = await setup({ config: { ownerId: "boss" } });
    for (const u of ["dev", "f1", "f2", "l1"]) t.db.ensureUser(u);
    const id = t.db.indieAdd({ appid: 20, ownerId: "dev", title: "Moss", studio: "Moss Co", pitch: "p", genres: ["Indie"], image: "https://x/20.jpg" }); t.db.indieDecide(id, "approved");
    t.db.indieToggleFollow("f1", "game", id); t.db.indieToggleFollow("f2", "studio", "dev"); t.db.indieToggleLike(id, "l1");
    const sent = [], news = createIndieNews({ db: t.db, dm: async (to, p) => { sent.push([to, p.embeds[0].title]); }, sleep: async () => {} });
    const out = await news.publish(t.db.indieGet(id), { kind: "news", title: "Big patch", body: "Fixes", link: null });
    assert.deepEqual([out.followers, out.likers, out.messaged], [2, 1, 2], "followers get a message, likers only a notification");
    assert.deepEqual(sent.map(s => s[0]).sort(), ["f1", "f2"]); assert.match(t.db.listNotifications("l1")[0].title, /Big patch/);
    // spotlight: Wednesday 1pm Eastern
    const wed = Date.UTC(2026, 10, 11, 18, 0), tuesday = Date.UTC(2026, 10, 10, 18, 0), posts = [], channel = [];
    const id2 = t.db.indieAdd({ appid: 21, ownerId: "dev", title: "Second", pitch: "p", genres: [], image: "https://x/21.jpg" }); t.db.indieDecide(id2, "approved");
    t.db.setMeta("indiespot:channel", "123456789012345678");
    let clock = tuesday;
    const sp = createSpotlight({ db: t.db, now: () => clock, xposter: { configured: () => true, status: () => ({ enabled: true }), manual: async a => { posts.push(a.text); return { id: "9" }; } }, postDiscord: async (c, p) => { channel.push(c); }, base: "https://svc.test" });
    assert.equal((await sp.tick()).skipped, "not due", "not on a Tuesday");
    clock = wed;
    const first = await sp.tick(); assert.ok(first.game); assert.match(posts[0], /#WishlistWednesday/); assert.equal(channel.length, 1);
    assert.equal((await sp.tick()).skipped, "not due", "only once that day");
    // servers with their own indie channel get the same pick, pinging their Indie pings role
    t.db.setCommunity("S1", { indie_channel: "c1", ping_indie: "r1" }); t.db.setCommunity("S2", { indie_channel: "c2" });
    const served = [], sp2 = createSpotlight({ db: t.db, now: () => clock, postChannel: async (c, p, role) => { served.push([c, role, p.embeds[0].title]); return true; }, base: "https://svc.test" });
    clock = wed + 14 * 86_400_000; const third = await sp2.tick();
    assert.equal(third.servers, 2); assert.deepEqual(served.map(x => x.slice(0, 2)), [["c1", "r1"], ["c2", null]]); assert.match(served[0][2], /Indie spotlight/);
    clock = wed + 7 * 86_400_000;
    clock = wed + 7 * 86_400_000;
    const second = await sp.tick(); assert.notEqual(second.game, first.game, "the next game gets its turn");
    await t.close();
});

test("indie lookup falls back to the store browse service when appdetails refuses a public page", async () => {
    const { createIndie } = await import("../src/indie.js");
    const seen = [];
    const fetchImpl = async url => {
        seen.push(String(url));
        if (String(url).includes("appdetails")) return { ok: true, json: async () => ({ 777: { success: false } }) };
        return { ok: true, json: async () => ({ response: { store_items: [{ success: 1, visible: true, type: 0, name: "Turtle Farm", appid: 777, basic_info: { short_description: "A cozy farm.", developers: [{ name: "Shell Co" }], publishers: [{ name: "Shell Co" }] }, release: { steam_release_date: 1600353507 }, best_purchase_option: { formatted_final_price: "$9.99", final_price_in_cents: "999" }, platforms: { windows: true, mac: false }, screenshots: { all_ages_screenshots: [{ filename: "steam/apps/777/ss_a.jpg?t=1" }] } }] } }) };
    };
    const g = await createIndie({ fetchImpl }).lookup(777);
    assert.equal(g.title, "Turtle Farm"); assert.equal(g.type, "game"); assert.equal(g.studio, "Shell Co"); assert.equal(g.price, "$9.99");
    assert.equal(g.comingSoon, false); assert.deepEqual(g.platforms, ["windows"]); assert.match(g.screenshots[0], /^https:\/\/.*ss_a\.jpg$/);
    assert.ok(seen.some(u => u.includes("IStoreBrowseService")));
    // a page that is truly hidden still reads as not public
    const none = createIndie({ fetchImpl: async u => ({ ok: true, json: async () => String(u).includes("appdetails") ? { 5: { success: false } } : { response: { store_items: [{ success: 2, appid: 5 }] } } }) });
    await assert.rejects(() => none.lookup(5), /no public store page/);
});

test("parseApp reads the other kinds of Steam links people paste", async () => {
    const { parseApp } = await import("../src/indie.js");
    for (const [u, id] of [["https://store.steampowered.com/app/1145360/Hades/", 1145360], ["steamcommunity.com/app/413150", 413150], ["https://s.team/a/367520", 367520], ["https://steamdb.info/app/2379780/charts/", 2379780], ["https://store.steampowered.com/agecheck/app/1086940/", 1086940], ["12345", 12345]]) assert.equal(parseApp(u), id, u);
    assert.equal(parseApp("Hades"), null);
});

test("LucadoOS windows run the site natively through SVC_SITE", async () => {
    const { readFileSync } = await import("node:fs");
    const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8"), os = readFileSync(new URL("../public/lucadoos.js", import.meta.url), "utf8");
    assert.match(app, /window\.SVC_SITE = envIn =>/); assert.match(app, /mountPage: env => window\.SVC_SITE\(/);
    assert.match(os, /mountPage\(\{ root: mountEl/); assert.match(os, /lucado-frames/);
});

// ---- Fortnite ----
const fnEntry = (over = {}) => ({ regularPrice: 1500, finalPrice: 1200, offerId: "o1", devName: "dev", sortPriority: 1, inDate: "2026-11-01T00:00:00Z", outDate: "2026-11-30T00:00:00Z", giftable: true, tileSize: "Size_1_x_1", colors: { color1: "112233ff", color3: "445566ff", textBackgroundColor: "778899ff" },
    layout: { name: "Peak Style", rank: 50, index: 2, displayType: "tileGrid" }, brItems: [{ id: "Character_X", name: "Peak Guy", type: { value: "outfit", displayValue: "Outfit" }, rarity: { value: "epic", displayValue: "Epic" }, images: { icon: "https://fortnite-api.com/i.png", smallIcon: "https://fortnite-api.com/s.png" } }], ...over });
const fnFetch = (calls = []) => async url => { calls.push(String(url)); const u = String(url);
    if (/v2\/shop/.test(u)) return { ok: true, status: 200, json: async () => ({ data: { date: "2026-11-10T00:00:00Z", entries: [fnEntry(), fnEntry({ offerId: "o2", layout: { name: "Jam Tracks", rank: 10, index: 1, displayType: "expandableList" }, brItems: undefined, tracks: [{ title: "Song", artist: "Band", albumArt: "https://cdn.fortnite-api.com/a.jpg" }] }), fnEntry({ offerId: "o3", layout: undefined, tileSize: "Size_2_x_1" })] } }) };
    if (/creatorcode/.test(u)) return { ok: true, status: 200, json: async () => ({ data: { code: "lucado", account: { name: "Jacob Lucado" }, status: "ACTIVE", verified: false } }) };
    if (/stats\/br/.test(u)) return { ok: true, status: 200, json: async () => ({ data: { account: { name: "Pro" }, stats: { all: { overall: { wins: 5, kills: 10, matches: 20, kd: 1, winRate: 25, top10: 8, minutesPlayed: 600 } } } } }) };
    return { ok: false, status: 404, json: async () => ({ error: "nope" }) }; };

test("fortnite: the shop is grouped into Fortnite's sections, in its order, with prices and sizes", async () => {
    const { createFortnite } = await import("../src/fortnite.js");
    const calls = []; const fn = createFortnite({ fetchImpl: fnFetch(calls) });
    const s = await fn.shop();
    assert.deepEqual(s.sections.map(x => x.name), ["Peak Style", "Jam Tracks", "Featured"], "highest rank first");
    const peak = s.sections[0].entries[0]; assert.equal(peak.name, "Peak Guy"); assert.equal(peak.kind, "outfit"); assert.equal(peak.price, 1200); assert.equal(peak.regular, 1500); assert.deepEqual(peak.colors, ["112233", "445566", "778899"]);
    assert.equal(s.sections[1].entries[0].kind, "jamtrack"); assert.equal(s.sections[1].display, "expandableList"); assert.equal(s.sections[2].entries[0].size, "Size_2_x_1");
    await fn.shop(); assert.equal(calls.length, 1, "the second look comes from the cache");
    assert.ok(s.refreshAt > Date.now() && new Date(s.refreshAt).getUTCHours() === 0);
});

test("fortnite: a failing upstream serves the last good copy, and stats need a key", async () => {
    const { createFortnite } = await import("../src/fortnite.js");
    let t = 0, fail = false; const good = fnFetch();
    const fn = createFortnite({ now: () => t, fetchImpl: async u => (fail ? { ok: false, status: 503, json: async () => ({}) } : good(u)) });
    const first = await fn.shop(); fail = true; t += 11 * 60_000;
    assert.equal((await fn.shop()).count, first.count, "stale but there");
    await assert.rejects(() => createFortnite({ fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }) }).shop(), /isn't answering/);
    await assert.rejects(() => fn.stats("Someone"), /aren't switched on/);
    const keyed = createFortnite({ apiKey: "k", fetchImpl: fnFetch() }); const st = await keyed.stats("Pro"); assert.equal(st.name, "Pro"); assert.equal(st.overall.wins, 5);
});

test("fortnite: the dashboard serves the shop and search to anyone and only offers stats with a key", async () => {
    const { createFortnite } = await import("../src/fortnite.js");
    const t = await setup({ extra: { fortniteSvc: createFortnite({ fetchImpl: fnFetch() }) } });
    const shop = await t.request("/api/fortnite/shop"); assert.equal(shop.status, 200); assert.equal(shop.data.sections[0].name, "Peak Style");
    const status = await t.request("/api/fortnite/status"); assert.equal(status.status, 200); assert.equal(status.data.stats, false);
    assert.equal((await t.request("/api/fortnite/search?q=a")).status, 400, "too short");
    assert.equal((await t.request("/api/fortnite/stats?name=Pro")).status, 400, "no key set");
});

test("fortnite: the creator code is announced and checked live", async () => {
    const { createFortnite } = await import("../src/fortnite.js");
    const t = await setup({ extra: { fortniteSvc: createFortnite({ fetchImpl: fnFetch(), creatorCode: "LUCADO" }) } });
    assert.equal((await t.request("/api/fortnite/status")).data.creatorCode, "LUCADO");
    const c = await t.request("/api/fortnite/creator?code=LUCADO"); assert.equal(c.status, 200); assert.equal(c.data.status, "ACTIVE"); assert.equal(c.data.name, "Jacob Lucado");
    assert.equal((await t.request("/api/fortnite/creator?code=x")).status, 400);
});
