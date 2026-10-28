import test from "node:test";
import assert from "node:assert/strict";

test("profile card: only the game being played right now, with entities decoded", async () => {
    const { parseProfileXml } = await import("../src/steamlib.js");
    const base = '<profile><steamID>Tom &amp; Jerry</steamID><onlineState>online</onlineState><mostPlayedGames><mostPlayedGame><gameName><![CDATA[Fell & Sell]]></gameName></mostPlayedGame></mostPlayedGames>';
    const idle = parseProfileXml(base + "</profile>", "76561198000000000");
    assert.equal(idle.playing, null, "a most-played game is not what they are playing now");
    assert.equal(idle.name, "Tom & Jerry", "&amp; becomes &");
    const live = parseProfileXml(base + "<inGameInfo><gameName>Hades &amp; II</gameName></inGameInfo></profile>", "76561198000000000");
    assert.equal(live.playing, "Hades & II");
});
