// Copy for /help, /about and /privacy. Kept in one place so the README, PRIVACY.md and the bot agree.

/** Shown once, after a person's first command: where to start. */
export function quickStart(dashboardUrl = null) {
    return {
        color: 0xff9800, title: "Welcome! Three good places to start",
        description: [
            "1. **Watch games:** `/wishlist import` brings in your public Steam wishlist, and I tell you when something goes on sale.",
            "2. **Price your games:** `/steam link` fills your library with hours played and what it is worth.",
            "3. **See everything:** `/help` lists every command" + (dashboardUrl ? `, and the dashboard has a guided tour: ${dashboardUrl}/#/mypage` : ".")
        ].join("\n"),
        footer: { text: "You will only see this once." }
    };
}

export const HELP = [
    "**Every command** (`/help`). Most work in a DM too. Replies are private. Never post game keys in chat or a ticket.",
    "",
    "**Prices and wishlist**",
    "• `/value` prices a list of games (typed, or a FanaticalGrabber export in `file`): MSRP, Steam price, cheapest now, and savings if you give `paid`.",
    "• `/wishlist` `import` (your public Steam wishlist; uses the Steam account you signed in with), `add`, `remove`, `view`, `check` (a good deal now?), `alert` (sale, % off, price or all-time low), `priority`, `cleanup` (drop games you own).",
    "• `/watch` watches one game for a price drop without adding it to your wishlist.",
    "• `/regions` ranks one game's price across regions. `/currency` picks the currency (also used on the dashboard).",
    "• `/bundle` says if a bundle is worth it. `/saleprep` `plan` / `recap` readies your wishlist for a sale or shows what alerts caught.",
    "• `/sales` shows upcoming Steam sales with countdowns. `/freegames` lists what is free to claim now on Steam, Epic, GOG and others.",
    "• `/friend` `add` / `list` / `deals` / `remove`: friends' birthdays and sales on their wishlists. `/publicpage` makes a shareable wishlist page.",
    "",
    "**Alerts**",
    "• `/alerts` `status`, `delivery` (DM or channel), `pause` / `resume`, `region`, `stores`, `quiethours`, `digest` (weekly), `mindiscount`, `bundles`, `freegames`, `mute`, `language`, `share` (opt in to boards and comparisons) and `history`.",
    "",
    "**Library and Steam**",
    "• `/library` `add`, `import`, `remove`, `view` (value and savings; a `*` marks a gift), `status` (backlog, playing, finished), `backlog` (play next), `spend`, `trend`, `challenge`, `badges`, `bundle` / `bundles`, `grabber` (link code for the FanaticalGrabber extension).",
    "• `/steam` `link` (sign in through Steam on the dashboard and it links itself), `sync`, `view`, `next`, `foryou` (deals picked for you), `verify` (Steam Verified role), `value`, `taste`, `recap`, `goal`, `unlink`: hours played, what you never played and what it is worth.",
    "• `/profilecard` makes a shareable picture of your profile. `/compare` lines your library up against a friend who opted in.",
    "• `/redeem` queues Steam keys; press Run on the dashboard's Batch redeem page and the results come back as a DM.",
    "",
    "**Servers**",
    "• `/serverlist` `add` / `view` / `vote` / `remove`: a wishlist your server shares. `/leaderboard` and `/serverstats` show boards and numbers for members who opted in.",
    "• `/gamenight` (in voice) shows what everyone owns and what to buy together. `/lfg` `post` / `list` / `close` finds players. `/calendar` `view` / `add` / `remove` / `feed` shows releases, sales and events.",
    "• Managers: `/setup` is a guided setup. `/alertchannel` `set` / `clear` / `show` / `feed` / `hot` / `sales` / `digest` / `group` picks where alerts go. `/giveaway` `create` / `list` / `info` / `end` / `cancel` / `reroll` / `replace` / `setup` runs giveaways.",
    "",
    "**Community**",
    "• `/rank` your level and place. `/levels` the top members. `/invites` `me` / `top` / `link` shows who joined through you and gives you an invite link.",
    "• Managers: `/community` `setup` builds the usual gaming-server channels, roles, welcome and XP; `welcome`, `autorole`, `verifyrole`, `xp`, `levelrole`, `referral`, `status` tune it. `/emoji` `import` / `list` adds emoji. `/leaderboardrefresh` updates #leaderboard.",
    "• Moderators: `/mod` `warn` / `warnings` / `clearwarns` / `timeout` / `untimeout` / `kick` / `ban` / `unban` / `purge` / `cases` / `log`. Actions are logged as cases in #mod-log.",
    "",
    "**Help and your data**",
    "• `/support` `open` / `mine` / `setup` asks the team for help. `/bug` reports a problem to the bot owner. `/changelog` shows what is new. `/dashboard` (or `/dash`) links the website. `/grabberad` is for the bot owner.",
    "• `/mydata` `export` / `delete` your stored data. `/status` shows if the bot is healthy. `/about` and `/privacy` explain the bot and your data.",
    "",
    "`/serverlist`, `/leaderboard` and `/serverstats` use the server you last used the bot in; `/giveaway`, `/setup`, `/gamenight`, `/lfg` and `/mod` only work in a server. The bot ignores anything that looks like a key outside the private giveaway form."
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
    "**Wishlist alerts and library:** if you use them, the bot stores your Discord ID, wishlist, alert rules, settings, library and what you paid, 90 days of alert history, server list votes and (if you import or link) your public Steam ID and playtime, an optional hashed FanaticalGrabber link code, any looking-for-group posts, friend nicknames with a birthday month and day (only if you add them). Sharing with your server (group alerts, leaderboard) is off until you opt in. It sends alerts by DM, or in the server alert channel if a DM fails or you choose that, where the game name is visible to the channel and you are mentioned. `/mydata export` and `/mydata delete` give you control. Support tickets (your messages and the replies) are kept until they have been closed for 6 months, are shared only with the bot owner or, if you chose a server, that server's staff, and are deleted by `/mydata delete`. A copy of each alert is kept 60 days in your notification center. If the web dashboard is on, signing in shares only your Discord name, avatar and server list, kept in memory for the session.",
    "",
    "The full text is on the dashboard under Help."
].join("\n");
