import test from "node:test";
import assert from "node:assert/strict";
import { createDashboard } from "../src/dashboard/server.js";
import { DiscordApiError } from "../src/dashboard/discord.js";
import { openDb } from "../src/db.js";
import { createVault } from "../src/vault.js";
import { createGiveawayService } from "../src/giveaway.js";
import { applySteamImport, WishlistError } from "../src/wishlist.js";

const ORIGIN = "http://localhost:3000";
const MANAGE = String(0x20);

const deal = (amount, regular) => ({ shop: { name: "GOG" }, price: { amount, currency: "USD" }, regular: { amount: regular, currency: "USD" }, cut: 0, url: "https://deal.example/x" });

async function setup({ sendFails = false, guildsOf, config = {}, giveawayService = null } = {}) {
    const db = openDb(":memory:");
    let clock = 1_000_000;
    const sent = [];
    const rest = {
        authorizeUrl: state => `https://discord.example/authorize?state=${state}`,
        login: async code => {
            if (code !== "good") throw new DiscordApiError(400, "bad code");
            return {
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
        listRoles: async () => [{ id: "r1", name: "Boosters" }]
    };
    const itad = {
        lookupTitles: async titles => titles.map(t => (/^zzz/i.test(t) ? { title: t, id: null } : { title: t, id: "id-" + t.toLowerCase().replace(/\W+/g, ""), approx: false, matched: t })),
        getPrices: async ids => new Map(ids.map(id => [id, { deals: [deal(10, 20)], historyLow: { all: { amount: 5 } } }])),
        getGiveawayList: async () => [{ id: "1", title: "Alpha", shop: "Epic", url: "https://e.example/a", expiry: null }, { id: "2", title: "Beta", shop: "Epic", url: "https://e.example/b", expiry: null }, { id: "3", title: "Evil", shop: "Steam", url: "javascript:alert(1)", expiry: null }],
        getHistory: async () => Array.from({ length: 400 }, (_, i) => ({ t: 1_700_000_000_000 + i * 86400_000, price: 10 + (i % 7), regular: 20, shop: "GOG" }))
    };
    const dash = createDashboard({ db, itad, rest, giveaways: typeof giveawayService === "function" ? giveawayService(db) : giveawayService, config: { publicUrl: ORIGIN, port: 0, host: "127.0.0.1", clientId: "123", ...config }, now: () => clock });
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

    return { db, dash, request, signIn, sent, advance: ms => { clock += ms; }, close: () => dash.close() };
}

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
    assert.equal(c.data.fanaticalUrl, "https://jacob-lucado.github.io/FanaticalGrabber/");
    assert.match(c.data.inviteUrl, /client_id=123/);
    assert.ok(c.data.regions.length >= 6);
    await t.close();
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
    assert.equal(ok.headers.get("location"), "/");
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

test("alert history lists the member's own alerts", async () => {
    const t = await signedIn();
    t.db.ensureUser("u1"); t.db.ensureUser("other");
    t.db.logAlert({ discord_id: "u1", title: "Hades", kind: "sale", price: 9.99, shop: "GOG", via: "dm" });
    t.db.logAlert({ discord_id: "other", title: "Secret", kind: "sale", price: 1 });
    const r = await t.request("/api/alerts/history");
    assert.deepEqual(r.data.alerts.map(a => a.title), ["Hades"]);
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
    const t = await setup({ giveawayService: db => createGiveawayService({
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
    assert.ok(html.includes(`<meta property="og:image" content="${ORIGIN}/preview.jpg">`));
    assert.ok(html.includes('name="twitter:card" content="summary_large_image"'));
    assert.ok(!html.includes("__ORIGIN__"));
    const img = await t.request("/preview.jpg", { raw: true });
    assert.equal(img.status, 200);
    assert.equal(img.headers.get("content-type"), "image/jpeg");
    const robots = await (await t.request("/robots.txt", { raw: true })).text();
    assert.match(robots, /Disallow: \/api\//);
    assert.match(robots, new RegExp(`Sitemap: ${ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/sitemap.xml`));
    assert.match(await (await t.request("/sitemap.xml", { raw: true })).text(), /<loc>/);
    await t.close();
});
