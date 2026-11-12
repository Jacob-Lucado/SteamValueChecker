// What's new. Newest first. The dashboard shows a banner for the newest entry until it is dismissed, and /bot changelog lists them.
export const CHANGELOG = [
    { version: "2026.11.62", date: "2026-11-12", title: "Proof screenshots for giveaway winners", items: [
        "**Add proof:** after a winner confirms their prize they can reply to the bot's DM with a screenshot within 30 minutes. It is posted in the vouches channel and the host is told.",
        "**Fixed:** giveaway problems (like not being able to post the winners) were not being reported to the server's problem list."
    ] },
    { version: "2026.11.61", date: "2026-11-12", title: "Sharper prices, Steam Family and server switches", items: [
        "**Exact matches:** paste a Steam store link in /games value instead of a title and it is always the right game. When a typed title is matched wrong, /games fixmatch (or the Fix button on the dashboard) teaches the bot once and it remembers.",
        "**Bigger wishlists:** lists now hold 500 games and a Steam import reads 400.",
        "**Bundle links:** /games bundle takes a link to a Humble, Fanatical, IndieGala or Steam bundle page, not just a game name.",
        "**Steam Family:** add your family with /me steam family (or on the Steam page). Sale alerts for games they already own are held, and bundle checks count those games as owned.",
        "**More on every game:** players in the game right now, and where the bot has the data, hours to finish and the critics' score, on alerts, the check card and game pages.",
        "**The bot's own price history:** every price it sees is noted once a day, so charts and buy-or-wait advice keep working when the price site's history is down.",
        "**Server switches:** /manage features (and the Setup page) turns whole areas off for a server: music, moderation, giveaways, levels, game nights, streams, the fun stuff, and codes and drops.",
        "**Stay signed in:** updating the bot no longer signs everyone out of the dashboard.",
        "**Fixed:** the sale calendar had the Autumn Sale in the wrong month, which skewed buy-or-wait advice."
    ] },
    { version: "2026.11.60", date: "2026-11-12", title: "Stats, milestones and setup preview", items: [
        "**In numbers:** a public stats page at /stats shows the bot's size and which listed servers played the most this week.",
        "**Milestones in your server:** /manage community milestones posts members' playtime milestones (100, 250, 500 hours and up) in a channel. Only members with a public page are shown.",
        "**Setup preview:** /manage community setup with preview on lists what would be added and changes nothing.",
        "**Sale heads-up:** a game page now says when a Steam sale is close and the game has been cheaper before."
    ] },
    { version: "2026.11.59", date: "2026-11-12", title: "Wrapped, server tools and push", items: [
        "**Steam Wrapped:** /games steam wrapped (or Library > Wrapped) makes five shareable slides from your year: hours, top games, streaks, genres and your gamer type.",
        "**Server tools:** role menus with buttons (/manage rolemenu), a starboard, polls that close themselves (/manage poll), a suggestion box (/server suggest) and custom commands (/server tag). All of it is on the new Servers > Server tools page.",
        "**Store link replies:** turn on link replies in /manage community and a Steam store link in chat gets a card with the best price and a buy-or-wait verdict.",
        "**Moderation:** temporary bans that lift themselves (/mod ban length:7d), warnings that expire, /mod stats, and ban appeals people can file at /appeal. Moderators answer them on the Moderation page.",
        "**Browser notifications:** turn them on under Alert settings and price alerts show up on that device, even with Discord closed.",
        "**Ctrl+K:** now jumps to any page, with arrow keys and Enter, as well as searching.",
        "**Game pages:** Steam Deck and ProtonDB badges, and a price card you can embed on a stream overlay or website."
    ] },
    { version: "2026.11.58", date: "2026-11-12", title: "More moderation", items: [
        "**Auto-moderator:** the bot can now watch for message spam, mass mentions, Discord invite links, links outside your allow-list, blocked words and SHOUTING. A message that breaks a rule is deleted, and the person can also be warned or timed out. Staff, chosen roles and chosen channels are never touched. Turn it on in the dashboard's Moderation page or with /mod automod.",
        "**Escalation:** after a set number of active warnings the bot can time the person out, kick them or ban them on its own.",
        "**Raid guard:** if a pile of accounts join in a few seconds, the bot times out or kicks each newcomer for ten minutes and logs it. You can also act on brand-new accounts.",
        "**More mod tools:** /mod note (a private staff note that never reaches the member), /mod slowmode, /mod lock and /mod unlock. They are in the dashboard's action list too, and every one is logged as a case.",
        "**Auto memes:** the meme feed now only uses real meme subreddits and skips photos, questions and showcase posts.",
        "**Needs your attention:** when the bot can't do something in your server (give a role, post the welcome message, write to the mod log) because of a missing permission or a role set too high, the Community page now says so and why, instead of staying quiet."
    ] },
    { version: "2026.11.57", date: "2026-11-11", title: "A tidier menu", items: [
        "**Fewer sections:** the top menu went from 13 sections to 9. Free games, Bundles, Playtests and Codes & promos now sit under Deals with the rest of the money-saving pages.",
        "**Creators:** the indie showcase and dev panel share a section with the streamer pages (Streamer hub, Overlay studio, Go live, Who is live).",
        "**Play together:** Fortnite moved in with Game night, Game club and the other things you do with other people. Every page keeps its old address, so your bookmarks still work.",
        "**New overlays:** the Overlay studio now has Alerts (a pop-up for each new member or boost), a Sale countdown that follows Steam's sale calendar, a Leaderboard of your server's top XP members, Who is playing (members in a game right now), and Scenes that rotate several overlays through one link, and a live Poll: start it from the studio, members vote with buttons or by typing a number in the channel, and the bars move on stream. A Free games overlay lists what you can claim right now, a Best deals overlay shows the biggest Steam discounts, a Game price overlay shows one game's best price, lowest ever and a buy-or-wait call, and Alerts can pop up level-ups too. Alerts can play a sound, goal bars throw confetti when they are reached, and every overlay now has nine one-click themes (Glass, Neon, Retro, Steam, Cyber and more). A green dot shows when OBS has an overlay open, and Download an OBS scene sets every overlay up as a Browser source for you.",
        "**Game pages:** every game now has a public page with its price history and a buy-or-wait verdict, and the Price history button on alerts opens it. There is also a Winter Sale countdown at /winter-sale."
    ] },
    { version: "2026.11.56", date: "2026-11-10", title: "Giveaways, playtests and friends", items: [
        "**Leave out a site:** you can now skip itch.io (or Alpha Beta Gamer, GamerPower, Playtester or Steam demos) in playtest alerts. Members do it under Alert settings or /alerts, and each server does it in its playtest settings, so a server can leave a site out even for games its members watch.",
        "**Your birthday:** the profile editor has a Birthday box (month and day only, never shown on your page). Tick the share option and anyone who has your page on their Friends list gets the reminder a week before, without having to type it in. A friend's own entry still wins, and turning sharing off or switching your page off hides it again.",
        "**Playtester labels:** Playtester writes \"Beta\" in the title of every playtest, so they all showed up as Betas. They're now listed as Playtests, and only its demos stay Demos.",
        "**Friends from follows:** when you follow someone's page they land on your Friends list automatically (and everyone you already follow was added once). Unfollowing removes them again unless you set a birthday. Only the birthday is left to add, right on the row, and you get the reminder a week before. The list now holds up to 100.",
        "**Save all on Setup:** the channel list on the Server setup page has one Save all button instead of a Save per row, and saving no longer reloads the page.",
        "**Giveaway channel on Setup:** the Server setup page now has a Giveaways row under Games and deals. Pick the channel where network-wide giveaways from the bot owner are posted in your server (the alert channel is used if you leave it empty).",
        "**Playtester, all of it:** Playtester only hands out its 50 newest listings per feed, so I now read its main feed, the demo and playtest feeds, and one feed per genre. Nothing it lists ages off the Playtests page, and each game shows its genre tags.",
        "**Genre filters:** the Playtests page has a genre picker, and server managers can limit Playtester's full feed to the genres they want (games your members have on a wishlist always post).",
        "**Giveaway outcomes:** the giveaway lists on the dashboard and the admin panel now have a Prizes column saying what became of each prize: claimed, waiting on a winner (and whether they could be reached), or no winner.",
        "**Giveaway winners in other servers:** if a winner's DMs are closed, I now ping them in the channel they entered from (their own server) before trying the host's. The host gets a message right away when nobody could reach the winner, and the Waiting to be claimed panels show whether each winner was reached.",
    ] },
    { version: "2026.11.55", date: "2026-11-10", title: "Fortnite extras and licenses", items: [
        "**Buy links:** every Fortnite item has a Buy in the Fortnite shop button and a Copy link button, and the link opens Fortnite's shop with creator code LUCADO already applied.",
        "**Treasure tab:** per-chest odds, the Treasure Hour boosts, and the weekly Treasure Hunters prizes, with this week highlighted.",
        "**Licenses page:** credits for the services and data the site uses, trademark notes, and the license for every library it's built on. It's laid out like the terms and privacy pages, and linked from About and the footer.",
        "**Desktop theme preview:** the home page now shows what LucadoOS looks like, with a Try the desktop button (or a Back to the classic site button if you are already on it). First-time visitors on a wide screen also get a small one-time note that it exists.",
        "**Tab names:** in the desktop theme the browser tab now says Steam Value Checker instead of LucadoOS.",
        "**Section tabs on the desktop:** pages in desktop windows now show their section's row of tabs, like My servers, Setup and Community, so you can move between them without going back.",
        "**Server setup, channel by channel:** the Setup page has a new Every channel the bot posts in section. Announcements, rules, welcome, member log, moderation log, level-ups, leaderboard, playtests, indie showcase, squad-ups, live streams, memes and the AI channel each get their own picker, with what it posts and what happens if you leave it empty.",
        "**Admin desktop:** pin pages to the Start menu and put icons for your most-used pages on the desktop, like the dashboard.",
        "**Fake sales filtered out:** deals where a high sticker price is \"cut\" to a few dollars (a common trick to look like a steal) are now left out of the weekly roundup, hot deals and For You unless the game has a real number of Steam reviews.",
        "**Weekly deals page:** the link in Friday's X and Discord posts now opens a page listing every deal with its price and its own link to the store, instead of the general feed. The admin Weekly best deals panel links to the same page.",
        "**Names next to Discord IDs:** anywhere the admin panel shows a bare Discord ID (Busiest users, votes and more), it now shows the person's name beside it.",
        "**Fixed:** the classic header got its right-hand tools back (search, desktop switch, currency, language, display, your name and Log out, and Sign in when logged out).",
        "**Fortnite page SEO:** /fortnite now has its own title, description, share card and structured data, and writes today's shop out as plain text with your creator code and buy links, so search engines and link previews see it.",
        "**Revenue Estimator:** if Steam is slow to send the review count, it tries again and tells you, instead of saying the game has no reviews.",
        "**Browser tab titles:** the tab now names the page you are on (Library, For you, Help and so on), including the Fortnite tabs and tabs inside a page, instead of keeping the last title.",
        "**Home when signed in:** the bare address and the logo now land on Home instead of the Value Checker.",
        "**Patch note links:** news alerts now open the post on Steam Community, which loads reliably, instead of the Steam News Hub page that sometimes came up blank.",
        "**Giveaways follow up on winners:** winners now get a DM with a Claim prize button the moment they're drawn, a reminder halfway through their window and a last call near the end. You get a DM when a winner is about to run out of time, when they never claim (with who was drawn instead), and when redraws run out. Unclaimed prizes show in the Waiting to be claimed panel in the dashboard and the admin panel, each with a Remind now button, and in the admin Needs your attention list.",
        "**Playtester added:** the playtest and demo alerts now read Playtester's feed too (its demos only alert for wishlisted games). Server admins can pick sources to post in full: under Community, Ping roles, tick Playtester, itch.io, GamerPower or Steam demos and every listing from it goes to the playtest channel, demos included. Turning one on starts quiet so the backlog isn't dumped.",
        "**More playtest sources:** the playtest and demo alerts now also read itch.io's beta, alpha and demo listings (demos only for games on a wishlist), on top of Steam announcements, Alpha Beta Gamer, GamerPower and Steam's new demos." ] },
    { version: "2026.11.54", date: "2026-11-10", title: "Fortnite on the dashboard", items: [
        "**Fortnite page:** the item shop laid out the way the game shows it, with its sections, big and small tiles, rarity colors, V-Bucks prices, new, on sale and leaving soon badges, a countdown to the next shop, and a closer look at anything in it. You can search the shop and filter it by outfits, emotes, bundles, jam tracks and more.",
        "**Also there:** the latest Fortnite news, everything new in the latest update, the island map with its named places, and a search of every cosmetic that shows how often and when it was last in the shop. It's open to everyone, no sign-in needed.",
        "**Creator code:** the Fortnite page shows creator code LUCADO with a copy button and checks that it's live." ] },
    { version: "2026.11.53", date: "2026-11-10", title: "Indie tools fixes", items: [
        "**Steam lookups:** pages that Steam's main lookup refuses, even though they're public, are now found through a second route, so \"no public store page\" should only show when the page really is hidden.",
        "**Names work too:** the tools that fill in from Steam and the rival comparison accept a game's name as well as a link, and more kinds of Steam links are understood.",
        "**Trailer check:** it can play the video you choose again.",
        "**LucadoOS:** the neon waves now show inside full-screen windows, and the Personalize switch turns them on and off.",
        "**Faster LucadoOS:** pages now run right inside their windows instead of each one loading the whole site again, so opening a window is quick and uses far less memory. Windows share what the desktop already loaded, only the window on top loads when your windows come back, and the neon waves sit inside full-screen windows.",
        "**Light mode:** desktop icon names are readable on dark wallpapers now." ] },
    { version: "2026.11.52", date: "2026-11-10", title: "Indie dev panel and LucadoOS upgrades", items: [
        "**Dev panel for indie developers:** once your game is approved you get the **Verified IndieDev** role in every server that has it, and the bot DMs you with a button to open the Dev panel. It has an overview with views, clicks, likes and followers, a request inbox where you approve or decline key requests (one by one or in bulk, with a note back), a key pool the bot hands out automatically, and a news composer for your followers.",
        "**Build my server** adds the Verified IndieDev role. Run it again on an existing server to pick it up, and set it on the Ping roles panel if you like.",
        "**LucadoOS:** windows now open full screen so you can shrink them yourself, the Start menu pins can be removed, reordered by dragging, and reset, and there's a clear ← Classic site button in the taskbar. Signing in with Steam or Discord is in the taskbar, owners get an Admin button, signing out keeps your open windows, and your first visit opens the Home page instead of the Value Checker." ] },
    { version: "2026.11.51", date: "2026-11-10", title: "LucadoOS desktop (beta)", items: [
        "**A desktop for the whole site:** press the 🖥️ button in the top bar to switch to LucadoOS. Every section is an icon, every page opens in its own window, and you can drag, resize, minimize and snap them side by side, with a taskbar and Start menu along the bottom.",
        "**Nothing is lost:** it's the same pages with all the same features, and links still work. Copy the address and it opens the same page. Your open windows come back when you return.",
        "**Make it yours:** the Personalize window has wallpapers (or any color), a switch for the neon waves, and light or dark. The ☀ button in the taskbar flips the theme for the desktop and every open page.",
        "**Classic stays the default.** Switch back any time from the Start menu. LucadoOS needs a wide screen, so phones and small windows always get the classic site." ] },
    { version: "2026.11.50", date: "2026-11-10", title: "Indie showcase for your server", items: [
        "**Build my server** now makes an **Indie showcase** area: #indie-spotlight, where the weekly indie pick is posted every Wednesday, and #indie-games for talking about hidden gems. There are two new self-roles in #roles, **Indie pings** and **Indie dev**.",
        "**Already built your server?** Run Build my server again. It only adds what's missing and leaves everything else alone.",
        "**On the dashboard:** the Ping roles panel has an indie spotlight channel and an Indie ping role, so you can point the weekly pick at any channel you like." ] },
    { version: "2026.11.49", date: "2026-11-09", title: "Free to play until", items: [
        "**Free weekends and trials:** when Steam makes a paid game free to play for a few days, the bot now posts it with the date it ends and a Play free button. It shows up in free game alerts, the server free feed and `/free`, next to the games you can keep.",
        "**Which games:** it watches the games people play most and the ones on sale. A tiny game with its own free weekend can still slip by, so tell us in a ticket if you spot one we missed." ] },
    { version: "2026.11.48", date: "2026-11-09", title: "Bundle pictures and supporter touches", items: [
        "**Bundle pictures:** Steam bundles in the bundles channel show their banner again, and bundles without one use a screenshot of the first game.",
        "**Adult bundles:** they're left out by default. Server managers can switch them on with `/server promos bundles adult:true` or from the Game bundles panel on the dashboard.",
        "**Several streaming sites at once:** link your Twitch, Kick and YouTube channels together. The bot notices when you go live on any of them and makes one post that links to each, and it only closes the post once all of them are offline.",
        "**More free games:** IndieGala giveaways now show up with the other freebies.",
        "**Supporters:** pick your own color for your price-alert cards on the Chip in page, and `/bot supporter` shows your pass and what it gives you. The page also says how many founding spots are left." ] },
    { version: "2026.11.47", date: "2026-11-09", title: "Every overlay in one studio", items: [
        "**One Overlay studio:** now playing, giveaway, deals and cards now live next to goal bars, stats and timers, as tabs. The streamer hub and music page just point there.",
        "**Share this deal:** sale alerts have a button that makes a tall picture of the deal, ready to post.",
        "**Gift a pass:** buy a supporter pass for a friend from the Chip in page. The first 50 people with a paid pass get a Founding supporter mark for good, and supporters can opt into a thank-you wall.",
        "**Server rivalries:** servers with the weekly digest on get paired once a month and compared on games finished per member.",
        "**You both want:** right-click someone, choose See their wishlist, and the games on both your lists show up at the top.",
        "**Smaller things:** Ctrl+K opens search on the dashboard, locked supporter themes can be previewed, and the owner is no longer held back by cooldowns or blocks." ] },
    { version: "2026.11.46", date: "2026-11-08", title: "A page to chip in", items: [
        "**Overlay studio:** build goal bars, server stats and timers for OBS under Streamers, with a live preview and your own colors, font and size. Each has its own private link.",
        "**Supporter passes:** pay once through Square for 1, 3 or 12 months and get a Supporter role in the server, a glowing profile badge, three exclusive profile themes, 24 overlay slots and 25% more XP. Refunds are handled automatically and you get a heads-up DM before a pass runs out. Everything else stays free.",
        "**Chip in:** a new tab under Help, and a button on `/bot about`, for anyone who wants to help with the hosting costs. Everything stays free either way.",
        "**Library value badge:** if your profile's Library value section is public, it now has a small image link you can paste into a bio or signature." ] },
    { version: "2026.11.45", date: "2026-11-08", title: "Co-op finder, library value and wrapped", items: [
        "**Find your co-op group:** `/server coop` takes a game and shows who in the server owns it, split into people already playing and people who haven't started. Turn on ping to invite them. There's a matching box on the dashboard's Game night page.",
        "**Library value on your profile:** a new profile section shows what your library is worth, what you paid and what you saved. It's off until you turn it on in the profile editor.",
        "**Server wrapped posts itself:** from December 26, servers with the weekly digest on get their year in one picture without anyone running a command.",
        "**Group buy radar:** the Friday digest now lists games several members want, even before they go on sale.",
        "**Top Voter role:** vote for the bot on Top.gg and you get the Top Voter role in the support server for as long as the vote counts."
    ] },
    { version: "2026.11.44", date: "2026-11-05", title: "Vote for the bot, get XP", items: [
        "**Top.gg votes pay out:** vote for the bot on Top.gg and you get 250 bonus XP in every server where you already have XP, double on weekends. Use `/vote` or the dashboard card.",
        "You also get a short thank-you DM with when you can vote again.",
        "**Housekeeping:** pictures on feed posts are cleared after about six months to keep storage small. The post text stays."
    ] },
    { version: "2026.11.43", date: "2026-11-05", title: "Giveaway roles and more free games", items: [
        "**Pick who can enter a giveaway:** require one role, any of several, or all of them, and require Steam Verified so only members who proved their Steam account can enter. Works on server, stream and network giveaways.",
        "**Override roles:** members with your booster role (or any role you choose) skip every requirement. **Bonus roles** decide who gets extra entries, and you can pick several.",
        "**Change the rules after launch** with `/giveaway rules`, or from the dashboard.",
        "**More free games:** Humble, EA app, itch.io and Prime Gaming freebies now show up next to Steam, Epic, GOG and Ubisoft."
    ] },
    { version: "2026.11.42", date: "2026-11-05", title: "A livelier site", items: [
        "**Smooth scrolling** with a mouse wheel, and in-page links glide to their section.",
        "**Pages move:** headlines and buttons arrive one after another, cards fade up as you scroll to them, numbers count up, and there is a progress bar along the top.",
        "**Scroll bars match each page:** purple and cyan on the AI page, orange and blue on FanaticalGrabber, and they follow light or dark mode everywhere.",
        "**Going between pages is a transition**, not a hard cut, and cards glow where your pointer is. All of it switches off if your device is set to reduce motion."
    ] },
    { version: "2026.11.41", date: "2026-11-05", title: "Server wrapped", items: [
        "**Your server's year in one picture:** `/leaderboard` has a new pick, Server wrapped. It shows hours played together, the games your server actually played, who put in the most time and how many games got finished. It only counts members who turned on `/alerts share`, so post it and let people see what joining adds."
    ] },
    { version: "2026.11.40", date: "2026-11-05", title: "Free tools on the website", items: [
        "**Discord timestamp generator:** pick a date, time and zone and copy a code that shows in everyone's own time zone.",
        "**Steam ID finder:** paste a profile link, custom name or any kind of Steam ID and get every format.",
        "**Steam refund calculator:** enter the purchase date and hours played to see if you're still inside the refund window.",
        "**Steam sale dates:** the next sales and festivals with a live countdown."
    ] },
    { version: "2026.11.39", date: "2026-11-05", title: "Easier to find on search engines", items: [
        "**Five new pages** that explain what the bot does in plain words, each with its own questions and answers: Steam library value, game deal alerts, free game alerts, the Steam Verified role and giveaways.",
        "**The home page has real text now** that loads before anything else, so search engines and slow connections see what the site is about."
    ] },
    { version: "2026.11.38", date: "2026-11-05", title: "An AI companion page and a new home page", items: [
        "**The AI companion has its own page** at /ai, with a live chat demo, the pictures it posts and the full list of what it can do. It's marked as a beta, with what to expect and what it won't do.",
        "**A new home page:** the AI spotlight, what's new, and six tabs covering deals, your library, server tools, community, giveaways and streaming, and music."
    ] },
    { version: "2026.11.37", date: "2026-11-05", title: "The AI can do a lot more", items: [
        "**Buy or wait:** ask if a game is worth it and get a verdict with a price-history graph, reviews and the next sale.",
        "**X vs Y:** compare two games side by side in one picture. **Play plan:** tell it how many hours you have and it picks from your library.",
        "**Play together:** games you and a @mentioned friend both own (they have to share their stats in this server).",
        "**Groups and events by chat:** ask it to set up a looking-for-group post, and managers can add server events.",
        "**Price targets:** \"tell me when Hades is under $10\" sets the alert for you.",
        "**It remembers what you like** (a few short notes, ask it to forget any time), and **server managers can write their own guides** for rules, roles and channels in the dashboard; the bot answers them automatically.",
        "**Server setup check** for managers, and ask \"what can you do?\" for a picture of everything."
    ] },
    { version: "2026.11.36", date: "2026-11-05", title: "How-to guides the bot answers by itself", items: [
        "**Ask and get a guide:** when someone in a server asks something like \"how do I get Steam verified\", the bot replies on its own with a card: a short intro, a picture of the numbered steps with the exact commands, and buttons that go straight to the right page. No AI needed.",
        "**Sixteen topics:** Steam Verified, linking Steam, importing a wishlist, sale alerts, free games, where alerts arrive, adding your library, your public profile page, the dashboard, region and currency, getting help, your data, music, finding a group, and levels.",
        "**More guides button:** every guide has a menu with the rest, so people can browse them.",
        "**Not spammy:** it only answers real how-to questions, once per person a minute and once per channel every few minutes. Managers can switch it off with `/manage community ai guides:false` or in the dashboard.",
        "**The AI uses the same guides** when you ask it how to do something, so its answers match."
    ] },
    { version: "2026.11.35", date: "2026-11-05", title: "The AI is plugged into everything", items: [
        "**It knows your stuff:** ask about your rarest achievements, hours played, spending, badges, monthly challenge, alert settings, friend birthdays or what's coming up, and it answers from your real data.",
        "**Deals and plans:** ask for deals that fit you, a sale plan with a budget, bundles for a game, news for your games, or what a game costs in other countries.",
        "**It can do things too:** when you ask, it adds or removes games, stars a wishlist game, sets a game's status, sets your goals, pauses alerts or changes your region, and tells you exactly what it changed.",
        "**Your server:** it can show your level and rank, open group posts and the leaderboard.",
        "**Pictures, not walls of text:** your achievements, library value, Steam hours, spending, trophies and challenge now come back as a picture with big numbers, bars and the achievement icons.",
        "**Missing icons fixed:** pictures now follow Steam's image redirects and fall back to the game's own art, so no more blank tiles. The AI also stops repeating the list in text when a picture shows it.",
        "**Cards that fit the question:** ask about your library, Steam, spending or settings and you get a card that opens that page in your dashboard. Play-next picks only show when you ask what to play."
    ] },
    { version: "2026.11.34", date: "2026-11-05", title: "The AI companion shows its work", items: [
        "**Cards with pictures:** when you ask the AI about a game, it now answers with a card under its message: the game's art, prices, release info and store buttons.",
        "**Buttons that work:** add a game to your wishlist straight from the card, or press Another pick to get a different suggestion from your backlog. They belong to whoever asked.",
        "**Game facts:** ask what a game is or whether it's any good and it reads the Steam page for you.",
        "**Speaks as itself:** answers are first person now and no longer mention things that don't exist."
    ] },
    { version: "2026.11.33", date: "2026-11-05", title: "Profile card, guestbooks, feed alerts, leaderboards and pictures", items: [
        "**Profile card:** `/me profilecard` now draws your profile page itself as a picture: banner, avatar, bio, links and the sections you switched on, in your colors and your order. The old card editor on My page is gone. Design everything on My profile instead.",
        "**Guestbook:** a new section on profile pages where signed-in visitors leave a short note (no links). You can delete any note, close the guestbook, or block someone. Switch it on or off in your page editor.",
        "**Feed alerts:** replies, reactions, new followers and guestbook notes now land in your notifications. Under Feed settings you can also get them on Discord, at most five an hour.",
        "**Leaderboards:** the Communities page shows who has been posting, who finished the most games this month and who holds the most rare achievements, for every server or just one. Only members whose page is on are counted.",
        "**Pictures in posts:** attach one picture to a post. It is shrunk for you, stays on our server, and goes away with the post."
    ] },
    { version: "2026.11.32", date: "2026-11-05", title: "Videos in news posts, a slider for wishlists, a better phone layout", items: [
        "**News with videos:** when a news post or giveaway announcement has a YouTube clip or a video file, the bot now puts the video under the card so you can press play right in Discord. The card gets a Watch the video button too.",
        "**Wishlist slider:** a wishlist on a profile page is now a row of compact cards you swipe through, so a long list no longer makes the page endless.",
        "**Phones:** the profile song player becomes a slim bar along the bottom of the screen with bigger tap targets, and buttons and fields across the dashboard are easier to hit and no longer make the page zoom."
    ] },
    { version: "2026.11.31", date: "2026-11-05", title: "Server feeds and a community directory", items: [
        "**Every server, one community:** the Feed has a new Servers view. Show posts from every server the bot is in at once, or switch to One server and pick a single community. Posts carry a small tag for the server the person is from.",
        "**Communities page:** browse every server connected to the bot with member counts and how many people were active this week, then open any server's feed. Guests can browse too.",
        "**Server managers:** from the Communities page you can hide your server from the directory, write a short blurb and add a Discord invite so people can join.",
        "**Discover by server:** the Discover page can be narrowed to one server to see what that community is playing and who has similar libraries."
    ] },
    { version: "2026.11.30", date: "2026-11-05", title: "A community feed: follow people, post, react, discover", items: [
        "**Feed:** a new Feed menu. Follow people from their page and see what they finish, which rare achievements they unlock and what they post, all on one timeline. Switch between Following, Everyone and your own posts, and tap a game to see who is talking about it.",
        "**Posts, replies and reactions:** write a short post (280 characters, no links), tag a game from your library, reply, and react with 👍 🔥 😂 🎮 ❤️ or 😮. Report anything that is off. Three reports hide a post until the bot owner has looked, and you can block anyone.",
        "**Discover:** games people are into this week, the rarest achievements across public pages, and members whose libraries look like yours.",
        "**On profile pages:** a Follow button with follower counts, a Compare libraries button (for members who show their Steam stats) and a Latest posts section.",
        "**You stay in control:** only pages that are switched on appear in the feed. Turn off finished games and unlocks in the Feed settings, or block people. Your new followers and replies show up in your notifications.",
        "**Weekly digest:** opt in on the Feed page and the bot sends you a weekly rundown of what the people you follow got up to."
    ] },
    { version: "2026.11.29", date: "2026-11-05", title: "Achievements on profile pages, region heads-up for gifts", items: [
        "**Region heads-up for gifts:** when you press \"I'll gift this\" and your Steam region (taken from your synced Steam profile, otherwise your bot price region) is not the list owner's, you get a note before the mark goes through. It says whether the currencies differ, since Steam can block gifts across those, and a reminder stays on the mark.",
        "**Achievements on your profile page:** two new sections for Steam-linked members, styled after Steam. *Rarest achievements* shows your rarest unlocks (held by under 10% of players) as a gold-edged row of icons with your total and rare counts, and *Recent activity* shows the games you played in the last two weeks with hours, last played date, an achievement progress bar and your newest unlocks. Turn them on in the page editor. They fill in after your next Steam sync, and games you played lately are re-checked daily."
    ] },
    { version: "2026.11.28", date: "2026-11-04", title: "Fanatical and Steam bundles, game art that always shows, a nicer radio player, much more translated", items: [
        "**Page backgrounds on profiles:** the space around your profile card can now have a background. Pick a preset, upload your own picture, or copy the background you have equipped on Steam (animated ones too, they play straight from Steam), and dim it so the page stays readable. You can keep up to 3 pictures, and they are cleared if you have not opened the bot or dashboard for 30 days.",
        "**SoundCloud songs match the rest:** a SoundCloud profile song now plays in the same dark floating card as the radio, with artwork, title, artist, a seekable bar and volume, instead of SoundCloud's fixed light box. If SoundCloud's player can't be reached, the normal player shows, darkened.",
        "**Safer gift marks:** \"I'll gift this\" is no longer an honor system. Marking a game needs a Discord sign-in, the account must be at least a week old, each person can hold 5 marks per list (15 overall), and a mark runs out after three weeks unless it is renewed. List owners can release any mark, pause marking, or release and report a fake one without ever learning who made it. Three reports in 60 days blocks an account from gift marks, and the bot owner has a Gift marks page in the admin panel to review and block or unblock. Old anonymous marks were cleared.",
        "**Sharper profile banners and a floating radio:** a game banner on a profile now uses the game's large hero picture instead of the small store header that looked blurry stretched out. A live radio song now plays in a small player floating in the corner of the page, with a button to fold it down to just the play tile.",
        "**Far more of the dashboard is translated:** the landing page, menus, footer, Library, Wishlist, Free games, Friends, Servers, the Streamer page and the profile editor now follow your language in Spanish, French, German, Portuguese, Italian, Russian, Polish, Turkish, Japanese, Korean and Chinese. Pages not done yet fall back to English.",
        "**Fanatical bundles load again:** Fanatical turns away automated requests, so its bundles are now read through IsThereAnyDeal when Fanatical says no. The owner's check now reports every store it could and could not read.",
        "**Every Steam bundle:** Steam has no public list of its bundles, so the bot now walks the newest bundle pages itself. A normal check looks at what is new; the owner's \"Check for new bundles now\" goes back through hundreds of older ones so you can see it working. Older ones fill the page quietly and are not announced.",
        "**Pictures that show:** IndieGala bundles now have their cover, and game art for newer Steam games, which are not on the old picture address, is found through the store and used everywhere: embeds, the dashboard, profiles and share pictures.",
        "**Pictures are kept:** every game and bundle picture is saved the first time it is fetched and served from our own address with a week-long browser cache, so visiting a page no longer goes out to the stores again.",
        "**Live radio on profiles:** a radio stream set as a profile song now plays in a card that matches the OBS now-playing overlay, with a play and pause button, volume and the live strip."
    ] },
    { version: "2026.11.27", date: "2026-11-04", title: "Bundles feed, plus Destiny 2 and Warframe codes", items: [
        "**Bundles feed:** new game bundles from Humble Bundle, Fanatical, IndieGala and the Steam store are posted once each in a channel, with the games inside, the price tiers when the store shows them, and when the bundle ends. Ended bundles are grayed out. Browse them on the new Bundles page, or set up the channel on your server's Codes & promos tab or with `/server promos bundles`.",
        "**Community setup:** setup now makes a #bundles-feed channel and an opt-in **Bundle pings** role and connects them. Servers that were set up before get both the next time you run `/manage community setup`.",
        "**Destiny 2 and Warframe codes:** their promo codes are posted like the other game codes, with the reward, how to claim it and a button to Bungie.net or Warframe.com. Pick them in your server's game list, `/games codes games` or your code alerts."
    ] },
    { version: "2026.11.26", date: "2026-11-04", title: "Profile links get their own preview", items: [
        "**Your name and look in the preview:** when you post your profile link (steamvaluechecker.com/u/yourname) in Discord, X or anywhere else that shows link previews, it now shows your own picture with your name, bio, favorite games and colors instead of the generic bot image.",
        "**Clean addresses:** every dashboard page now has a plain address like steamvaluechecker.com/wishlist or /u/yourname instead of one with /#/ in it. Old links with the # still open the right page, and what you copy from the address bar now previews properly when you share it.",
        "**Streamers tab colors:** the Streamers pages now glow in a mix of Twitch purple, YouTube red and Kick green, with a matching gradient strip under the top bar. Every other page keeps its normal look.",
        "**Songs:** a saved profile song now shows up for visitors, and if profile songs are switched off by the bot owner you get a note on your own page saying so."
    ] },
    { version: "2026.11.25", date: "2026-11-04", title: "Steam wishlist stays in sync by itself", items: [
        "**No extension needed:** after you sign in through Steam, your public Steam wishlist is added straight away, and from then on I re-read it about twice a day. New games appear on your list and ones you removed on Steam are dropped.",
        "**Your choice:** switch automatic sync off with the checkbox on the Wishlist page. Your Steam Game details must be Public for it to work; if the list is private I just skip it quietly."
    ] },
    { version: "2026.11.24", date: "2026-11-04", title: "Free games listed once", items: [
        "**No more doubles:** when two sources report the same free game, like one with \"- FREE on Epic Games\" on the end of its name and one without, it now shows once everywhere, in the free games page and in the alerts.",
        "**One Epic tab:** \"Epic Game Store\" and \"Epic Games Store\" are now the same store in the filters."
    ] },
    { version: "2026.11.23", date: "2026-11-04", title: "Enter giveaways from Twitch chat", items: [
        "**!enter in chat:** when you start a stream giveaway you can let viewers type `!enter` in your Twitch chat. The bot listens only while the giveaway runs, and the overlay can show a \"Type !enter in chat\" line.",
        "**Link your Twitch once:** viewers link their Twitch on the Steam page of the dashboard. It reads the Twitch account shown in their Discord connections, so nobody can enter as someone else, and winners still get their prize by Discord message.",
        "**Newcomers are pointed the right way:** anyone who types `!enter` without being linked gets a reply in chat with your Discord invite and the link page. Members who are not in your server yet are asked to join first."
    ] },
    { version: "2026.11.22", date: "2026-11-04", title: "Giveaway overlay for streamers", items: [
        "**On-screen giveaway:** the Streamer hub has a new Giveaway overlay for OBS. It shows your stream giveaway's prizes, how many people entered, a live countdown and the steps to enter, then shows the winners the moment they are drawn.",
        "**Make it yours:** pick a card, wide bar or small tag layout; dark, light, glass, neon or no background; any corner of the screen; four fonts; your own accent color and size. Switch the prizes, entry count, countdown, progress bar, steps and winners on or off, add your own heading and a line like your Discord invite, and choose whether the winners hide after a while.",
        "**Several giveaways at once:** tick up to six of the giveaways running in your server and the overlay slides between them, each with its own live entry count and countdown, with dots underneath. Pick none and it follows your latest stream giveaway.",
        "**Live preview:** you see every change as you make it, and your choices are remembered. It uses the same private link as your deals overlay and follows your latest stream giveaway by itself, so you set it up once."
    ] },
    { version: "2026.11.21", date: "2026-11-04", title: "Full giveaway tools for streamers", items: [
        "**Stream giveaways grew up:** the Streamer hub's giveaway panel now takes several prizes (keys, Nitro, gift cards, money or anything else), a title and description, your own pictures or automatic artwork, a color and button text, with a live preview of the post.",
        "**Required steps:** ask viewers to follow you on Twitch or X, join your Discord, subscribe on YouTube, wishlist a game or any link you like. They show on the post as numbered steps with link buttons. Discord can't check them, so it runs on trust and winners may be checked.",
        "**Rules:** minimum account age, minimum time in the server, boosters only, hours to claim, and for managers a required role, a bonus-entry role and a ping role. Choose whether it draws the moment your stream ends or runs for its full length.",
        "**Everywhere:** the server Giveaways page has the same required steps, and `/server stream giveaway` still gives away a single key quickly."
    ] },
    { version: "2026.11.20", date: "2026-11-04", title: "More free games caught", items: [
        "**Short-run freebies:** the bot now also watches GamerPower's live giveaways, so the batches of small Epic, Steam and GOG games that are free for only a few days show up in your free game alerts and in `/games freegames`.",
        "**No repeats:** a game that was already announced from another source isn't posted twice, and the first run stays quiet about what was already open."
    ] },
    { version: "2026.11.19", date: "2026-11-04", title: "Game trivia", items: [
        "**Guess the game:** a manager starts trivia with `/server trivia start` (or on the Trivia page in the dashboard). Each round shows the genre and release year, then the developer, then a description with the name blanked out and a screenshot.",
        "**Tap to answer:** four titles to pick from, one guess each. Right answers score 3, 2 or 1 points depending on how many clues you needed, and the round's answer is revealed when time is up.",
        "**Leaderboard:** points add up per server. `/server trivia top` shows the all-time board, and `/server trivia stop` ends a game early without losing the scores so far."
    ] },
    { version: "2026.11.18", date: "2026-11-04", title: "Secret Santa", items: [
        "**Secret Santa for your server:** a manager starts one with `/server santa create` (or on the Secret Santa page in the dashboard) and sets a budget. Members join, then a manager draws the names.",
        "**Private and useful:** everyone gets a message saying who they're buying for, plus what's on that person's wishlist inside the budget at today's cheapest price, with links. Joining is what shares your wishlist, and only with whoever draws you.",
        "**No mix-ups:** nobody draws themselves, DMs that fail are reported to the manager, and `/server santa ideas` shows your giftee again if you lose the message. `/server santa reveal` shows who had who when it's over."
    ] },
    { version: "2026.11.17", date: "2026-11-04", title: "Smarter alerts", items: [
        "**Match score:** each sale alert now shows how well the game fits what you actually play, worked out from your Steam library hours and the game's genres. It only shows once you have a linked library to compare against.",
        "**Next likely sale:** the price history note adds a rough guess of when the next sale might start, based on how often that game has dropped before. It says plainly that it is a guess.",
        "**Price ceiling:** set the highest price you'd pay and alerts above it stay quiet. It is on the alert settings page, in `/alerts` and in the dashboard.",
        "**Record lows only:** one switch to hear only about all-time lows. Starred games always come through, whatever you set.",
        "**Ready-made announcements and a time zone default:** times now default to Eastern, and the bot owner can send restart, development and thank-you notices in one click."
    ] },
    { version: "2026.11.16", date: "2026-11-04", title: "AI companion (coming soon)", items: [
        "**Coming soon, with a preview already working:** the full AI turns on when the bot owner adds an AI key. Until then, when a server turns the companion on, the bot answers the common questions itself: game prices, the free games right now, your wishlist, your library and what to play next. Anything else gets a polite “coming soon” and a list of what works.",
        "**Ask the bot anything:** say `Hey AI` followed by a question, or mention the bot, and it answers in the channel. It is off until a server manager turns it on under Community in the dashboard (or `/manage community ai`), and managers can limit it to one channel.",
        "**It uses the bot's real data:** it can look up live game prices and the cheapest store, list the free games right now, check your wishlist for sales, summarize your library and suggest what to play next from your backlog, show the server's savings leaderboard, and add a game to your wishlist when you ask it to. It only ever sees your own lists.",
        "**Bring your own key:** a server manager can paste their own AI key under Community, from Anthropic, OpenAI, Google Gemini, OpenRouter, Groq, Mistral, xAI or DeepSeek. It is checked when saved, stored encrypted and never shown again. That server then pays Anthropic for its own answers and is not held to the bot's daily limit, and the AI companion can run even on a bot with no key of its own.",
        "**Support server button:** a Support server button now sits in the dashboard header and on the landing page, linking to the bot owner's own server. That server is never limited by the AI daily cap.",
        "**AI Plus (work in progress):** a preview in the Community page for servers that hit their daily limit. Payments are not live yet; managers can say they are interested, and the bot owner can switch Plus on for a server by hand.",
        "**Limits, spelled out in the dashboard:** a daily answer limit per server, a short wait between one person's questions, a cap on question and answer length, and a note on what is sent to the AI provider (only the question and recent replies in the thread).",
        "**Bot owner controls:** the Admin area has an AI companion page (master switch, model, tone, extra instructions, limits, per-server limits, blocking people or servers, usage by day, and a box to try it) and a Bot settings page (profile pages, profile songs, trap channel bans, and a notice banner shown across the dashboard).",
    ] },
    { version: "2026.11.15", date: "2026-11-04", title: "12 languages", items: [
        "**Dashboard languages:** a language picker (🌐) in the top bar switches the dashboard between English, Spanish, French, German, Portuguese, Italian, Russian, Polish, Turkish, Japanese, Korean and Chinese. It starts in your browser's language. The menus, tabs, buttons, wishlist and profile editor are translated; anything not translated yet stays in English.",
        "**`/language`:** pick the language for the bot's buttons and alert messages. It is the same setting as the dashboard picker, so changing one changes the other.",
        "**Command descriptions in your Discord language:** the main commands now show their descriptions in the language your Discord app is set to. Discord decides that from your own app setting, so the bot cannot switch it per person. Command names stay the same everywhere.",
    ] },
    { version: "2026.11.14", date: "2026-11-03", title: "Public profiles", items: [
        "**Your own profile page:** build it under Account, My profile, with a live preview. Pick a theme and accent color, background, layout and banner, write a bio, add up to six links (Twitch, Kick, YouTube, X, Bluesky, Steam, GitHub or a website) and pin up to five favorite games. Share it at `/u/yourname`; it shows a proper preview card when pasted into Discord.",
        "**Profile song:** set a YouTube, SoundCloud or Spotify link, or the address of a live radio stream, and visitors get a play button on your page. Turn on the optional **Click to enter** screen and the song starts the moment they click it.",
        "**You choose who sees each part:** about, favorites, wishlist, recently finished, trophies, Steam stats, streaming and playing now are each public, server only or hidden, and can be reordered. Hidden parts are never sent to visitors.",
        "**Live ban counter in the trap channel:** the do-not-type-here notice now shows how many accounts it has banned so far, and updates itself within a few seconds of each ban.",
        "**`/me profile`:** view, bio, name, look, song, link, unlink, favorite, unfavorite and show, all from Discord. Visitors can report a page, and moderators can hide one from the Admin area.",
    ] },
    { version: "2026.11.13", date: "2026-11-03", title: "Menus and settings panels", items: [
        "**Panels for every command group:** `/games menu`, `/me menu`, `/server menu`, `/manage menu`, `/bot menu` and `/mod menu` open a private panel with live status for each area (your wishlist count, open giveaways, who is live and so on). Pick a command, fill in its options with dropdowns, member and channel pickers or a small form, and press Run. No typing of options. `/music` has the same from the All commands button on `/player`.",
        "**Wishlist, library and streaming panels:** open them from the wishlist, library and stream areas in `/me menu` and `/server menu`. Browse and page your wishlist, star, remove or set an alert on a game, change a library game's status, or go live and give a key away, all with buttons. Menus reopen where you left off and refresh themselves while open.",
        "**`/alerts status` is now a settings panel:** dropdowns and buttons for every alert, where they go, quiet hours, digest, minimum discount, muting and which games send you codes. Every old `/alerts` command still works."
    ] },
    { version: "2026.11.12", date: "2026-11-03", title: "Streamer hub, Now playing and Game club", items: [
        "**Game club:** `/server club pick` sets the server's game of the month; the Game club page and `/server club status` show who is playing, finished or has not started, and a card is posted weekly in the club channel.",
        "**Share your wishlist page:** `/me publicpage share:true` posts your page in the channel as a card with a button. `/me publicpage` on its own shows your link. The dashboard has a Copy link button.",
        "**Extension 2.9 (needs the link with the bot):** on Steam store pages the extension now shows playtest and demo badges, how many server members own the game, one-click wishlist and Spotlight on stream, plus a toolbar count of new free games, playtests and alerts. Until you link it, the icon shows a ! and store pages show a Link now card.",
        "**Chat commands for streamers:** `/server stream chat` (and the hub) gives `!game`, `!deals`, `!free` and `!wishlist` lines to paste into Nightbot, StreamElements, Streamlabs or Fossabot, so viewers in Twitch, Kick or YouTube chat get answers.",
        "**Stream giveaways:** `/server stream giveaway` gives one key to your viewers while you are live. It draws when your stream ends. The deals overlay also has a Playing now card.",
        "**Streamer hub:** one page (Streamers in the menu) with go-live posts and pings, your channel link, the music overlay, the new deals overlay, your public gift-me wishlist and who is live.",
        "**Deals overlay for OBS:** a private link that rotates the best deal on your wishlist, a free game right now and a gift-me card. Pick the cards, corner, colors and speed.",
        "**Now playing:** `/server nowplaying` and a dashboard page show who in your server is in a game. Members opt in with `join:true`. Setup adds a #now-playing channel and Squad pings role for squad-up posts when two or more play the same game.",
    ] },
    { version: "2026.11.11", date: "2026-11-03", title: "Playtests page and a guided first run", items: [
        "**More playtest sources, no duplicates:** playtests, betas and demos are now also read from GamerPower (free beta and playtest key listings), itch.io's playtest tag and Steam's list of new demos, next to Alpha Beta Gamer and Steam announcements. Steam's demo list is long, so it only counts for games on someone's wishlist. A game announced by one source is not announced again by another, in your DMs, in server channels or on the Playtests page, and each new source starts quiet so nothing is dumped on you when it is added.",
        "**Refresh the playtest channel:** server managers can run `/manage community playtests` (or press **Post current playtests now** in the dashboard's Ping roles panel) to post what is listed right now, not only what is new. It posts the newest 8 (up to 15), oldest first, without pinging the role, and the regular check won't repeat them. Once a minute at most.",
        "**Playtests page:** a new page under Free & codes lists every playtest, beta, demo and free weekend the bot can see: Steam announcements for games on your wishlist or in your library, plus the Alpha Beta Gamer site. Filter by type, show only your wishlist, hide games you own, or search. It checks again every five minutes by itself, marks what is new since you opened it, and pauses while the tab is hidden.",
        "**First-run tutorial and setup:** new members now get a guided welcome on the dashboard: a nine-part tour of every area, then a six-step setup for region and stores, delivery, Steam, alerts and your server. The tour can be skipped (it asks to confirm) and setup still follows. Replay it any time with **Take the tour** on My page.",
    ] },
    { version: "2026.11.10", date: "2026-11-03", title: "Refund reminders, milestones and right-click shortcuts", items: [
        "**Community setup:** setup now makes a **#playtests** channel and a **Playtest pings** role (members pick it in #roles) and connects them. The channel posts every playtest and demo the bot finds and pings the role, whatever members have set in their own alert settings. Managers can change the channel and role on the dashboard. Run `/manage community setup` again on an existing server to add them. The new-member welcome message also mentions playtests and the right-click shortcuts.",
        "**Playtest watcher:** `/alerts playtests` (off by default) now has two modes: only games on your wishlist, or every free playtest, beta and demo the bot finds. It reads Steam announcements and the Alpha Beta Gamer site (alphabetagamer.com), which lists sign-ups and demos Steam news never mentions. Every post links back to the site. Servers can also pick a **Playtests** ping role in the dashboard's Ping roles panel: the bot then posts those announcements in the alert channel for games the server's sharing members watch, and pings the role. There is also a switch to post every playtest, not only watched games. No member is named.",
        "**Vote on game night:** the game night card has a **Start a vote** button. It posts up to five games everyone owns, people tap to vote (and can change their vote), and the tally updates live for six hours.",
        "**Saved views:** on the Wishlist page, name your current sort and filters and bring them back from the Views menu. They are saved in the browser you use.",
        "**Wishlist page color:** a member's public wishlist page now uses the color they picked for their profile card.",
        "**Refund and rebuy:** with `/alerts refund` on, you also hear when a game still inside its refund window drops below what you paid on Steam, so a refund and rebuy would save money. It needs prices from the extension's purchase sync; games without a recorded price are skipped, and `/alerts refund` tells you if none are recorded yet.",
        "**Achievement heads-up:** `/alerts achievements` (off by default) tells you when a game you have played for 5 hours or more is within 3 achievements of 100%. Counts come from your last Steam sync.",
        "**Press / to search:** on the dashboard, `/` jumps to the search box on pages that have one.",
        "**Backlog pick:** `/alerts nudge` (off by default) sends one game from your backlog to try on the 1st of each month, the biggest spend you haven't started.",
        "**Who owns this:** right-click a message that is a game title, then Apps, **Who owns this?** to see which members who share their library own it and how long they have played.",
        "**Year in games:** `/alerts yearinreview` (off by default) sends your recap card (hours, months, top games) by DM from December 26. It needs Steam linked.",
        "**Refund reminders:** `/alerts refund` (off by default) warns you about two days before the 14-day Steam refund window closes on a game you have played under two hours. It needs Steam linked, and only counts games that show up after you link.",
        "**Playtime milestones:** `/alerts milestones` (off by default) sends a card when a game passes 100, 250, 500, 1000 or 2000 hours. The first check is quiet.",
        "**Right-click shortcuts:** right-click (or long-press) a member, then Apps: **Compare libraries**, **See their wishlist** or **Play together** (shared games tagged co-op or multiplayer, barely played first) or **Gift ideas** (their shared wishlist games that are on sale and not yet claimed). Right-click a message that is just a game title for **Check this game's price** or **Add to my wishlist**.",
    ] },
    { version: "2026.11.09", date: "2026-11-03", title: "DLC sales and an installable dashboard", items: [
        "**DLC sale alerts:** turn on `/alerts dlc` (or the checkbox in Alert settings) and the bot tells you when DLC or add-ons for a game you play go 40% off or more. It looks at the Steam games you have played for two hours or more, and your own minimum discount still applies. Your first check is quiet.",
        "**Install the dashboard:** the site can now be added to your phone's home screen or installed as an app from your browser, with shortcuts to your wishlist, free games and alert settings.",
    ] },
    { version: "2026.11.08", date: "2026-11-03", title: "Steam reviews on your alerts", items: [
        "**Steam reviews:** sale alerts and `/me wishlist check` now show how Steam players rate the game (for example \"Very Positive on Steam: 92% of 18,420 reviews are positive\"), so you can tell a good deal on a good game from a good deal on a bad one. Games with very few reviews show nothing.",
    ] },
    { version: "2026.11.07", date: "2026-11-03", title: "Sample alerts and price charts", items: [
        "**Price chart on game checks:** `/me wishlist check` now comes with a picture of the game's price over the last year, with its lowest price and today's price marked.",
        "**Release dates:** you hear when a wishlist game gets a release date, and when a date is pushed back or brought forward by two days or more. Same switch as release-day alerts.",
        "**Mute a game:** on the Wishlist page, each game now has an alerts menu: snooze for 7 or 30 days, or mute it until you switch it back on.",
        "**See how alerts look:** Alert settings has buttons that send you a sample of any alert kind in a DM, marked as a sample.",
        "**Find an alert:** the Notifications page can now be filtered by kind and searched.",
        "**For server managers:** the Community page shows who joined and left over the last 30 days (people only), and can preview the welcome picture card before it goes out.",
        "**New board:** `/server leaderboard` has \"Most games finished, all time\".",
    ] },
    { version: "2026.11.06", date: "2026-11-02", title: "People-only counts", items: [
        "**Member counts leave out bots:** the member numbers the bot shows (about, status, welcome messages, member numbers, the dashboard) now count people only. Turn on the Server Members intent so every bot can be spotted; without it only the bot itself is left out.",
        "**Admin system health:** now shows when the running bot started and which release, machine and region it is on.",
    ] },
    { version: "2026.11.05", date: "2026-11-01", title: "Fewer commands, bigger music", items: [
        "**Patch notes and news:** turn on `/alerts news` (or pick it on the dashboard's Alerts page) and the bot tells you about new patch notes, or every announcement, for the Steam games you own or wishlist. `/me library news` shows the latest right now. Your first check is quiet, so only new posts reach you.",
        "**Sale countdowns:** alerts, `/me wishlist check` and the weekly digest now say when a sale ends (\"ends in 9 hours\") whenever the store gives an end date.",
        "**Welcome cards:** the welcome message for new members now comes with a picture card showing their avatar, name and member number. Servers can turn it off with `/manage welcome card:false` or on the dashboard's Community page.",
        "**Coming soon on Epic:** members with free game alerts (and servers with the free game feed) now hear about next week's free Epic games before they start, with the date and time they go live.",
        "**Subscriptions:** the bundle alerts now also tell you when a wishlist game joins a subscription like Game Pass or Prime Gaming, and when it's about to leave one. `/me wishlist check` shows which subscriptions include the game. The same switch as bundle alerts (`/alerts bundles`) controls them.",
        "**Go-live switch:** managers can turn the automatic go-live posts off (and back on) for their server, with the checkbox in the Streams page settings or `/server stream setup auto:`. Linked channels stay linked while it's off.",
        "**Amazon Luna claims:** the monthly games you can claim with Prime on Amazon Luna now show up with the other free games. You get an alert when a new one opens, a last-chance reminder before it ends, and they're in `/games freegames` (filter by Amazon Luna) and on the dashboard. Each card says which store the game is delivered through (Epic, GOG or Amazon Games).",
        "**Fancier /help and embeds:** `/help` is now a branded card with the logo, a banner, a jump menu, Back / Next buttons and Dashboard, Add to a server and Support links. Every card and message the bot sends now gets the same orange color and a footer with the logo, and plain text replies show up as cards (messages that ping someone stay as text so the ping still works).",
        "**Commands grouped:** the long list is now a few short ones. `/games` (prices, deals, free games, sales, codes), `/me` (wishlist, library, Steam, friends, your data), `/server` (giveaways, game nights, levels, boards, events), `/manage` (setup and community for managers), `/bot` (status, changelog, support, ideas), plus `/alerts`, `/music`, `/play`, `/mod`, `/dashboard` and `/help`. Everything does what it did before, just under a group.",
        "**One card at a time:** messages that used to stack several cards (a batch of free games, several wishlist alerts, bundle and giveaway alerts, long replies) now show one card with Previous / Next buttons and a jump menu. Each page keeps its own buttons.",
        "**Emoji packs:** `/manage emoji packs` browses emoji.gg packs one at a time and imports the one you pick (still only, animated only, or both, in batches of 50). The dashboard's Community page has the same with tick boxes. Emoji links from any website now work too, and animated Discord emoji keep their movement.",
        "**Terms and privacy:** the Terms of Service and Privacy Policy are pages on the bot's own site (`/terms.html` and `/privacy.html`), linked from the footer and `/bot privacy`.",
        "**Admin panel:** the owner's tools moved to their own panel (`admin.` in front of the bot's address, or `/admin`) with a sidebar, Ctrl+K search, live system health and an audit log. Everything from the old Admin page is still there.",
        "**Admin password sign-in:** the owner can add a username and password (and an optional authenticator code) as a second way into the admin panel, from the panel's Account and security page. Discord sign-in stays the main way in.",
        "**Music studio:** a full-screen player of its own (`music.` in front of the bot's address, or `/music`) with the song cover and a live visualizer, drag-and-drop queue, search, radio, requests, saved playlists and a session chat with emoji reactions that float across everyone's screen. It's the same player as the dashboard's Music page, just built for listening.",
        "**Live visualizer:** the music studio now has a visualizer behind the player that moves with the real sound. The bot measures the audio it sends to Discord and streams the levels to the page. Switch between bars, mirror and off with the button (or the V key), and line it up with what you hear using [ and ].",
        "**Streamers page:** a new page on the dashboard (Servers > Streamers) lists everyone in your server who linked a Twitch, Kick or YouTube channel, with their channel link and whether they are live right now (title, game, how long, and a Watch button). It refreshes by itself.",
        "**Automatic go-live:** link your Twitch, Kick or YouTube channel (`/server stream link`, or the Streams page on the dashboard) and the bot posts in the live channel when you start streaming, pings the people who opted in, and closes the post when you finish. No more posting it yourself. The Streams page also has the OBS overlay now.",
        "**Auto memes:** the bot now posts a fresh meme in #memes every hour (servers can pick 1 to 24 hours, another channel, or turn it off with `/manage memes setup` or on the dashboard's Community page; `/manage memes now` posts one right away). Nothing marked NSFW is used and a server never gets the same post twice.",
        "**Live radio:** more stations, with hip hop, R&B, dance, chill, rock, throwbacks and reggae. Filter by type in `/music live` and on the dashboard.",
        "**Music:** paste a SoundCloud profile link (like soundcloud.com/name) and the bot queues that artist's own uploads, not their reposts. Old now-playing cards are now deleted when the next song starts, so the channel stays clean.",
        "**Stream overlay:** the music studio has a Stream tab with a compact now-playing card for OBS or any streaming software. It fades in when a song starts, swaps with a shine when the song changes, and fades out when the music stops. Preview it live with what is actually playing (or a demo reel, on a transparent, game or bright backdrop, close-up or as a full 1080p scene) and pick from nine looks (card, spinning record, neon outline, poster, square cover, wide bar, slim strip, small chip, minimal text), theme, color, size and where it sits, preview it live, then paste your server's private link into a Browser source. Managers can make a new link any time and the old one stops working.",
        "**Streamers:** servers can have a **Streamer** role and a **#stream-live** channel (community setup makes both, and the `Stream pings` role). Streamers, moderators and managers use `/server stream live` or the dashboard's new **Streams** page to announce they're live; members who picked the Stream pings role (`/server stream ping`, the roles channel or the Streams page) get pinged. The OBS overlay settings are now only for moderators, managers, the bot owner and the streamer role, and everyone gets their own private overlay link instead of sharing one per server.",
        "**Chat on screen:** new messages in the big player's session chat now float up over the player like the emoji (links hidden, long messages cut, a few at a time, with an On screen button to turn it off). The song progress bar also no longer jumps back and forth.",
        "**Big player from Discord:** `/player` gives a button that opens the big music player for your server, and the now-playing post has a **Big player** button too, plus **Listen here** (and a **Listen now** button in the big player), which drops you into the voice channel the music is playing in.",
        "**FanaticalGrabber page:** the extension's web page now lives on the bot's own site at `/grabber`, with the same live demo and visitor counter.",
        "**Paged help:** `/help` is now a clean paged embed with a menu for each topic.",
        "**Live radio:** `/music live` lists stations that are on the air right now, and you can paste any Icecast or Shoutcast stream link into `/play`.",
        "**Auto DJ:** managers pick a playlist and the bot keeps playing it when nobody has queued anything. Members send requests (`/music autodj submit`, or on the dashboard) and they play first.",
        "**Stay in the channel:** with `stay` on (`/music settings`, or the Music page), the bot waits in the voice channel it was last used in instead of leaving. When someone joins it goes back to the last live station, or starts the Auto DJ if no station was playing. It also rejoins after a restart.",
        "**Music on the dashboard:** the Music page now has live status with album art, seek, the radio list, Auto DJ requests and settings, and roles for managers, moderators, DJs and listeners.",
    ] },
    { version: "2026.11.04", date: "2026-11-01", title: "Music", items: [
        "**SoundCloud music:** join a voice channel and use `/play` with a SoundCloud link, a playlist link or just words to search. There is a queue, skip (others vote), previous, loop, shuffle, seek, volume and a now-playing panel with buttons.",
        "**Playlists:** paste a SoundCloud playlist (up to 100 songs) and it queues the lot, or save your own with `/music saveplaylist` and load it in any server.",
        "**Dashboard:** a new **Music** page under Servers does all of it from the browser, and managers set a DJ role, starting volume, limits and where song messages go.",
        "**Setup:** community setup adds a Music category with a #music-commands channel and two voice channels (run `/manage community setup` again on an existing server). The bot needs Connect and Speak permission, so servers that added it earlier may need to grant them."
    ] },
    { version: "2026.11.03", date: "2026-11-01", title: "Promo drops", items: [
        "**Alerts to your DMs:** `/alerts codes` messages you when a new game code drops (all games, or only the ones you pick), and `/alerts promos` does the same for giveaway and code news. Both are on the dashboard's Alerts page, show up in Notifications, can be muted, and only send what is new from the moment you turn them on.",
        "**Promo drops:** for key giveaways like SteelSeries or NVIDIA rewards. A server manager adds the code or link with `/server promos add` (or on the dashboard under Servers, Promo drops) and the bot posts it once in the promo channel, then grays it out when it ends.",
        "**News watching:** turn on `/server promos news` and the bot also posts news that mentions a giveaway or a code: the NVIDIA and SteelSeries blogs, and the official Steam news for Dead by Daylight, Warframe, Destiny 2, Apex Legends, Rainbow Six Siege, Marvel Rivals, Wuthering Waves, Path of Exile and PUBG. It only posts new ones, and it can be wrong now and then, so each one links to the post.",
        "**Codes, tidied:** all the Borderlands games are now one entry in every picker and filter (the code card still names the exact game), and Genshin, Star Rail and Zenless codes show their game art on the dashboard and in Discord posts.",
        "**Ping roles:** community setup adds opt-in **Game code pings** and **Promo drop pings** roles to the role picker, and those are pinged by default (or pick your own role on the dashboard or with `/games codes ping` and `/server promos ping`). Run `/manage community setup` again to add them to an existing server.",
        "**Where they go:** community setup adds a #promo-drops channel (run `/manage community setup` again to add it to an existing server)."
    ] },
    { version: "2026.11.02", date: "2026-11-01", title: "Game codes", items: [
        "**Limited-time game codes:** the bot now watches for SHiFT codes (Borderlands 2, 3, 4, The Pre-Sequel, Wonderlands and the GOTY edition) plus redeem codes for Genshin Impact, Honkai: Star Rail and Zenless Zone Zero, and posts each one once, with the right game's art, the reward, the platform and when it ends. When a code runs out, its post is grayed out.",
        "**Where they go:** servers get a #game-codes channel from community setup (run `/manage community setup` again to add it to an existing server). Managers can pick the channel, which games to include and a role to ping with `/games codes`, or on the dashboard under Servers, Game codes.",
        "**Dashboard:** a new **Game codes** page under Prices lists every working code with a copy button, and lets you look at ones that just ended. `/games codes latest` shows the same list in Discord.",
    ] },
    { version: "2026.11.01", date: "2026-10-29", title: "A full community bot", items: [
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
    { version: "2026.10.31", date: "2026-10-29", title: "Sign in through Steam", items: [
        "**Sign in through Steam** on the dashboard: one click on Steam's own page and your library, hours and taste profile fill in. No profile links to paste. Wishlist import, `/me wishlist import` and `/me steam link` use the Steam account you signed in with.",
        "The Steam page has a new **Library analytics** view: games, hours, collection value, how much you have played, hours by genre, played versus backlog and your most played games.",
        "Free DLC is now labeled, and if your Steam library is synced the alert says whether you own the base game.",
        "FanaticalGrabber 2.7: press **Connect the extension** on the Library page and the code is handed over for you. The cart check now says why when it cannot read a cart, and \"You're seeing the best deals available\" when you are well under Steam.",
        "**For you** page and `/me steam foryou`: live deals ranked by a match score from your library taste and wishlist, with filters for all-time lows, discount, price and store.",
        "Home page: a live count of free offers and a feature ticker. `/help` is now a full command list."
    ] },
    { version: "2026.10.30", date: "2026-10-28", title: "Goals, bundles, more leaderboards and a tidier menu", items: [
        "`/me steam goal`: set an hours goal for the year and see if you are on pace (also on the Steam page). `/me steam recap` now posts a picture you can share, and the Steam page can make the same image.",
        "`/me library bundle` and `/me library bundles`: record a bundle you bought and see what its games are worth, what each cost you and how much you have played.",
        "`/server leaderboard` has two more boards: hours played this year and biggest library. The dashboard shows all four in one picker.",
        "`/alerts mindiscount`: only get sale alerts for a minimum percent off. Starred games still come through.",
        "Dashboard menu: pages are grouped into Library, Prices, Friends, Servers, Account and Help, with each section's pages as tabs under the menu. Theme and contrast now share one Display menu.",
        "FanaticalGrabber: bundle and cart pages on Fanatical now show how the price compares with Steam and whether it is worth buying. It can also fill in what you paid from your Steam purchase history (Send what I paid)",
    ] },
    { version: "2026.10.29", date: "2026-10-27", title: "Hours tracked, challenges, gifts and a Steam panel", items: [
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
        "My page also has a Profile card: pick what to show (games, finished, hours, percent saved, streak, badges, genres), choose a color and save it as an image.",
        "My page pictures: add a banner and a profile card picture from any https image link, or let a Steam link fill them in (your profile picture and the art of your most played game). They refresh each time you sync.",
        "Profile card: add your gaming names (Steam, Xbox, PlayStation, Nintendo, Epic, GOG and more) and they show on the card. `/me profilecard` posts the same card as a picture (add `public:true` to share it).",
        "`/me steam value` now answers with a picture that looks like the Steam page's account value panel. The Steam page has a Save as image button for it too.",
        "New: a short guided tour the first time you open the dashboard (replay it from My page), and a one-time quick start after your first command.",
        "Taste profile (`/me steam taste`) suggests games from your own library's tags." ] },
    { version: "2026.10.28", date: "2026-10-26", title: "Steam library, bundles and looking for group", items: [
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
    { version: "2026.10.27", date: "2026-10-26", title: "Game night and easier setup", items: [
        "`/server gamenight`: what everyone in your voice channel can play together, who is missing a game, and what to buy together.",
        "Optional group-buy nudges in a voice channel when a game several of you want goes on sale.",
        "`/manage setup` can create the channels for you, and the dashboard menu is now grouped." ] },
    { version: "2026.10.26", date: "2026-10-26", title: "Support, notifications and more", items: [
        "Support tickets: `/bot support open` or the Support page. Replies reach you in Discord and on the dashboard.",
        "Notification center on the dashboard keeps a copy of every alert. Mute a kind of alert with `/alerts mute`.",
        "Sale alerts have Snooze 7 days and Only below a price buttons.",
        "Setup checklist on the dashboard home, a global search (press `/`), and a high-contrast theme.",
        "Spanish and French for the main buttons: `/alerts language`." ] },
    { version: "2026.10.12", date: "2026-10-26", title: "Status page, free game menu and server tools", items: [
        "A public Status page and `/bot status`.",
        "`/games freegames` is a scrollable menu with Games and DLC tabs.",
        "`/me library backlog`, `/games watch`, `/games sales`, `/me publicpage` and `/server serverstats`." ] }
];
export const LATEST = CHANGELOG[0].version;

export function changelogEmbed(limit = 3) {
    return {
        color: 0xff9800, title: "What's new",
        // Each version gets an equal share of the space, so one long entry can't push the others out.
        description: CHANGELOG.slice(0, limit).map(e => `**${e.title}** (${e.date})\n${e.items.map(x => "• " + x).join("\n")}`.slice(0, Math.floor(3900 / Math.max(1, Math.min(limit, CHANGELOG.length))))).join("\n\n").slice(0, 4000)
    };
}
