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

const PAGES = ["home", "library", "steam", "value", "wishlist", "foryou", "deals", "warroom", "free", "bundles", "playtests", "codes", "feed", "people", "friends", "compare", "communities", "discover", "gamenight", "nowplaying", "club", "trivia", "lfg", "calendar", "fortnite", "servers", "setup", "community", "santa", "xp", "mod", "giveaways", "indie", "streamer", "overlays", "streams", "streamers", "profile", "mypage", "notifications", "alerts", "mydata", "help", "support", "tip", "requests", "status", "changelog", "about"];

test("every dashboard page opens without script errors", { timeout: 240_000 }, async t => {
    const browser = await launchBrowser();
    if (!browser) return t.skip("no Chromium here");
    const o = await signedIn({ config: { ownerId: "u1" }, extra: { botGuilds: () => true, guildList: () => [{ id: "g-admin", name: "Mine", members: 10, boosts: 0 }] } });
    try {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        await ctx.addCookies(o.cookie().split("; ").map(p => { const [name, ...v] = p.split("="); return { name, value: v.join("="), url: o.base }; }));
        const page = await ctx.newPage();
        await page.addInitScript(() => { try { localStorage.setItem("svc_visited", "1"); localStorage.setItem("svc_os_intro", "1"); } catch { /* no storage */ } });
        const errors = [], empty = [];
        page.on("pageerror", e => errors.push(`${page.url()} ${e.message}`));
        for (const id of (process.env.ONLY ? process.env.ONLY.split(",") : PAGES)) {
            await page.goto(`${o.base}/${id === "home" ? "" : id}`, { waitUntil: "load" });
            await page.waitForTimeout(500);
            const len = await page.evaluate(() => (document.getElementById("app")?.innerText ?? "").trim().length);
            if (len < 30) { empty.push(id); if (process.env.ONLY) console.log(await page.evaluate(() => document.body.innerText.slice(0, 300)), page.url()); }
        }
        assert.deepEqual(errors, []);
        assert.deepEqual(empty, []);
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
