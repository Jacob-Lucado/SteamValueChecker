<div align="center">

<img src="branding/steam-value-checker-banner-1360x480.png" alt="Steam Value Checker" width="680">

# Steam Value Checker

**See what your game library is worth, and what you saved.**

![Node](https://img.shields.io/badge/node-%E2%89%A518.17-107c41)
![discord.js](https://img.shields.io/badge/discord.js-v14-5865f2)
![Tests](https://github.com/Jacob-Lucado/SteamValueChecker/actions/workflows/test.yml/badge.svg)

</div>

---

## What it does

Send the bot a list of game titles, or upload an export from the [FanaticalGrabber](https://github.com/Jacob-Lucado/FanaticalGrabber) browser extension, and it replies with:

| Column | Meaning |
| --- | --- |
| **MSRP** | The regular price |
| **Steam** | The current Steam price |
| **Cheapest** | The lowest current price across tracked stores, with the store name |
| **All-time low** | The lowest price ever recorded (shown in the totals) |

Tell it what you paid and it works out what you saved against each of those.

Prices come from [IsThereAnyDeal](https://isthereanydeal.com).

> The bot **never needs game keys, Steam logins or cookies.** Anything that looks like a key is thrown away before any lookup. Replies are visible only to the person who ran the command.

## Commands

### `/value`

| Option | What it does |
| --- | --- |
| `titles` | Game titles separated by `;` or new lines |
| `file` | A FanaticalGrabber export: `.csv`, `.json`, `.txt` or `.md`. Only the game titles are read |
| `paid` | What you paid in total, to see savings and cost per game |
| `region` | US, UK, Germany, Canada, Australia or Brazil prices |
| `stores` | Count every tracked store (including key sites), or major stores only, for "cheapest now" |
| `sort` | As entered, name, MSRP or cheapest price |

Examples:

```
/value titles:Hades; Celeste; Hollow Knight
/value file:FanaticalGrabber_2026-10-26.csv paid:25 region:GB
```

### `/help`, `/about`, `/privacy`

Usage notes, credits and a plain-language privacy summary.

## Paid vs value

When you give an amount the bot adds:

- **Savings against four benchmarks:** MSRP, Steam now, cheapest now and all-time low, as an amount and a percentage. A negative result is shown as "extra" so overpaying is obvious.
- **Cost per game.**
- **A one-line verdict**, such as "You paid 31% of MSRP."
- **Per-game detail** when your CSV has a `Paid` column: your best deals, and games that are cheaper somewhere else right now.

A bundle price works as a single `paid` total. For per-game amounts, add a `Paid` column to the CSV before uploading. If you give both, the typed total wins.

## Results

- **15 games per page** with Previous / Next buttons, so big lists don't flood the channel.
- **A CSV download** of the full table, ready for a spreadsheet.
- Up to **100 titles** per request, with a short cooldown per user.
- Approximate title matches are marked with `~`, and games the bot can't match show as "not found".

## Setup

You need Node 18.17 or newer, a Discord application, and an IsThereAnyDeal API key.

1. **Create the Discord app** at the [Developer Portal](https://discord.com/developers/applications). Add a Bot, copy its token, and leave every Privileged Gateway Intent off. The bot only uses slash commands.
2. **Get an ITAD key** at [isthereanydeal.com/apps/my](https://isthereanydeal.com/apps/my/).
3. **Install:**
   ```bash
   git clone https://github.com/Jacob-Lucado/SteamValueChecker.git
   cd SteamValueChecker
   npm install
   ```
4. **Configure:** copy `.env.example` to `.env` and fill in `DISCORD_TOKEN`, `CLIENT_ID`, `ITAD_API_KEY`, and optionally `GUILD_ID` for instant command updates on a test server.
5. **Invite the bot** using the link on the app's **Installation** tab, with the scopes `bot` and `applications.commands` and no extra permissions.
6. **Register the commands and start:**
   ```bash
   npm run register
   npm start
   ```

The bot has to keep running to answer. A small VPS, Railway, Fly.io or a spare PC works. There is no database to set up.

### Development

```bash
npm test
```

The tests cover input parsing, price summarising, the savings math, rendering limits and the ITAD client (with a fake `fetch`), and need no Discord token or API key.

```
src/
  index.js      Discord client and the /value flow
  commands.js   Slash command definitions
  register.js   Registers the commands with Discord
  parse.js      Reads titles from typed text or an export; drops anything key-shaped
  itad.js       IsThereAnyDeal client: lookup, fuzzy matching, prices, cache, retries
  report.js     Rows, totals and the paid-vs-value comparison
  render.js     Embeds and the CSV download
  text.js       /help, /about and /privacy copy
test/           node:test suites
branding/       Logo and banner
```

## Privacy

Nothing is stored. Game titles are sent to IsThereAnyDeal to get prices, prices are cached in memory for 30 minutes, and user input is never written to logs. See [PRIVACY.md](PRIVACY.md) and [TERMS.md](TERMS.md).

## Known limits

- **Prices are estimates.** They are whatever IsThereAnyDeal tracked recently and can differ from a store's page.
- **"Cheapest now" can come from key-reseller sites.** Use `stores:major` to limit it to major stores.
- **Title matching can be wrong.** Fuzzy matches are marked with `~`. Check them before trusting the totals.
- **Unmatched games are left out of the totals,** while `paid` covers everything you entered. The bot notes this when it happens.
- The ITAD endpoints and field names follow ITAD's public documentation. If ITAD changes its API, the table shows `-` for fields it can't find.

## Credits

Price data by [IsThereAnyDeal](https://isthereanydeal.com). Not affiliated with or endorsed by Valve, Steam, Fanatical or IsThereAnyDeal. Steam is a trademark of Valve Corporation.

Made by [Jacob Lucado](https://x.com/twit_user69).
