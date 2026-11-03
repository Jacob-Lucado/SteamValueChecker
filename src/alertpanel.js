// /alerts opens this panel: every alert setting in three pages, changed with dropdowns and buttons.
// The old /alerts subcommands still work and write the same columns.
import { ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from "discord.js";
import { button, navRow, rowOf, select } from "./panel.js";
import { UserError } from "./errors.js";
import { REGIONS } from "./constants.js";
import { LANGS } from "./i18n.js";
import { prefsPatch, describeQuiet, describeDigest } from "./prefs.js";
import { WEEKDAYS } from "./timeutil.js";

const ID = "alerts";
const COLOR = 0xff9800;
const PAGES = [["types", "What you get"], ["delivery", "Where"], ["timing", "When"]];

// [key, label, hint, read(user, subs), write(db, user, on)]
const col = (c, dflt = 0) => ({ read: u => (u[c] ?? dflt) !== 0 && !!(u[c] ?? dflt), write: (db, u, on) => db.updateUser(u.discord_id, { [c]: on ? 1 : 0 }) });
export const TOGGLES = [
    { key: "bundles", label: "Bundles, giveaways and subscriptions", hint: "A wishlist game lands in a bundle, is given away or joins Game Pass", ...col("bundles", 1) },
    { key: "free", label: "Free games", hint: "Free to claim on Steam, Epic, GOG and others", ...col("free") },
    { key: "dlc", label: "DLC sales", hint: "Big sales on add-ons for games you play", ...col("dlc") },
    { key: "refund", label: "Refund window", hint: "A heads-up two days before the 14 days run out", ...col("refund") },
    { key: "milestones", label: "Playtime milestones", hint: "A card at 100, 250, 500, 1000 and 2000 hours", ...col("milestones") },
    { key: "achv", label: "Almost 100%", hint: "A few achievements short in a game you play a lot", ...col("achv") },
    { key: "nudge", label: "Monthly backlog pick", hint: "One unplayed game to try on the 1st", ...col("nudge") },
    { key: "yearly", label: "Year in games", hint: "Your recap card after December 26", ...col("yearly") },
    { key: "codes", label: "Game codes", hint: "New codes for Borderlands, Genshin, Star Rail, Zenless", read: (u, s) => !!s.codes, write: (db, u, on) => db.setAlertSubs(u.discord_id, { codes: on }) },
    { key: "promos", label: "Giveaway and promo news", hint: "NVIDIA, SteelSeries and game news mentioning a giveaway", read: (u, s) => !!s.promos, write: (db, u, on) => db.setAlertSubs(u.discord_id, { promos: on }) },
    { key: "share", label: "Share with my server", hint: "Show my name in group alerts and on the leaderboard", ...col("share") }
];
const NEWS = ["Off", "Patch notes only", "Every announcement"];
const PLAYTEST = ["Off", "Only games on my wishlist", "Every playtest and demo the bot finds"];
const MINS = [0, 10, 25, 40, 50, 60, 75, 90];
const onOff = v => (v ? "On" : "Off");

export function alertPanel({ db }) {
    const subs = u => db.getAlertSubs(u.discord_id);

    function embedFor(page, u, notice) {
        const s = subs(u);
        const base = { color: COLOR, footer: { text: "Everything here is private to you. Old /alerts commands still work." } };
        const head = [u.paused ? "**Alerts are paused.** Nothing is sent until you resume." : null, notice ? `> ${notice}` : null].filter(Boolean).join("\n");
        if (page === "types") {
            const lines = TOGGLES.map(t => `${t.read(u, s) ? "✅" : "▫️"} **${t.label}**  ${t.hint}`);
            return { ...base, title: "Your alerts · What you get", description: [head, "Sale alerts for your wishlist are always on. Pick the extras you want from the first menu.", "", ...lines, "", `📰 **News:** ${NEWS[u.news ?? 0]}`, `🧪 **Playtests and demos:** ${PLAYTEST[u.playtest ?? 0]}`].filter(x => x !== null && x !== undefined).join("\n") };
        }
        if (page === "delivery") {
            const guild = db.getGuild(u.guild_id);
            return { ...base, title: "Your alerts · Where", description: [head, "", `📬 **Delivery:** ${u.delivery === "channel" ? "Server alert channel, you are mentioned" : "Direct message"}`,
                `🌍 **Region:** ${REGIONS.find(r => r.value === u.region)?.name ?? u.region}`, `🏬 **Stores:** ${u.stores === "major" ? "Major stores" : "All tracked stores"}`,
                `🗣️ **Language:** ${LANGS[u.lang] ?? "English"}`, `📣 **Server alert channel:** ${guild ? `<#${guild.channel_id}>` : "not set (DMs only)"}`].filter(x => x !== null).join("\n") };
        }
        return { ...base, title: "Your alerts · When", description: [head, "", `🌙 **Quiet hours:** ${describeQuiet(u)}`, `🗓️ **Weekly digest:** ${describeDigest(u)}`,
            `🏷️ **Minimum discount:** ${u.min_discount ? `${u.min_discount}% (starred games always come through)` : "any"}`, `🌐 **Time zone:** ${u.tz ?? "UTC"}`].filter(x => x !== null).join("\n") };
    }

    function componentsFor(page, u) {
        const s = subs(u);
        const nav = navRow(ID, PAGES, page, [button(ID, u.paused ? "Resume" : "Pause", u.paused ? "resume" : "pause", page, { style: u.paused ? ButtonStyle.Success : ButtonStyle.Danger })]);
        if (page === "types") {
            return [
                rowOf(select(ID, "toggles", "", "Turn extras on or off", TOGGLES.map(t => ({ label: t.label, value: t.key, description: t.hint, default: t.read(u, s) })), { min: 0, max: TOGGLES.length })),
                rowOf(select(ID, "news", "", "News and patch notes", NEWS.map((l, v) => ({ label: `News: ${l}`, value: v, default: (u.news ?? 0) === v })))),
                rowOf(select(ID, "playtest", "", "Playtests, demos and betas", PLAYTEST.map((l, v) => ({ label: `Playtests: ${l}`, value: v, default: (u.playtest ?? 0) === v })))),
                nav
            ];
        }
        if (page === "delivery") {
            return [
                rowOf(select(ID, "delivery", "", "Where alerts go", [{ label: "Direct message", value: "dm", description: "Falls back to the server channel if DMs are closed", default: u.delivery !== "channel" }, { label: "Server alert channel", value: "channel", description: "You get mentioned there", default: u.delivery === "channel" }])),
                rowOf(select(ID, "region", "", "Region for prices", REGIONS.map(r => ({ label: r.name, value: r.value, default: r.value === u.region })))),
                rowOf(select(ID, "stores", "", "Which stores count", [{ label: "Major stores only", value: "major", default: u.stores === "major" }, { label: "All tracked stores", value: "all", default: u.stores !== "major" }])),
                rowOf(select(ID, "lang", "", "Language", Object.entries(LANGS).map(([v, l]) => ({ label: l, value: v, default: (u.lang ?? "en") === v })))),
                nav
            ];
        }
        return [
            rowOf(select(ID, "digest", "", "Weekly digest", [{ label: "Digest off", value: "off", default: !u.digest }, ...WEEKDAYS.map((d, v) => ({ label: `Digest every ${d}`, value: v, default: !!u.digest && u.digest_day === v }))])),
            rowOf(select(ID, "mindisc", "", "Smallest sale worth an alert", MINS.map(v => ({ label: v ? `At least ${v}% off` : "Any discount", value: v, default: (u.min_discount ?? 0) === v })))),
            rowOf(button(ID, "Set quiet hours", "quiet", "", { emoji: "🌙", style: ButtonStyle.Primary }), button(ID, "Quiet hours off", "quietoff", "", { disabled: u.quiet_start === null || u.quiet_start === undefined })),
            nav
        ];
    }

    function modal(u) {
        const mk = (id, label, value, ph) => new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Short).setRequired(id !== "tz").setPlaceholder(ph).setValue(value ?? "").setMaxLength(60));
        const [a, b] = (describeQuiet(u).match(/\d{1,2}:\d{2}/g) ?? []);
        return new ModalBuilder().setCustomId("pn:alerts:quietm").setTitle("Quiet hours")
            .addComponents(mk("start", "Start", u.quiet_start == null ? "" : a, "22:00 or 10pm"), mk("end", "End", u.quiet_end == null ? "" : b, "07:00 or 7am"), mk("tz", "Time zone (optional)", u.tz && u.tz !== "UTC" ? u.tz : "", "America/New_York"));
    }

    return {
        pages: PAGES,
        pageOf: () => "types",
        render(ctx, page, notice) {
            const u = ctx.db.getUser(ctx.user.discord_id);
            return { embeds: [embedFor(page, u, notice)], components: componentsFor(page, u) };
        },
        handle(ctx, kind, arg, i, values) {
            const u = ctx.db.getUser(ctx.user.discord_id);
            const up = patch => ctx.db.updateUser(u.discord_id, patch);
            switch (kind) {
                case "go": return { page: arg };
                case "pause": up({ paused: 1 }); return { page: arg, notice: "Alerts paused. Your wishlist is kept." };
                case "resume": up({ paused: 0 }); return { page: arg, notice: "Alerts are on again." };
                case "toggles": {
                    const s = subs(u), want = new Set(values);
                    for (const t of TOGGLES) if (want.has(t.key) !== t.read(u, s)) t.write(ctx.db, u, want.has(t.key));
                    return { page: "types", notice: "Saved." };
                }
                case "news": up({ news: Number(values[0]) }); return { page: "types", notice: `News: ${NEWS[Number(values[0])] ?? "Off"}.` };
                case "playtest": up({ playtest: Number(values[0]) }); return { page: "types", notice: `Playtests: ${PLAYTEST[Number(values[0])] ?? "Off"}.` };
                case "delivery":
                    if (values[0] === "channel" && !ctx.db.getGuild(u.guild_id)) throw new UserError("This server has no alert channel yet. Ask an admin to run `/manage alertchannel set`.");
                    up({ delivery: values[0] === "channel" ? "channel" : "dm" }); return { page: "delivery", notice: "Delivery updated." };
                case "region": up({ region: values[0] }); return { page: "delivery", notice: "Region updated." };
                case "stores": up({ stores: values[0] === "all" ? "all" : "major" }); return { page: "delivery", notice: "Stores updated." };
                case "lang": up({ lang: values[0] }); return { page: "delivery", notice: "Language updated." };
                case "digest": {
                    if (values[0] === "off") up(prefsPatch({ digest: false }, u));
                    else up(prefsPatch({ digest: true, digest_day: Number(values[0]) }, u));
                    return { page: "timing", notice: values[0] === "off" ? "Digest off." : "Digest on." };
                }
                case "mindisc": up(prefsPatch({ min_discount: Number(values[0]) }, u)); return { page: "timing", notice: "Saved." };
                case "quiet": return { modal: modal(u) };
                case "quietoff": up({ quiet_start: null, quiet_end: null }); return { page: "timing", notice: "Quiet hours are off." };
                case "quietm": {
                    const f = k => { try { return i.fields.getTextInputValue(k).trim(); } catch { return ""; } };
                    const input = { quiet_start: f("start"), quiet_end: f("end") };
                    if (f("tz")) input.tz = f("tz");
                    up(prefsPatch(input, u));
                    return { page: "timing", notice: `Quiet hours: ${describeQuiet(ctx.db.getUser(u.discord_id))}.` };
                }
            }
            return { page: "types" };
        }
    };
}
