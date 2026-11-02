// Copy for /help, /bot about and /bot privacy. Kept in one place so the README, PRIVACY.md and the bot agree.

/** Shown once, after a person's first command: where to start. */
export function quickStart(dashboardUrl = null) {
    return {
        color: 0xff9800, title: "Three places to start",
        description: [
            "1. **Watch games:** `/me wishlist import` pulls in your public Steam wishlist, and I'll tell you when something goes on sale.",
            "2. **Price your games:** `/me steam link` fills in your library, your hours, and what it's all worth.",
            "3. **See everything else:** `/help` lists every command" + (dashboardUrl ? `, and the dashboard has a guided tour: ${dashboardUrl}/#/mypage` : ".")
        ].join("\n"),
        footer: { text: "You'll only see this once." }
    };
}

// /help is a paged embed: a menu of topics, one tidy page each. Every command lives under one of a handful of names.
export const HELP_PAGES = [
    { key: "start", label: "Start here", emoji: "🧭", title: "Everything in a few commands",
        description: "Pick a topic from the menu below (`/help` brings this back any time). Replies are private unless a command says otherwise, and most work in a DM too. Never post keys.",
        fields: [
            { name: "🎮 /games", value: "Price games, check bundles, free games, sales, codes, sale prep." },
            { name: "👤 /me  ·  🔔 /alerts", value: "Your wishlist, library, Steam link, friends and data; how you get sale alerts." },
            { name: "🏠 /server", value: "Giveaways, game nights, levels, boards, events, invites, streams." },
            { name: "🎵 /music  ·  /play  ·  /player", value: "SoundCloud and live radio in voice, with an Auto DJ. `/player` opens the big player." },
            { name: "🛠 /manage  ·  🛡 /mod", value: "Setup and community tools for managers; moderation for mods." },
            { name: "🤖 /bot  ·  /dashboard", value: "Status, changelog, support and ideas. `/dashboard` opens the website." }
        ] },
    { key: "games", label: "Games and prices", emoji: "🎮", title: "/games",
        description: "Prices come from IsThereAnyDeal. Nothing here needs a login.",
        fields: [
            { name: "Prices", value: "`/games value` prices a list of games (typed, or a FanaticalGrabber export in `file`): MSRP, Steam price, cheapest now, and savings if you give `paid`.\n`/games regions` ranks one game across regions. `/games bundle` says if a bundle is worth it." },
            { name: "Watching", value: "`/games watch` watches one game for a price drop without wishlisting it.\n`/games saleprep` `plan` / `recap` readies your wishlist for a sale or shows what your alerts caught." },
            { name: "Free and limited", value: "`/games freegames` lists what is free to claim now. `/games sales` shows upcoming Steam sales.\n`/games codes` `latest` lists game codes (managers: `channel` / `games` / `ping`)." },
            { name: "Keys", value: "`/games redeem` queues Steam keys; press Run on the dashboard's Batch redeem page." }
        ] },
    { key: "me", label: "Wishlist and library", emoji: "👤", title: "/me",
        description: "Your own things. Only you see the replies.",
        fields: [
            { name: "Wishlist", value: "`/me wishlist` `import` (your public Steam wishlist), `add`, `remove`, `view`, `check`, `alert` (sale, % off or low), `priority`, `cleanup`." },
            { name: "Library", value: "`/me library` `add`, `import`, `remove`, `view`, `status`, `backlog`, `spend`, `trend`, `challenge`, `badges`, `bundles`, `grabber`." },
            { name: "Steam", value: "`/me steam` `link`, `sync`, `view`, `next`, `foryou`, `verify`, `value`, `taste`, `recap`, `goal`, `unlink`." },
            { name: "Sharing", value: "`/me profilecard` makes a profile picture. `/me publicpage` makes a shareable wishlist page. `/me currency` picks your currency.\n`/me friend` `add` / `list` / `deals` / `remove`: friends' birthdays and wishlist sales." },
            { name: "Data", value: "`/me mydata` `export` / `delete` your data." }
        ] },
    { key: "alerts", label: "Sale alerts", emoji: "🔔", title: "/alerts",
        description: "How and where you hear about price drops. Only you see the replies.",
        fields: [
            { name: "Settings", value: "`/alerts` `status`, `delivery`, `pause` / `resume`, `region`, `stores`, `quiethours`, `digest`, `mindiscount`, `bundles`, `freegames`, `codes`, `promos`, `mute`, `language`, `share`, `history`." }
        ] },
    { key: "server", label: "Your server", emoji: "🏠", title: "/server",
        description: "Things for everyone in a server. `/server serverlist`, `leaderboard`, `serverstats` and `calendar` use the server you last used the bot in when you ask in a DM.",
        fields: [
            { name: "Play together", value: "`/server gamenight` (in voice) shows what everyone owns. `/server lfg` `post` / `list` / `close` finds players. `/server compare` lines your library up against a friend's." },
            { name: "Shared lists and boards", value: "`/server serverlist` `add` / `view` / `vote` / `remove`: a wishlist your server shares. `/server leaderboard` and `/server serverstats` show boards for members who opted in." },
            { name: "Levels and invites", value: "`/server rank` your level and place. `/server levels` the top members. `/server invites` `me` / `top` / `link`." },
            { name: "Streams", value: "`/server stream` `link` connects your Twitch, Kick or YouTube channel so I post when you go live and close the post when you finish, with no commands needed (`unlink` stops it). `live` posts by hand for other sites, `end` marks it finished, `ping` turns the go-live ping on or off for you, `list` shows who is live, `setup` (managers) picks the streamer role, channel and ping role." },
            { name: "Events and giveaways", value: "`/server calendar` shows releases, sales and server events.\n`/server giveaway` `create` / `list` / `info` / `end` / `cancel` / `reroll` / `replace` / `setup` runs key giveaways.\n`/server promos` `list` shows drops like SteelSeries or NVIDIA (managers: `add` / `end` / `channel` / `ping` / `news`)." }
        ] },
    { key: "music", label: "Music", emoji: "🎵", title: "/music, /play and /player",
        description: "SoundCloud songs, playlists and live radio in your voice channel. Join one first. `/player` opens the big player on the web: queue, search, radio, a live visualizer, a session chat and a Stream tab for OBS.",
        fields: [
            { name: "Start something", value: "`/play` (or `/music play`) a link or words. `/music search` picks from results. `/music live` lists stations on the air right now." },
            { name: "Controls", value: "`nowplaying`, `queue`, `pause`, `resume`, `skip`, `skipto`, `previous`, `seek`, `stop`, `leave`, `volume`, `loop`, `shuffle`, `remove`, `move`, `clear`." },
            { name: "Playlists", value: "`saveplaylist`, `loadplaylist`, `playlists`, `deleteplaylist` (yours, any server)." },
            { name: "Auto DJ", value: "`/music autodj` `submit` a request (no voice needed), `requests` to see them, `setup` (managers) picks the playlist, channel and idle time. It plays when nobody has queued anything." },
            { name: "Managers", value: "`/music settings` sets the DJ role, volume, limits, announcements and whether radio links are allowed. Turn on `stay` and the bot waits in its last voice channel, then goes back to the last live station (or the Auto DJ) when someone joins." }
        ] },
    { key: "manage", label: "Manage and community", emoji: "🛠", title: "/manage  ·  /mod",
        description: "Needs Manage Server (or the moderator role for `/mod`).",
        fields: [
            { name: "Setup", value: "`/manage setup` is a guided setup. `/manage community` `setup` builds the usual channels, roles, welcome and XP; `welcome`, `autorole`, `verifyrole`, `xp`, `levelrole`, `referral`, `status` tune it." },
            { name: "Alerts and extras", value: "`/manage alertchannel` `set` / `clear` / `show` / `feed` / `hot` / `sales` / `digest` / `group` picks where alerts go. `/manage emoji` `import` (emoji or picture links from anywhere) / `list` / `packs` (browse emoji.gg packs and import one) adds emoji. `/manage leaderboardrefresh` updates #leaderboard." },
            { name: "Auto memes", value: "`/manage memes` `setup` picks the memes channel, how often (every 1 to 24 hours) or turns it off, `now` posts one right away. Servers set up with the community setup get it on automatically in #memes." },
            { name: "Moderation", value: "`/mod` `warn` / `warnings` / `clearwarns` / `timeout` / `untimeout` / `kick` / `ban` / `unban` / `purge` / `cases` / `log`. Every action is logged in #mod-log." }
        ] },
    { key: "bot", label: "Bot and support", emoji: "🤖", title: "/bot",
        description: "Questions, problems and ideas.",
        fields: [
            { name: "Help", value: "`/bot support` `open` / `mine` / `setup` asks the team. `/bot bug` reports a problem to the bot owner. `/bot feature` `request` / `list` / `vote` for ideas." },
            { name: "About", value: "`/bot status` shows bot health. `/bot changelog` shows what is new. `/bot about` and `/bot privacy` explain what it does with your data. `/bot grabberad` is for the owner." },
            { name: "Website", value: "`/dashboard` links the dashboard, and opens a page if you pick one." }
        ] }
];
export const HELP = HELP_PAGES.map(p => [p.title, p.description, ...p.fields.map(f => f.name + " " + f.value)].join("\n")).join("\n\n");

export const ABOUT = [
    "Steam Value Checker tells you what your game library is worth: the full price, what Steam charges now, the cheapest price across the stores it tracks, and how much you saved if you tell it what you paid.",
    "",
    "Prices come from [IsThereAnyDeal](https://isthereanydeal.com). It works with exports from the FanaticalGrabber browser extension, and it can keep an eye on your wishlist for sales.",
    "",
    "I'm not affiliated with Valve, Steam, Fanatical or IsThereAnyDeal. Prices move fast, so what you see in a store might not match."
].join("\n");

export const PRIVACY = [
    "**What the bot reads:** the game titles you type or upload, the region you pick, and the amount you enter for `paid`.",
    "**What it never needs:** Steam or Fanatical logins, cookies or passwords. Anything that looks like a key is dropped before any lookup. The one exception is giveaways: a server manager can enter prize keys in a private form, and they are stored encrypted until the winner confirms (then deleted).",
    "**Where titles go:** game titles are sent to IsThereAnyDeal to get prices. Nothing else is sent.",
    "**Storage:** `/games value` saves nothing. Prices are cached in memory for 30 minutes and results are not logged. Your reply is visible only to you.",
    "**Wishlist alerts and library:** if you use them, the bot stores your Discord ID, wishlist, alert rules, settings, library and what you paid, 90 days of alert history, server list votes and (if you import or link) your public Steam ID and playtime, an optional hashed FanaticalGrabber link code, any looking-for-group posts, friend nicknames with a birthday month and day (only if you add them). Sharing with your server (group alerts, leaderboard) is off until you opt in. It sends alerts by DM, or in the server alert channel if a DM fails or you choose that, where the game name is visible to the channel and you are mentioned. `/me mydata export` and `/me mydata delete` give you control. Support tickets (your messages and the replies) are kept until they have been closed for 6 months, are shared only with the bot owner or, if you chose a server, that server's staff, and are deleted by `/me mydata delete`. A copy of each alert is kept 60 days in your notification center. If the web dashboard is on, signing in shares only your Discord name, avatar and server list, kept in memory for the session.",
    "",
    "The full text is on the dashboard under Help."
].join("\n");
