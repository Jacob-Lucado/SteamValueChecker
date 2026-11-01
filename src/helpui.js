// The paged /help: one embed per topic and a menu to flip between them.
import { ActionRowBuilder, StringSelectMenuBuilder } from "discord.js";
import { HELP_PAGES } from "./text.js";

const COLOR = 0xff9800;

export function helpPayload(key = "start") {
    const page = HELP_PAGES.find(p => p.key === key) ?? HELP_PAGES[0];
    const at = HELP_PAGES.indexOf(page);
    const embed = {
        color: COLOR,
        title: `${page.emoji}  ${page.title}`,
        description: page.description,
        fields: page.fields.map(f => ({ name: f.name, value: f.value.slice(0, 1024) })),
        footer: { text: `Page ${at + 1} of ${HELP_PAGES.length}  ·  pick a topic below` }
    };
    const menu = new StringSelectMenuBuilder().setCustomId("help_pick").setPlaceholder("Choose a topic")
        .addOptions(HELP_PAGES.map(p => ({ label: p.label, value: p.key, emoji: p.emoji, default: p.key === page.key })));
    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
}

export const handleHelpPick = i => i.update(helpPayload(i.values[0]));
