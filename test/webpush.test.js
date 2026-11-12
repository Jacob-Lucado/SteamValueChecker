import test from "node:test";
import assert from "node:assert/strict";
import { createECDH, randomBytes, createPublicKey, verify } from "node:crypto";
import { openDb } from "../src/db.js";
import { createPush, encrypt, decrypt, allowedEndpoint } from "../src/webpush.js";
import { createNotifier } from "../src/notify.js";

const ua = () => { const e = createECDH("prime256v1"); e.generateKeys(); const auth = randomBytes(16); return { e, auth: auth.toString("base64url"), sub: { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: e.getPublicKey().toString("base64url"), auth: auth.toString("base64url") } } }; };

test("a message encrypts so only the subscribed browser can read it", () => {
    const u = ua();
    const body = encrypt(JSON.stringify({ title: "Hades", body: "now 50% off" }), { p256dh: u.sub.keys.p256dh, auth: u.sub.keys.auth });
    assert.equal(JSON.parse(decrypt(body, u.e, u.auth)).title, "Hades");
    const other = ua();
    assert.throws(() => decrypt(body, other.e, other.auth));
});
test("only the browsers' own push services are accepted", () => {
    assert.ok(allowedEndpoint("https://fcm.googleapis.com/fcm/send/x")); assert.ok(allowedEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x")); assert.ok(allowedEndpoint("https://web.push.apple.com/x"));
    for (const bad of ["http://fcm.googleapis.com/x", "https://evil.example/x", "https://127.0.0.1/x", "https://fcm.googleapis.com.evil.example/x", "not a url"]) assert.ok(!allowedEndpoint(bad), bad);
});
test("sending signs with VAPID, drops dead subscriptions and survives failures", async () => {
    const db = openDb(":memory:"), u = ua(), seen = [];
    let status = 201;
    const push = createPush({ db, fetchImpl: async (url, o) => { seen.push({ url, o }); return { status }; } });
    assert.equal(push.subscribe("u1", u.sub).devices, 1);
    assert.equal(push.publicKey(), createPush({ db }).publicKey(), "the keys are made once and kept");
    assert.equal(await push.send("u1", { title: "Hi", body: "there" }), 1);
    const h = seen[0].o.headers, [, jwt] = /t=([^,]+),/.exec(h.Authorization);
    const [a, b, c] = jwt.split(".");
    assert.equal(JSON.parse(Buffer.from(b, "base64url")).aud, "https://fcm.googleapis.com");
    const pub = createPublicKey({ key: { kty: "EC", crv: "P-256", x: Buffer.from(push.publicKey(), "base64url").subarray(1, 33).toString("base64url"), y: Buffer.from(push.publicKey(), "base64url").subarray(33).toString("base64url") }, format: "jwk" });
    assert.ok(verify("sha256", Buffer.from(`${a}.${b}`), { key: pub, dsaEncoding: "ieee-p1363" }, Buffer.from(c, "base64url")));
    assert.equal(JSON.parse(decrypt(seen[0].o.body, u.e, u.auth)).body, "there");
    status = 500; assert.equal(await push.send("u1", { title: "x" }), 0); assert.equal(db.countPushSubs("u1"), 1);
    status = 410; assert.equal(await push.send("u1", { title: "x" }), 0); assert.equal(db.countPushSubs("u1"), 0);
});
test("bad subscriptions are refused", () => {
    const db = openDb(":memory:"), push = createPush({ db }), u = ua();
    assert.throws(() => push.subscribe("u1", { ...u.sub, endpoint: "https://evil.example/x" }));
    assert.throws(() => push.subscribe("u1", { endpoint: u.sub.endpoint, keys: { p256dh: "AAAA", auth: u.auth } }));
});
test("an alert goes to the browser when push works, and by DM when it does not", async () => {
    const db = openDb(":memory:"), u = ua(), dms = [];
    db.upsertUser?.("u1"); 
    let ok = true;
    const push = createPush({ db, fetchImpl: async () => ({ status: ok ? 201 : 500 }) });
    push.subscribe("u1", u.sub);
    const n = createNotifier({ db, push, discord: { sendDm: async (id, p) => { dms.push(id); }, sendChannel: async () => {} } });
    const user = { discord_id: "u1" };
    assert.equal((await n.deliver(user, { embeds: [{ title: "Sale", description: "50% off", url: "https://store.steampowered.com/app/1" }] })).via, "push");
    assert.equal(dms.length, 0);
    ok = false;
    assert.equal((await n.deliver(user, { embeds: [{ title: "Sale" }] })).via, "dm");
    assert.equal(dms.length, 1);
});
