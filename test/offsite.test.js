import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db.js";
import { signV4, packBackup, unpackBackup, createOffsite, offsiteConfig } from "../src/offsite.js";

test("the request signing matches Amazon's published example", () => {
    const h = signV4({ method: "GET", url: "https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J", region: "us-east-1", accessKey: "AKIAIOSFODNN7EXAMPLE", secretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", now: new Date("2013-05-24T00:00:00Z") });
    assert.match(h.Authorization, /Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7$/);
    assert.match(h.Authorization, /SignedHeaders=host;x-amz-content-sha256;x-amz-date/);
});

test("backups round-trip, encrypted or not, and a wrong key fails", () => {
    const data = Buffer.from("SQLite format 3 ".repeat(500));
    const plain = packBackup(data, null);
    assert.equal(plain.encrypted, false);
    assert.deepEqual(unpackBackup(plain.data, null), data);
    const sealed = packBackup(data, "secret-one");
    assert.equal(sealed.encrypted, true);
    assert.ok(!sealed.data.includes("SQLite"), "nothing readable in the upload");
    assert.deepEqual(unpackBackup(sealed.data, "secret-one"), data);
    assert.throws(() => unpackBackup(sealed.data, "secret-two"));
    assert.throws(() => unpackBackup(sealed.data, null), /no KEY_ENCRYPTION_SECRET/);
});

function fakeStorage() {
    const objects = new Map(), seen = [];
    const server = http.createServer((req, res) => {
        const chunks = []; req.on("data", c => chunks.push(c)); req.on("end", () => {
            const url = new URL(req.url, "http://x"); seen.push([req.method, url.pathname, Boolean(req.headers.authorization)]);
            const key = decodeURIComponent(url.pathname.replace(/^\/bucket\//, ""));
            if (req.method === "PUT") { objects.set(key, Buffer.concat(chunks)); return res.end(); }
            if (req.method === "DELETE") { objects.delete(key); return res.writeHead(204).end(); }
            if (url.pathname === "/bucket/" && url.searchParams.get("list-type") === "2") {
                const items = [...objects].filter(([k]) => k.startsWith(url.searchParams.get("prefix") ?? "")).map(([k, v]) => `<Contents><Key>${k}</Key><Size>${v.length}</Size><LastModified>2026-11-08T10:00:00.000Z</LastModified></Contents>`).join("");
                return res.end(`<?xml version="1.0"?><ListBucketResult>${items}</ListBucketResult>`);
            }
            if (objects.has(key)) return res.end(objects.get(key));
            res.writeHead(404).end();
        });
    });
    return new Promise(r => server.listen(0, "127.0.0.1", () => r({ objects, seen, endpoint: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(x => server.close(x)) })));
}

test("upload, prune and verify against a storage server", async () => {
    const st = await fakeStorage();
    const dir = mkdtempSync(join(tmpdir(), "svc-off-"));
    const db = openDb(join(dir, "live.db"));
    db.ensureUser("u1", "g"); db.ensureUser("u2", "g");
    const files = ["2026-11-06", "2026-11-07", "2026-11-08"].map(d => { const f = join(dir, `steamvaluechecker-${d}.db`); db.backupTo(f); return f; });
    const off = createOffsite({ endpoint: st.endpoint, bucket: "bucket", accessKey: "k", secretKey: "s", secret: "pw", keep: 2, db });
    try {
        for (const f of files) assert.ok((await off.upload(f)).uploaded);
        assert.equal((await off.upload(files[2])).skipped, "already uploaded");
        const keys = [...st.objects.keys()];
        assert.equal(keys.length, 2, "oldest was pruned");
        assert.ok(keys.every(k => k.endsWith(".db.gz.enc")));
        assert.ok(st.seen.every(s => s[2]), "every request was signed");
        const v = await off.verify();
        assert.equal(v.ok, true); assert.equal(v.users, 2);
        assert.match(v.key, /2026-11-08/);
        assert.equal(JSON.parse(db.getMeta("offsite:last")).encrypted, true);
        assert.equal((await off.list()).length, 2);
    } finally { await st.close(); }
});

test("without settings nothing happens, and the environment names Fly's storage uses are understood", async () => {
    const off = createOffsite({});
    assert.equal(off.enabled, false);
    assert.deepEqual(await off.list(), []);
    await assert.rejects(off.verify(), /aren't set up/);
    const c = offsiteConfig({ AWS_ENDPOINT_URL_S3: "https://fly.storage.tigris.dev", BUCKET_NAME: "b", AWS_ACCESS_KEY_ID: "a", AWS_SECRET_ACCESS_KEY: "z" });
    assert.deepEqual([c.endpoint, c.bucket, c.accessKey, c.secretKey, c.region], ["https://fly.storage.tigris.dev", "b", "a", "z", "auto"]);
});
