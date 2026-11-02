// A username and password for the owner, as a second way into the admin panel besides Discord.
// Passwords are kept only as a salted scrypt hash. Wrong guesses slow down and then lock the account for a while,
// and an optional authenticator code (TOTP) can be required on top.
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const adminLoginSchema = `
CREATE TABLE IF NOT EXISTS admin_login (
    owner_id     TEXT PRIMARY KEY,
    username     TEXT NOT NULL UNIQUE,
    salt         TEXT NOT NULL,
    hash         TEXT NOT NULL,
    created      INTEGER NOT NULL,
    updated      INTEGER NOT NULL,
    last_login   INTEGER,
    fails        INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER NOT NULL DEFAULT 0,
    totp_secret  TEXT,
    totp_on      INTEGER NOT NULL DEFAULT 0,
    totp_step    INTEGER NOT NULL DEFAULT 0
);
`;

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const norm = pw => String(pw).normalize("NFKC");

export function hashPassword(password, salt = randomBytes(16)) {
    const buf = Buffer.isBuffer(salt) ? salt : Buffer.from(salt, "hex");
    return { salt: buf.toString("hex"), hash: scryptSync(norm(password), buf, 64, SCRYPT).toString("hex") };
}
export function checkPassword(password, salt, hash) {
    const got = scryptSync(norm(password), Buffer.from(salt, "hex"), 64, SCRYPT);
    const want = Buffer.from(hash, "hex");
    return got.length === want.length && timingSafeEqual(got, want);
}
/** Burns the same time as a real check, so an unknown username is not faster to refuse than a wrong password. */
const DUMMY = hashPassword("not-a-real-password");
export const burnTime = () => { checkPassword("x", DUMMY.salt, DUMMY.hash); };

export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
/** Returns a problem to show the person, or null when the pair is fine. */
export function passwordProblem(password, username = "") {
    const p = String(password ?? "");
    if (p.length < 12) return "Use at least 12 characters. A few random words in a row works well.";
    if (p.length > 128) return "That is too long (128 characters at most).";
    if (username && p.toLowerCase().includes(String(username).toLowerCase())) return "The password should not contain the username.";
    if (/^(.)\1+$/.test(p) || /^(?:0123456789|1234567890|abcdefghijkl|qwertyuiop|password|letmein)/i.test(p)) return "That one is too easy to guess.";
    return null;
}

// ---- authenticator codes (RFC 6238: 6 digits, 30 seconds, SHA-1, the same as every authenticator app) ----
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const base32 = buf => { let bits = 0, val = 0, out = ""; for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } } if (bits) out += B32[(val << (5 - bits)) & 31]; return out; };
export const unbase32 = str => { let bits = 0, val = 0; const out = []; for (const c of String(str).toUpperCase().replace(/[^A-Z2-7]/g, "")) { val = (val << 5) | B32.indexOf(c); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); };
export const newTotpSecret = () => base32(randomBytes(20));
export function totpCode(secret, step) {
    const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
    const h = createHmac("sha1", unbase32(secret)).update(msg).digest();
    const o = h[h.length - 1] & 15;
    return String(((h[o] & 127) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1_000_000).padStart(6, "0");
}
/** The step number the code belongs to (this one or a neighbour, for clock drift), or null. A step can be used only once. */
export function matchTotp(secret, code, nowMs, lastStep = 0) {
    const c = String(code ?? "").replace(/\s/g, "");
    if (!/^\d{6}$/.test(c)) return null;
    const step = Math.floor(nowMs / 30_000);
    for (const s of [step, step - 1, step + 1]) if (s > lastStep && totpCode(secret, s) === c) return s;
    return null;
}
export const totpUri = (secret, account) => `otpauth://totp/${encodeURIComponent("Steam Value Checker")}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent("Steam Value Checker")}`;

export function adminLoginStore({ run, get, now }) {
    const getLogin = ownerId => get("SELECT * FROM admin_login WHERE owner_id = ?", String(ownerId)) ?? null;
    const getLoginByName = username => get("SELECT * FROM admin_login WHERE username = ?", String(username)) ?? null;
    function saveLogin(ownerId, username, password) {
        const { salt, hash } = hashPassword(password), t = now();
        const prev = getLogin(ownerId);
        if (prev) run("UPDATE admin_login SET username = ?, salt = ?, hash = ?, updated = ?, fails = 0, locked_until = 0 WHERE owner_id = ?", username, salt, hash, t, String(ownerId));
        else run("INSERT INTO admin_login (owner_id, username, salt, hash, created, updated) VALUES (?,?,?,?,?,?)", String(ownerId), username, salt, hash, t, t);
    }
    const removeLogin = ownerId => run("DELETE FROM admin_login WHERE owner_id = ?", String(ownerId));
    /** Five wrong tries in a row lock the account for 15 minutes, doubling each further five, up to a day. */
    function failLogin(ownerId, t = now()) {
        const r = getLogin(ownerId); if (!r) return 0;
        const fails = r.fails + 1;
        const lock = fails % 5 === 0 ? Math.min(24 * 3600_000, 15 * 60_000 * 2 ** (fails / 5 - 1)) : 0;
        run("UPDATE admin_login SET fails = ?, locked_until = ? WHERE owner_id = ?", fails, lock ? t + lock : r.locked_until, String(ownerId));
        return lock;
    }
    const okLogin = (ownerId, step = 0, t = now()) => run("UPDATE admin_login SET fails = 0, locked_until = 0, last_login = ?, totp_step = MAX(totp_step, ?) WHERE owner_id = ?", t, step, String(ownerId));
    const setTotp = (ownerId, secret, on) => run("UPDATE admin_login SET totp_secret = ?, totp_on = ?, totp_step = 0 WHERE owner_id = ?", secret, on ? 1 : 0, String(ownerId));
    const useTotpStep = (ownerId, step) => run("UPDATE admin_login SET totp_step = ? WHERE owner_id = ?", step, String(ownerId));
    return { getAdminLogin: getLogin, getAdminLoginByName: getLoginByName, saveAdminLogin: saveLogin, removeAdminLogin: removeLogin, failAdminLogin: failLogin, okAdminLogin: okLogin, setAdminTotp: setTotp, useAdminTotpStep: useTotpStep };
}
