// Encrypts giveaway prize keys at rest (AES-256-GCM). The secret comes from KEY_ENCRYPTION_SECRET and is never stored
// in the database, so a copy of the database or a backup alone does not reveal any key.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

export const MIN_SECRET_LENGTH = 16;

export function createVault(secret) {
    if (typeof secret !== "string" || secret.length < MIN_SECRET_LENGTH) {
        throw new Error(`KEY_ENCRYPTION_SECRET must be at least ${MIN_SECRET_LENGTH} characters.`);
    }
    const key = Buffer.from(hkdfSync("sha256", secret, "steam-value-checker", "giveaway-keys-v1", 32));
    return {
        encrypt(plain) {
            const iv = randomBytes(12);
            const c = createCipheriv("aes-256-gcm", key, iv);
            const body = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
            return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), body.toString("base64")].join(":");
        },
        /** Returns the plain text, or null if the value was not encrypted with this secret. */
        decrypt(blob) {
            try {
                const [v, iv, tag, body] = String(blob).split(":");
                if (v !== "v1") return null;
                const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
                d.setAuthTag(Buffer.from(tag, "base64"));
                return Buffer.concat([d.update(Buffer.from(body, "base64")), d.final()]).toString("utf8");
            } catch { return null; }
        }
    };
}
