import test from "node:test";
import assert from "node:assert/strict";
import { parseWeekend, createFreeWeekends, withFreeWeekends } from "../src/freeweekend.js";
import { freeGamesPayload } from "../src/render.js";

const page = (title, start, end) => `<html><div id="appHubAppName" class="apphub_AppName">${title}</div><div data-props="{&quot;free_weekend&quot;:{&quot;start_time&quot;:${start},&quot;end_time&quot;:${end},&quot;text&quot;:null,&quot;appid&quot;:null}}"></div></html>`;

test("free weekend block is read from a store page, and a page without one gives nothing", () => {
    assert.deepEqual(parseWeekend(page("X", 100, 200)), { start: 100, end: 200, text: "" });
    assert.equal(parseWeekend("<html>nothing</html>"), null);
});

test("free-to-play-until games come from store pages, skip ended and far-future ones, and are cached", async () => {
    const now = 1_000_000_000_000, sec = ms => Math.floor(ms / 1000);
    const pages = { 11: page("For The King II", sec(now - 1000), sec(now + 86_400_000)), 12: page("Old Weekend", sec(now - 9e6), sec(now - 1000)), 13: page("Later", sec(now + 9e8), sec(now + 9e8 + 1000)), 14: "<html></html>" };
    let calls = 0;
    const fetchImpl = async url => {
        calls++;
        const id = /app\/(\d+)/.exec(url)?.[1];
        if (id) return { ok: true, text: async () => pages[id] ?? "" };
        if (/GetMostPlayedGames/.test(url)) return { ok: true, json: async () => ({ response: { ranks: [{ appid: 11 }, { appid: 12 }, { appid: 13 }, { appid: 14 }] } }) };
        return { ok: false, status: 500 };
    };
    const fw = createFreeWeekends({ fetchImpl, now: () => now });
    const list = await fw.list();
    assert.equal(list.length, 1); assert.equal(list[0].title, "For The King II"); assert.equal(list[0].weekend, true); assert.equal(list[0].expiry, now + 86_400_000);
    const before = calls; await fw.list(); assert.equal(calls, before, "second ask uses the cache");
    const itad = { getGiveawayList: async () => [{ id: "x", title: "Other", url: "https://e.test/" }] };
    withFreeWeekends(itad, fw);
    assert.equal((await itad.getGiveawayList()).length, 2);
    const off = createFreeWeekends({ fetchImpl, enabled: false }); assert.deepEqual(await off.list(), []);
});

test("a free weekend card says free to play until the date, not 'claim'", () => {
    const p = freeGamesPayload("Steam", [{ id: "fw:1", title: "Some Game", url: "https://store.steampowered.com/app/1/", expiry: 1794506400000, weekend: true }]);
    assert.match(p.content, /Free to play until <t:1794506400:d>/);
    assert.match(p.embeds[0].description, /FREE TO PLAY/);
    assert.equal(p.components[0].components[0].label, "Play free");
});
