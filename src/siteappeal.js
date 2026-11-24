// Appeals against a Steam Value Checker restriction (the owner cutting someone off from the bot and dashboard).
// A restricted person can't sign in, so the public appeal page works without an account. The appeal lands in the owner's Admin panel,
// where accepting it lifts the restriction. Stored in the same table as server ban appeals, under the guild id "site".
import { HttpError } from "./dashboard/http.js";

const SITE = "site";
const clean = s => String(s ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim();

export function createSiteAppeals({ db, config, dm = null, now = Date.now, log = () => {} }) {
    /** A restricted person asks to come back. They have to be restricted, and only one appeal can be waiting at a time. */
    function submit({ userId, text, contact = "", verified = false }) {
        const id = String(userId ?? "").replace(/\D/g, "");
        if (!/^\d{15,25}$/.test(id)) throw new HttpError(400, "That doesn't look like a Discord user ID. It's a long number; the help text shows how to find it.");
        const why = clean(text);
        if (why.length < 10) throw new HttpError(400, "Tell us in a sentence or two why the restriction should be lifted.");
        const ban = db.getBan(id);
        if (!ban) throw new HttpError(404, "That account isn't restricted from Steam Value Checker. If you were banned from a Discord server, use the server option instead.");
        if (db.openAppeal(SITE, id)) throw new HttpError(409, "You already have an appeal waiting. It will be answered here and by direct message if possible.");
        const a = db.addAppeal(SITE, id, why.slice(0, 1000), now(), { contact: clean(contact).slice(0, 120), verified: verified ? 1 : 0 });
        db.bumpUsage("site_appeal");
        if (config.ownerId) { try { db.addNotification(config.ownerId, { type: "appeal", title: "New restriction appeal", body: `${id}: ${why.slice(0, 140)}` }); } catch { /* the Admin panel still lists it */ } }
        return { appeal: { id: a.id, status: a.status } };
    }
    const list = (status = "open") => db.listAppeals(SITE, status).map(a => ({ ...a, restricted: Boolean(db.isBanned(a.user_id)), reason: db.getBan(a.user_id)?.reason ?? "" }));
    /** The owner answers. Accepting lifts the restriction. The person gets a direct message if the bot can send one. */
    async function decide({ id, accept, note = "", actorId }) {
        const a = db.getAppeal(SITE, Math.trunc(Number(id)));
        if (!a) throw new HttpError(404, "That appeal could not be found.");
        if (a.status !== "open") throw new HttpError(409, "That appeal was already answered.");
        if (accept) { db.unbanUser(a.user_id); log(`Bot owner accepted restriction appeal #${a.id}; lifted ${a.user_id}`); }
        db.decideAppeal(SITE, a.id, accept ? "accepted" : "denied", actorId, now());
        let told = false;
        if (dm) { try { await dm(a.user_id, { embeds: [{ color: accept ? 0x57f287 : 0xed4245, title: accept ? "Your appeal was accepted" : "Your appeal was denied", description: accept ? "Your access to Steam Value Checker is back." + (clean(note) ? `\n\n${clean(note).slice(0, 500)}` : "") : "Your restriction on Steam Value Checker stays." + (clean(note) ? `\n\n${clean(note).slice(0, 500)}` : "") }] }); told = true; } catch { /* DMs closed */ } }
        return { appeal: { ...a, status: accept ? "accepted" : "denied" }, told };
    }
    return { submit, list, decide };
}
