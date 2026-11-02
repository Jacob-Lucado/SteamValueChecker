// What's new. Newest first. The dashboard shows a banner for the newest entry until it is dismissed, and /bot changelog lists them.
export const CHANGELOG = [
    { version: "2026.11.05", date: "2026-11-05", title: "Fewer commands, bigger music", items: [
        "**Commands grouped:** the long list is now a few short ones. `/games` (prices, deals, free games, sales, codes), `/me` (wishlist, library, Steam, friends, your data), `/server` (giveaways, game nights, levels, boards, events), `/manage` (setup and community for managers), `/bot` (status, changelog, support, ideas), plus `/alerts`, `/music`, `/play`, `/mod`, `/dashboard` and `/help`. Everything does what it did before, just under a group.",
        "**One card at a time:** messages that used to stack several cards (a batch of free games, several wishlist alerts, bundle and giveaway alerts, long replies) now show one card with Previous / Next buttons and a jump menu. Each page keeps its own buttons.",
        "**Emoji packs:** `/manage emoji packs` browses emoji.gg packs one at a time and imports the one you pick (still only, animated only, or both, in batches of 50). The dashboard's Community page has the same with tick boxes. Emoji links from any website now work too, and animated Discord emoji keep their movement.",
        "**Terms and privacy:** the Terms of Service and Privacy Policy are pages on the bot's own site (`/terms` and `/privacy`), linked from the footer and `/bot privacy`.",
        "**Paged help:** `/help` is now a clean paged embed with a menu for each topic.",
        "**Live radio:** `/music live` lists stations that are on the air right now, and you can paste any Icecast or Shoutcast stream link into `/play`.",
        "**Auto DJ:** managers pick a playlist and the bot keeps playing it when nobody has queued anything. Members send requests (`/music autodj submit`, or on the dashboard) and they play first.",
        "**Stay in the channel:** with `stay` on (`/music settings`, or the Music page), the bot waits in the voice channel it was last used in instead of leaving. When someone joins it goes back to the last live station, or starts the Auto DJ if no station was playing. It also rejoins after a restart.",
        "**Music on the dashboard:** the Music page now has live status with album art, seek, the radio list, Auto DJ requests and settings, and roles for managers, moderators, DJs and listeners.",
    ] },
    { version: "2026.11.04", date: "2026-11-04", title: "Music", items: [
        "**SoundCloud music:** join a voice channel and use `/play` with a SoundCloud link, a playlist link or just words to search. There is a queue, skip (others vote), previous, loop, shuffle, seek, volume and a now-playing panel with buttons.",
        "**Playlists:** paste a SoundCloud playlist (up to 100 songs) and it queues the lot, or save your own with `/music saveplaylist` and load it in any server.",
        "**Dashboard:** a new **Music** page under Servers does all of it from the browser, and managers set a DJ role, starting volume, limits and where song messages go.",
        "**Setup:** community setup adds a Music category with a #music-commands channel and two voice channels (run `/manage community setup` again on an existing server). The bot needs Connect and Speak permission, so servers that added it earlier may need to grant them."
    ] },
    { version: "2026.11.03", date: "2026-11-03", title: "Promo drops", items: [
        "**Alerts to your DMs:** `/alerts codes` messages you when a new game code drops (all games, or only the ones you pick), and `/alerts promos` does the same for giveaway and code news. Both are on the dashboard's Alerts page, show up in Notifications, can be muted, and only send what is new from the moment you turn them on.",
        "**Promo drops:** for key giveaways like SteelSeries or NVIDIA rewards. A server manager adds the code or link with `/server promos add` (or on the dashboard under Servers, Promo drops) and the bot posts it once in the promo channel, then greys it out when it ends.",
        "**News watching:** turn on `/server promos news` and the bot also posts news that mentions a giveaway or a code: the NVIDIA and SteelSeries blogs, and the official Steam news for Dead by Daylight, Warframe, Destiny 2, Apex Legends, Rainbow Six Siege, Marvel Rivals, Wuthering Waves, Path of Exile and PUBG. It only posts new ones, and it can be wrong now and then, so each one links to the post.",
        "**Codes, tidied:** all the Borderlands games are now one entry in every picker and filter (the code card still names the exact game), and Genshin, Star Rail and Zenless codes show their game art on the dashboard and in Discord posts.",
        "**Ping roles:** community setup adds opt-in **Game code pings** and **Promo drop pings** roles to the role picker, and those are pinged by default (or pick your own role on the dashboard or with `/games codes ping` and `/server promos ping`). Run `/manage community setup` again to add them to an existing server.",
        "**Where they go:** community setup adds a #promo-drops channel (run `/manage community setup` again to add it to an existing server)."
    ] },
    { version: "2026.11.02", date: "2026-11-02", title: "Game codes", items: [
        "**Limited-time game codes:** the bot now watches for SHiFT codes (Borderlands 2, 3, 4, The Pre-Sequel, Wonderlands and the GOTY edition) plus redeem codes for Genshin Impact, Honkai: Star Rail and Zenless Zone Zero, and posts each one once, with the right game's art, the reward, the platform and when it ends. When a code runs out, its post is greyed out.",
        "**Where they go:** servers get a #game-codes channel from community setup (run `/manage community setup` again to add it to an existing server). Managers can pick the channel, which games to include and a role to ping with `/games codes`, or on the dashboard under Servers, Game codes.",
        "**Dashboard:** a new **Game codes** page under Prices lists every working code with a copy button, and lets you look at ones that just ended. `/games codes latest` shows the same list in Discord.",
    ] },
    { version: "2026.11.01", date: "2026-11-01", title: "A full community bot", items: [
        "**Brand-new servers are set up for you.** Add the bot to a fresh server and it builds the usual gaming layout (welcome, rules, general, gaming, deals, voice and a private staff area), with Moderator and Member roles, a role picker and the bot's own channels connected. Any other server can run `/manage community setup`.",
        "**Welcome messages, levels and XP, invites and referrals.** New members are greeted with who invited them, chat and voice earn XP, `/server rank` and `/server levels` show where you stand, and `/server invites link` gives you your own link with rewards for bringing people in.",
        "**Emoji import:** `/manage emoji import` copies emoji from other servers or adds an image. The dashboard can paste emoji or upload an image too.",
        "**Dashboard:** new **Community** and **Server XP** pages in the Servers menu (leaderboard, level rewards, how XP works, and a prize shop that is coming soon). The owner's Admin page has a **Community** tab showing what is used.",
        "**Welcome DM:** new members now get a private message once with what the bot does and a button to the dashboard. Managers can switch it off with `/manage community welcome dm:false`. Also new: `/dashboard` (or `/dash`) gives the dashboard link, and the dashboard scrolls and loads more smoothly.",
        "**Bot status:** the bot's status line now rotates through its server count, members, uptime and where to get support.",
        "**Moderation:** `/mod` has `warn`, `warnings`, `clearwarns`, `timeout`, `untimeout`, `kick`, `ban`, `unban`, `purge`, `cases` and `log`. Every action is a numbered case posted to a private **#mod-log** (joins and leaves now go to **#member-log**). Moderators need the matching Discord permission, and nobody can act on themselves, the owner, the bot or someone above them. The dashboard has a **Moderation** page with the same actions and the case log.",
        "**Steam Verified:** fresh servers get a Steam Verified role and a #verify channel. Press the button (or run `/me steam verify`) after signing in through Steam. You can also add **Linked Roles** from the Steam page so your Steam shows on your Discord profile; the normal way to link still works.",
        "**Cross-server giveaways** now say they are cross-server and who hosts them, can be hosted by a partner with their links, and can ask for entry steps like following on X or joining a Discord. Giveaway numbers no longer show on posts."
    ] },
    { version: "2026.10.31", date: "2026-10-31", title: "Sign in through Steam", items: [
        "**Sign in through Steam** on the dashboard: one click on Steam's own page and your library, hours and taste profile fill in. No profile links to paste. Wishlist import, `/me wishlist import` and `/me steam link` use the Steam account you signed in with.",
        "The Steam page has a new **Library analytics** view: games, hours, collection value, how much you have played, hours by genre, played versus backlog and your most played games.",
        "Free DLC is now labelled, and if your Steam library is synced the alert says whether you own the base game.",
        "FanaticalGrabber 2.7: press **Connect the extension** on the Library page and the code is handed over for you. The cart check now says why when it cannot read a cart, and \"You're seeing the best deals available\" when you are well under Steam.",
        "**For you** page and `/me steam foryou`: live deals ranked by a match score from your library taste and wishlist, with filters for all-time lows, discount, price and store.",
        "Home page: a live count of free offers and a feature ticker. `/help` is now a full command list."
    ] },
    { version: "2026.10.30", date: "2026-10-30", title: "Goals, bundles, more leaderboards and a tidier menu", items: [
        "`/me steam goal`: set an hours goal for the year and see if you are on pace (also on the Steam page). `/me steam recap` now posts a picture you can share, and the Steam page can make the same image.",
        "`/me library bundle` and `/me library bundles`: record a bundle you bought and see what its games are worth, what each cost you and how much you have played.",
        "`/server leaderboard` has two more boards: hours played this year and biggest library. The dashboard shows all four in one picker.",
        "`/alerts mindiscount`: only get sale alerts for a minimum percent off. Starred games still come through.",
        "Dashboard menu: pages are grouped into Library, Prices, Friends, Servers, Account and Help, with each section's pages as tabs under the menu. Theme and contrast now share one Display menu.",
        "FanaticalGrabber: bundle and cart pages on Fanatical now show how the price compares with Steam and whether it is worth buying. It can also fill in what you paid from your Steam purchase history (Send what I paid)",
    ] },
    { version: "2026.10.29", date: "2026-10-29", title: "Hours tracked, challenges, gifts and a Steam panel", items: [
        "`/me steam recap` (and a card you can save as an image on the Steam page): the hours you add after linking Steam, for this year and in total since you linked, per month and per game. Steam only shares lifetime hours, so nothing from before you linked. Linked libraries now sync automatically every few hours.",
        "`/me library challenge`: set a monthly goal of games to finish and keep a streak. It is on the Library page too.",
        "Wishlist: `/me wishlist cleanup` removes games you already own, and `/me wishlist priority` stars a game so it is listed first and its alerts come through quiet hours.",
        "Your `/me publicpage` lets visitors mark \"I'm gifting this\" so nobody doubles up. You only see how many are claimed, and can clear them.",
        "Free games: a one-time last-chance reminder when an offer you were told about ends within a day.",
        "Server admins: `/manage alertchannel digest` posts a Friday round-up of cheap shared games, free games and events.",
        "Buy now or wait: `/me wishlist check` and the price history chart now give a verdict from a year of prices, how often it has hit its low and whether a Steam sale is coming.",
        "`/me library spend` and a Library page panel: what you have spent, by month, cost per hour played and what you bought and never played.",
        "FanaticalGrabber 2.5 adds a Steam-style batch redeem panel on Steam's own pages, a price overlay on game pages, a bundle helper, a cart check and a queue from Fanatical.",
        "`/me friend`: keep friends' birthdays and public wishlist pages, see what is on sale for them and get a reminder a week before. Dashboard: Friends page.",
        "`/me library badges` and a Trophy case on the Library page. `/server leaderboard board:finished` is a monthly backlog league for members who opted in.",
        "Dashboard: a page for every game (click a wishlist title) and a Sale war room with a budget slider.",
        "Dashboard: a My page under Account lists every feature as a card with its status, switches for the simple ones, and links to set up the rest. Pin, reorder or hide cards.",
        "My page also has a Profile card: pick what to show (games, finished, hours, percent saved, streak, badges, genres), choose a colour and save it as an image.",
        "My page pictures: add a banner and a profile card picture from any https image link, or let a Steam link fill them in (your profile picture and the art of your most played game). They refresh each time you sync.",
        "Profile card: add your gaming names (Steam, Xbox, PlayStation, Nintendo, Epic, GOG and more) and they show on the card. `/me profilecard` posts the same card as a picture (add `public:true` to share it).",
        "`/me steam value` now answers with a picture that looks like the Steam page's account value panel. The Steam page has a Save as image button for it too.",
        "New: a short guided tour the first time you open the dashboard (replay it from My page), and a one-time quick start after your first command.",
        "Taste profile (`/me steam taste`) suggests games from your own library's tags." ] },
    { version: "2026.10.28", date: "2026-10-28", title: "Steam library, bundles and looking for group", items: [
        "`/me steam link` (or the Steam page) links a public profile: your games, hours played, what you never played and what it is all worth. `/me steam next` picks what to play next from your own library, and `/me steam value` estimates your Steam account's value. A sync marks games with every achievement unlocked as Finished.",
        "`/games bundle` checks whether a bundle beats buying separately. `/games saleprep` plans a sale shopping list and recaps past alerts.",
        "`/server lfg post` makes a looking-for-group post with Join and Leave buttons and an optional Discord event.",
        "FanaticalGrabber 2.2 can send game titles (never keys) straight to your library: get a code with `/me library grabber`.",
        "Batch redeem (dashboard, Games menu): paste Steam keys and redeem them all through the FanaticalGrabber extension 2.3. `/games redeem` queues keys from Discord and DMs you the results.",
        "Release-day alerts: games on your wishlist that are not out yet get a DM when they launch. Mute with `/alerts mute`.",
        "`/me library trend` and a backlog chart on the Library page. `/server compare` your library with a friend. `/games regions` ranks a game's price across regions.",
        "Calendar: `/server calendar view` and a Calendar page show your wishlist release dates, Steam sales, server events and group games. Managers add server events (announced, with a reminder). An optional private link syncs it to Google, Apple or Outlook calendar.",
        "Batch redeem remembers how keys turned out (masked), skips repeats and has `/games redeem history:true`.",
        "The bot owner can download the latest backup from the Admin page." ] },
    { version: "2026.10.27", date: "2026-10-27", title: "Game night and easier setup", items: [
        "`/server gamenight`: what everyone in your voice channel can play together, who is missing a game, and what to buy together.",
        "Optional group-buy nudges in a voice channel when a game several of you want goes on sale.",
        "`/manage setup` can create the channels for you, and the dashboard menu is now grouped." ] },
    { version: "2026.10.26", date: "2026-10-26", title: "Support, notifications and more", items: [
        "Support tickets: `/bot support open` or the Support page. Replies reach you in Discord and on the dashboard.",
        "Notification center on the dashboard keeps a copy of every alert. Mute a kind of alert with `/alerts mute`.",
        "Sale alerts have Snooze 7 days and Only below a price buttons.",
        "Setup checklist on the dashboard home, a global search (press `/`), and a high-contrast theme.",
        "Spanish and French for the main buttons: `/alerts language`." ] },
    { version: "2026.10.12", date: "2026-10-12", title: "Status page, free game menu and server tools", items: [
        "A public Status page and `/bot status`.",
        "`/games freegames` is a scrollable menu with Games and DLC tabs.",
        "`/me library backlog`, `/games watch`, `/games sales`, `/me publicpage` and `/server serverstats`." ] }
];
export const LATEST = CHANGELOG[0].version;

export function changelogEmbed(limit = 3) {
    return {
        color: 0xff9800, title: "What's new",
        description: CHANGELOG.slice(0, limit).map(e => `**${e.title}** (${e.date})\n${e.items.map(x => "• " + x).join("\n")}`).join("\n\n").slice(0, 4000)
    };
}
