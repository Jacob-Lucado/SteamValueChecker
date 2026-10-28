// Gift helper: keep your friends' nicknames, birthdays and public wishlist pages, see what is on sale for them, and get a reminder
// a week before a birthday. Only a nickname and the month and day are stored, never a year or a real name.
import { UserError } from "./errors.js";
import { publicWishlist, cleanSlug } from "./profile.js";
import { BIRTHDAY_RE, daysUntilBirthday } from "./friendstore.js";
import { money } from "./render.js";

export const REMIND_DAYS = 7;

export function cleanFriendName(input) {
    const name = String(input ?? "").trim().replace(/\s+/g, " ");
    if (!name || name.length > 30) throw new UserError("Use a nickname of 1 to 30 characters.");
    if (/[<>@`]/.test(name)) throw new UserError("Keep the nickname to plain text.");
    return name;
}

export function cleanBirthday(input) {
    if (input === null || input === undefined || input === "") return null;
    const v = String(input).trim();
    if (!BIRTHDAY_RE.test(v)) throw new UserError("Write the birthday as MM-DD, for example 03-27.");
    return v;
}

/** Their wishlist games that are on sale and that nobody has already said they will gift. */
export async function friendDeals(db, itad, slug, limit = 8) {
    const page = slug ? await publicWishlist(db, itad, slug) : null;
    if (!page) return null;
    return page.games.filter(g => !g.claim && g.price !== null).sort((a, b) => b.discount - a.discount || a.title.localeCompare(b.title)).slice(0, limit)
        .map(g => ({ title: g.title, price: g.price, shop: g.shop, discount: g.discount, url: g.url, currency: g.currency ?? null }));
}

export function birthdayEmbed(friend, days, deals) {
    const when = days === 0 ? "is **today**" : days === 1 ? "is **tomorrow**" : `is in **${days} days**`;
    const lines = deals?.length ? deals.slice(0, 5).map(d => `• **${d.title}** ${money(d.price, d.currency ?? "USD")}${d.discount > 0 ? ` (-${d.discount}%)` : ""} at ${d.shop}`).join("\n")
        : friend.slug ? "Nothing on their public wishlist is on sale right now." : `Add their public page with \`/friend add name:${friend.name} page:their-page-name\` and I will show what is on sale for them.`;
    return { color: 0xe91e63, title: `🎂 ${friend.name}'s birthday ${when.replace(/\*\*/g, "")}`, description: `${friend.name}'s birthday ${when}.\n\n${lines}`, footer: { text: "Mute these with /alerts mute: Friend birthday reminders" } };
}

/** Once a year per friend, from a week before. */
export async function runFriendReminders({ db, itad, notifier, now = () => Date.now(), log = () => {} }) {
    const stats = { due: 0, sent: 0, failed: 0 };
    const year = new Date(now()).getUTCFullYear();
    for (const f of db.friendsWithBirthdays()) {
        const days = daysUntilBirthday(f.birthday, now());
        if (days > REMIND_DAYS || f.reminded_in === year) continue;
        const user = db.getUser(f.discord_id);
        if (!user || user.paused) continue;
        stats.due++;
        try {
            const deals = await friendDeals(db, itad, f.slug, 5).catch(() => null);
            const res = await notifier.deliver(user, { embeds: [birthdayEmbed(f, days, deals)] }, "friend");
            if (res.ok) { db.markFriendReminded(f.id, year); stats.sent++; } else stats.failed++;
        } catch (err) { stats.failed++; log(`friend reminder failed: ${err.code ?? err.name}`); }
    }
    return stats;
}

export function friendRows(db, userId, nowMs = Date.now()) {
    return db.listFriends(userId).map(f => ({ ...f, daysToBirthday: f.birthday ? daysUntilBirthday(f.birthday, nowMs) : null }))
        .sort((a, b) => (a.daysToBirthday ?? 999) - (b.daysToBirthday ?? 999) || a.name.localeCompare(b.name));
}

export function saveFriend(db, userId, { name, birthday, page }) {
    const n = cleanFriendName(name), b = cleanBirthday(birthday), slug = page ? cleanSlug(page) : null;
    const r = db.addFriend(userId, { name: n, slug, birthday: b });
    if (r.full) throw new UserError("You can keep up to 20 friends. Remove one first.");
    return { name: n, ...r };
}
