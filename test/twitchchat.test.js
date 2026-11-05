import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/db.js";
import { createStreamGiveaways } from "../src/streamgiveaway.js";
import { createTwitchChat, parseIrc } from "../src/twitchchat.js";
import { UserError } from "../src/errors.js";

class FakeWS {
    static last = null;
    constructor(url) { this.url = url; this.sent = []; FakeWS.last = this; setTimeout(() => this.onopen?.(), 0); }
    send(l) { this.sent.push(l); }
    close() { this.onclose?.(); }
    say(line) { this.onmessage?.({ data: line + "\r\n" }); }
}
const wait = ms => new Promise(r => setTimeout(r, ms));

function rig({ botToken = "tok", members = { d1: { roleIds: [] } } } = {}) {
    const db = openDb(":memory:");
    db.setCommunity("g", { live_channel: "live" });
    db.setStreamLive("g", "host", { title: "t", url: "https://twitch.tv/mia", started: Date.now() });
    db.setStreamLink("g", "host", { platform: "twitch", handle: "mia", via: "role", added: Date.now() });
    const made = [];
    const svc = {
        create: async i => { const id = db.createGiveaway({ guild_id: "g", channel_id: "live", host_id: "host", title: i.title, ends_at: Date.now() + 3600_000, status: "active" }, i.keys.map(k => ({ label: k.label, enc: "x" }))); made.push(id); return { id, prizes: i.keys.length }; },
        end: async () => {},
        enter: async (id, who) => { if (who.roleIds.includes("banned")) throw new UserError("You need the <@&123> role to enter."); db.addEntry(id, who.userId, 1); return { status: "entered", total: db.countEntries(id), steps: [] }; },
        refresh: async () => {}
    };
    const streamGw = createStreamGiveaways({ db, giveaways: () => svc });
    const chat = createTwitchChat({ db, giveaways: svc, streamGw, member: async (g, u) => members[u] ?? null, site: "https://svc.example", env: botToken ? { TWITCH_BOT_LOGIN: "svcbot", TWITCH_BOT_TOKEN: "oauth:" + botToken } : {}, WS: FakeWS, sayEveryMs: 5 });
    return { db, streamGw, chat, made };
}
const line = (nick, uid, text, chan = "mia") => `@display-name=${nick};user-id=${uid} :${nick.toLowerCase()}!x@x.tmi.twitch.tv PRIVMSG #${chan} :${text}`;

test("chat lines are read with their tags", () => {
    const m = parseIrc("@display-name=Some\\sOne;user-id=42 :someone!x@x PRIVMSG #mia :!enter please");
    assert.equal(m.command, "PRIVMSG"); assert.equal(m.channel, "mia"); assert.equal(m.text, "!enter please");
    assert.equal(m.tags["display-name"], "Some One"); assert.equal(m.tags["user-id"], "42");
    assert.equal(parseIrc("PING :tmi.twitch.tv").command, "PING");
    assert.equal(parseIrc(""), null);
});

test("it only listens where a giveaway allows chat entry and the streamer's Twitch is linked", async () => {
    const { streamGw, chat } = rig();
    assert.equal(chat.wantedNow().size, 0, "no giveaway yet");
    await streamGw.start("g", { id: "host", name: "Mia" }, { game: "Hades", key: "AAAA-BBBB" });
    assert.equal(chat.wantedNow().size, 0, "a giveaway without chat entry is left alone");
    await streamGw.start("g", { id: "host", name: "Mia" }, { game: "Celeste", key: "CCCC-DDDD", endWithStream: false, chat: { invite: "https://discord.gg/abc" } });
    const w = chat.wantedNow();
    assert.deepEqual([...w.keys()], ["mia"]); assert.equal(w.get("mia").invite, "https://discord.gg/abc");
});

test("!enter: unlinked viewers are sent to the Discord and link page, linked members get in once", async () => {
    const { db, streamGw, chat } = rig();
    const r = await streamGw.start("g", { id: "host", name: "Mia" }, { game: "Hades", key: "AAAA-BBBB", chat: { invite: "https://discord.gg/abc" } });
    chat.start(); await wait(20);
    const ws = FakeWS.last;
    assert.match(ws.sent.join("\n"), /PASS oauth:tok/); assert.match(ws.sent.join("\n"), /NICK svcbot/);
    ws.say(":tmi.twitch.tv 001 svcbot :Welcome"); await wait(5);
    assert.ok(ws.sent.includes("JOIN #mia"), "joins the streamer's chat");
    const said = () => ws.sent.filter(l => l.startsWith("PRIVMSG"));
    // not linked yet
    ws.say(line("Newbie", "900", "!enter")); await wait(30);
    assert.equal(said().length, 1); assert.match(said()[0], /@Newbie/); assert.match(said()[0], /https:\/\/discord\.gg\/abc/); assert.match(said()[0], /svc\.example\/#\/steam/);
    ws.say(line("Newbie", "900", "!enter")); await wait(30);
    assert.equal(said().length, 1, "no spam for the same person");
    assert.equal(db.countEntries(r.id), 0);
    // linked and in the server
    db.setTwitchLink("d1", { twitchId: "901", login: "fan" });
    ws.say(line("Fan", "901", "!ENTER")); await wait(40);
    assert.equal(db.countEntries(r.id), 1); assert.match(said().at(-1), /you're in the giveaway/);
    // a second try is told so and does not leave the giveaway
    chat.stop(); 
});

test("!enter: not in the server, already in, and refused entries each get a plain answer", async () => {
    const { db, streamGw, chat } = rig({ members: { d1: { roleIds: [] }, d3: { roleIds: ["banned"] } } });
    const r = await streamGw.start("g", { id: "host", name: "Mia" }, { game: "Hades", key: "AAAA-BBBB", chat: { invite: "https://discord.gg/abc" } });
    chat.start(); await wait(20);
    const ws = FakeWS.last; ws.say(":tmi.twitch.tv 001 svcbot :Welcome"); await wait(5);
    const said = () => ws.sent.filter(l => l.startsWith("PRIVMSG"));
    db.setTwitchLink("d2", { twitchId: "902", login: "ghost" }); db.setTwitchLink("d1", { twitchId: "901", login: "fan" }); db.setTwitchLink("d3", { twitchId: "903", login: "nope" });
    ws.say(line("Ghost", "902", "!enter")); await wait(30);
    assert.match(said().at(-1), /join the Discord first/);
    ws.say(line("Fan", "901", "!enter")); await wait(30);
    chat.stop();
    assert.equal(db.countEntries(r.id), 1);
    // reconnect for the remaining checks
    const again = rig({ members: { d3: { roleIds: ["banned"] }, d1: { roleIds: [] } } });
    const g2 = await again.streamGw.start("g", { id: "host", name: "Mia" }, { game: "Hades", key: "AAAA-BBBB", chat: {} });
    again.db.setTwitchLink("d3", { twitchId: "903", login: "nope" }); again.db.setTwitchLink("d1", { twitchId: "901", login: "fan" });
    again.chat.start(); await wait(20);
    const w2 = FakeWS.last; w2.say(":tmi.twitch.tv 001 svcbot :Welcome"); await wait(5);
    w2.say(line("Nope", "903", "!enter")); await wait(30);
    const out = w2.sent.filter(l => l.startsWith("PRIVMSG"));
    assert.match(out.at(-1), /@Nope .*the required role/); assert.ok(!/<@&/.test(out.at(-1)), "no raw Discord mentions in chat");
    w2.say(line("Fan", "901", "!enter")); await wait(30);
    w2.say(line("Fan", "901", "!enter")); await wait(30);
    again.chat.stop();
    assert.equal(again.db.countEntries(g2.id), 1);
});

test("without a bot login it still counts linked viewers but stays quiet", async () => {
    const { db, streamGw, chat } = rig({ botToken: "" });
    const r = await streamGw.start("g", { id: "host", name: "Mia" }, { game: "Hades", key: "AAAA-BBBB", chat: {} });
    db.setTwitchLink("d1", { twitchId: "901", login: "fan" });
    chat.start(); await wait(20);
    const ws = FakeWS.last; assert.match(ws.sent.join("\n"), /NICK justinfan/); ws.say(":tmi.twitch.tv 001 justinfan1 :Welcome"); await wait(5);
    ws.say(line("Fan", "901", "!enter")); await wait(40);
    chat.stop();
    assert.equal(db.countEntries(r.id), 1); assert.equal(ws.sent.filter(l => l.startsWith("PRIVMSG")).length, 0); assert.equal(chat.canSay, false);
});

test("a Twitch account belongs to one Discord account", () => {
    const db = openDb(":memory:");
    db.setTwitchLink("a", { twitchId: "1", login: "x" }); db.setTwitchLink("b", { twitchId: "1", login: "x" });
    assert.equal(db.getTwitchLink("a"), null); assert.equal(db.twitchLinkByTwitchId("1").discord_id, "b");
    assert.equal(db.removeTwitchLink("b"), true);
});
