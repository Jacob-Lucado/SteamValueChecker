// The dashboard's own public pages (/support, /help, /about and so on) are all one app, so without this they'd all show the home page's title and
// preview in search and in link cards. Each one gets its own title, description, preview picture and short answers here.
// The pictures are public/page-<slug>.jpg.
export const PAGE_SEO = {
    support: {
        title: "Support and help | Steam Value Checker",
        desc: "Get help with the Steam Value Checker Discord bot: open a support ticket, report a bug or suggest a feature. A real person replies, and it's free.",
        alt: "Steam Value Checker support: get help, report a bug or suggest a feature",
        tickets: true,
        faq: [
            ["How do I get help with Steam Value Checker?", "Sign in on steamvaluechecker.com, open Support and start a ticket. A real person reads it and replies there and by Discord message."],
            ["How do I report a bug?", "Open a ticket from the Support page and say what you did and what happened. Screenshots help."],
            ["Can I suggest a feature?", "Yes. Send it as a ticket and you'll get a message when its status changes."],
            ["Is support free?", "Yes. The bot and its support are free for everyone."]
        ]
    },
    help: {
        title: "Help and commands: how to use the Steam Value Checker bot",
        desc: "How to use Steam Value Checker in Discord: check game prices, set wishlist sale alerts, get free game alerts, see your library value and share a profile card. Answers to common questions.",
        alt: "Steam Value Checker help: how to use the Discord bot",
        faq: [
            ["How do I add Steam Value Checker to Discord?", "Use the Add to Discord button on steamvaluechecker.com, pick your server and approve. It works in a server and in your own DMs."],
            ["How do I check what my Steam library is worth?", "Sign in with Steam on the site or use the library command in Discord. Your game details need to be public for it to load."],
            ["How do I get sale alerts for my wishlist?", "Bring in your public Steam wishlist or type game names, pick an alert type, and the bot messages you when a game hits your price."],
            ["Where can I ask a question?", "Open a ticket on the Support page or join the community server from the Help page."]
        ]
    },
    about: {
        title: "About Steam Value Checker: a free Discord bot for game deals",
        desc: "Steam Value Checker is a free Discord bot and dashboard that prices your Steam library, sends wishlist sale and free game alerts and builds a shareable profile card. Made by one developer.",
        alt: "About Steam Value Checker, a free Discord bot for game deals",
        faq: [
            ["What is Steam Value Checker?", "A free Discord bot and web dashboard that prices your game library, alerts you to sales, free games and bundles, and makes a shareable profile card."],
            ["Who makes it?", "It's built and run by Jacob Lucado, with help and ideas from the community."],
            ["Does it cost anything?", "No. Everything core is free. Supporters can chip in to keep it running."]
        ]
    },
    status: {
        title: "Status: is Steam Value Checker online?",
        desc: "Live status for the Steam Value Checker Discord bot and dashboard: whether it's online, how the checks for free games, bundles and prices are doing, and recent incidents.",
        alt: "Steam Value Checker status page",
        faq: [
            ["Is the bot down?", "This page shows whether the bot and its background checks are running right now."],
            ["What if something is broken?", "Open a ticket on the Support page and say what you saw."]
        ]
    },
    tip: {
        title: "Support Steam Value Checker: tip jar and other ways to help",
        desc: "Steam Value Checker is free. If it saves you money, you can chip in to cover hosting and development, or help for free by voting, adding it to a server and telling friends.",
        alt: "Support Steam Value Checker with a tip or a vote",
        faq: [
            ["Is the bot free?", "Yes. Tips and supporter perks keep it running, but the core features cost nothing."],
            ["How can I help without paying?", "Vote for the bot on Top.gg, add it to a server and tell friends who buy too many bundles."]
        ]
    },
    fortnite: {
        title: "Fortnite item shop today: current skins, prices and creator code | Steam Value Checker",
        desc: "Today's Fortnite item shop with prices and when each item leaves, plus Fortnite news, the map and player stats. Support the creator with code LUCADO when you buy.",
        alt: "Fortnite item shop today on Steam Value Checker, with creator code LUCADO",
        faq: [
            ["What is in the Fortnite item shop today?", "The page lists everything in the shop right now with its V-Bucks price and when it leaves. The shop refreshes every day at 8 PM Eastern."],
            ["What is a Fortnite creator code?", "A Support-A-Creator code. Enter it in the item shop before you buy and a small share goes to that creator at no extra cost to you."],
            ["What creator code should I use here?", "Use LUCADO in the Fortnite item shop. Every buy link on this page adds it for you."],
            ["Does it cost more to use a creator code?", "No. The price is the same with or without a code."]
        ]
    },
    feed: {
        title: "Live game deals feed: free games, bundles and sales | Steam Value Checker",
        desc: "What's on right now: free games from Epic, Steam, GOG and Prime, new bundles from Humble, Fanatical, IndieGala and Steam, and the biggest sales, updated as they appear.",
        alt: "Steam Value Checker live feed of free games, bundles and sales",
        faq: [
            ["Where do the deals come from?", "Free games and sales come from IsThereAnyDeal and the stores themselves. Bundles are read from Humble, Fanatical, IndieGala and Steam."],
            ["Can I get these in Discord?", "Yes. Add the bot to a server and turn on the free game and bundle posts."]
        ]
    },
    discover: {
        title: "Discover Discord servers that use Steam Value Checker",
        desc: "Find gaming Discord servers that use the Steam Value Checker bot, with free game posts, deal alerts, giveaways and a community of players.",
        alt: "Discover Discord servers that use Steam Value Checker",
        faq: [["How do I list my server?", "Add the bot, run the community setup and turn on your public listing from the dashboard."]]
    },
    communities: {
        title: "Gaming communities on Steam Value Checker",
        desc: "Browse gaming communities that run on Steam Value Checker: servers with free game posts, giveaways, game nights and shared wishlists.",
        alt: "Gaming communities on Steam Value Checker",
        faq: [["What is a community?", "A Discord server that has set up Steam Value Checker for free game posts, giveaways, game nights and shared wishlists."]]
    }
};
