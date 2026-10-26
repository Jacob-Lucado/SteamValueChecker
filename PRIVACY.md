# Privacy Policy: Steam Value Checker

Last updated: October 26, 2026 (wishlist alerts added)

Steam Value Checker is a Discord bot that prices a list of games and, if you choose, watches your wishlist and tells you when a game goes on sale. This page explains what it does with your data.

**`/value` stores nothing. Wishlist alerts store the data listed under Storage, and only if you use `/wishlist`.**

## What the bot receives

- The game titles you type, or the titles in a file you upload.
- The region, store, sort and `paid` options you choose.
- Your Discord user ID. For `/value` it is held in memory only, to enforce a short cooldown and let you page through your own results. If you use wishlist alerts it is stored (see Storage).

## What the bot does not want

- **Game keys.** Anything that looks like a product key is discarded before any lookup. Please do not post keys.
- **Passwords, cookies or logins** for Steam, Fanatical or any other service. The bot never asks for them. Wishlist import reads only a **public** Steam wishlist.

## What it does with the data

- Game titles (and game IDs for wishlist alerts) are sent to **IsThereAnyDeal** (isthereanydeal.com) to look up prices. Their [privacy policy](https://isthereanydeal.com/privacy/) applies to that request. Nothing about you, other than the titles or game IDs, is sent.
- When you run `/wishlist import`, the bot asks **Steam** (steampowered.com and steamcommunity.com) for the public wishlist of the profile you gave. Steam's own policies apply to that request.
- Results are shown only to you (ephemeral replies) and are returned as an embed and a CSV file in that reply.

## Storage

**`/value`**: nothing is stored. Prices are cached in memory for about 30 minutes and cleared when the bot restarts.

**Wishlist alerts**: if you use `/wishlist`, the bot keeps a small database (SQLite) on the machine that runs it. It contains:

- Your Discord user ID.
- The ID of the server where you last used a wishlist command (so the bot knows which server's alert channel to use).
- Your wishlist: game titles, price-service game IDs, whether each came from Steam or was added by hand, your alert rule for each game, and the last price the bot alerted you about (to avoid repeat alerts).
- Your Steam profile ID (SteamID64), only if you imported a Steam wishlist. It is a public identifier.
- Your settings: region, store filter, delivery choice (DM or channel), whether alerts are paused, and a count of failed DM attempts.

For server admins: the alert channel ID you set with `/alertchannel`, and the ID of the admin who set it.

Your data is kept until you delete it with `/mydata delete`. Removing the bot from a server clears that server's alert channel. `/mydata export` gives you a copy of everything stored about you.

User input and results are never written to logs. Error logs contain only technical error messages.
Discord keeps your messages and the bot's replies according to Discord's own policies.

## How alerts reach you

- **Direct message by default.** If you use wishlist alerts, the bot will message you without being asked each time. Pause them with `/alerts pause`, or delete your data with `/mydata delete`.
- **Server channel as a fallback, or by choice.** If a DM cannot be delivered, or you choose channel delivery with `/alerts delivery`, the alert is posted in the alert channel a server admin set. **Everyone who can see that channel can see the game name, and you are mentioned.** If no channel is set, a failed DM is not delivered and the bot tries again on its next check.

## Sharing

The bot does not sell, share or transfer your data, other than the titles or game IDs sent to IsThereAnyDeal and the profile lookup sent to Steam, as described above.

## Your control

- `/mydata export` downloads everything stored about you.
- `/mydata delete` deletes it all.
- `/alerts pause` stops alerts but keeps your list.
- `/value` stores nothing, so there is nothing to delete for it. You can remove the bot from your server at any time.

## Contact

Questions: [Jacob Lucado on X](https://x.com/twit_user69).

## Changes

If this policy changes, the date above will be updated.
