// /calendar: what is coming up, server events for managers, and an optional private link for other calendar apps.
import { MessageFlags, PermissionFlagsBits } from "discord.js";
import { calendarEntries, KINDS } from "./calendar.js";
import { parseWhen } from "./lfg.js";
import { validTimezone } from "./timeutil.js";
import { UserError } from "./errors.js";

const ICON = { release: "🎮", sale: "🏷️", event: "📅", lfg: "👥" };

export function createCalendarHandlers({ db, calendar, publicUrl }) {
    const base = publicUrl ? publicUrl.replace(/\/$/, "") : null;
    const eph = (i, content) => i.reply({ content, flags: MessageFlags.Ephemeral });
    const canManage = i => Boolean(i.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
    async function failed(i, err) {
        if (!(err instanceof UserError)) console.error(`[calendar] ${err.name}: ${err.message}`);
        const content = err instanceof UserError ? err.message : "Something went wrong. Try again in a moment.";
        if (i.deferred || i.replied) await i.editReply({ content }).catch(() => {}); else await eph(i, content).catch(() => {});
    }

    async function handle(i) {
        const sub = i.options.getSubcommand();
        const user = db.ensureUser(i.user.id, i.guildId);
        const guildIds = i.guildId ? [i.guildId] : (user.guild_id ? [user.guild_id] : []);
        try {
            if (sub === "view") {
                const days = i.options.getInteger("days") ?? 14;
                const now = Date.now();
                const list = calendarEntries(db, i.user.id, { from: now - 3600_000, to: now + days * 86400_000, guildIds, kinds: KINDS });
                const lines = list.slice(0, 20).map(e => {
                    const ts = Math.floor(e.start / 1000);
                    const when = e.allDay ? `<t:${ts}:D>${e.end ? ` to <t:${Math.floor(e.end / 1000)}:D>` : ""}` : `<t:${ts}:f> (<t:${ts}:R>)`;
                    return `${ICON[e.kind]} **${e.title}**${e.kind === "event" ? ` \`#${e.id}\`` : ""}\n${when}${e.notes ? ` · ${e.notes.slice(0, 80)}` : ""}`;
                });
                return void await i.reply({ flags: MessageFlags.Ephemeral, embeds: [{ color: 0x5865f2, title: `Coming up in the next ${days} days`,
                    description: lines.join("\n\n") || "Nothing on the calendar. Wishlist games with a release date, Steam sales and server events show up here.",
                    footer: { text: `${list.length > 20 ? `${list.length - 20} more. ` : ""}${base ? "The dashboard Calendar page has the full month view." : ""}` } }] });
            }
            if (sub === "add") {
                if (!i.guildId) return void await eph(i, "Use this in a server.");
                if (!canManage(i)) return void await eph(i, "You need the Manage Server permission to add events.");
                const tz = validTimezone(user.tz) ? user.tz : "UTC";
                const startsAt = parseWhen(i.options.getString("when", true), { tz });
                if (startsAt === null) throw new UserError("I could not read that time. Try `tomorrow 19:30`, `friday 9pm` or `2026-11-07 20:00` (in your time zone, set with `/alerts quiethours`).");
                const announce = i.options.getBoolean("announce") !== false;
                const remind = i.options.getInteger("reminder");
                const r = await calendar.create({ guildId: i.guildId, creatorId: i.user.id, title: i.options.getString("title", true), notes: i.options.getString("notes"), startsAt, channelId: announce ? i.channelId : null, remindMin: remind ?? 60 });
                return void await eph(i, `Added event \`#${r.id}\`.${announce ? (r.announced ? " Announced in this channel." : " I could not post the announcement here. Check my permissions in this channel.") : ""} Members see it with \`/calendar view\`${base ? " and on the dashboard's Calendar page" : ""}.`);
            }
            if (sub === "remove") {
                if (!i.guildId) return void await eph(i, "Use this in a server.");
                if (!canManage(i)) return void await eph(i, "You need the Manage Server permission to remove events.");
                return void await eph(i, calendar.remove(i.options.getInteger("id", true), i.guildId) ? "Removed." : "I can't find that event in this server. The number is shown in `/calendar view`.");
            }
            if (sub === "feed") {
                if (i.options.getString("action") === "off") return void await eph(i, db.revokeCalFeed(i.user.id) ? "Your calendar link is off. The old link no longer works." : "You do not have a calendar link.");
                if (!base) return void await eph(i, "The dashboard is not set up on this bot, so there is no link to make.");
                const token = db.createCalFeed(i.user.id, guildIds);
                return void await eph(i, [
                    "Your private calendar link (keep it secret; anyone with it can read your calendar):",
                    `\`${base}/calendar/feed/${token}.ics\``,
                    "Paste it into Google Calendar (Other calendars > From URL), Apple Calendar (File > New Calendar Subscription) or Outlook (Add calendar > From internet). It updates by itself.",
                    "Making a new link replaces this one. `/calendar feed action:Turn the link off` removes it."
                ].join("\n"));
            }
        } catch (err) { await failed(i, err); }
    }
    return { handle };
}
