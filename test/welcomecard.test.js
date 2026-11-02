import test from "node:test";
import assert from "node:assert/strict";
import { welcomeSvg, renderWelcomeCard } from "../src/cardimg.js";
import { createDiscordRest } from "../src/dashboard/discord.js";

test("the welcome picture escapes names, copes with long ones, and renders to a PNG", async () => {
    const svg = welcomeSvg({ name: `<b>"Hax" & co</b> with a very long name indeed`, server: "A server with a rather long name for a card", count: 7 });
    assert.doesNotMatch(svg, /<b>/); assert.match(svg, /Member #7/); assert.match(svg, /…/);
    const png = await renderWelcomeCard({ name: "Newbie", server: "Game Junkies", count: 12, avatarUrl: "http://169.254.169.254/x.png", fetchImpl: async () => { throw new Error("must not be fetched"); } });
    assert.equal(png.subarray(1, 4).toString(), "PNG");
});

test("posting with a file sends a multipart form: the message as JSON, then the picture", async () => {
    let seen;
    const rest = createDiscordRest({ clientId: "c", clientSecret: "s", botToken: "T", redirectUri: "http://x", fetchImpl: async (url, init) => { seen = { url, init }; return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ id: "m1" }), text: async () => "{}" }; } });
    await rest.sendMessage("chan", { embeds: [{ title: "Hi", image: { url: "attachment://welcome.png" } }], files: [{ name: "welcome.png", data: Buffer.from("abc") }] });
    assert.ok(seen.init.body instanceof FormData); assert.equal(seen.init.headers["Content-Type"], undefined, "the form sets its own content type");
    const json = JSON.parse(seen.init.body.get("payload_json"));
    assert.deepEqual(json.attachments, [{ id: 0, filename: "welcome.png" }]); assert.equal(json.files, undefined);
    assert.equal(seen.init.body.get("files[0]").name, "welcome.png");
    await rest.sendMessage("chan", { content: "plain" });
    assert.equal(typeof seen.init.body, "string");
});
