// Opens every page of the dashboard in a real browser, signed in, and fails on any script error or a page that comes up empty.
// It needs a Chromium (see helpers/browser.js); without one the test skips itself.
import test from "node:test";
import assert from "node:assert/strict";
import { createDashboard } from "../src/dashboard/server.js";
import { DiscordApiError } from "../src/dashboard/discord.js";
import { openDb } from "../src/db.js";
import { launchBrowser } from "./helpers/browser.js";

const ORIGIN = "http://localhost:3000";
const MANAGE = String(0x20);
const deal = (amount, regular) => ({ shop: { name: "GOG" }, price: { amount, currency: "USD" }, regular: { amount: regular, currency: "USD" }, cut: 0, url: "https://deal.example/x" });

async function setup({ port = 0, sendFails = false, guildsOf, config = {}, giveawayService = null, extra = {}, itadExtra = {}, restExtra = {} } = {}) {
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
    const addr = await dash.listen(port, "127.0.0.1");
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
const signedIn = async (opts) => { const t = await setup(opts); await t.signIn(); return t; };

const PAGES = ["home", "wrapped", "tools", "appeal", "library", "steam", "value", "wishlist", "foryou", "deals", "warroom", "free", "bundles", "playtests", "codes", "feed", "people", "friends", "compare", "communities", "discover", "gamenight", "nowplaying", "club", "trivia", "lfg", "calendar", "fortnite", "servers", "setup", "community", "santa", "xp", "mod", "giveaways", "indie", "streamer", "overlays", "streams", "streamers", "profile", "mypage", "notifications", "alerts", "mydata", "help", "support", "tip", "requests", "status", "changelog", "about"];

test("every dashboard page opens without script errors", { timeout: 240_000 }, async t => {
    const browser = await launchBrowser();
    if (!browser) return t.skip("no Chromium here");
    const o = await signedIn({ config: { ownerId: "u1" }, extra: { botGuilds: () => true, guildList: () => [{ id: "g-admin", name: "Mine", members: 10, boosts: 0 }] } });
    try {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        await ctx.addCookies(o.cookie().split("; ").map(p => { const [name, ...v] = p.split("="); return { name, value: v.join("="), url: o.base }; }));
        const page = await ctx.newPage();
        await page.addInitScript(() => { try { localStorage.setItem("svc_visited", "1"); localStorage.setItem("svc_os_intro", "1"); } catch { /* no storage */ } });
        const errors = [], empty = [], noise = [];
        page.on("pageerror", e => errors.push(`${page.url()} ${e.message}`));
        page.on("console", m => { if (m.type() === "error") noise.push(m.text()); }); page.on("requestfailed", r => noise.push(`failed ${r.url()}`)); page.on("response", r => { if (r.status() >= 400) noise.push(`${r.status()} ${r.url()}`); });
        for (const id of (process.env.ONLY ? process.env.ONLY.split(",") : PAGES)) {
            await page.goto(`${o.base}/${id === "home" ? "" : id}`, { waitUntil: "load" });
            await page.waitForFunction(() => (document.getElementById("app")?.innerText ?? "").trim().length >= 30, null, { timeout: 4000 }).catch(() => {});
            await page.waitForTimeout(250);
            const len = await page.evaluate(() => (document.getElementById("app")?.innerText ?? "").trim().length);
            if (len < 30) { empty.push(id); if (process.env.ONLY) console.log(await page.evaluate(() => document.body.innerText.slice(0, 300)), page.url()); }
        }
        assert.deepEqual(errors, []);
        assert.deepEqual(empty, [], noise.join(" | "));
    } finally { await browser.close(); await o.close(); }
});

test("the moderation page shows the auto-moderator and saves a change", { timeout: 120_000 }, async t => {
    const browser = await launchBrowser();
    if (!browser) return t.skip("no Chromium here");
    const { createModeration } = await import("../src/moderation.js");
    const { createAutomod } = await import("../src/automod.js");
    const { createServer } = await import("node:net");
    const port = await new Promise(r => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
    const o = await signedIn({
        port, config: { publicUrl: `http://127.0.0.1:${port}` },
        guildsOf: [{ id: "g-admin", name: "Mine", icon: null, owner: false, permissions: "8" }],
        restExtra: { allRoles: async () => [{ id: "g-admin", name: "@everyone" }, { id: "900000000000000077", name: "Mods" }], getGuild: async () => ({ name: "Mine", owner_id: "1" }) },
        extra: db => {
            const api = { getGuild: async () => ({ name: "Mine", owner_id: "1" }), sendMessage: async () => ({}) };
            const moderation = createModeration({ db, api, botId: () => "900000000000000005" });
            return { botGuilds: () => true, moderation, automod: createAutomod({ db, api, mod: moderation, botId: () => "900000000000000005" }) };
        }
    });
    try {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        await ctx.addCookies(o.cookie().split("; ").map(p => { const [name, ...v] = p.split("="); return { name, value: v.join("="), url: o.base }; }));
        const page = await ctx.newPage();
        await page.addInitScript(() => { try { localStorage.setItem("svc_visited", "1"); localStorage.setItem("svc_os_intro", "1"); } catch { /* no storage */ } });
        const errors = []; page.on("pageerror", e => errors.push(e.message));
        await page.goto(`${o.base}/mod`, { waitUntil: "load" });
        await page.locator("label.check", { hasText: "Message spam" }).waitFor({ timeout: 10_000 }).catch(async e => { throw new Error(`${e.message}\n${(await page.evaluate(() => document.getElementById("app")?.innerText ?? "")).slice(0, 600)}\n${errors.join("\n")}`); });
                await page.waitForLoadState("networkidle"); await page.waitForTimeout(600); // the page may redraw once while its lists arrive
        for (const name of ["Auto-moderator on", "Message spam"]) await page.locator("label.check", { hasText: name }).locator("input").evaluate(el => { if (!el.checked) { el.checked = true; el.dispatchEvent(new Event("change", { bubbles: true })); } });
        await page.getByRole("button", { name: "Save auto-moderator" }).evaluate(el => el.click());
        await page.waitForTimeout(1500);
        const toastText = await page.evaluate(() => [...document.querySelectorAll("[class*=toast],[role=status],[role=alert]")].map(e => e.innerText).join("|"));
        await page.waitForTimeout(1200);
        if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, fullPage: true });
        const saved = await o.request("/api/mod/automod?guild=g-admin");
        assert.equal(saved.status, 200, toastText);
        assert.equal(saved.data.settings.on, true); assert.equal(saved.data.settings.rules.spam.on, true);
        const options = await page.locator("select").first().locator("option").allTextContents();
        for (const want of ["Add a staff note", "Slowmode", "Lock a channel", "Unlock a channel"]) assert.ok(options.includes(want), `action list has ${want}`);
        assert.deepEqual(errors, []);
    } finally { await browser.close(); await o.close(); }
});

test("the signed-out landing page and the welcome tour open without script errors", { timeout: 120_000 }, async t => {
    const browser = await launchBrowser();
    if (!browser) return t.skip("no Chromium here");
    const o = await setup({ config: { ownerId: "u1" }, extra: { botGuilds: () => true } });
    try {
        const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
        const errors = []; page.on("pageerror", e => errors.push(e.message));
        await page.goto(`${o.base}/`, { waitUntil: "load" });
        await page.waitForTimeout(800);
        const len = await page.evaluate(() => (document.getElementById("app")?.innerText ?? "").trim().length);
        assert.ok(len > 200, `the landing page drew ${len} characters`);
        assert.deepEqual(errors, []);
    } finally { await browser.close(); await o.close(); }
});

test("the page speaks the browser's language and fetches only that language file", { timeout: 120_000 }, async t => {
    const browser = await launchBrowser();
    if (!browser) return t.skip("no Chromium here");
    const o = await setup({ config: { ownerId: "u1" }, extra: { botGuilds: () => true } });
    try {
        for (const [locale, code] of [["ja-JP", "ja"], ["en-US", null]]) {
            const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, locale })).newPage();
            const errors = [], packs = []; page.on("pageerror", e => errors.push(e.message)); page.on("request", r => { const m = /\/i18n-([a-z]{2})\.js/.exec(r.url()); if (m) packs.push(m[1]); });
            await page.goto(`${o.base}/`, { waitUntil: "load" });
            await page.waitForFunction(() => (document.getElementById("app")?.innerText ?? "").trim().length > 200, null, { timeout: 15000 });
            // The English placeholder is already longer than that, so also wait for the translated page itself.
            if (code) await page.waitForFunction(c => document.documentElement.lang === c && /[\u3040-\u30ff\u4e00-\u9fff]/.test(document.getElementById("app")?.innerText ?? ""), code, { timeout: 15000 });
            assert.deepEqual(errors, []);
            assert.deepEqual(packs, code ? [code] : [], `${locale} fetched ${packs.join(",") || "no"} language file`);
            if (code) assert.equal(await page.evaluate(() => document.documentElement.lang), code);
            if (code) assert.match(await page.evaluate(() => document.getElementById("app").innerText), /[\u3040-\u30ff\u4e00-\u9fff]/, "the page is drawn in Japanese");
        }
    } finally { await browser.close(); await o.close(); }
});

test("a server's page and the welcome tour open signed in", { timeout: 120_000 }, async t => {
    const browser = await launchBrowser();
    if (!browser) return t.skip("no Chromium here");
    const o = await signedIn({ config: { ownerId: "u1" }, extra: { botGuilds: () => true, guildList: () => [{ id: "g-admin", name: "Mine", members: 10, boosts: 0 }] } });
    try {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        await ctx.addCookies(o.cookie().split("; ").map(p => { const [name, ...v] = p.split("="); return { name, value: v.join("="), url: o.base }; }));
        const page = await ctx.newPage();
        await page.addInitScript(() => { try { localStorage.setItem("svc_visited", "1"); } catch { /* no storage */ } });
        const errors = []; page.on("pageerror", e => errors.push(e.message));
        await page.goto(`${o.base}/servers`, { waitUntil: "load" }); await page.waitForTimeout(600);
        await page.goto(`${o.base}/servers/g-admin`, { waitUntil: "load" }); await page.waitForTimeout(800);
        const len = await page.evaluate(() => (document.getElementById("app")?.innerText ?? "").trim().length);
        assert.ok(len > 60, `the server page drew ${len} characters`);
        assert.deepEqual(errors, []);
    } finally { await browser.close(); await o.close(); }
});

test("the Setup page's area switches and the Steam page's family list work in a real browser", { timeout: 120_000 }, async t => {
    const browser = await launchBrowser();
    if (!browser) return t.skip("no Chromium here");
    const FAM = "76561198000000042";
    // Steam, as far as the family list needs it: a public games list and a profile name.
    const steamFetch = async url => ({ ok: true, status: 200, headers: new Map(), json: async () => ({}), text: async () => (/\?xml=1$/.test(String(url)) ? "<profile><steamID><![CDATA[Sis]]></steamID></profile>" : "<gamesList><games><game><appID>620</appID><name><![CDATA[Portal 2]]></name></game></games></gamesList>") });
    // The page saves things here, so the site's own address has to be the one the browser is on (saves from anywhere else are refused).
    const PORT = 38517;
    const o = await signedIn({ port: PORT, config: { ownerId: "u1", publicUrl: `http://127.0.0.1:${PORT}` }, extra: { botGuilds: () => true, steamFetch, guildList: () => [{ id: "g-admin", name: "Mine", members: 10, boosts: 0 }] } });
    try {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        await ctx.addCookies(o.cookie().split("; ").map(p => { const [name, ...v] = p.split("="); return { name, value: v.join("="), url: o.base }; }));
        const page = await ctx.newPage();
        await page.addInitScript(() => { try { localStorage.setItem("svc_visited", "1"); } catch { /* no storage */ } });
        const errors = []; page.on("pageerror", e => errors.push(e.message));

        await page.goto(`${o.base}/setup`, { waitUntil: "load" });
        const music = page.locator(".setup-row", { hasText: "Music" });
        await music.waitFor({ timeout: 15000 });
        await music.getByRole("button", { name: "Switch off" }).dispatchEvent("click"); // the first-visit tour sits on top of the page, so press the button directly
        await page.locator(".setup-row", { hasText: "Music" }).getByRole("button", { name: "Switch on" }).waitFor({ timeout: 15000 });
        assert.equal(o.db.getMeta("featoff:g-admin"), '["music"]');

        o.db.ensureUser("u1", "g-admin"); o.db.setSteamLink("u1", "76561198000000001", { verified: true });
        await page.goto(`${o.base}/steam`, { waitUntil: "load" });
        const fam = page.locator(".panel", { hasText: "Steam Family" });
        await fam.waitFor({ timeout: 15000 });
        await fam.locator("input[type=text]").fill(FAM);
        await fam.getByRole("button", { name: "Add" }).dispatchEvent("click");
        await fam.locator("li", { hasText: "Sis" }).waitFor({ timeout: 15000 });
        assert.deepEqual([...o.db.familyAppIds("u1")], [620]);
        await fam.getByRole("button", { name: "Remove" }).dispatchEvent("click");
        await page.waitForFunction(() => ![...document.querySelectorAll(".panel li")].some(li => li.textContent.includes("Sis")), null, { timeout: 15000 });
        assert.equal(o.db.listFamily("u1").length, 0);
        assert.deepEqual(errors, []);
    } finally { await browser.close(); await o.close(); }
});

test("the giveaway form takes a region list and a video file, and saves both", { timeout: 180_000 }, async t => {
    const browser = await launchBrowser();
    if (!browser) return t.skip("no Chromium here");
    const { createGiveawayService } = await import("../src/giveaway.js");
    const { createVault } = await import("../src/vault.js");
    const { createServer } = await import("node:net");
    const port = await new Promise(r => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
    let svc;
    const posts = [];
    const o = await signedIn({
        port, config: { publicUrl: `http://127.0.0.1:${port}` },
        giveawayService: db => (svc = createGiveawayService({ db, vault: createVault("test-secret-at-least-16-chars"),
            discord: { post: async (c, p) => { posts.push(p); return { id: String(posts.length) }; }, edit: async () => {}, dm: async () => ({}), memberOk: async () => true, findChannelByName: async () => null } })),
        extra: { botGuilds: () => true }
    });
    try {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        await ctx.addCookies(o.cookie().split("; ").map(p => { const [name, ...v] = p.split("="); return { name, value: v.join("="), url: o.base }; }));
        const page = await ctx.newPage();
        await page.addInitScript(() => { try { localStorage.setItem("svc_visited", "1"); localStorage.setItem("svc_os_intro", "1"); } catch { /* no storage */ } });
        const errors = []; page.on("pageerror", e => errors.push(e.message));
        await page.goto(`${o.base}/giveaways`, { waitUntil: "load" });
        const regions = page.locator("input[placeholder^='Regions allowed']").first();
        await regions.waitFor({ state: "attached", timeout: 40_000 });
        await page.waitForLoadState("networkidle"); await page.waitForTimeout(800); // the page may redraw once while its lists arrive
        await page.evaluate(() => document.querySelectorAll("details").forEach(d => { d.open = true; }));
        await regions.fill("us, eu");
        await page.locator("textarea[placeholder^='Hades']").fill("Hades | AAAAA-BBBBB-CCCCC");
        await page.locator("input[type=file]").first().setInputFiles({ name: "clip.mp4", mimeType: "video/mp4", buffer: Buffer.from("fake-mp4-bytes") });
        assert.match(await page.locator(".dpreview").innerText(), /Regions: US, EU/);
        assert.match(await page.locator(".dpreview").innerText(), /video is attached/);
        await page.getByRole("button", { name: "Start giveaway" }).evaluate(el => el.click());
        for (let n = 0; n < 120 && !o.db.listGiveaways("g-admin").length; n++) await page.waitForTimeout(250);
        const g = o.db.listGiveaways("g-admin")[0];
        assert.ok(g, `no giveaway was created: ${errors.join(" | ")} ${(await page.evaluate(() => [...document.querySelectorAll('.toast,.notice,[role=alert]')].map(e => e.innerText).join(' / ')))}`);
        assert.equal(g.regions, "US,EU");
        assert.equal(o.db.hasVideo(g.id), true);
        assert.equal(posts[0].files[0].name, "giveaway.mp4");
        assert.deepEqual(errors, []);
    } finally { await browser.close(); await o.close(); }
});
