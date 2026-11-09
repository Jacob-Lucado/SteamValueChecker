// Offsite backups: each daily database copy is compressed, encrypted and uploaded to any S3-compatible bucket (Fly's Tigris storage
// works), so losing the data volume doesn't lose everything. Backups hold the same personal data as the database, which is why
// they are encrypted with a key made from KEY_ENCRYPTION_SECRET before they leave the machine.
import { createHash, createHmac, createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const MAGIC = Buffer.from("SVCB1");
const sha = d => createHash("sha256").update(d).digest("hex");
const hmac = (k, d) => createHmac("sha256", k).update(d).digest();
const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());

/** Signs one request with AWS signature v4. Returns the headers to send. */
export function signV4({ method, url, region, accessKey, secretKey, body = "", now = new Date() }) {
    const u = new URL(url);
    const amz = now.toISOString().replace(/[:-]|\.\d{3}/g, ""), day = amz.slice(0, 8);
    const payloadHash = sha(body);
    const headers = { host: u.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amz };
    const names = Object.keys(headers).sort();
    const canonicalQuery = [...u.searchParams].map(([k, v]) => [enc(k), enc(v)]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("&");
    const canonical = [method, u.pathname.split("/").map(p => enc(decodeURIComponent(p))).join("/"), canonicalQuery, names.map(n => `${n}:${headers[n]}\n`).join(""), names.join(";"), payloadHash].join("\n");
    const scope = `${day}/${region}/s3/aws4_request`;
    const toSign = ["AWS4-HMAC-SHA256", amz, scope, sha(canonical)].join("\n");
    const key = hmac(hmac(hmac(hmac("AWS4" + secretKey, day), region), "s3"), "aws4_request");
    const signature = createHmac("sha256", key).update(toSign).digest("hex");
    const { host, ...rest } = headers;
    return { ...rest, Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}` };
}

/** gzip, then AES-256-GCM. Layout: magic, salt(16), iv(12), tag(16), ciphertext. */
export function packBackup(buf, secret) {
    const gz = gzipSync(buf);
    if (!secret) return { data: gz, encrypted: false };
    const salt = randomBytes(16), iv = randomBytes(12), key = scryptSync(secret, salt, 32);
    const c = createCipheriv("aes-256-gcm", key, iv), body = Buffer.concat([c.update(gz), c.final()]);
    return { data: Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), body]), encrypted: true };
}
export function unpackBackup(buf, secret) {
    if (buf.subarray(0, MAGIC.length).equals(MAGIC)) {
        if (!secret) throw new Error("This backup is encrypted and there is no KEY_ENCRYPTION_SECRET to open it.");
        const salt = buf.subarray(5, 21), iv = buf.subarray(21, 33), tag = buf.subarray(33, 49), body = buf.subarray(49);
        const d = createDecipheriv("aes-256-gcm", scryptSync(secret, salt, 32), iv); d.setAuthTag(tag);
        return gunzipSync(Buffer.concat([d.update(body), d.final()]));
    }
    return gunzipSync(buf);
}

export function createOffsite({ endpoint, bucket, accessKey, secretKey, region = "auto", secret = null, keep = 14, prefix = "backups/", fetchImpl = globalThis.fetch, now = () => Date.now(), db = null, log = () => {} } = {}) {
    const enabled = Boolean(endpoint && bucket && accessKey && secretKey);
    const base = () => `${endpoint.replace(/\/$/, "")}/${bucket}`;
    async function call(method, path, { body = "", query = "" } = {}) {
        const url = `${base()}${path}${query ? "?" + query : ""}`;
        const headers = signV4({ method, url, region, accessKey, secretKey, body, now: new Date(now()) });
        const res = await fetchImpl(url, { method, headers, body: method === "PUT" ? body : undefined, signal: AbortSignal.timeout(60_000) });
        if (!res.ok) throw new Error(`storage answered ${res.status}`);
        return res;
    }
    const nameOf = file => file.split("/").pop();

    async function list() {
        if (!enabled) return [];
        const xml = await (await call("GET", "/", { query: `list-type=2&prefix=${enc(prefix)}` })).text();
        return [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map(m => ({
            key: /<Key>([^<]+)<\/Key>/.exec(m[1])?.[1], size: Number(/<Size>(\d+)<\/Size>/.exec(m[1])?.[1] ?? 0), at: Date.parse(/<LastModified>([^<]+)<\/LastModified>/.exec(m[1])?.[1] ?? "") || null
        })).filter(o => o.key).sort((a, b) => (a.key < b.key ? -1 : 1));
    }

    /** Uploads one local backup file (once), then removes the oldest copies beyond `keep`. */
    async function upload(file) {
        if (!enabled) return { skipped: "not set up" };
        const name = nameOf(file);
        if (db?.getMeta(`offsite:done:${name}`)) return { skipped: "already uploaded" };
        const { data, encrypted } = packBackup(readFileSync(file), secret);
        const key = `${prefix}${name}.gz${encrypted ? ".enc" : ""}`;
        await call("PUT", "/" + key.split("/").map(enc).join("/"), { body: data });
        db?.setMeta(`offsite:done:${name}`, String(now()));
        db?.setMeta("offsite:last", JSON.stringify({ at: now(), name, bytes: data.length, encrypted }));
        const all = await list();
        let removed = 0;
        for (const o of all.slice(0, Math.max(0, all.length - keep))) { try { await call("DELETE", "/" + o.key.split("/").map(enc).join("/")); removed++; } catch (e) { log(`could not remove ${o.key}: ${e.message}`); } }
        return { uploaded: key, bytes: data.length, encrypted, removed };
    }

    async function fetchLatest() {
        const all = await list();
        const latest = all[all.length - 1];
        if (!latest) return null;
        const raw = Buffer.from(await (await call("GET", "/" + latest.key.split("/").map(enc).join("/"))).arrayBuffer());
        return { key: latest.key, db: unpackBackup(raw, secret) };
    }

    /** Proves the newest offsite copy can be downloaded, opened and read: integrity check plus a row count. */
    async function verify() {
        if (!enabled) throw new Error("Offsite backups aren't set up.");
        const got = await fetchLatest();
        if (!got) throw new Error("There are no offsite backups yet.");
        const dir = mkdtempSync(join(tmpdir(), "svc-verify-")), file = join(dir, "check.db");
        try {
            writeFileSync(file, got.db);
            const d = new DatabaseSync(file, { readOnly: true });
            try {
                const ok = d.prepare("PRAGMA integrity_check").get();
                const users = d.prepare("SELECT COUNT(*) AS n FROM users").get().n;
                return { key: got.key, ok: Object.values(ok)[0] === "ok", users, bytes: got.db.length };
            } finally { d.close(); }
        } finally { rmSync(dir, { recursive: true, force: true }); }
    }

    return { enabled, list, upload, verify, fetchLatest };
}

/** Reads the settings from the environment. Works with the names Fly's Tigris storage sets as well as BACKUP_S3_* ones. */
export function offsiteConfig(env = process.env) {
    return {
        endpoint: env.BACKUP_S3_ENDPOINT || env.AWS_ENDPOINT_URL_S3 || null,
        bucket: env.BACKUP_S3_BUCKET || env.BUCKET_NAME || null,
        accessKey: env.BACKUP_S3_KEY || env.AWS_ACCESS_KEY_ID || null,
        secretKey: env.BACKUP_S3_SECRET || env.AWS_SECRET_ACCESS_KEY || null,
        region: env.BACKUP_S3_REGION || env.AWS_REGION || "auto",
        keep: Math.max(2, Number(env.BACKUP_OFFSITE_KEEP) || 14)
    };
}
