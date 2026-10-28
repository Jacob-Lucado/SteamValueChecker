// Copy for /help, /about and /privacy. Kept in one place so the README, PRIVACY.md and the bot agree.

export const HELP = [
    "**Price a game library**",
    "`/value titles:Hades; Celeste; Hollow Knight` or `/value file:` with a FanaticalGrabber export.",
    "",
    "Options: `file` (an export from the extension; only titles are read), `paid` (your total, to see savings), `region`, `stores` and `sort`. A `Paid` column in your CSV is used per game.",
    "",
    "**Wishlist and sale alerts**",
    "• `/wishlist import` reads your **public** Steam wishlist (no login). `/wishlist add` adds a game by title.",
    "• `/wishlist view` shows current prices. `/wishlist alert` sets when you are alerted: any sale, a % off, a price, or an all-time low.",
    "• Alerts come by **DM**. If a DM fails, or you pick channel delivery with `/alerts delivery`, they go to the server's alert channel and mention you. Server admins set it with `/alertchannel set`.",
    "• `/wishlist check` tells you if a game is a good deal now. Alerts show a verdict (all-time low, 1-year low, and so on).",
    "• `/alerts` has pause, region and store settings, plus `quiethours` (alerts are held overnight), `digest` (weekly summary), `bundles` (bundle and giveaway alerts), `freegames` (free to claim on any store, with Claim buttons), `history`, and `share`.",
    "",
    "**Library and servers**",
    "• `/library add`, `import`, `view`, `remove`: games you own and what you paid, with what you saved against MSRP.",
    "• `/serverlist` is a wishlist your server shares, with votes. `/leaderboard` ranks members who opted in with `/alerts share`.",
    "• Server admins can use `/alertchannel group` to post when several opted-in members watch the same game and it goes on sale.",
    "• Server managers can run key giveaways with `/giveaway create`. Winners claim with a button, confirm it worked, and a vouch is posted.",
    "• `/freegames` lists what is free to claim right now on Steam, Epic, GOG and others. `/alerts freegames` tells you when new ones appear.",
    "",
    "**More**",
    "• `/watch` watches one game for a price drop without adding it to your wishlist (it is removed after the alert). `/sales` shows the Steam sale calendar.",
    "• `/library status` marks a game as backlog, playing, played, finished or dropped. `/library backlog` shows what you have not played, what it cost and what to play next.",
    "• `/publicpage` turns on a shareable page of your wishlist and best prices, handy for gifts. `/freegames` has Games and DLC tabs; `/alerts freegames dlc:false` hides DLC.",
    "• `/serverstats` shows a server's numbers. `/alertchannel feed` posts new free games in the channel. `/status` shows whether the bot is healthy.",
    "• `/gamenight` (in a voice channel) shows what everyone there owns, who is missing a game, and what is worth buying together. Only members who opted in with `/alerts share` count. Managers can turn on nudges in `/setup`.",
    "• Server managers: `/setup` is a guided setup with channel pickers for alerts, support tickets and giveaway vouches. The dashboard has the same on its Setup page.",
    "• `/support open` asks the team for help; `/support mine` lists your tickets. Server managers set a ticket channel with `/support setup`. A giveaway key that did not work opens one for you.",
    "• `/alerts mute` stops DMs for one kind of alert (kept on the dashboard's Notifications page). `/alerts language` switches buttons to Spanish or French. `/changelog` shows what is new.",
    "• Sale alerts have **Snooze 7 days** and **Only below a price** buttons.",
    "• `/steam link` links your **public** Steam profile and fills your library with your games and hours played; `/steam view` shows what you never played and what it is worth, `/steam sync` also marks games you got every achievement in as Finished. `/steam value` estimates your account's worth (add `public:true` to share it), and `/steam next` picks what to play next. `/bundle` checks if a bundle beats buying the games separately. `/saleprep` plans what to buy in the next sale.",
    "• `/lfg post` finds people to play with (Join/Leave buttons, optional Discord event). `/library grabber` gives the FanaticalGrabber extension a link code to send your game titles in one click.",
    "• `/redeem` queues Steam keys (typed or in a file). Press Run on the dashboard's Batch redeem page while logged into Steam, with the FanaticalGrabber extension 2.3+, and the results come back as a DM.",
    "• `/library trend` shows how your library value and backlog changed. `/compare` lines your library up against a friend who opted in with `/alerts share`. `/regions` ranks one game's price across regions. `/redeem history:true` shows how your last keys turned out. Wishlisted games that are not out yet get a release-day alert (`/alerts mute type:Release-day alerts` to stop it).",
    "• `/calendar view` lists what is coming up: wishlist release dates, Steam sales, your server's events and group games. Managers add events with `/calendar add` (announced, with a reminder). The dashboard has a month view, and `/calendar feed` makes an optional private link for Google, Apple or Outlook calendar.",
    "• `/wishlist cleanup` drops games you already own; `/wishlist priority` stars one (listed first, alerts in quiet hours). `/steam recap` is your year in games, `/library challenge` a monthly finish-the-backlog goal with a streak. Visitors to your `/publicpage` can mark gifts (`reset_claims` clears them). Admins: `/alertchannel digest` posts a Friday round-up.",
    "• `/currency` picks the currency prices are shown in (saved, and shared with the dashboard).",
    "• `/mydata` exports or deletes everything stored about you.",
    "",
    "Most commands also work in a DM with the bot. `/serverlist`, `/leaderboard` and `/serverstats` use the server you last used the bot in; `/giveaway`, `/setup`, `/gamenight` and `/lfg` only work in a server.",
    "Replies are private to you. Never post game keys in chat or in a ticket. The bot ignores anything that looks like a key, except keys a server manager enters in the private giveaway form."
].join("\n");

export const ABOUT = [
    "Steam Value Checker shows what a game library is worth: MSRP, the current Steam price, the cheapest current price across tracked stores, and what you saved if you tell it what you paid.",
    "",
    "Price data comes from [IsThereAnyDeal](https://isthereanydeal.com). It works with exports from the FanaticalGrabber browser extension, and can watch your wishlist for sales.",
    "",
    "Not affiliated with Valve, Steam, Fanatical or IsThereAnyDeal. Prices change quickly and may differ from what a store shows you."
].join("\n");

export const PRIVACY = [
    "**What the bot reads:** the game titles you type or upload, the region you pick, and the amount you enter for `paid`.",
    "**What it never needs:** Steam or Fanatical logins, cookies or passwords. Anything that looks like a key is dropped before any lookup. The one exception is giveaways: a server manager can enter prize keys in a private form, and they are stored encrypted until the winner confirms (then deleted).",
    "**Where titles go:** game titles are sent to IsThereAnyDeal to get prices. Nothing else is sent.",
    "**Storage:** `/value` saves nothing. Prices are cached in memory for 30 minutes and results are not logged. Your reply is visible only to you.",
    "**Wishlist alerts and library:** if you use them, the bot stores your Discord ID, wishlist, alert rules, settings, library and what you paid, 90 days of alert history, server list votes and (if you import or link) your public Steam ID and playtime, an optional hashed FanaticalGrabber link code, and any looking-for-group posts. Sharing with your server (group alerts, leaderboard) is off until you opt in. It sends alerts by DM, or in the server alert channel if a DM fails or you choose that, where the game name is visible to the channel and you are mentioned. `/mydata export` and `/mydata delete` give you control. Support tickets (your messages and the replies) are kept until they have been closed for 6 months, are shared only with the bot owner or, if you chose a server, that server's staff, and are deleted by `/mydata delete`. A copy of each alert is kept 60 days in your notification center. If the web dashboard is on, signing in shares only your Discord name, avatar and server list, kept in memory for the session.",
    "",
    "Full text: https://github.com/Jacob-Lucado/SteamValueChecker/blob/main/PRIVACY.md"
].join("\n");
