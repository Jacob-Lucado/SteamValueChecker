import { createTicketService } from "../src/tickets.js";
import test from "node:test";
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

async function setup({ sendFails = false, guildsOf, config = {}, giveawayService = null, extra = {}, itadExtra = {} } = {}) {
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

    return { db, dash, base, request, signIn, sent, advance: ms => { clock += ms; }, close: () => dash.close() };
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
    assert.ok(html.includes(`<meta property="og:image" content="${ORIGIN}/preview.jpg?v=2">`));
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

test("gift claims: visitors mark a game, others see it taken, the owner only sees a count and can clear it", async () => {
    const t = await signedIn();
    await t.request("/api/wishlist/add", { method: "POST", body: { title: "Celeste" } });
    await t.request("/api/profile", { method: "POST", body: { enabled: true, slug: "jacob" } });
    const id = (await t.request("/api/wishlist")).data.rows[0].itad_id;
    const A = "a".repeat(24), B = "b".repeat(24);
    const pub = (tok) => t.request("/api/public/wishlist?slug=jacob" + (tok ? "&t=" + tok : ""));
    const gift = (body) => t.request("/api/public/gift", { method: "POST", body: { slug: "jacob", id, ...body } });
    assert.equal((await pub(A)).data.games[0].claim, null);
    assert.equal((await gift({ token: "short" })).status, 400);
    assert.equal((await gift({ token: A })).data.claim, "mine");
    assert.equal((await pub(A)).data.games[0].claim, "mine");
    assert.equal((await pub(B)).data.games[0].claim, "taken");
    assert.equal((await pub()).data.games[0].claim, "taken");
    assert.equal((await gift({ token: B })).status, 409, "a second visitor cannot take it");
    assert.equal((await gift({ token: B, claim: false })).data.claim, "taken", "and cannot undo someone else's");
    assert.equal((await t.request("/api/profile")).data.claims, 1);
    assert.equal(JSON.stringify((await t.request("/api/profile")).data).includes(A), false, "the owner is not told who");
    assert.equal((await t.request("/api/public/gift", { method: "POST", body: { slug: "nobody", id, token: A } })).status, 404);
    assert.equal((await gift({ token: A, claim: false })).data.claim, null);
    assert.equal((await pub(B)).data.games[0].claim, null);
    await gift({ token: A });
    const cleared = await t.request("/api/profile", { method: "POST", body: { enabled: true, slug: "jacob", resetClaims: true } });
    assert.equal(cleared.data.cleared, 1);
    assert.equal((await pub(B)).data.games[0].claim, null);
    // a game the owner already has is left off the page
    t.db.upsertLibrary("u1", [{ itad_id: id, title: "Celeste", paid: null }]);
    assert.equal((await pub(B)).data.games.length, 0);
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

test("profile card data comes from stored data only", async () => {
    const t = await signedIn();
    try {
        const r = await t.request("/api/profile/card");
        assert.equal(r.status, 200);
        assert.equal(r.data.games, 0); assert.equal(r.data.savedPct, null);
        assert.ok(Array.isArray(r.data.badges)); assert.ok(Array.isArray(r.data.genres));
    } finally { await t.close(); }
});

test("profile card settings are saved per member, validated, and the same card is drawn as a PNG", async () => {
    const t = await signedIn();
    const post = (path, body) => t.request(path, { method: "POST", body });
    try {
        let r = await t.request("/api/profile/card");
        assert.equal(r.data.prefs.theme, "steam"); assert.deepEqual(r.data.prefs.platforms, []); assert.ok(r.data.platforms.some(p => p.id === "xbox"));
        assert.equal((await post("/api/profile/card-settings", { platforms: [{ id: "xbox", name: "Jacob360" }, { id: "gog", name: "jl" }], theme: "night" })).status, 200);
        r = await t.request("/api/profile/card");
        assert.deepEqual(r.data.prefs.platforms.map(p => p.id), ["xbox", "gog"]); assert.equal(r.data.prefs.theme, "night");
        assert.equal((await post("/api/profile/card-settings", { platforms: [{ id: "bogus", name: "x" }] })).status, 400);
        assert.equal((await post("/api/profile/card-settings", { avatar: "http://insecure.example/a.png" })).status, 400);
        assert.equal((await t.request("/api/profile/card")).data.prefs.platforms.length, 2, "a refused change leaves the saved card alone");
        t.advance(5_000);
        const img = await t.request("/api/profile/card.png", { raw: true });
        assert.equal(img.status, 200); assert.equal(img.headers.get("content-type"), "image/png");
        assert.deepEqual([...new Uint8Array(await img.arrayBuffer()).subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
        assert.equal((await t.request("/api/steam/value.png")).status, 429, "pictures are rate limited");
        t.advance(5_000);
        assert.equal((await t.request("/api/steam/value.png")).status, 404, "no Steam profile linked yet");
        assert.ok(JSON.stringify(t.db.exportUser("u1").profile_card).includes("Jacob360"), "included in the data export");
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
    assert.equal(r2.headers.get("location"), "/#/steam");
    const me = await t.request("/api/me");
    assert.equal(me.status, 200); assert.equal(me.data.steamOnly, true); assert.equal(me.data.isOwner, false);
    assert.equal(me.data.steam.linked, true);

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
