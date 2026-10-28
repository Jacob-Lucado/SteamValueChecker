// What's new. Newest first. The dashboard shows a banner for the newest entry until it is dismissed, and /changelog lists them.
export const CHANGELOG = [
    { version: "2026.10.28", date: "2026-10-28", title: "Steam library, bundles and looking for group", items: [
        "`/steam link` (or the Steam page) links a public profile: your games, hours played, what you never played and what it is all worth. `/steam next` picks what to play next from your own library, and `/steam value` estimates your Steam account's value. A sync marks games with every achievement unlocked as Finished.",
        "`/bundle` checks whether a bundle beats buying separately. `/saleprep` plans a sale shopping list and recaps past alerts.",
        "`/lfg post` makes a looking-for-group post with Join and Leave buttons and an optional Discord event.",
        "FanaticalGrabber 2.2 can send game titles (never keys) straight to your library: get a code with `/library grabber`.",
        "Batch redeem (dashboard, Games menu): paste Steam keys and redeem them all through the FanaticalGrabber extension 2.3. `/redeem` queues keys from Discord and DMs you the results.",
        "Release-day alerts: games on your wishlist that are not out yet get a DM when they launch. Mute with `/alerts mute`.",
        "`/library trend` and a backlog chart on the Library page. `/compare` your library with a friend. `/regions` ranks a game's price across regions.",
        "Calendar: `/calendar view` and a Calendar page show your wishlist release dates, Steam sales, server events and group games. Managers add server events (announced, with a reminder). An optional private link syncs it to Google, Apple or Outlook calendar.",
        "Batch redeem remembers how keys turned out (masked), skips repeats and has `/redeem history:true`.",
        "The bot owner can download the latest backup from the Admin page." ] },
    { version: "2026.10.27", date: "2026-10-27", title: "Game night and easier setup", items: [
        "`/gamenight`: what everyone in your voice channel can play together, who is missing a game, and what to buy together.",
        "Optional group-buy nudges in a voice channel when a game several of you want goes on sale.",
        "`/setup` can create the channels for you, and the dashboard menu is now grouped." ] },
    { version: "2026.10.26", date: "2026-10-26", title: "Support, notifications and more", items: [
        "Support tickets: `/support open` or the Support page. Replies reach you in Discord and on the dashboard.",
        "Notification center on the dashboard keeps a copy of every alert. Mute a kind of alert with `/alerts mute`.",
        "Sale alerts have Snooze 7 days and Only below a price buttons.",
        "Setup checklist on the dashboard home, a global search (press `/`), and a high-contrast theme.",
        "Spanish and French for the main buttons: `/alerts language`." ] },
    { version: "2026.10.12", date: "2026-10-12", title: "Status page, free game menu and server tools", items: [
        "A public Status page and `/status`.",
        "`/freegames` is a scrollable menu with Games and DLC tabs.",
        "`/library backlog`, `/watch`, `/sales`, `/publicpage` and `/serverstats`." ] }
];
export const LATEST = CHANGELOG[0].version;

export function changelogEmbed(limit = 3) {
    return {
        color: 0xff9800, title: "What's new",
        description: CHANGELOG.slice(0, limit).map(e => `**${e.title}** (${e.date})\n${e.items.map(x => "• " + x).join("\n")}`).join("\n\n").slice(0, 4000)
    };
}
