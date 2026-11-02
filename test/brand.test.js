import test from "node:test";
import assert from "node:assert/strict";
import { brandEmbed, brandPayload, brandInteraction, brandRest, BRAND_COLOR } from "../src/brand.js";
import { helpPayload, configureHelp, handleHelpPick, isHelpNav } from "../src/helpui.js";
import { HELP_PAGES } from "../src/text.js";

const logo = "https://svc.example/logo.png";

test("embeds keep what a command set and get what it left out", () => {
    const a = brandEmbed({ title: "Hi" }, { logo });
    assert.equal(a.color, BRAND_COLOR); assert.deepEqual(a.footer, { text: "Steam Value Checker", icon_url: logo });
    const b = brandEmbed({ color: 0x123456, footer: { text: "Mine" } }, { logo });
    assert.equal(b.color, 0x123456); assert.deepEqual(b.footer, { text: "Mine", icon_url: logo });
    const c = brandEmbed({ footer: { text: "x", icon_url: "https://a.example/i.png" } }, { logo });
    assert.equal(c.footer.icon_url, "https://a.example/i.png");
    const orig = { title: "t" }; brandEmbed(orig, { logo }); assert.deepEqual(orig, { title: "t" }, "the original isn't changed");
});

test("bare text becomes a card, except when it pings someone or carries embeds or files", () => {
    const t = brandPayload({ content: "✅ Saved." }, { logo });
    assert.equal(t.content, undefined); assert.equal(t.embeds[0].description, "✅  Saved."); assert.equal(t.embeds[0].color, 0x57f287);
    assert.equal(brandPayload("hello").embeds[0].description, "hello");
    assert.equal(brandPayload({ content: "⚠️ No." }).embeds[0].color, 0xed4245);
    assert.equal(brandPayload({ content: "✅ Saved." }).embeds[0].color, 0x57f287, "good news is green");
    assert.equal(brandPayload({ content: "<@123456789012345678> you won" }).content, "<@123456789012345678> you won", "pings stay as text");
    assert.equal(brandPayload({ content: "@everyone hi" }).embeds, undefined);
    const withEmbed = brandPayload({ content: "<@&123456789012345678>", embeds: [{ title: "x" }] }, { logo });
    assert.equal(withEmbed.content, "<@&123456789012345678>"); assert.equal(withEmbed.embeds[0].footer.text, "Steam Value Checker");
    assert.deepEqual(brandPayload({ components: [] }), { components: [] }, "a components-only edit is untouched");
    assert.equal(brandPayload({ content: "x", files: [1] }).embeds, undefined);
    assert.equal(brandPayload({ flags: 1 << 15, content: "v2" }).embeds, undefined);
    assert.equal(brandPayload(null), null);
});

test("every reply to an interaction and every channel post or DM goes through the brand", async () => {
    const seen = [];
    const i = { reply: async p => seen.push(["reply", p]), editReply: async p => seen.push(["edit", p]), followUp: async p => seen.push(["follow", p]), update: async p => seen.push(["update", p]), deferReply: async () => seen.push(["defer"]) };
    brandInteraction(i, { logo });
    await i.reply({ content: "ok", flags: 64 }); await i.editReply({ embeds: [{ title: "t" }] }); await i.followUp("hey"); await i.update({ embeds: [{ description: "d" }] }); await i.deferReply();
    assert.equal(seen[0][1].flags, 64); assert.ok(seen[0][1].embeds); assert.equal(seen[1][1].embeds[0].footer.icon_url, logo); assert.ok(seen[2][1].embeds); assert.ok(seen[3][1].embeds[0].footer); assert.deepEqual(seen[4], ["defer"]);
    const calls = [];
    const api = { sendMessage: async (c, p) => calls.push(["send", c, p]), editMessage: async (c, m, p) => calls.push(["edit", c, m, p]), sendDm: async (u, p) => calls.push(["dm", u, p]), other: 1 };
    brandRest(api, { logo });
    await api.sendMessage("c1", { embeds: [{ title: "x" }] }); await api.editMessage("c1", "m1", { embeds: [{ title: "y" }] }); await api.editMessage("c1", "m1", { components: [] }); await api.sendDm("u1", { content: "plain" });
    assert.equal(calls[0][2].embeds[0].color, BRAND_COLOR); assert.equal(calls[1][3].embeds[0].footer.text, "Steam Value Checker"); assert.deepEqual(calls[2][3], { components: [] }); assert.ok(calls[3][2].embeds);
});

test("/help is a branded card with a menu, Back and Next, and links; every page works and the buttons wrap around", async () => {
    configureHelp({ base: "https://svc.example", supportUrl: "https://creator.example", inviteUrl: "https://discord.com/oauth2/authorize?x=1" });
    for (const p of HELP_PAGES) {
        const out = helpPayload(p.key), e = out.embeds[0];
        assert.equal(e.author.icon_url, "https://svc.example/logo.png"); assert.equal(e.thumbnail.url, "https://svc.example/logo.png"); assert.match(e.footer.text, /page \d+ of \d+/);
        assert.ok(e.fields.every(f => f.name && f.value.length <= 1024)); assert.equal(out.components.length, 2);
        const row = out.components[1].components; assert.equal(row[0].custom_id, "help_go:" + HELP_PAGES[(HELP_PAGES.indexOf(p) + HELP_PAGES.length - 1) % HELP_PAGES.length].key);
        assert.deepEqual(row.slice(2).map(b => b.style), [5, 5, 5]); assert.ok(row.slice(2).every(b => /^https:\/\//.test(b.url)));
    }
    assert.ok(helpPayload("start").embeds[0].image.url.endsWith("/banner.png")); assert.equal(helpPayload(HELP_PAGES[1].key).embeds[0].image, undefined);
    let got = null; await handleHelpPick({ isButton: () => true, customId: "help_go:" + HELP_PAGES[2].key, update: async p => { got = p; } });
    assert.match(got.embeds[0].title, new RegExp(HELP_PAGES[2].title.slice(0, 10)));
    assert.equal(isHelpNav({ isButton: () => true, customId: "help_go:start" }), true); assert.equal(isHelpNav({ isButton: () => true, customId: "mu:x" }), false);
    configureHelp({ base: null, supportUrl: null, inviteUrl: null });
    assert.equal(helpPayload("start").embeds[0].thumbnail, undefined); assert.equal(helpPayload("start").components[1].components.length, 2, "no links without addresses");
});
