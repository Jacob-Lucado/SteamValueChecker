// /steam: link a public Steam profile so the library and hours played fill in by themselves, and get a pick for what to play next.
import { MessageFlags } from "discord.js";
import { libraryView } from "./library.js";
import { resolveProfile, syncSteamLibrary, playStats, steamNext, fmtHours } from "./steamlib.js";
import { SteamError } from "./steam.js";
import { UserError } from "./errors.js";
import { ItadError } from "./itad.js";
import { LibraryError } from "./library.js";
import { money } from "./render.js";

const COOLDOWN_MS = 60_000;
const last = new Map();
const wait = userId => { const w = COOLDOWN_MS - (Date.now() - (last.get(userId) ?? 0)); if (w > 0) throw new UserError(`Slow down a little. Try again in ${Math.ceil(w / 1000)}s.`); last.set(userId, Date.now()); };

const line = (r, f) => `• **${r.title}** ${f(r)}`;
const art = appid => `https://cdn.akamai.steamstatic.com/steam/apps/${encodeURIComponent(appid)}/header.jpg`;

export function steamEmbed({ stats, link, currency }) {
    const fields = [];
    fields.push({ name: "Your library", value: [
        stats.value ? `Worth **${money(stats.value.msrp, currency)}** at full price, **${money(stats.value.cheapest, currency)}** at today's cheapest prices` : null,
        `**${stats.games}** games, **${stats.playedGames}** played, **${fmtHours(stats.totalMinutes)}** on record`
    ].filter(Boolean).join("\n") });
    if (stats.mostPlayed.length) fields.push({ name: "Most played", value: stats.mostPlayed.map(r => line(r, x => fmtHours(x.minutes))).join("\n") });
    if (stats.unplayedCount) fields.push({ name: "Barely or never played", value: `**${stats.unplayedCount}** games, worth **${money(stats.unplayedMsrp, currency)}** at full price` + (stats.unplayedTop.length ? "\n" + stats.unplayedTop.slice(0, 3).map(r => line(r, x => (x.msrp ? money(x.msrp, currency) : "no price"))).join("\n") : "") });
    return {
        color: 0x66c0f4, title: "Your Steam library",
        fields,
        footer: { text: `Synced ${link?.synced_at ? new Date(link.synced_at).toISOString().slice(0, 10) : "never"}  •  Run /steam sync to refresh, /steam next for something to play.` }
    };
}

export function nextEmbed(n, currency) {
    return {
        color: 0x66c0f4, title: `🎯 Play ${n.pick.title}`, description: n.why,
        image: n.pick.appid ? { url: art(n.pick.appid) } : undefined,
        fields: n.others.length ? [{ name: "Also good", value: n.others.map(r => line(r, x => (x.minutes ? fmtHours(x.minutes) : "unplayed"))).join("\n") }] : [],
        footer: { text: n.remaining ? `${n.remaining} more to choose from. Run /steam next again for another.` : "That is everything left that you have not finished." }
    };
}

export function createSteamHandlers({ db, itad, apiKey = null, fetchImpl = globalThis.fetch }) {
    const eph = (i, content) => i.reply({ content, flags: MessageFlags.Ephemeral });
    async function failed(i, err) {
        const known = err instanceof UserError || err instanceof SteamError || err instanceof ItadError || err instanceof LibraryError;
        if (!known) console.error(`[steam] ${err.name}: ${err.message}`);
        const content = known ? err.message : "Something went wrong. Try again in a moment.";
        if (i.deferred || i.replied) await i.editReply({ content, embeds: [] }).catch(() => {});
        else await eph(i, content).catch(() => {});
    }

    const summary = r => [
        `Linked. Found **${r.owned}** games (**${fmtHours(r.minutes)}** played).`,
        r.value && r.value.games ? `Library value: **${money(r.value.msrp, r.value.currency)}** at full price, **${money(r.value.cheapest, r.value.currency)}** at today's cheapest prices.` : null,
        `Added **${r.added}**, updated **${r.updated}**.` + (r.unmatched ? ` ${r.unmatched} could not be matched to a price and were skipped.` : ""),
        r.skippedForLimit ? `Your library is full, so ${r.skippedForLimit} were skipped.` : null,
        r.truncated ? "Only your most played games fit in the library limit." : null,
        "What you paid is never read from Steam. Add it with `/library add` to see savings. Run `/steam view` for the breakdown or `/steam next` for something to play."
    ].filter(Boolean).join("\n");

    async function handle(i) {
        const sub = i.options.getSubcommand();
        db.ensureUser(i.user.id, i.guildId);
        try {
            if (sub === "unlink") {
                const had = db.removeSteamLink(i.user.id);
                if (!had) return eph(i, "No Steam profile is linked.");
                let removed = 0;
                if (i.options.getBoolean("remove_games")) {
                    for (const g of db.listLibrary(i.user.id).filter(g => g.appid)) if (db.removeLibrary(i.user.id, g.itad_id)) removed++;
                }
                return eph(i, removed ? `Unlinked, and removed ${removed} games that came from Steam.` : "Unlinked. Your library stays as it is. Add `remove_games: true` next time to remove the games that came from Steam.");
            }
            const link = db.getSteamLink(i.user.id);
            if (sub === "next") {
                if (!link) throw new UserError("Link your profile first with `/steam link`.");
                await i.deferReply({ flags: MessageFlags.Ephemeral });
                const view = await libraryView(db, itad, db.getUser(i.user.id), { snapshot: false });
                const n = steamNext(view.rows);
                if (!n) throw new UserError("Nothing left to suggest. Everything from Steam is finished or dropped, or not synced yet (`/steam sync`).");
                return void await i.editReply({ embeds: [nextEmbed(n, view.currency)] });
            }
            if (sub === "view") {
                if (!link) throw new UserError("Link your profile first with `/steam link`.");
                await i.deferReply({ flags: MessageFlags.Ephemeral });
                const user = db.getUser(i.user.id);
                const view = await libraryView(db, itad, user, { snapshot: false });
                const rows = view.rows.filter(r => r.appid);
                if (!rows.length) throw new UserError("No Steam games in your library yet. Run `/steam sync`.");
                return void await i.editReply({ embeds: [steamEmbed({ stats: playStats(rows), link, currency: view.currency })] });
            }
            wait(i.user.id);
            await i.deferReply({ flags: MessageFlags.Ephemeral });
            const steamid = sub === "link" ? await resolveProfile(i.options.getString("profile", true), fetchImpl) : link?.steamid;
            if (!steamid) throw new UserError("Link your profile first with `/steam link`.");
            const r = await syncSteamLibrary({ db, itad, userId: i.user.id, steamid, apiKey, fetchImpl });
            return void await i.editReply(summary(r));
        } catch (err) {
            await failed(i, err);
        }
    }
    return { handle };
}
