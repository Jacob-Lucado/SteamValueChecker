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
        const saved = await o.request("/api/mod/automod?guild=g-admin");
        assert.equal(saved.status, 200, toastText);
        assert.equal(saved.data.settings.on, true); assert.equal(saved.data.settings.rules.spam.on, true);
        await page.getByPlaceholder(/Paste a message here/).fill("selling fullz, hit me up on telegram");
        await page.getByRole("button", { name: "Try it", exact: true }).evaluate(el => el.click());
        await page.getByText(/Would be caught by: Scam guard/).waitFor({ timeout: 10_000 });
        await page.getByText("Hasn't had to stop anything here yet.").first().waitFor({ timeout: 5000 });
        o.db.setMeta("scamcaught:g-admin", JSON.stringify({ n: 1, at: Date.now(), recent: [{ at: Date.now(), user: "900000000000000031", channel: "1", what: "Scam message", action: "ban", text: "selling fullz dm me" }] }));
        await page.reload({ waitUntil: "load" });
        await page.getByText("Last 1 caught").first().waitFor({ timeout: 15_000 });
        await page.getByText("Last 1 caught").first().evaluate(el => el.click());
        await page.getByText("selling fullz dm me").first().waitFor({ timeout: 5000 });
        await page.getByRole("button", { name: "Wrong call: unban" }).first().waitFor({ timeout: 5000 });
        assert.equal(saved.data.settings.scam.on, true, "the scam guard is on by default"); assert.equal(saved.data.settings.phish.on, true);
        for (const name of ["Same message in several channels", "@everyone and @here", "Too many emoji", "Wall of lines", "Risky file types", "Links from brand-new members"]) await page.locator("label.check", { hasText: name }).first().waitFor({ timeout: 5000 });
        await page.locator("label.check", { hasText: "Wall of lines" }).locator("input").evaluate(el => { el.checked = true; el.dispatchEvent(new Event("change", { bubbles: true })); });
        await page.locator("label.check", { hasText: "Scam guard on" }).locator("input").evaluate(el => { el.checked = false; el.dispatchEvent(new Event("change", { bubbles: true })); });
        await page.getByRole("button", { name: "Save auto-moderator" }).evaluate(el => el.click());
        await page.waitForTimeout(1500);
        assert.equal((await o.request("/api/mod/automod?guild=g-admin")).data.settings.scam.on, false, "and the toggle saves");
        assert.equal((await o.request("/api/mod/automod?guild=g-admin")).data.settings.rules.lines.on, true);
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
        // the host stats strip shows up once something has run, and the block list works from the page
        await page.getByText("Your giveaways so far").waitFor({ timeout: 20_000 });
        await page.locator("input[aria-label='Discord ID to block']").fill("123456789012345678");
        await page.getByRole("button", { name: "Block", exact: true }).evaluate(el => el.click());
        for (let n = 0; n < 40 && !o.db.isBlocked("g-admin", "123456789012345678"); n++) await page.waitForTimeout(250);
        assert.equal(o.db.isBlocked("g-admin", "123456789012345678"), true);
        await page.getByText("123456789012345678").first().waitFor({ timeout: 10_000 });
        assert.deepEqual(errors, []);
    } finally { await browser.close(); await o.close(); }
});

test("the Alerts page's Smart alerts switch saves, survives a reload and sits beside the other switches", { timeout: 120_000 }, async t => {
    const browser = await launchBrowser();
    if (!browser) return t.skip("no Chromium here");
    const { createServer } = await import("node:net");
    const port = await new Promise(r => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
    const o = await signedIn({ port, config: { publicUrl: `http://127.0.0.1:${port}`, ownerId: "u1" }, extra: { botGuilds: () => true } });
    try {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        await ctx.addCookies(o.cookie().split("; ").map(p => { const [name, ...v] = p.split("="); return { name, value: v.join("="), url: o.base }; }));
        const page = await ctx.newPage();
        await page.addInitScript(() => { try { localStorage.setItem("svc_visited", "1"); localStorage.setItem("svc_os_intro", "1"); } catch { /* no storage */ } });
        const errors = []; page.on("pageerror", e => errors.push(e.message));
        await page.goto(`${o.base}/alerts`, { waitUntil: "load" });
        const smart = page.getByRole("checkbox", { name: /^Smart alerts: a wishlist game/ });
        await smart.waitFor({ timeout: 20_000 });
        const nudge = page.locator("label.check", { hasText: "monthly pick from my backlog" }).locator("input");
        assert.equal(await smart.isChecked(), false, "off by default");
        await smart.evaluate(el => el.click());
        await page.getByRole("button", { name: "Save settings" }).evaluate(el => el.click());
        for (let n = 0; n < 40 && !o.db.getUser("u1")?.smart; n++) await page.waitForTimeout(250);
        assert.equal(o.db.getUser("u1").smart, 1);
        assert.equal(o.db.getUser("u1").nudge, 0, "the other switches are untouched");
        await page.reload({ waitUntil: "load" });
        await page.getByRole("checkbox", { name: /^Smart alerts: a wishlist game/ }).waitFor({ timeout: 20_000 });
        assert.equal(await page.getByRole("checkbox", { name: /^Smart alerts: a wishlist game/ }).isChecked(), true, "still on after a reload");
        assert.equal(await nudge.count() > 0, true);
        assert.deepEqual(errors, []);
    } finally { await browser.close(); await o.close(); }
});

test("the Alerts page lets you switch off extra lines on price cards, and it sticks", { timeout: 120_000 }, async t => {
    const browser = await launchBrowser();
    if (!browser) return t.skip("no Chromium here");
    const { createServer } = await import("node:net");
    const port = await new Promise(r => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
    const o = await signedIn({ port, config: { publicUrl: `http://127.0.0.1:${port}`, ownerId: "u1" }, extra: { botGuilds: () => true } });
    try {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        await ctx.addCookies(o.cookie().split("; ").map(p => { const [name, ...v] = p.split("="); return { name, value: v.join("="), url: o.base }; }));
        const page = await ctx.newPage();
        await page.addInitScript(() => { try { localStorage.setItem("svc_visited", "1"); localStorage.setItem("svc_os_intro", "1"); } catch { /* no storage */ } });
        const errors = []; page.on("pageerror", e => errors.push(e.message));
        const seen = []; page.on("response", r => { if (/api\/settings/.test(r.url())) seen.push(r.request().method() + " " + r.status()); }); page.on("console", m => seen.push("console:" + m.text()));
        await page.goto(`${o.base}/alerts`, { waitUntil: "load" });
        await page.getByText("Extra lines on price cards").waitFor({ timeout: 20_000 });
        const vr = page.locator("label.check", { hasText: "VR support" }).locator("input");
        assert.equal(await vr.isChecked(), true, "everything starts switched on");
        await vr.evaluate(el => el.click());
        await page.getByRole("button", { name: "Save settings" }).evaluate(el => el.click());
        const me = "u1";
        for (let n = 0; n < 40 && !String(o.db.getUser(me)?.hide_facts ?? "").includes("vr"); n++) await page.waitForTimeout(250);
        assert.equal(o.db.getUser(me).hide_facts, "vr", seen.join(" | "));
        assert.deepEqual(errors, []);
    } finally { await browser.close(); await o.close(); }
});

test("the Wishlist page filters by co-op and genre", { timeout: 120_000 }, async t => {
    const browser = await launchBrowser();
    if (!browser) return t.skip("no Chromium here");
    const { createServer } = await import("node:net");
    const port = await new Promise(r => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
    const o = await signedIn({ port, config: { publicUrl: `http://127.0.0.1:${port}`, ownerId: "u1" }, extra: { botGuilds: () => true } });
    try {
        o.db.addItems("u1", [{ itad_id: "a", title: "Alpha Duo" }, { itad_id: "b", title: "Beta Solo" }]);
        o.db.setAppId("u1", "a", 111); o.db.setAppId("u1", "b", 222);
        o.db.saveAppTags(111, ["Action"], ["Online Co-op"]); o.db.saveAppTags(222, ["RPG"], ["Single-player"]);
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        await ctx.addCookies(o.cookie().split("; ").map(p => { const [name, ...v] = p.split("="); return { name, value: v.join("="), url: o.base }; }));
        const page = await ctx.newPage();
        await page.addInitScript(() => { try { localStorage.setItem("svc_visited", "1"); localStorage.setItem("svc_os_intro", "1"); } catch { /* no storage */ } });
        const errors = []; page.on("pageerror", e => errors.push(e.message));
        await page.goto(`${o.base}/wishlist`, { waitUntil: "load" });
        await page.getByText("Alpha Duo").first().waitFor({ timeout: 20_000 });
        assert.equal(await page.getByText("Beta Solo").count() > 0, true);
        await page.getByRole("button", { name: "Co-op" }).evaluate(el => el.click());
        await page.waitForTimeout(300);
        assert.equal(await page.getByText("Beta Solo").count(), 0, "the solo game drops out of the co-op filter");
        assert.equal(await page.getByText("Alpha Duo").count() > 0, true);
        await page.getByRole("button", { name: "Co-op" }).evaluate(el => el.click());
        await page.getByLabel("Filter by genre").selectOption("RPG");
        await page.waitForTimeout(300);
        assert.equal(await page.getByText("Alpha Duo").count(), 0);
        assert.equal(await page.getByText("Beta Solo").count() > 0, true);
        await page.getByLabel("Filter by genre").selectOption("");
        await page.getByLabel("Show only games at or under this price").fill("5");
        await page.getByLabel("Show only games at or under this price").dispatchEvent("change");
        await page.waitForTimeout(300);
        assert.equal(await page.getByText("Alpha Duo").count(), 0, "everything in the test costs 10, so a 5 cap hides it");
        assert.equal(await page.getByText("No games match those filters.").count() > 0, true);
        assert.deepEqual(errors, []);
    } finally { await browser.close(); await o.close(); }
});

test("the Wishlist wallet planner picks games that fit the budget", { timeout: 120_000 }, async t => {
    const browser = await launchBrowser();
    if (!browser) return t.skip("no Chromium here");
    const { createServer } = await import("node:net");
    const port = await new Promise(r => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
    const o = await signedIn({ port, config: { publicUrl: `http://127.0.0.1:${port}`, ownerId: "u1" }, extra: { botGuilds: () => true } });
    try {
        o.db.addItems("u1", [{ itad_id: "a", title: "Alpha Duo" }, { itad_id: "b", title: "Beta Solo" }]);
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        await ctx.addCookies(o.cookie().split("; ").map(p => { const [name, ...v] = p.split("="); return { name, value: v.join("="), url: o.base }; }));
        const page = await ctx.newPage();
        await page.addInitScript(() => { try { localStorage.setItem("svc_visited", "1"); localStorage.setItem("svc_os_intro", "1"); } catch { /* no storage */ } });
        const errors = []; page.on("pageerror", e => errors.push(e.message));
        await page.goto(`${o.base}/wishlist`, { waitUntil: "load" });
        await page.getByText("Alpha Duo").first().waitFor({ timeout: 20_000 });
        await page.getByRole("button", { name: /Wallet planner/ }).evaluate(el => el.click());
        await page.getByLabel("How much you want to spend").fill("25");
        await page.getByRole("button", { name: "Plan it" }).evaluate(el => el.click());
        await page.getByText("Left over").first().waitFor({ timeout: 10_000 });
        const text = await page.locator(".wl-drawer").filter({ hasText: "Wallet planner" }).innerText();
        assert.match(text, /Alpha Duo/); assert.match(text, /Beta Solo/);
        await page.getByLabel("How much you want to spend").fill("12");
        await page.getByRole("button", { name: "Plan it" }).evaluate(el => el.click());
        await page.waitForTimeout(600);
        const one = await page.locator(".wl-drawer").filter({ hasText: "Wallet planner" }).innerText();
        assert.equal(/Alpha Duo/.test(one) !== /Beta Solo/.test(one), true, "a 12 budget fits exactly one 10 game");
        assert.deepEqual(errors, []);
    } finally { await browser.close(); await o.close(); }
});

test("the Trivia page plays Higher or lower and keeps the streak", { timeout: 120_000 }, async t => {
    const browser = await launchBrowser();
    if (!browser) return t.skip("no Chromium here");
    const { createServer } = await import("node:net");
    const port = await new Promise(r => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
    const { createHilo } = await import("../src/hilo.js");
    const facts = [[1, "Cheap Game", 999, 50000, 80], [2, "Pricey Game", 5999, 9000, 90], [3, "Free Game", 0, 900000, 70], [4, "Mid Game", 2999, 200000, 60]].map(([appid, name, price, recs, meta]) => ({ v: 2, appid, name, year: "2020", genres: ["Action"], price, recs, meta }));
    const o = await signedIn({ port, config: { publicUrl: `http://127.0.0.1:${port}`, ownerId: "u1" }, extra: db => { for (const f of facts) db.saveTriviaFacts(f.appid, f); return { botGuilds: () => true, hilo: createHilo({ db, fetchImpl: async () => { throw new Error("offline"); }, pool: [1, 2, 3, 4] }) }; } });
    try {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        await ctx.addCookies(o.cookie().split("; ").map(p => { const [name, ...v] = p.split("="); return { name, value: v.join("="), url: o.base }; }));
        const page = await ctx.newPage();
        await page.addInitScript(() => { try { localStorage.setItem("svc_visited", "1"); localStorage.setItem("svc_os_intro", "1"); } catch { /* no storage */ } });
        const errors = []; page.on("pageerror", e => errors.push(e.message));
        await page.goto(`${o.base}/trivia`, { waitUntil: "load" });
        await page.getByRole("button", { name: /Start a streak/ }).waitFor({ timeout: 20_000 });
        await page.getByRole("button", { name: /Start a streak/ }).evaluate(el => el.click());
        await page.getByRole("button", { name: /Higher/ }).waitFor({ timeout: 10_000 });
        let played = 0, ended = false;
        for (let n = 0; n < 6 && !ended; n++) {
            await page.getByRole("button", { name: /Higher/ }).evaluate(el => el.click());
            await page.waitForTimeout(500);
            ended = (await page.getByText(/Final streak/).count()) > 0;
            played++;
        }
        const best = o.db.hiloBest("g-admin", "u1");
        assert.ok(best, "a streak or a finished game is saved");
        assert.deepEqual(errors, []);
    } finally { await browser.close(); await o.close(); }
});

test("the Library page shows a backlog finish date", { timeout: 120_000 }, async t => {
    const browser = await launchBrowser();
    if (!browser) return t.skip("no Chromium here");
    const { createServer } = await import("node:net");
    const port = await new Promise(r => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
    const o = await signedIn({ port, config: { publicUrl: `http://127.0.0.1:${port}`, ownerId: "u1" }, extra: { botGuilds: () => true } });
    try {
        o.db.syncSteamGames("u1", [{ itad_id: "x1", title: "Unplayed One", appid: 81, minutes: 0, lastPlayed: null }, { itad_id: "x2", title: "Unplayed Two", appid: 82, minutes: 0, lastPlayed: null }]);
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        await ctx.addCookies(o.cookie().split("; ").map(p => { const [name, ...v] = p.split("="); return { name, value: v.join("="), url: o.base }; }));
        const page = await ctx.newPage();
        await page.addInitScript(() => { try { localStorage.setItem("svc_visited", "1"); localStorage.setItem("svc_os_intro", "1"); } catch { /* no storage */ } });
        const errors = []; page.on("pageerror", e => errors.push(e.message));
        await page.goto(`${o.base}/library`, { waitUntil: "load" });
        await page.getByText("Backlog finish date").first().waitFor({ timeout: 20_000 });
        await page.getByText(/hours waiting|guess from your own habits/).first().waitFor({ timeout: 10_000 });
        assert.deepEqual(errors, []);
    } finally { await browser.close(); await o.close(); }
});

test("the Library page's co-op filter keeps only co-op games", { timeout: 120_000 }, async t => {
    const browser = await launchBrowser();
    if (!browser) return t.skip("no Chromium here");
    const { createServer } = await import("node:net");
    const port = await new Promise(r => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
    const o = await signedIn({ port, config: { publicUrl: `http://127.0.0.1:${port}`, ownerId: "u1" }, extra: { botGuilds: () => true } });
    try {
        o.db.syncSteamGames("u1", [{ itad_id: "duo", title: "Duo Game", appid: 91, minutes: 60, lastPlayed: null }, { itad_id: "solo", title: "Solo Game", appid: 92, minutes: 60, lastPlayed: null }]);
        o.db.saveAppTags(91, ["Action"], ["Online Co-op"]); o.db.saveAppTags(92, ["RPG"], ["Single-player"]);
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        await ctx.addCookies(o.cookie().split("; ").map(p => { const [name, ...v] = p.split("="); return { name, value: v.join("="), url: o.base }; }));
        const page = await ctx.newPage();
        await page.addInitScript(() => { try { localStorage.setItem("svc_visited", "1"); localStorage.setItem("svc_os_intro", "1"); } catch { /* no storage */ } });
        const errors = []; page.on("pageerror", e => errors.push(e.message));
        await page.goto(`${o.base}/library`, { waitUntil: "load" });
        await page.getByText("Duo Game").first().waitFor({ timeout: 20_000 });
        assert.equal(await page.getByText("Solo Game").count() > 0, true);
        await page.getByRole("button", { name: /Filter/i }).first().evaluate(el => el.click());
        await page.getByRole("button", { name: "Co-op games only" }).evaluate(el => el.click());
        await page.waitForTimeout(300);
        assert.equal(await page.getByText("Solo Game").count(), 0, "the solo game drops out");
        assert.equal(await page.getByText("Duo Game").count() > 0, true);
        assert.deepEqual(errors, []);
    } finally { await browser.close(); await o.close(); }
});

test("the Steam page's hours panel shows play habits once there are a few days of play", { timeout: 120_000 }, async t => {
    const browser = await launchBrowser();
    if (!browser) return t.skip("no Chromium here");
    const { createServer } = await import("node:net");
    const port = await new Promise(r => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
    const o = await signedIn({ port, config: { publicUrl: `http://127.0.0.1:${port}`, ownerId: "u1" }, extra: { botGuilds: () => true } });
    try {
        o.db.ensureUser("u1", "g-admin"); o.db.setSteamLink("u1", "76561198000000001", { verified: true });
        // Three days in a row, ending today: each sync adds hours to the same game on a different day.
        const real = Date.now;
        try { for (const [back, minutes] of [[2, 60], [1, 180], [0, 240]]) { Date.now = () => real() - back * 86400_000; o.db.syncSteamGames("u1", [{ itad_id: "hab", title: "Habit Game", appid: 71, minutes, lastPlayed: null }], { track: true }); } } finally { Date.now = real; }
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        await ctx.addCookies(o.cookie().split("; ").map(p => { const [name, ...v] = p.split("="); return { name, value: v.join("="), url: o.base }; }));
        const page = await ctx.newPage();
        await page.addInitScript(() => { try { localStorage.setItem("svc_visited", "1"); localStorage.setItem("svc_os_intro", "1"); } catch { /* no storage */ } });
        const errors = []; page.on("pageerror", e => errors.push(e.message));
        await page.goto(`${o.base}/steam`, { waitUntil: "load" });
        const box = page.locator(".subpanel", { hasText: "Your play habits" });
        await box.waitFor({ timeout: 20_000 });
        assert.match(await box.innerText(), /Longest streak: 3 days in a row \(3 right now\)/);
        assert.deepEqual(errors, []);
        await ctx.close();
    } finally { await browser.close(); await o.close(); }
});

test("the Alerts page warns a member whose DMs are closed, and the test message clears it", { timeout: 120_000 }, async t => {
    const browser = await launchBrowser();
    if (!browser) return t.skip("no Chromium here");
    const { createServer } = await import("node:net");
    const port = await new Promise(r => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
    const dms = [];
    const o = await signedIn({ port, config: { publicUrl: `http://127.0.0.1:${port}`, ownerId: "u1" }, extra: { botGuilds: () => true, dm: async (id, p) => { dms.push([id, p]); return {}; } } });
    try {
        o.db.ensureUser("u1", "g-admin"); o.db.updateUser("u1", { dm_failures: 4 });
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        await ctx.addCookies(o.cookie().split("; ").map(p => { const [name, ...v] = p.split("="); return { name, value: v.join("="), url: o.base }; }));
        const page = await ctx.newPage();
        await page.addInitScript(() => { try { localStorage.setItem("svc_visited", "1"); localStorage.setItem("svc_os_intro", "1"); } catch { /* no storage */ } });
        const errors = []; page.on("pageerror", e => errors.push(e.message));
        await page.goto(`${o.base}/alerts`, { waitUntil: "load" });
        await page.getByText("Your alerts aren't reaching you").waitFor({ timeout: 20_000 });
        assert.match(await page.locator(".notice.warn").first().innerText(), /last 4 direct messages/);
        await page.getByRole("button", { name: "Send me a test message" }).evaluate(el => el.click());
        await page.getByText("I can reach you").waitFor({ timeout: 10_000 });
        assert.equal(dms.length, 1);
        assert.equal(o.db.getUser("u1").dm_failures, 0);
        assert.deepEqual(errors, []);
        await ctx.close();
    } finally { await browser.close(); await o.close(); }
});

test("the Wishlist page's Why no alert? drawer names what is in the way", { timeout: 120_000 }, async t => {
    const browser = await launchBrowser();
    if (!browser) return t.skip("no Chromium here");
    const { createServer } = await import("node:net");
    const port = await new Promise(r => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
    const o = await signedIn({ port, config: { publicUrl: `http://127.0.0.1:${port}`, ownerId: "u1" }, extra: { botGuilds: () => true } });
    try {
        o.db.addItems("u1", [{ itad_id: "a", title: "Alpha Duo" }]);
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        await ctx.addCookies(o.cookie().split("; ").map(p => { const [name, ...v] = p.split("="); return { name, value: v.join("="), url: o.base }; }));
        const page = await ctx.newPage();
        await page.addInitScript(() => { try { localStorage.setItem("svc_visited", "1"); localStorage.setItem("svc_os_intro", "1"); } catch { /* no storage */ } });
        const errors = []; page.on("pageerror", e => errors.push(e.message));
        await page.goto(`${o.base}/wishlist`, { waitUntil: "load" });
        await page.getByText("Alpha Duo").first().waitFor({ timeout: 20_000 });
        await page.getByRole("button", { name: /Why no alert/ }).evaluate(el => el.click());
        const drawer = page.locator(".wl-drawer").filter({ hasText: "Why no alert?" });
        await drawer.locator("select").selectOption({ label: "Alpha Duo" });
        await drawer.getByRole("button", { name: "Check it" }).evaluate(el => el.click());
        await drawer.getByText(/Nothing is stopping it/).waitFor({ timeout: 10_000 });
        o.db.updateUser("u1", { paused: 1 });
        await drawer.getByRole("button", { name: "Check it" }).evaluate(el => el.click());
        await drawer.getByText(/Not sent: Your alerts are paused/).waitFor({ timeout: 10_000 });
        assert.match(await drawer.innerText(), /❌ Your alerts are paused/);
        await drawer.getByRole("button", { name: "Check my whole list" }).evaluate(el => el.click());
        await drawer.getByText(/0 of 1 would alert on the next run/).waitFor({ timeout: 10_000 });
        assert.match(await drawer.innerText(), /1 alerts paused: Alpha Duo/);
        assert.deepEqual(errors, []);
        await ctx.close();
    } finally { await browser.close(); await o.close(); }
});

test("the Alerts page previews what the filters would do to the wishlist before saving", { timeout: 120_000 }, async t => {
    const browser = await launchBrowser();
    if (!browser) return t.skip("no Chromium here");
    const { createServer } = await import("node:net");
    const port = await new Promise(r => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
    const o = await signedIn({ port, config: { publicUrl: `http://127.0.0.1:${port}`, ownerId: "u1" }, extra: { botGuilds: () => true } });
    try {
        o.db.addItems("u1", [{ itad_id: "a", title: "Alpha Duo" }]);
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        await ctx.addCookies(o.cookie().split("; ").map(p => { const [name, ...v] = p.split("="); return { name, value: v.join("="), url: o.base }; }));
        const page = await ctx.newPage();
        await page.addInitScript(() => { try { localStorage.setItem("svc_visited", "1"); localStorage.setItem("svc_os_intro", "1"); } catch { /* no storage */ } });
        const errors = []; page.on("pageerror", e => errors.push(e.message));
        await page.goto(`${o.base}/alerts`, { waitUntil: "load" });
        const box = page.locator('input[type=number][max="90"]').first();
        await box.waitFor({ timeout: 20_000 });
        await box.fill("90");
        await page.getByText(/of your 1 wishlist games would alert right now/).waitFor({ timeout: 10_000 });
        assert.equal(o.db.getUser("u1").min_discount || 0, 0, "nothing is saved by previewing");
        assert.deepEqual(errors, []);
        await ctx.close();
    } finally { await browser.close(); await o.close(); }
});

test("the Wishlist price history suggests an alert price and one click sets it", { timeout: 120_000 }, async t => {
    const browser = await launchBrowser();
    if (!browser) return t.skip("no Chromium here");
    const { createServer } = await import("node:net");
    const port = await new Promise(r => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
    const DAY = 86400_000, n = Date.now();
    const getHistory = async () => [{ t: n - 360 * DAY, price: 30 }, { t: n - 150 * DAY, price: 15 }, { t: n - 90 * DAY, price: 24 }, { t: n - 50 * DAY, price: 30 }].map(p => ({ ...p, regular: 30, shop: "Steam" }));
    const o = await signedIn({ port, config: { publicUrl: `http://127.0.0.1:${port}`, ownerId: "u1" }, extra: { botGuilds: () => true }, itadExtra: { getHistory } });
    try {
        o.db.addItems("u1", [{ itad_id: "a", title: "Alpha Duo" }]);
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        await ctx.addCookies(o.cookie().split("; ").map(p => { const [name, ...v] = p.split("="); return { name, value: v.join("="), url: o.base }; }));
        const page = await ctx.newPage();
        await page.addInitScript(() => { try { localStorage.setItem("svc_visited", "1"); localStorage.setItem("svc_os_intro", "1"); } catch { /* no storage */ } });
        const errors = []; page.on("pageerror", e => errors.push(e.message));
        await page.goto(`${o.base}/wishlist`, { waitUntil: "load" });
        await page.getByText("Alpha Duo").first().waitFor({ timeout: 20_000 });
        await page.getByRole("button", { name: /Alert rule and actions for Alpha Duo/ }).first().evaluate(el => el.click());
        await page.getByRole("button", { name: "Price history" }).evaluate(el => el.click());
        await page.getByText(/Suggested alert price: \$24\.00/).waitFor({ timeout: 10_000 });
        await page.getByRole("button", { name: "Alert me at $24.00" }).evaluate(el => el.click());
        await page.getByText(/You'll hear about Alpha Duo at \$24\.00 or less/).waitFor({ timeout: 10_000 });
        const it = o.db.listItems("u1")[0];
        assert.equal(it.trigger_type, "price");
        assert.equal(it.trigger_value, 24);
        assert.deepEqual(errors, []);
        await ctx.close();
    } finally { await browser.close(); await o.close(); }
});

test("the Wishlist page suggests prices for several games and applies the ticked ones", { timeout: 120_000 }, async t => {
    const browser = await launchBrowser();
    if (!browser) return t.skip("no Chromium here");
    const { createServer } = await import("node:net");
    const port = await new Promise(r => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
    const DAY = 86400_000, n = Date.now();
    const getHistory = async () => [{ t: n - 360 * DAY, price: 30 }, { t: n - 150 * DAY, price: 15 }, { t: n - 90 * DAY, price: 24 }, { t: n - 50 * DAY, price: 30 }].map(p => ({ ...p, regular: 30, shop: "Steam" }));
    const o = await signedIn({ port, config: { publicUrl: `http://127.0.0.1:${port}`, ownerId: "u1" }, extra: { botGuilds: () => true }, itadExtra: { getHistory } });
    try {
        o.db.addItems("u1", [{ itad_id: "a", title: "Alpha Duo" }, { itad_id: "b", title: "Beta Trio" }]);
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        await ctx.addCookies(o.cookie().split("; ").map(p => { const [name, ...v] = p.split("="); return { name, value: v.join("="), url: o.base }; }));
        const page = await ctx.newPage();
        await page.addInitScript(() => { try { localStorage.setItem("svc_visited", "1"); localStorage.setItem("svc_os_intro", "1"); } catch { /* no storage */ } });
        const errors = []; page.on("pageerror", e => errors.push(e.message));
        await page.goto(`${o.base}/wishlist`, { waitUntil: "load" });
        await page.getByText("Alpha Duo").first().waitFor({ timeout: 20_000 });
        await page.getByRole("button", { name: /Suggest prices/ }).evaluate(el => el.click());
        await page.getByRole("button", { name: "Suggest prices", exact: true }).evaluate(el => el.click());
        await page.getByText(/Alpha Duo: \$24\.00/).waitFor({ timeout: 10_000 });
        assert.match(await page.getByRole("link", { name: "Alpha Duo" }).first().getAttribute("href"), /\/g\/a$/, "the suggestion links to the game's page");
        await page.getByLabel("Alert me for Beta Trio").evaluate(el => el.click());
        await page.getByRole("button", { name: "Apply the ticked ones" }).evaluate(el => el.click());
        await page.getByText(/Saved a price alert for 1 game\./).waitFor({ timeout: 10_000 });
        const by = Object.fromEntries(o.db.listItems("u1").map(i => [i.title, i]));
        assert.equal(by["Alpha Duo"].trigger_type, "price");
        assert.equal(by["Alpha Duo"].trigger_value, 24);
        assert.notEqual(by["Beta Trio"].trigger_type, "price");
        assert.deepEqual(errors, []);
        await ctx.close();
    } finally { await browser.close(); await o.close(); }
});

test("the Admin page shows the daily channel check and opens without script errors", { timeout: 120_000 }, async t => {
    const browser = await launchBrowser();
    if (!browser) return t.skip("no Chromium here");
    const { createServer } = await import("node:net");
    const { reportProblem } = await import("../src/guildproblems.js");
    const port = await new Promise(r => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
    const o = await signedIn({ port, config: { publicUrl: `http://127.0.0.1:${port}`, ownerId: "u1" }, extra: { botGuilds: () => true } });
    try {
        o.db.setMeta("scammer:900000000000000021", JSON.stringify({ at: Date.now(), n: 2 }));
        reportProblem(o.db, "g-admin", "audit:codes", "Game code posts: the channel is missing Embed Links", { status: 403 });
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        await ctx.addCookies(o.cookie().split("; ").map(p => { const [name, ...v] = p.split("="); return { name, value: v.join("="), url: o.base }; }));
        const page = await ctx.newPage();
        await page.addInitScript(() => { try { localStorage.setItem("svc_visited", "1"); localStorage.setItem("svc_os_intro", "1"); } catch { /* no storage */ } });
        const errors = []; page.on("pageerror", e => errors.push(e.message));
        await page.goto(`${o.base}/admin#/system`, { waitUntil: "load" });
        await page.getByText("Daily channel check").first().waitFor({ timeout: 20_000 });
        await page.getByText(/missing Embed Links/).first().waitFor({ timeout: 10_000 });
        await page.getByText("Known scam accounts (1)").first().waitFor({ timeout: 10_000 });
        await page.getByText("900000000000000021").first().waitFor({ timeout: 5000 });
        await page.locator("tr", { hasText: "900000000000000021" }).getByRole("button", { name: "Clear" }).evaluate(el => el.click());
        await page.waitForFunction(() => !document.body.textContent.includes("900000000000000021"), null, { timeout: 10_000 });
        assert.equal(o.db.getMeta("scammer:900000000000000021"), "");
        await page.getByText("Fanatical affiliate links").first().waitFor({ timeout: 10_000 });
        const afPanel = page.locator(".panel", { has: page.getByRole("heading", { name: "Fanatical affiliate links" }) });
        await afPanel.getByRole("button", { name: "Turn on", exact: true }).evaluate(el => el.click());
        await afPanel.getByRole("button", { name: "Turn off", exact: true }).waitFor({ timeout: 20_000 });
        assert.equal(o.db.getMeta("affiliate:fanatical"), "1");
        assert.deepEqual(errors, []);
        await ctx.close();
    } finally { await browser.close(); await o.close(); }
});

const ADMIN_PAGES = ["overview", "system", "growth", "features", "community", "votes", "panels", "traffic", "servers", "members", "supporters", "profiles", "gifts", "social", "announce", "giveaway", "xposts", "indie", "settings", "ai", "music", "radio", "chat", "admins", "audit", "datareq", "tools", "account", "personalize"];

test("every Admin page opens, draws something and throws no script errors", { timeout: 240_000 }, async t => {
    const browser = await launchBrowser();
    if (!browser) return t.skip("no Chromium here");
    const { createServer } = await import("node:net");
    const port = await new Promise(r => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
    const o = await signedIn({ port, config: { publicUrl: `http://127.0.0.1:${port}`, ownerId: "u1" }, extra: { botGuilds: () => true, guildList: () => [{ id: "g-admin", name: "Mine", members: 10, boosts: 0 }] } });
    try {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        await ctx.addCookies(o.cookie().split("; ").map(p => { const [name, ...v] = p.split("="); return { name, value: v.join("="), url: o.base }; }));
        const page = await ctx.newPage();
        await page.addInitScript(() => { try { localStorage.setItem("svc_visited", "1"); localStorage.setItem("svc_os_intro", "1"); } catch { /* no storage */ } });
        const errors = [], empty = [];
        page.on("pageerror", e => errors.push(`${page.url()} ${e.message}`));
        await page.goto(`${o.base}/admin`, { waitUntil: "load" });
        await page.locator(".adm-link").first().waitFor({ state: "attached", timeout: 20_000 });
        for (const id of (process.env.ONLY ? process.env.ONLY.split(",") : ADMIN_PAGES)) {
            await page.evaluate(h => { location.hash = "#/" + h; }, id);
            await page.waitForTimeout(600);
            const len = await page.evaluate(() => (document.querySelector("main, #body, .adm-body, #app")?.innerText ?? document.body.innerText).trim().length);
            if (len < 40) empty.push(id);
        }
        assert.deepEqual(errors, []);
        assert.deepEqual(empty, []);
        await ctx.close();
    } finally { await browser.close(); await o.close(); }
});

test("the Wishlist cards say how far each game is from its alert rule", { timeout: 120_000 }, async t => {
    const browser = await launchBrowser();
    if (!browser) return t.skip("no Chromium here");
    const { createServer } = await import("node:net");
    const port = await new Promise(r => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
    const deal = (p, r) => ({ deals: [{ shop: { name: "Steam" }, price: { amount: p, currency: "USD" }, regular: { amount: r }, cut: Math.round((1 - p / r) * 100), url: "https://s" }], historyLow: { all: { amount: 5 } } });
    const getPrices = async ids => new Map(ids.map(id => [id, id === "a" ? deal(24, 40) : deal(18, 40)]));
    const o = await signedIn({ port, config: { publicUrl: `http://127.0.0.1:${port}`, ownerId: "u1" }, extra: { botGuilds: () => true }, itadExtra: { getPrices } });
    try {
        o.db.addItems("u1", [{ itad_id: "a", title: "Alpha Duo" }, { itad_id: "b", title: "Beta Trio" }]);
        o.db.setTrigger("u1", "price", 20, "a"); o.db.setTrigger("u1", "price", 20, "b");
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        await ctx.addCookies(o.cookie().split("; ").map(p => { const [name, ...v] = p.split("="); return { name, value: v.join("="), url: o.base }; }));
        const page = await ctx.newPage();
        await page.addInitScript(() => { try { localStorage.setItem("svc_visited", "1"); localStorage.setItem("svc_os_intro", "1"); } catch { /* no storage */ } });
        const errors = []; page.on("pageerror", e => errors.push(e.message));
        await page.goto(`${o.base}/wishlist`, { waitUntil: "load" });
        await page.getByText(/\$4\.00 above your price/).waitFor({ timeout: 20_000 });
        await page.getByText(/✓ meets your rule/).waitFor({ timeout: 5_000 });
        await page.locator("select").filter({ has: page.locator("option", { hasText: "Closest to alerting" }) }).selectOption({ label: "Closest to alerting" });
        const titles = await page.locator(".wl-card .fy-title").allInnerTexts();
        assert.deepEqual(titles.slice(0, 2), ["Beta Trio", "Alpha Duo"], "the game that already meets its rule comes first");
        assert.deepEqual(errors, []);
        await ctx.close();
    } finally { await browser.close(); await o.close(); }
});

test("the Wishlist page's newer buttons come out in the browser's language", { timeout: 120_000 }, async t => {
    const browser = await launchBrowser();
    if (!browser) return t.skip("no Chromium here");
    const { createServer } = await import("node:net");
    const port = await new Promise(r => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
    const o = await signedIn({ port, config: { publicUrl: `http://127.0.0.1:${port}`, ownerId: "u1" }, extra: { botGuilds: () => true }, itadExtra: { getPrices: async ids => new Map(ids.map(id => [id, { deals: [{ shop: { name: "Steam" }, price: { amount: 24, currency: "USD" }, regular: { amount: 40 }, cut: 40, url: "https://s" }], historyLow: { all: { amount: 5 } } }])) } });
    try {
        o.db.addItems("u1", [{ itad_id: "a", title: "Alpha Duo" }]); o.db.setTrigger("u1", "price", 20, "a");
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "es-ES" });
        await ctx.addCookies(o.cookie().split("; ").map(p => { const [name, ...v] = p.split("="); return { name, value: v.join("="), url: o.base }; }));
        const page = await ctx.newPage();
        await page.addInitScript(() => { try { localStorage.setItem("svc_visited", "1"); localStorage.setItem("svc_os_intro", "1"); } catch { /* no storage */ } });
        const errors = []; page.on("pageerror", e => errors.push(e.message));
        await page.goto(`${o.base}/wishlist`, { waitUntil: "load" });
        await page.getByRole("button", { name: /Sugerir precios/ }).first().waitFor({ timeout: 20_000 });
        await page.getByRole("button", { name: /¿Por qué no hay alerta\?/ }).first().waitFor({ timeout: 5_000 });
        await page.getByText(/\$4\.00 por encima de tu precio/).waitFor({ timeout: 10_000 });
        assert.deepEqual(errors, []);
        await ctx.close();
    } finally { await browser.close(); await o.close(); }
});

// Calls every plain GET endpoint as the signed-in owner and fails on a server error. A 400, 403 or 404 is fine (a missing
// parameter, a feature that isn't set up in the test); a 500 means the route itself broke, like a helper that wasn't in scope.
test("no dashboard GET endpoint answers with a server error", { timeout: 240_000 }, async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const SKIP = /\/(events|stream|backup|export|download|logout|callback|sse|live|updates)\b|\/api\/admin\/(backup|account)/;
    const dir = new URL("../src/dashboard/", import.meta.url);
    const paths = new Set();
    for (const f of readdirSync(dir).filter(n => n.endsWith(".js"))) for (const m of readFileSync(new URL(f, dir), "utf8").matchAll(/"GET (\/api\/[^" ?]*)"/g)) if (!SKIP.test(m[1])) paths.add(m[1]);
    const o = await signedIn({ config: { ownerId: "u1" }, extra: { botGuilds: () => true, guildList: () => [{ id: "g-admin", name: "Mine", members: 10, boosts: 0 }] }, itadExtra: { getDealsPool: async () => [] } });
    const broken = [];
    try {
        for (const p of paths) { const r = await o.request(p); if (r.status >= 500 && r.status !== 503) broken.push(`${p} -> ${r.status} ${JSON.stringify(r.data)?.slice(0, 120)}`); }
        assert.deepEqual(broken, []);
    } finally { await o.close(); }
});

test("For you cards link the title to the game page and the card to the store", { timeout: 120_000 }, async t => {
    const browser = await launchBrowser();
    if (!browser) return t.skip("no Chromium here");
    const { createServer } = await import("node:net");
    const port = await new Promise(r => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
    const getDealsPool = async () => [{ id: "zz1", title: "Gamma Deluxe", appid: 4242, cut: 50, price: 10, regular: 20, currency: "USD", url: "https://store.example/gamma" }];
    const o = await signedIn({ port, config: { publicUrl: `http://127.0.0.1:${port}`, ownerId: "u1" }, extra: { botGuilds: () => true }, itadExtra: { getDealsPool } });
    try {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        await ctx.addCookies(o.cookie().split("; ").map(p => { const [name, ...v] = p.split("="); return { name, value: v.join("="), url: o.base }; }));
        const page = await ctx.newPage();
        await page.addInitScript(() => { try { localStorage.setItem("svc_visited", "1"); localStorage.setItem("svc_os_intro", "1"); } catch { /* no storage */ } });
        const errors = []; page.on("pageerror", e => errors.push(e.message));
        await page.goto(`${o.base}/foryou`, { waitUntil: "load" });
        const title = page.getByRole("link", { name: "Gamma Deluxe", exact: true });
        await title.waitFor({ timeout: 20_000 });
        assert.match(await title.getAttribute("href"), /\/g\/zz1$/);
        assert.match(await page.getByRole("link", { name: /Open Gamma Deluxe in the store/ }).getAttribute("href"), /^https:\/\//);
        assert.deepEqual(errors, []);
        await ctx.close();
    } finally { await browser.close(); await o.close(); }
});

test("the public appeal page works signed out and lands in the Admin panel, where accepting lifts the restriction", { timeout: 150_000 }, async t => {
    const browser = await launchBrowser();
    if (!browser) return t.skip("no Chromium here");
    const { createServer } = await import("node:net");
    const port = await new Promise(r => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
    const o = await signedIn({ port, config: { publicUrl: `http://127.0.0.1:${port}`, ownerId: "u1" }, extra: { botGuilds: () => true } });
    const WHO = "900000000000000777";
    try {
        o.db.banUser(WHO, "Spamming the server", "u1");
        // 1. A signed-out visitor opens /appeal and sends it.
        const anon = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
        await anon.addInitScript(() => { try { localStorage.setItem("svc_visited", "1"); localStorage.setItem("svc_os_intro", "1"); } catch { /* no storage */ } });
        const errors = []; anon.on("pageerror", e => errors.push(e.message));
        await anon.goto(`${o.base}/appeal`);
        await anon.getByText("You don't need to sign in.").first().waitFor({ timeout: 20_000 });
        await anon.getByPlaceholder("Your Discord user ID (a long number)", { exact: true }).fill(WHO);
        await anon.getByPlaceholder(/What happened/).fill("I was sorry about the spam and it won't happen again.");
        await anon.getByPlaceholder(/Optional: how to reach you/).fill("me@example.com");
        await anon.getByRole("button", { name: "Send appeal" }).evaluate(el => el.click());
        await anon.getByText("Appeal sent").first().waitFor({ timeout: 10_000 });
        assert.deepEqual(errors, []);
        await anon.getByPlaceholder("Your Discord user ID", { exact: true }).fill(WHO);
        await anon.getByRole("button", { name: "Check", exact: true }).evaluate(el => el.click());
        await anon.getByText(/is waiting for an answer/).waitFor({ timeout: 10_000 });
        assert.equal(o.db.listAppeals("site").length, 1);
        assert.equal(o.db.listAppeals("site")[0].contact, "me@example.com");
        // 2. The owner sees it in Admin and accepts.
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        await ctx.addCookies(o.cookie().split("; ").map(p => { const [name, ...v] = p.split("="); return { name, value: v.join("="), url: o.base }; }));
        const page = await ctx.newPage();
        await page.addInitScript(() => { try { localStorage.setItem("svc_visited", "1"); localStorage.setItem("svc_os_intro", "1"); } catch { /* no storage */ } });
        await page.goto(`${o.base}/admin#/system`, { waitUntil: "load" });
        await page.getByText("Restriction appeals (1)").first().waitFor({ timeout: 20_000 });
        await page.getByText("it won't happen again.").first().waitFor({ timeout: 5000 });
        await page.getByRole("button", { name: "Accept and lift" }).evaluate(el => el.click());
        await page.getByText(/The restriction is lifted/).first().waitFor({ timeout: 10_000 });
        assert.equal(o.db.isBanned(WHO), false, "accepting lifted the restriction");
        assert.equal(o.db.listAppeals("site", "accepted").length, 1);
    } finally { await browser.close(); await o.close(); }
});

test("the Bundles page stars bundles with a wishlist game and filters to them", { timeout: 120_000 }, async t => {
    const browser = await launchBrowser();
    if (!browser) return t.skip("no Chromium here");
    const { createServer } = await import("node:net");
    const port = await new Promise(r => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
    const o = await signedIn({ port, config: { publicUrl: `http://127.0.0.1:${port}`, ownerId: "u1" }, extra: { botGuilds: () => true } });
    try {
        o.db.addItems("u1", [{ itad_id: "h", title: "Hades" }]);
        const mk = (n, games) => ({ key: `humble:b${n}`, store: "humble", title: "Bundle " + n, url: `https://example.com/b${n}`, image: null, games, gameCount: games.length, price: "$5", expiresAt: null, seenAt: Date.now() });
        o.db.upsertFeedBundle(mk(1, ["Hades", "Hollow Knight"])); o.db.upsertFeedBundle(mk(2, ["Celeste", "Tunic"]));
        o.db.upsertLibrary("u1", [{ itad_id: "c", title: "Celeste", paid: null }]);
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        await ctx.addCookies(o.cookie().split("; ").map(p => { const [name, ...v] = p.split("="); return { name, value: v.join("="), url: o.base }; }));
        const page = await ctx.newPage();
        await page.addInitScript(() => { try { localStorage.setItem("svc_visited", "1"); localStorage.setItem("svc_os_intro", "1"); } catch { /* no storage */ } });
        const errors = []; page.on("pageerror", e => errors.push(e.message));
        await page.goto(`${o.base}/bundles`, { waitUntil: "load" });
        await page.getByText("Bundle 2").first().waitFor({ timeout: 20_000 });
        assert.equal(await page.getByText("★ On your wishlist: Hades").count(), 1, "only the bundle with Hades is starred");
        assert.equal(await page.getByText("You already own 1 of 2, so 1 would be new").count(), 1, "the owned count shows on the bundle with Celeste");
        assert.equal(await page.locator("a[href='/b/1/go']").count() > 0, true, "the open button goes through the site's own redirect");
        await page.getByRole("button", { name: "On my wishlist (1)" }).evaluate(el => el.click());
        await page.waitForTimeout(300);
        assert.equal(await page.getByText("Bundle 2").count(), 0, "the other bundle drops out");
        assert.equal(await page.getByText("Bundle 1").count() > 0, true);
        assert.deepEqual(errors, []);
    } finally { await browser.close(); await o.close(); }
});

test("the Alerts page shows Alert wins once an alert was followed by owning the game", { timeout: 120_000 }, async t => {
    const browser = await launchBrowser();
    if (!browser) return t.skip("no Chromium here");
    const { createServer } = await import("node:net");
    const port = await new Promise(r => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
    const o = await signedIn({ port, config: { publicUrl: `http://127.0.0.1:${port}`, ownerId: "u1" }, extra: { botGuilds: () => true } });
    try {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        await ctx.addCookies(o.cookie().split("; ").map(p => { const [name, ...v] = p.split("="); return { name, value: v.join("="), url: o.base }; }));
        const page = await ctx.newPage();
        await page.addInitScript(() => { try { localStorage.setItem("svc_visited", "1"); localStorage.setItem("svc_os_intro", "1"); } catch { /* no storage */ } });
        const errors = []; page.on("pageerror", e => errors.push(e.message));
        await page.goto(`${o.base}/alerts`, { waitUntil: "load" });
        await page.getByText("Alert settings").first().waitFor({ timeout: 20_000 });
        assert.equal(await page.getByText("🏆 Alert wins").count(), 0, "nothing shows before there is a win");
        o.db.logAlert({ discord_id: "u1", itad_id: "a", title: "Hades", kind: "sale", price: 10, regular: 25, shop: "Steam", via: "dm" });
        o.db.upsertLibrary("u1", [{ itad_id: "a", title: "Hades", paid: null }]);
        await page.goto(`${o.base}/alerts`, { waitUntil: "load" });
        await page.getByText("🏆 Alert wins").waitFor({ timeout: 20_000 });
        assert.equal(await page.getByText("saved you $15.00 on 1 game").count(), 1);
        assert.equal(await page.getByText("Hades: $10.00 instead of $25.00 at Steam").count(), 1);
        assert.deepEqual(errors, []);
    } finally { await browser.close(); await o.close(); }
});
