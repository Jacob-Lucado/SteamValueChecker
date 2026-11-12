// Web push: price alerts that reach a phone or desktop through the browser, with no Discord DM needed.
// Written on Node's own crypto (RFC 8030 push, RFC 8291 message encryption, RFC 8292 VAPID), so it needs no package.
import { createECDH, createCipheriv, createDecipheriv, createPrivateKey, createPublicKey, generateKeyPairSync, hkdfSync, randomBytes, sign } from "node:crypto";

const b64u = b => Buffer.from(b).toString("base64url");
const unb64u = s => Buffer.from(String(s), "base64url");
const HOSTS = [/(^|\.)fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)web\.push\.apple\.com$/];
/** Only the browsers' own push services are ever contacted, never an address a visitor made up. */
export const allowedEndpoint = u => { try { const x = new URL(u); return x.protocol === "https:" && !x.port && HOSTS.some(r => r.test(x.hostname)) && u.length <= 600; } catch { return false; } };

/** Encrypts `payload` for one subscription (RFC 8291, aes128gcm). */
export function encrypt(payload, { p256dh, auth }, { ephemeral = null, salt = randomBytes(16) } = {}) {
    const ua = unb64u(p256dh), authSecret = unb64u(auth);
    if (ua.length !== 65 || ua[0] !== 4 || authSecret.length !== 16) throw new Error("bad subscription keys");
    const as = ephemeral ?? (() => { const e = createECDH("prime256v1"); e.generateKeys(); return e; })();
    const asPub = as.getPublicKey();
    const secret = as.computeSecret(ua);
    const ikm = Buffer.from(hkdfSync("sha256", secret, authSecret, Buffer.concat([Buffer.from("WebPush: info\0"), ua, asPub]), 32));
    const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
    const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
    const c = createCipheriv("aes-128-gcm", cek, nonce);
    const body = Buffer.concat([c.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), c.final(), c.getAuthTag()]);
    const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
    return Buffer.concat([salt, rs, Buffer.from([asPub.length]), asPub, body]);
}
/** What the browser does with it, used by the tests. */
export function decrypt(buf, ecdh, authB64) {
    const salt = buf.subarray(0, 16), idlen = buf[20], asPub = buf.subarray(21, 21 + idlen), data = buf.subarray(21 + idlen);
    const uaPub = ecdh.getPublicKey(), secret = ecdh.computeSecret(asPub);
    const ikm = Buffer.from(hkdfSync("sha256", secret, unb64u(authB64), Buffer.concat([Buffer.from("WebPush: info\0"), uaPub, asPub]), 32));
    const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
    const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
    const d = createDecipheriv("aes-128-gcm", cek, nonce); d.setAuthTag(data.subarray(data.length - 16));
    const plain = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
    return plain.subarray(0, plain.lastIndexOf(2)).toString();
}

export function createPush({ db, fetchImpl = fetch, contact = "mailto:admin@steamvaluechecker.com", now = () => Date.now() }) {
    let keys = null;
    function vapid() {
        if (keys) return keys;
        let saved = null; try { saved = JSON.parse(db.getMeta("vapid_keys") ?? "null"); } catch { /* make new ones */ }
        if (!saved?.d || !saved?.x || !saved?.y) {
            const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
            const j = privateKey.export({ format: "jwk" }); saved = { d: j.d, x: j.x, y: j.y };
            db.setMeta("vapid_keys", JSON.stringify(saved));
        }
        keys = { pub: b64u(Buffer.concat([Buffer.from([4]), unb64u(saved.x), unb64u(saved.y)])), priv: createPrivateKey({ key: { kty: "EC", crv: "P-256", ...saved }, format: "jwk" }) };
        return keys;
    }
    const publicKey = () => vapid().pub;
    function jwt(endpoint) {
        const k = vapid(), head = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }));
        const claims = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now() / 1000) + 12 * 3600, sub: contact }));
        return `${head}.${claims}.${b64u(sign("sha256", Buffer.from(`${head}.${claims}`), { key: k.priv, dsaEncoding: "ieee-p1363" }))}`;
    }
    function subscribe(userId, sub) {
        const s = { endpoint: String(sub?.endpoint ?? ""), p256dh: String(sub?.keys?.p256dh ?? sub?.p256dh ?? ""), auth: String(sub?.keys?.auth ?? sub?.auth ?? "") };
        if (!allowedEndpoint(s.endpoint)) throw new Error("That browser's push service is not supported.");
        if (unb64u(s.p256dh).length !== 65 || unb64u(s.auth).length !== 16) throw new Error("That subscription looks wrong.");
        if (db.countPushSubs(userId) >= 8 && !db.pushSubs(userId).some(x => x.endpoint === s.endpoint)) throw new Error("You already have push turned on in 8 browsers. Turn one off first.");
        db.addPushSub(userId, s);
        return { devices: db.countPushSubs(userId) };
    }
    const unsubscribe = (userId, endpoint = null) => ({ removed: db.dropPushSubsOf(userId, endpoint) });
    /** Sends one notification to every browser a person turned push on in. Returns how many accepted it. */
    async function send(userId, { title, body = "", url = "/", tag = null }) {
        let ok = 0;
        const payload = JSON.stringify({ title: String(title).slice(0, 120), body: String(body).slice(0, 240), url, tag });
        for (const s of db.pushSubs(userId)) {
            try {
                const r = await fetchImpl(s.endpoint, { method: "POST", headers: { Authorization: `vapid t=${jwt(s.endpoint)}, k=${publicKey()}`, "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "86400", Urgency: "normal" }, body: encrypt(payload, s), signal: AbortSignal.timeout(10_000) });
                if (r.status >= 200 && r.status < 300) ok++;
                else if (r.status === 404 || r.status === 410) db.dropPushSub(s.endpoint);
                else db.failPushSub(s.endpoint);
            } catch { db.failPushSub(s.endpoint); }
        }
        return ok;
    }
    return { publicKey, subscribe, unsubscribe, send, devices: userId => db.countPushSubs(userId) };
}
