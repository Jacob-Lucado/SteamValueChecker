// The paged /help: one embed per topic, a menu to jump, and Prev / Next buttons.
import { ActionRowBuilder, StringSelectMenuBuilder } from "discord.js";
import { HELP_PAGES } from "./text.js";
import { BRAND_COLOR, BRAND_NAME } from "./brand.js";

let ctx = { base: null, supportUrl: null, inviteUrl: null };
/** Where the links and pictures point (the dashboard address, the support page, the invite link). */
export const configureHelp = o => { ctx = { ...ctx, ...o }; };

const NAV = "help_go:";
const httpsOnly = u => (typeof u === "string" && /^https:\/\//.test(u) ? u : null);

export function helpPayload(key = "start") {
    const page = HELP_PAGES.find(p => p.key === key) ?? HELP_PAGES[0];
    const at = HELP_PAGES.indexOf(page), first = at === 0;
    const base = httpsOnly(ctx.base), logo = base ? `${base}/logo.png` : null;
    const embed = {
        color: BRAND_COLOR,
        author: { name: `${BRAND_NAME}  ·  Help`, ...(logo ? { icon_url: logo } : {}), ...(base ? { url: base } : {}) },
        title: `${page.emoji}  ${page.title}`,
        description: page.description,
        fields: page.fields.map(f => ({ name: f.name, value: f.value.slice(0, 1024), inline: first && f.value.length < 130 })),
        ...(logo ? { thumbnail: { url: logo } } : {}),
        ...(first && base ? { image: { url: `${base}/banner.png` } } : {}),
        footer: { text: `${page.label}  ·  page ${at + 1} of ${HELP_PAGES.length}  ·  /help brings this back any time`, ...(logo ? { icon_url: logo } : {}) }
    };
    const menu = new StringSelectMenuBuilder().setCustomId("help_pick").setPlaceholder("Jump to a topic…")
        .addOptions(HELP_PAGES.map(p => ({ label: p.label, value: p.key, emoji: p.emoji, default: p.key === page.key })));
    const prev = HELP_PAGES[(at + HELP_PAGES.length - 1) % HELP_PAGES.length], next = HELP_PAGES[(at + 1) % HELP_PAGES.length];
    const links = [[base ? `${base}/#/mypage` : null, "Dashboard", "🌐"], [httpsOnly(ctx.inviteUrl), "Add to a server", "➕"], [httpsOnly(ctx.supportUrl), "Support", "💬"]].filter(l => l[0]);
    const buttons = [
        { type: 2, style: 2, custom_id: NAV + prev.key, label: "Back", emoji: { name: "◀️" } },
        { type: 2, style: 1, custom_id: NAV + next.key, label: "Next", emoji: { name: "▶️" } },
        ...links.slice(0, 3).map(([url, label, e]) => ({ type: 2, style: 5, url, label, emoji: { name: e } }))
    ];
    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu), { type: 1, components: buttons }] };
}

export const isHelpNav = i => i.isButton?.() && i.customId?.startsWith(NAV);
export const handleHelpPick = i => i.update(helpPayload(i.isButton?.() ? i.customId.slice(NAV.length) : i.values[0]));
