// Copy for /help, /about and /privacy. Kept in one place so the README, PRIVACY.md and the bot agree.

export const HELP = [
    "**Price a game library**",
    "`/value titles:Hades; Celeste; Hollow Knight` or `/value file:` with a FanaticalGrabber export.",
    "",
    "**Options**",
    "• `file`: the CSV, JSON, TXT or Markdown export from the extension. Only the game titles are read.",
    "• `paid`: what you paid in total. Adds savings against MSRP, Steam's current price, the cheapest price now and the all-time low.",
    "• `region`: which country's prices to use.",
    "• `stores`: count every tracked store (including key sites) or major stores only for \"cheapest now\".",
    "• `sort`: order of the table.",
    "",
    "**Per-game amounts:** if your CSV has a `Paid` column, the bot uses it and shows what you paid for each game.",
    "",
    "**Wishlist and sale alerts**",
    "• `/wishlist import` reads your **public** Steam wishlist (no login). `/wishlist add` adds a game by title.",
    "• `/wishlist view` shows current prices. `/wishlist alert` sets when you are alerted: any sale, a % off, a price, or an all-time low.",
    "• Alerts come by **DM**. If a DM fails, or you pick channel delivery with `/alerts delivery`, they go to the server's alert channel and mention you. Server admins set it with `/alertchannel set`.",
    "• `/alerts` has pause, region and store settings. `/mydata` exports or deletes everything stored about you.",
    "",
    "Replies are private to you. Never post game keys in Discord. The bot ignores anything that looks like a key."
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
    "**What it never needs:** game keys, Steam or Fanatical logins, cookies or passwords. Anything that looks like a key is dropped before any lookup.",
    "**Where titles go:** game titles are sent to IsThereAnyDeal to get prices. Nothing else is sent.",
    "**Storage:** `/value` saves nothing. Prices are cached in memory for 30 minutes and results are not logged. Your reply is visible only to you.",
    "**Wishlist alerts:** if you use `/wishlist`, the bot stores your Discord ID, wishlist, alert rules, settings and (if you import) your public Steam ID. It sends alerts by DM, or in the server alert channel if a DM fails or you choose that, where the game name is visible to the channel and you are mentioned. `/mydata export` and `/mydata delete` give you control.",
    "",
    "Full text: https://github.com/Jacob-Lucado/SteamValueChecker/blob/main/PRIVACY.md"
].join("\n");
