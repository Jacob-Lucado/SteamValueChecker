// What's new. Newest first. The dashboard shows a banner for the newest entry until it is dismissed, and /changelog lists them.
export const CHANGELOG = [
    { version: "2026.11.01", date: "2026-11-01", title: "A full community bot", items: [
        "**Brand-new servers are set up for you.** Add the bot to a fresh server and it builds the usual gaming layout (welcome, rules, general, gaming, deals, voice and a private staff area), with Moderator and Member roles, a role picker and the bot's own channels connected. Any other server can run `/community setup`.",
        "**Welcome messages, levels and XP, invites and referrals.** New members are greeted with who invited them, chat and voice earn XP, `/rank` and `/levels` show where you stand, and `/invites link` gives you your own link with rewards for bringing people in.",
        "**Emoji import:** `/emoji import` copies emoji from other servers or adds an image. The dashboard can paste emoji or upload an image too.",
        "**Dashboard:** new **Community** and **Server XP** pages in the Servers menu (leaderboard, level rewards, how XP works, and a prize shop that is coming soon). The owner's Admin page has a **Community** tab showing what is used.",
        "**Bot status:** the bot's status line now rotates through its server count, members, uptime and where to get support.",
        "**Moderation:** `/mod` has `warn`, `warnings`, `clearwarns`, `timeout`, `untimeout`, `kick`, `ban`, `unban`, `purge`, `cases` and `log`. Every action is a numbered case posted to a private **#mod-log** (joins and leaves now go to **#member-log**). Moderators need the matching Discord permission, and nobody can act on themselves, the owner, the bot or someone above them. The dashboard has a **Moderation** page with the same actions and the case log.",
        "**Steam Verified:** fresh servers get a Steam Verified role and a #verify channel. Press the button (or run `/steam verify`) after signing in through Steam. You can also add **Linked Roles** from the Steam page so your Steam shows on your Discord profile; the normal way to link still works.",
        "**Cross-server giveaways** now say they are cross-server and who hosts them, can be hosted by a partner with their links, and can ask for entry steps like following on X or joining a Discord. Giveaway numbers no longer show on posts."
    ] },
    { version: "2026.10.31", date: "2026-10-31", title: "Sign in through Steam", items: [
        "**Sign in through Steam** on the dashboard: one click on Steam's own page and your library, hours and taste profile fill in. No profile links to paste. Wishlist import, `/wishlist import` and `/steam link` use the Steam account you signed in with.",
        "The Steam page has a new **Library analytics** view: games, hours, collection value, how much you have played, hours by genre, played versus backlog and your most played games.",
        "Free DLC is now labelled, and if your Steam library is synced the alert says whether you own the base game.",
        "FanaticalGrabber 2.7: press **Connect the extension** on the Library page and the code is handed over for you. The cart check now says why when it cannot read a cart, and \"You're seeing the best deals available\" when you are well under Steam.",
        "**For you** page and `/steam foryou`: live deals ranked by a match score from your library taste and wishlist, with filters for all-time lows, discount, price and store.",
        "Home page: a live count of free offers and a feature ticker. `/help` is now a full command list."
    ] },
    { version: "2026.10.30", date: "2026-10-30", title: "Goals, bundles, more leaderboards and a tidier menu", items: [
        "`/steam goal`: set an hours goal for the year and see if you are on pace (also on the Steam page). `/steam recap` now posts a picture you can share, and the Steam page can make the same image.",
        "`/library bundle` and `/library bundles`: record a bundle you bought and see what its games are worth, what each cost you and how much you have played.",
        "`/leaderboard` has two more boards: hours played this year and biggest library. The dashboard shows all four in one picker.",
        "`/alerts mindiscount`: only get sale alerts for a minimum percent off. Starred games still come through.",
        "Dashboard menu: pages are grouped into Library, Prices, Friends, Servers, Account and Help, with each section's pages as tabs under the menu. Theme and contrast now share one Display menu.",
        "FanaticalGrabber: bundle and cart pages on Fanatical now show how the price compares with Steam and whether it is worth buying. It can also fill in what you paid from your Steam purchase history (Send what I paid)",
    ] },
    { version: "2026.10.29", date: "2026-10-29", title: "Hours tracked, challenges, gifts and a Steam panel", items: [
        "`/steam recap` (and a card you can save as an image on the Steam page): the hours you add after linking Steam, for this year and in total since you linked, per month and per game. Steam only shares lifetime hours, so nothing from before you linked. Linked libraries now sync automatically every few hours.",
        "`/library challenge`: set a monthly goal of games to finish and keep a streak. It is on the Library page too.",
        "Wishlist: `/wishlist cleanup` removes games you already own, and `/wishlist priority` stars a game so it is listed first and its alerts come through quiet hours.",
        "Your `/publicpage` lets visitors mark \"I'm gifting this\" so nobody doubles up. You only see how many are claimed, and can clear them.",
        "Free games: a one-time last-chance reminder when an offer you were told about ends within a day.",
        "Server admins: `/alertchannel digest` posts a Friday round-up of cheap shared games, free games and events.",
        "Buy now or wait: `/wishlist check` and the price history chart now give a verdict from a year of prices, how often it has hit its low and whether a Steam sale is coming.",
        "`/library spend` and a Library page panel: what you have spent, by month, cost per hour played and what you bought and never played.",
        "FanaticalGrabber 2.5 adds a Steam-style batch redeem panel on Steam's own pages, a price overlay on game pages, a bundle helper, a cart check and a queue from Fanatical.",
        "`/friend`: keep friends' birthdays and public wishlist pages, see what is on sale for them and get a reminder a week before. Dashboard: Friends page.",
        "`/library badges` and a Trophy case on the Library page. `/leaderboard board:finished` is a monthly backlog league for members who opted in.",
        "Dashboard: a page for every game (click a wishlist title) and a Sale war room with a budget slider.",
        "Dashboard: a My page under Account lists every feature as a card with its status, switches for the simple ones, and links to set up the rest. Pin, reorder or hide cards.",
        "My page also has a Profile card: pick what to show (games, finished, hours, percent saved, streak, badges, genres), choose a colour and save it as an image.",
        "My page pictures: add a banner and a profile card picture from any https image link, or let a Steam link fill them in (your profile picture and the art of your most played game). They refresh each time you sync.",
        "Profile card: add your gaming names (Steam, Xbox, PlayStation, Nintendo, Epic, GOG and more) and they show on the card. `/profilecard` posts the same card as a picture (add `public:true` to share it).",
        "`/steam value` now answers with a picture that looks like the Steam page's account value panel. The Steam page has a Save as image button for it too.",
        "New: a short guided tour the first time you open the dashboard (replay it from My page), and a one-time quick start after your first command.",
        "Taste profile (`/steam taste`) suggests games from your own library's tags." ] },
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
