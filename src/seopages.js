// Pages that exist to be found: one plain, server-rendered page per thing people search for. Each has its own title, description,
// headings, answers and structured data, and links to the others, so search engines (and people) land on the right one without
// needing the dashboard to run. Kept as data so a new page is a few lines.

const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const SEO_PAGES = {
    "steam-library-value": {
        title: "How much is my Steam library worth? Free Steam account value checker",
        desc: "Find out what your Steam library is worth: the full price, what you'd pay today, the cheapest store right now, and how much you saved. Free, with a Discord bot and a web dashboard.",
        h1: "How much is your Steam library worth?",
        lead: "Sign in with Steam and get the number: what your games cost at full price, what Steam charges for them today, the cheapest price in any store right now, and how much you actually saved on what you paid.",
        sections: [
            ["What you get", ["Your library's total value at full price and at today's prices", "Hours played, the games you never launched, and what you paid for the ones you bought", "Your rarest achievements across every game", "A shareable profile card, and a public page if you want one", "A pick for what to play next from your own backlog"]],
            ["Why people use it", ["Steam shows you a games count, but not what it all adds up to. This tells you, and then shows where the money went and what's still sitting unplayed.", "It only reads what Steam shows publicly (or what you share through Steam's own sign-in). It never asks for your Steam password."]]
        ],
        steps: ["Open the dashboard and press Sign in through Steam.", "Steam's own page asks you to confirm. I never see your password.", "Your library loads and the value appears. Run /me library in Discord for the same numbers there."],
        faq: [
            ["Is it free?", "Yes. There's no paid tier for the library value."],
            ["Does it need my Steam password?", "No. You sign in on Steam's own page and I only get a link to your public profile."],
            ["My profile says it's private. Can it still work?", "Your game details need to be public for the library to load. You can set them to public, check the value, then set them back."],
            ["Where do the prices come from?", "IsThereAnyDeal, which tracks prices across dozens of stores."]
        ],
        related: ["discord-game-deals-bot", "steam-verified-role", "free-game-alerts"]
    },
    "discord-game-deals-bot": {
        title: "Discord bot for game deals and wishlist sale alerts | Steam Value Checker",
        desc: "A free Discord bot that watches your Steam wishlist and pings you when a game goes on sale, hits an all-time low or drops to a price you set. Price history graphs and a buy-or-wait verdict included.",
        h1: "A Discord bot that tells you when your games go on sale",
        lead: "Bring in your public Steam wishlist, choose what counts as worth a ping, and get a message in Discord (or a DM) the moment a game hits it. Every alert shows the store, the discount, the all-time low and a link to the deal.",
        sections: [
            ["Alerts that fit how you buy", ["Any sale, a percent off, a price you set, or an all-time low", "Hot-deal and sale-start posts for your whole server", "DLC sales for games you really play", "Sale war room: set a budget before a Steam sale and plan the cart", "Release dates, patch notes and news for the games you own"]],
            ["Should you buy now?", ["Ask the AI companion (in beta) or run a price check and it shows a year of price history, how often the game hit its low, and the next big sale.", "It says plainly when it isn't sure, so check a price before you buy."]]
        ],
        steps: ["Add the bot to your server, or to your own account.", "Sign in with Steam and bring in your wishlist, or just type game names.", "Pick your alert type, and whether alerts come by DM or in a channel."],
        faq: [
            ["Which stores does it watch?", "Steam, GOG, Fanatical, Humble, Epic and many more, through IsThereAnyDeal."],
            ["Does it work for a whole server?", "Yes. A server can share a wishlist everyone votes on, and get a ping when several members wait on the same deal."],
            ["Can I get alerts in my DMs instead?", "Yes. Choose DM or a channel, and set quiet hours."],
            ["Is it free?", "Yes."]
        ],
        related: ["steam-library-value", "free-game-alerts", "discord-giveaway-bot"]
    },
    "free-game-alerts": {
        title: "Free game alerts for Discord: Epic, Steam, GOG and more | Steam Value Checker",
        desc: "Get a Discord message the moment a game goes free on Epic, Steam, GOG and other stores, with a button to claim it. Each offer is posted once, with the end date.",
        h1: "Free game alerts in Discord",
        lead: "Stores give games away all the time and the offers disappear fast. The bot posts each free game once, with the store, the end date and a button to claim it, so you don't have to keep checking.",
        sections: [
            ["What it covers", ["Free games on Epic, Steam, GOG and other stores", "Free weekends, demos and playtests", "Limited-time game codes like SHiFT codes, posted once and greyed out when they run out", "A /games freegames command that shows what's free right now"]],
            ["For your server", ["Point the free games feed at a channel and ping a role. Members who don't want pings can skip them."]]
        ],
        steps: ["Add the bot to your server.", "Choose the channel for free games with /manage alertchannel.", "Optionally pick a role to ping."],
        faq: [
            ["Will the same game be posted twice?", "No. Each offer is listed once."],
            ["Does it show when the offer ends?", "Yes, every post has the end date."],
            ["Can I get free games by DM?", "Yes, from your alert settings."]
        ],
        related: ["discord-game-deals-bot", "discord-giveaway-bot", "steam-library-value"]
    },
    "steam-verified-role": {
        title: "Steam Verified role for Discord: prove a member owns their Steam account | Steam Value Checker",
        desc: "Give members a Steam Verified role after they sign in on Steam's own page. No passwords, no screenshots. Set it up with one command.",
        h1: "A Steam Verified role for your Discord server",
        lead: "Members prove their Steam account is theirs by signing in on Steam's own page, and the bot gives them a role. Nobody types a password and nobody posts screenshots.",
        sections: [
            ["Why servers use it", ["Keep trading, giveaway and group channels for people with a real account", "Let members show their library stats without exposing anything private", "Gate roles and channels behind verification"]],
            ["What members see", ["A Verify button, a sign-in on Steam, and the role lands on them right away. It takes about a minute."]]
        ],
        steps: ["Set the role with /manage community verifyrole.", "Members press the Verify button or run /me steam verify.", "They sign in on Steam and come back to Discord with the role."],
        faq: [
            ["Does the bot see Steam passwords?", "No. Sign-in happens on Steam's own page."],
            ["Can the bot answer 'how do I get verified' by itself?", "Yes. It replies to that question with a picture guide and the exact commands."],
            ["Can I write my own guides?", "Yes. Managers add their own answers in the dashboard."]
        ],
        related: ["steam-library-value", "discord-giveaway-bot", "discord-game-deals-bot"]
    },
    "discord-giveaway-bot": {
        title: "Discord giveaway bot for game keys, Nitro and gift cards | Steam Value Checker",
        desc: "Run safe key giveaways in Discord. Prize keys are encrypted, only the winner sees one, unclaimed prizes are redrawn, and a vouch posts when it works. Twitch chat entry and stream overlays included.",
        h1: "A Discord giveaway bot built for game keys",
        lead: "Hand out game keys, Nitro, gift cards or anything else. Keys are encrypted the moment they're saved and only the winner ever sees one. Once they confirm it worked, the key is wiped and a vouch posts for you.",
        sections: [
            ["How a giveaway runs", ["It ends and winners are drawn", "The winner presses Claim prize and the key arrives by DM, or privately in the channel if DMs are closed", "They press one button to confirm it worked", "A vouch goes up in your vouches channel"]],
            ["Extras", ["Several prizes in one giveaway, with custom art, GIFs or video", "Role requirements and bonus entries", "Unclaimed prizes redrawn, unused keys returned to the host", "Enter from Twitch chat, with an OBS overlay for streamers"]]
        ],
        steps: ["Add the bot and open the Giveaways page in the dashboard.", "Add the prizes and pick the channel and end time.", "Let it run. It draws, DMs and posts the vouch."],
        faq: [
            ["Are the keys safe?", "They're encrypted when saved. Only the winner sees one."],
            ["What if the winner never claims?", "The prize is redrawn."],
            ["Can viewers enter from Twitch?", "Yes, from Twitch chat."]
        ],
        related: ["steam-verified-role", "free-game-alerts", "discord-game-deals-bot"]
    }
};

const NAV_LABEL = { "steam-library-value": "Steam library value", "discord-game-deals-bot": "Game deal alerts", "free-game-alerts": "Free game alerts", "steam-verified-role": "Steam Verified role", "discord-giveaway-bot": "Giveaway bot" };

export const seoSlugs = () => Object.keys(SEO_PAGES);

export function renderSeoPage(slug, { origin, invite = null } = {}) {
    const p = SEO_PAGES[slug];
    if (!p) return null;
    const url = `${origin}/${slug}`;
    const ld = [
        { "@context": "https://schema.org", "@type": "WebPage", name: p.title, description: p.desc, url, isPartOf: { "@type": "WebSite", name: "Steam Value Checker", url: origin } },
        { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Steam Value Checker", item: origin + "/" }, { "@type": "ListItem", position: 2, name: NAV_LABEL[slug], item: url }] },
        { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: p.faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
        { "@context": "https://schema.org", "@type": "HowTo", name: p.h1, step: p.steps.map((t, i) => ({ "@type": "HowToStep", position: i + 1, text: t })) }
    ];
    const list = items => `<ul>${items.map(i => `<li>${esc(i)}</li>`).join("")}</ul>`;
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.title)}</title>
<meta name="description" content="${esc(p.desc)}">
<link rel="canonical" href="${url}">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Steam Value Checker">
<meta property="og:title" content="${esc(p.title)}">
<meta property="og:description" content="${esc(p.desc)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${origin}/preview.jpg?v=2">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:creator" content="@twit_user69">
<meta name="theme-color" content="#0f1724">
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="stylesheet" href="/seo.css">
<script src="/theme.js"></script>
${ld.map(o => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, "\\u003c")}</script>`).join("\n")}
</head>
<body>
<header class="top"><div class="wrap"><a class="brand" href="/"><img src="/logo.png" alt="" width="30" height="30"><span>Steam Value Checker</span></a>
<nav aria-label="Main"><a href="/">Dashboard</a><a href="/ai">AI companion</a><a href="/grabber">FanaticalGrabber</a></nav></div></header>
<main class="wrap">
<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Steam Value Checker</a> / <span>${esc(NAV_LABEL[slug])}</span></nav>
<h1>${esc(p.h1)}</h1>
<p class="lead">${esc(p.lead)}</p>
<div class="cta"><a class="btn go" href="${invite ? esc(invite) : "/"}">${invite ? "Add it to your server" : "Open the dashboard"}</a><a class="btn alt" href="/auth/steam">Sign in through Steam</a></div>
${p.sections.map(([h, body]) => `<section><h2>${esc(h)}</h2>${body.length > 1 && body.every(x => x.length < 130) ? list(body) : body.map(t => `<p>${esc(t)}</p>`).join("")}</section>`).join("\n")}
<section><h2>How to get started</h2><ol>${p.steps.map(s => `<li>${esc(s)}</li>`).join("")}</ol></section>
<section class="faq"><h2>Questions</h2>${p.faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}</section>
<section class="more"><h2>More from Steam Value Checker</h2><ul class="links">${p.related.map(r => `<li><a href="/${r}">${esc(NAV_LABEL[r])}</a></li>`).join("")}<li><a href="/ai">AI companion (beta)</a></li></ul></section>
</main>
<footer class="foot wrap"><span>Prices by <a href="https://isthereanydeal.com" rel="noopener noreferrer">IsThereAnyDeal</a>. Not affiliated with Valve, Steam or IsThereAnyDeal.</span>
<span>${seoSlugs().map(s => `<a href="/${s}">${esc(NAV_LABEL[s])}</a>`).join(" · ")} · <a href="/terms.html">Terms</a> · <a href="/privacy.html">Privacy</a></span></footer>
</body>
</html>
`;
}
