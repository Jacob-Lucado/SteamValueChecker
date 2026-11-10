// Invite links. Each person gets a link of their own; when someone new signs in through it, the person who shared it earns a few days of
// supporter. It's capped, new accounts must be a week old on Discord, and each newcomer can only ever count once.
import { randomBytes } from "node:crypto";

export const DAYS_EACH = 3, MAX_REFERRALS = 10, MIN_ACCOUNT_AGE_DAYS = 7;
const DISCORD_EPOCH = 1420070400000n;
const CODE = /^[a-z0-9]{8}$/;

/** When a Discord account was made, read straight from its ID. */
export const accountCreatedAt = id => { try { return Number((BigInt(id) >> 22n) + DISCORD_EPOCH); } catch { return null; } };

export function createReferrals({ db, supporters = null, dm = null, publicUrl = null, now = () => Date.now(), log = () => {} }) {
    const base = () => (publicUrl ? String(publicUrl).replace(/\/+$/, "") : "");

    /** The person's own code, made the first time it's asked for. */
    function codeFor(userId) {
        let code = db.getMeta(`ref:code:${userId}`);
        if (!code) {
            do { code = randomBytes(6).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "").padEnd(8, "x").slice(0, 8); } while (db.getMeta(`ref:owner:${code}`));
            db.setMeta(`ref:code:${userId}`, code); db.setMeta(`ref:owner:${code}`, String(userId));
        }
        return code;
    }
    const ownerOf = code => (CODE.test(String(code ?? "")) ? db.getMeta(`ref:owner:${code}`) || null : null);
    const joined = userId => { try { return JSON.parse(db.getMeta(`ref:joined:${userId}`) || "[]"); } catch { return []; } };

    function stats(userId) {
        const list = joined(userId);
        return { link: `${base()}/r/${codeFor(userId)}`, joined: list.length, counted: Math.min(list.length, MAX_REFERRALS), max: MAX_REFERRALS, daysEach: DAYS_EACH, daysEarned: Math.min(list.length, MAX_REFERRALS) * DAYS_EACH, full: list.length >= MAX_REFERRALS };
    }

    /** Called when someone signs in for the very first time with a code in hand. Returns why it didn't count, or { counted: true }. */
    async function onSignup({ userId, code, wasNew }) {
        if (!wasNew) return { skipped: "not new" };
        const owner = ownerOf(code);
        if (!owner) return { skipped: "no such code" };
        if (String(owner) === String(userId)) return { skipped: "self" };
        if (db.getMeta(`ref:by:${userId}`)) return { skipped: "already counted" };
        const made = accountCreatedAt(userId);
        if (made && now() - made < MIN_ACCOUNT_AGE_DAYS * 86400_000) return { skipped: "account too new" };
        db.setMeta(`ref:by:${userId}`, String(owner)); // marked first, so a failure below can never count twice
        const list = joined(owner);
        if (list.length >= MAX_REFERRALS) { db.setMeta(`ref:joined:${owner}`, JSON.stringify([...list, userId])); return { skipped: "limit", owner }; }
        db.setMeta(`ref:joined:${owner}`, JSON.stringify([...list, userId]));
        let until = null;
        try { until = (await supporters?.grant(owner, DAYS_EACH, `ref:${userId}`, "Referral", 0, { silent: true }))?.until ?? null; } catch (e) { log(`referral grant failed: ${e.message}`); }
        try {
            const who = db.getUser?.(userId);
            await dm?.(owner, { embeds: [{ color: 0x57f287, title: "🎉 A friend joined through your link",
                description: `Someone new just signed in with your invite link, so **${DAYS_EACH} days of supporter** were added to your pass.`,
                fields: [{ name: "Friends so far", value: `${list.length + 1} of ${MAX_REFERRALS}`, inline: true }, ...(until ? [{ name: "Supporter until", value: `<t:${Math.floor(until / 1000)}:D>`, inline: true }] : [])],
                footer: { text: "Keep sharing your link on the Support page" } }] });
        } catch { /* DMs may be closed */ }
        return { counted: true, owner, until };
    }
    return { codeFor, ownerOf, onSignup, stats };
}
