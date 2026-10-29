// /steam: link a public Steam profile so the library and hours played fill in by themselves, and get a pick for what to play next.
import { MessageFlags } from "discord.js";
import { libraryView } from "./library.js";
import { viewRows } from "./wishlist.js";
import { refreshTags, tasteProfile, recommend, tasteWhy } from "./taste.js";
import { goalProgress } from "./steamstore.js";
import { resolveProfile, syncSteamLibrary, playStats, steamNext, steamValue, fmtHours } from "./steamlib.js";
import { SteamError } from "./steam.js";
import { UserError } from "./errors.js";
import { ItadError } from "./itad.js";
import { LibraryError } from "./library.js";
import { money } from "./render.js";
import { AttachmentBuilder } from "discord.js";
import { renderSteamValue } from "./cardimg.js";

const COOLDOWN_MS = 60_000;
const last = new Map();
const wait = userId => { const w = COOLDOWN_MS - (Date.now() - (last.get(userId) ?? 0)); if (w > 0) throw new UserError(`Slow down a little. Try again in ${Math.ceil(w / 1000)}s.`); last.set(userId, Date.now()); };

const achievementsLine = v => `**${v.achDone.toLocaleString("en-US")}** of **${v.achTotal.toLocaleString("en-US")}** unlocked (${Math.round(v.achDone / v.achTotal * 100)}%) across ${v.achGames} games`;
const line = (r, f) => `• **${r.title}** ${f(r)}`;
const art = appid => `https://cdn.akamai.steamstatic.com/steam/apps/${encodeURIComponent(appid)}/header.jpg`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function recapEmbed(r) {
    if (!r.totalMinutes) return { color: 0x66c0f4, title: `Hours tracked in ${r.year}`, description: (r.allTime?.totalMinutes ? `Nothing tracked this year yet, but **${fmtHours(r.allTime.totalMinutes)}** since you linked. ` : "Nothing tracked yet. ") + "Steam only shares lifetime hours per game, so this counts what you play after you link, as your library syncs (automatically every few hours)." };
    const peak = Math.max(...r.months), bars = " ▁▂▃▄▅▆▇█";
    const spark = r.months.map(m => bars[Math.round(m / peak * 8)]).join("");
    return {
        color: 0x66c0f4, title: `Hours tracked in ${r.year}`,
        description: `**${fmtHours(r.totalMinutes)}** across **${r.games}** game${r.games === 1 ? "" : "s"} on **${r.activeDays}** different day${r.activeDays === 1 ? "" : "s"}. Busiest month: **${MONTHS[r.busiestMonth]}**.\n\`${spark}\` Jan to Dec`,
        fields: [{ name: "Top games", value: r.top.map((g, n) => `${n + 1}. **${g.title}** ${fmtHours(g.minutes)}`).join("\n") },
            ...(r.allTime ? [{ name: "Since you linked", value: `**${fmtHours(r.allTime.totalMinutes)}** across **${r.allTime.games}** game${r.allTime.games === 1 ? "" : "s"}` }] : [])],
        footer: { text: "Steam only shares lifetime hours, so this counts what was added between syncs since you linked. It can't see earlier play." }
    };
}

export function goalEmbed(p) {
    const filled = Math.round(p.pct / 10), bar = "▰".repeat(filled) + "▱".repeat(10 - filled);
    const lines = [`\`${bar}\` **${p.done}** of **${p.goal}** hours (${p.pct}%)`];
    if (p.reached) lines.push("🎉 Goal reached. Nice.");
    else {
        lines.push(`At this pace you will finish the year around **${p.projected}** hours${p.projected >= p.goal ? ", so you are on track." : "."}`);
        if (p.daysLeft) lines.push(`To hit it, about **${p.perWeek}** hours a week for the ${p.daysLeft} days left.`);
    }
    return { color: 0x66c0f4, title: "Your hours goal for this year", description: lines.join("\n"), footer: { text: "Counts hours tracked since you linked Steam." } };
}

export function tasteEmbed(profile, picks, currency) {
    if (!profile.games) return { color: 0x66c0f4, title: "Your taste in games", description: "Link Steam and sync first, so I can see what you play." };
    if (!profile.genres.length) return { color: 0x66c0f4, title: "Your taste in games", description: `I am still looking up genres (${profile.tagged} of ${profile.games} games so far). Try again in a little while.` };
    const bar = pct => "▰".repeat(Math.max(1, Math.round(pct / 10))) + "▱".repeat(10 - Math.max(1, Math.round(pct / 10)));
    return {
        color: 0x66c0f4, title: "Your taste in games",
        description: profile.genres.slice(0, 6).map(g => `\`${bar(g.pct)}\` **${g.name}** ${g.pct}%`).join("\n") + (profile.tagged < profile.games ? `\n*Based on ${profile.tagged} of ${profile.games} games so far.*` : ""),
        fields: picks.length ? [{ name: "Wishlist picks that fit", value: picks.map(p => `• **${p.title}**${p.price != null ? " " + money(p.price, currency) : ""}: ${tasteWhy(p)}`).join("\n") }] : [],
        footer: { text: "Weighted by hours played. Genres come from Steam's public store pages." }
    };
}

export function steamEmbed({ stats, link, currency }) {
    const fields = [];
    fields.push({ name: "Your library", value: [
        stats.value ? `Worth **${money(stats.value.msrp, currency)}** at full price, **${money(stats.value.cheapest, currency)}** at today's cheapest prices` : null,
        `**${stats.games}** games, **${stats.playedGames}** played, **${fmtHours(stats.totalMinutes)}** on record`
    ].filter(Boolean).join("\n") });
    if (stats.value?.achTotal) fields.splice(1, 0, { name: "Achievements", value: achievementsLine(stats.value) });
    if (stats.mostPlayed.length) fields.push({ name: "Most played", value: stats.mostPlayed.map(r => line(r, x => fmtHours(x.minutes))).join("\n") });
    if (stats.unplayedCount) fields.push({ name: "Barely or never played", value: `**${stats.unplayedCount}** games, worth **${money(stats.unplayedMsrp, currency)}** at full price` + (stats.unplayedTop.length ? "\n" + stats.unplayedTop.slice(0, 3).map(r => line(r, x => (x.msrp ? money(x.msrp, currency) : "no price"))).join("\n") : "") });
    return {
        color: 0x66c0f4, title: "Your Steam library",
        fields,
        footer: { text: `Synced ${link?.synced_at ? new Date(link.synced_at).toISOString().slice(0, 10) : "never"}  •  Run /steam sync to refresh, /steam next for something to play.` }
    };
}

/** The "estimated account value" card. These are estimates from current prices, not what was paid. */
export function valueEmbed({ value, owned, currency, link }) {
    const rows = [
        `**${money(value.msrp, currency)}** at full price (list price today)`,
        `**${money(value.cheapest, currency)}** at today's cheapest prices`,
        value.atl ? `**${money(value.atl, currency)}** at their all-time-low prices` : null
    ].filter(Boolean).join("\n");
    const fields = [{ name: "Estimated account value", value: rows }];
    if (value.achTotal) fields.push({ name: "Achievements", value: achievementsLine(value) });
    if (value.top.length) fields.push({ name: "Most valuable games", value: value.top.map(r => line(r, x => money(x.msrp, currency))).join("\n") });
    const gap = Math.max(0, (owned ?? value.games) - value.priced);
    return {
        color: 0x66c0f4, title: "💰 Estimated Steam account value", fields,
        footer: { text: `${value.priced} of ${owned ?? value.games} games priced${gap ? ` (${gap} free, removed or not found are not counted)` : ""}  •  An estimate from current prices, not what was paid.  •  Synced ${link?.synced_at ? new Date(link.synced_at).toISOString().slice(0, 10) : "never"}` }
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
        r.achievements?.checked ? `Checked achievements for **${r.achievements.checked}** games${r.achievements.newlyFinished ? `; **${r.achievements.newlyFinished}** at 100% were marked Finished` : ""}.${r.achievements.remaining ? " Run `/steam sync` again for the rest." : ""}` : null,
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
            if (sub === "taste") {
                if (!link) throw new UserError("Link your profile first with `/steam link`.");
                await i.deferReply({ flags: MessageFlags.Ephemeral });
                const user = db.getUser(i.user.id);
                const need = db.appsNeedingTags(i.user.id, 10);
                if (need.length) await refreshTags({ db, appids: need, fetchImpl, delayMs: 300 });
                const profile = tasteProfile(db, i.user.id);
                let picks = [], currency = "USD";
                try { const w = await viewRows(db, itad, user); currency = w.currency ?? "USD"; picks = recommend(db, i.user.id, w.rows, profile); } catch { /* the profile is still useful */ }
                return void await i.editReply({ embeds: [tasteEmbed(profile, picks, currency)] });
            }
            if (sub === "recap") {
                if (!link) throw new UserError("Link your profile first with `/steam link`.");
                const year = new Date().getUTCFullYear();
                const shared = i.options.getBoolean("public") === true;
                const all = db.playRecapAll(i.user.id);
                return void await i.reply({ embeds: [recapEmbed({ ...db.playRecap(i.user.id, year), allTime: all })], ...(shared ? {} : { flags: MessageFlags.Ephemeral }) });
            }
            if (sub === "goal") {
                if (!link) throw new UserError("Link your profile first with `/steam link`.");
                const set = i.options.getInteger("hours");
                if (set !== null) db.setHourGoal(i.user.id, set);
                const goal = db.getHourGoal(i.user.id);
                if (!goal) return void await i.reply({ content: set === 0 ? "Hours goal cleared." : "No hours goal yet. Set one with `/steam goal hours:300`.", flags: MessageFlags.Ephemeral });
                return void await i.reply({ embeds: [goalEmbed(goalProgress(goal, db.playRecap(i.user.id, new Date().getUTCFullYear()).totalMinutes))], flags: MessageFlags.Ephemeral });
            }
            if (sub === "value") {
                if (!link) throw new UserError("Link your profile first with `/steam link`.");
                const shared = i.options.getBoolean("public") === true;
                await i.deferReply(shared ? {} : { flags: MessageFlags.Ephemeral });
                const view = await libraryView(db, itad, db.getUser(i.user.id), { snapshot: false });
                const rows = view.rows.filter(r => r.appid);
                if (!rows.length) throw new UserError("No Steam games in your library yet. Run `/steam sync`.");
                const value = steamValue(rows, view.currency);
                // The same picture as the website's Steam page. If it cannot be drawn, the text version still goes out.
                let png = null;
                try { png = await renderSteamValue({ db, itad, userId: i.user.id, fetchImpl }); } catch (err) { console.error(`[steam value] ${err.name}: ${err.message}`); }
                if (png) {
                    const alt = `Estimated Steam account value: ${money(value.msrp, view.currency)} at full price, ${money(value.cheapest, view.currency)} at today's cheapest prices.`;
                    return void await i.editReply({ content: alt, embeds: [], files: [new AttachmentBuilder(Buffer.from(png), { name: "steam-account-value.png", description: alt })] });
                }
                return void await i.editReply({ embeds: [valueEmbed({ value, owned: link.games, currency: view.currency, link })] });
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
