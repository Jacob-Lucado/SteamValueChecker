# Privacy Policy: Steam Value Checker

Last updated: October 26, 2026 (wishlist alerts added)

Steam Value Checker is a Discord bot that prices a list of games and, if you choose, watches your wishlist and tells you when a game goes on sale. This page explains what it does with your data.

**`/value` stores nothing. Wishlist alerts store the data listed under Storage, and only if you use `/wishlist`.**

## What the bot receives

- The game titles you type, or the titles in a file you upload.
- The region, store, sort and `paid` options you choose.
- Your Discord user ID. For `/value` it is held in memory only, to enforce a short cooldown and let you page through your own results. If you use wishlist alerts it is stored (see Storage).

## What the bot does not want

- **Game keys in chat.** Anything that looks like a product key is discarded before any lookup. Please do not post keys. (Giveaways are the one exception: see below.)
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
- Your settings: region, store filter, delivery choice (DM or channel), whether alerts are paused, a count of failed DM attempts, quiet hours and time zone, weekly digest choice, bundle alert choice, free game alert choice, and whether you opted in to sharing with your server.
- If you use the library: the games you add, what you paid for each (only if you enter it), and one daily snapshot of the totals (number of games, total paid, total MSRP, cheapest price) used for the value chart and leaderboard.
- If you link Steam with `/steam link`: your public SteamID64 and, for each game you own, its Steam app ID, minutes played, when it was last played and, if the bot has a Steam API key, how many achievements you have unlocked of the total (used to mark a game Finished at 100%). The bot reads only what your public profile shows and never asks for a login. `/steam unlink` removes the link (and, if you choose, the games it added).
- If you use the FanaticalGrabber extension's send button: a SHA-256 hash of your link code, when it was made and last used, and how many sends. The code itself is never stored. `/library grabber action:off` deletes it. The extension sends game titles only, never keys.
- If you post with `/lfg`: the post (game, time, slots), who joined, and the Discord event ID if one was made. Posts are removed shortly after they close.
- Your alert history: what was sent, when, the price and how (DM or channel). It is deleted after 90 days.
- If you use a server's shared list: the games you suggested and your votes.
- A note of which bundles, giveaways and free games you were already told about, so you are not told twice (deleted after 120 days).

For server admins: the alert channel ID you set with `/alertchannel`, and the ID of the admin who set it.

**Server sharing is off by default.** If you opt in with `/alerts share` (or on the dashboard), other members of the server may see your name in a group alert (\"3 members are watching...\") and on the leaderboard, with your number of games and the percent you saved against MSRP. They never see your wishlist, what you paid or any prices you entered. Opt out at any time.

**Server shared list:** games added to `/serverlist` and the votes on them are visible to everyone in that server.

**Backups:** the bot owner may keep daily copies of the database (the last 7 by default). They hold the same data as above, so deleted data can remain in a backup until it rotates out, up to 7 days.

**Owner statistics:** the bot owner can see totals (how many members, how many games, how many alerts) but not who watches what.

Your data is kept until you delete it with `/mydata delete`. Removing the bot from a server clears that server's alert channel. `/mydata export` gives you a copy of everything stored about you.

User input and results are never written to logs. Error logs contain only technical error messages.
Discord keeps your messages and the bot's replies according to Discord's own policies.

## Giveaways

If a server manager runs a giveaway, the bot stores: the giveaway settings, your Discord user ID if you enter, who won each prize and its status, and the prize keys the manager entered. Keys are **encrypted** and are deleted once the winner confirms, when the giveaway is cancelled or the key is returned to the host, or automatically after a retention period (delivered keys after 14 days, leftover keys 7 days after the giveaway ends). Keys are sent only to the winner by DM or in a reply only they can see. When a winner confirms, a vouch message naming the winner is posted in the server. Giveaway records are removed 90 days after they finish, and `/mydata delete` removes your entries.

**Error log**: the bot keeps recent error and crash messages (with the time) in memory and in a small file next to the database, so the bot owner can read them on the dashboard's Admin page. Tokens and keys are masked. Error messages can occasionally mention a Discord ID or command name.

## The web dashboard

If the bot's owner turns on the dashboard, you can sign in with Discord instead of using commands.

- **What Discord shares:** the `identify` and `guilds` scopes, which give the dashboard your Discord ID, name, avatar and the list of servers you are in (with your permissions there, to know where you can set an alert channel). No email, no messages, no passwords.
- **What is kept:** your name, avatar link and server list are held **in memory only** for your session (7 days at most) and are lost when the bot restarts. Discord's access token is used once at sign-in and then discarded. The wishlist and settings you create are stored exactly as described under Storage.
- **Cookies:** one strictly necessary cookie that keeps you signed in, and a short-lived one used during sign-in. There is no tracking or analytics.
- **Alert channels:** when a server admin chooses an alert channel on the dashboard, the bot posts a short confirmation there.

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


## Newer features

- **Public wishlist page:** off by default. When you turn it on, anyone with the link can see your game names, artwork and today's best prices. Nothing else, and never your Discord account. Turn it off any time with `/publicpage enabled:false`.
- **Backlog status:** the status you set on library games (backlog, playing, finished, dropped) is stored with your library and deleted with `/mydata delete`.
- **One-off watches:** a game added with `/watch` is stored like a wishlist game and removed after its alert or after 30 days.
- **Server stats:** numbers for members who opted in with `/alerts share`. Counts and totals only; nobody is named for what they want.
- **Status history:** the bot stores per-day uptime counts and a short log of outages. Nothing about people.

## Support tickets, notifications and language
- **Tickets:** what you write in a ticket and the replies are stored with your Discord ID and name. They are visible to you, to the bot owner, and, if you picked a server that set up a ticket channel, to that server's staff. Never put a game key in a ticket; staff cannot see giveaway keys. Closed tickets are deleted after 6 months, and `/mydata delete` removes yours. `/mydata export` includes them.
- **Notification center:** a copy of the title and short text of each alert sent to you, kept 60 days, only visible to you.
- **Settings:** muted alert types, language and the last "what's new" you saw.
- **Voice channels:** for `/gamenight` and the optional game night nudges the bot checks who is in a voice channel at that moment. It never records voice, audio or how long anyone was there, and only members who opted in with `/alerts share` are used.
