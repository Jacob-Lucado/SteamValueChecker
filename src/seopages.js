// Pages that exist to be found: one plain, server-rendered page per thing people search for. Each has its own title, description,
// headings, answers and structured data, and links to the others, so search engines (and people) land on the right one without
// needing the dashboard to run. Kept as data so a new page is a few lines.

import { upcomingSales, SALES_UPDATED } from "./salescal.js";
import { money, steamArt } from "./render.js";

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
        lead: "Stores give games away all the time and the offers disappear fast. The bot posts each free game once, with the store, the end date and a button to claim it, so you don't have to keep checking. Steam free weekends are covered too, with the date they end.",
        sections: [
            ["What it covers", ["Free games on Epic, Steam, GOG and other stores", "Free weekends, demos and playtests", "Limited-time game codes like SHiFT codes, posted once and grayed out when they run out", "A /games freegames command that shows what's free right now"]],
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
    },
    "discord-timestamp-generator": {
        tool: true, script: "/tools/timestamp.js",
        title: "Discord timestamp generator: make timestamps that show in everyone's time zone",
        desc: "Free Discord timestamp generator. Pick a date, time and time zone and copy the code for any style, including the relative style that counts down. Shows each member the time in their own zone.",
        h1: "Discord timestamp generator",
        lead: "Pick a date and time, and copy the code. Paste it into Discord and every member sees it in their own time zone, so nobody has to do the math for your game night.",
        html: `<section class="tool"><div class="fields"><label>Date and time<input type="datetime-local" id="when"></label><label>Time zone<select id="zone"></select></label></div>
<p class="unix">Unix time: <code id="unix"></code></p><div id="styles" class="ts-list" aria-live="polite"></div><noscript><p>This tool needs JavaScript.</p></noscript></section>`,
        sections: [["How Discord timestamps work", ["A timestamp is a code like <t:1767225600:F>. Discord swaps it for the date and time in each reader's own time zone.", "The letter at the end picks the style. R is the relative style (\"in 3 hours\") and updates by itself."]],
            ["Make it automatic", ["Steam Value Checker uses the same codes for events, giveaways and looking-for-group posts, so you can just type the time and it does the rest."]]],
        steps: ["Choose the date, time and time zone.", "Press Copy on the style you want.", "Paste it into a Discord message."],
        faq: [["Do I need a bot for this?", "No. Timestamps are built into Discord. This page just writes the code for you."], ["Why does everyone see a different time?", "That's the point. Each person sees it converted to their own time zone."], ["Which style is best for events?", "Full date and time (F) for the start, and relative (R) next to it so people can see how long is left."]],
        related: ["discord-game-deals-bot", "discord-giveaway-bot", "steam-verified-role"]
    },
    "steam-id-finder": {
        tool: true, script: "/tools/steamid.js",
        title: "Steam ID finder: find your SteamID64 from a profile link or custom URL",
        desc: "Free Steam ID finder. Paste a profile link, custom URL name, SteamID or SteamID3 and get the SteamID64 and every other format, ready to copy.",
        h1: "Steam ID finder",
        lead: "Paste a Steam profile link, a custom profile name or any kind of Steam ID. You get the 64-bit SteamID64, the older STEAM_0 format, the SteamID3 format and a link to the profile.",
        html: `<section class="tool"><form id="sid-form" class="fields row"><label class="grow">Profile link, name or ID<input id="sid-in" type="text" autocomplete="off" spellcheck="false" placeholder="https://steamcommunity.com/id/yourname"></label><button class="go" type="submit">Find</button></form>
<p id="sid-msg" class="muted" aria-live="polite"></p><div id="sid-out" class="ts-list"></div><noscript><p>This tool needs JavaScript.</p></noscript></section>`,
        sections: [["What each format is", ["SteamID64 is the long 17-digit number (it starts with 7656119). Most tools and websites use it.", "SteamID looks like STEAM_0:1:12345. It's the older format used by some game servers.", "SteamID3 looks like [U:1:24691] and is used by newer Valve tools."]],
            ["Where to find it by hand", ["Open your Steam profile in a browser. If the address ends in /profiles/ and a number, that's your SteamID64. If it has a custom name after /id/, paste it here."]]],
        steps: ["Paste your profile link, custom name or ID.", "Press Find.", "Copy the format you need."],
        faq: [["Is it safe?", "Yes. It only reads public profile information. It never asks for a password."], ["Why can't it find my profile?", "Custom names have to match your profile address exactly, and the profile must exist. Try pasting the full link."], ["Can I use the ID to see my library value?", "Yes. Sign in with Steam on the dashboard and it works out your library value for you."]],
        related: ["steam-library-value", "steam-verified-role", "discord-game-deals-bot"]
    },
    "steam-refund-calculator": {
        tool: true, script: "/tools/refund.js",
        title: "Steam refund calculator: can I still refund my game? 14 days and 2 hours explained",
        desc: "Check if your Steam game is still refundable. Enter the purchase date and hours played and see if you're inside Steam's 14-day, 2-hour refund window, with the steps to ask for it.",
        h1: "Steam refund calculator",
        lead: "Steam usually refunds a game if you ask within 14 days of buying it and you've played less than 2 hours. Enter your purchase date and playtime to see where you stand.",
        html: `<section class="tool"><div class="fields"><label>Purchase date<input type="date" id="rf-date"></label><label>Hours played<input type="number" id="rf-hours" min="0" step="0.1" value="0"></label></div>
<label class="check"><input type="checkbox" id="rf-pre"> It's a pre-order that hasn't been released yet</label><div id="rf-out" class="rf-out" aria-live="polite"></div><noscript><p>This tool needs JavaScript.</p></noscript></section>`,
        sections: [["The refund rules in short", ["14 days from purchase and under 2 hours of playtime. If you meet both, Steam refunds it, no reason needed.", "Pre-orders can be refunded any time before release.", "Outside the window, Steam can still look at special cases, so it never hurts to ask."]],
            ["Never miss the window", ["Steam Value Checker can remind you before the two-hour and fourteen-day windows close, so you can decide while it's still free to change your mind."]]],
        steps: ["Enter the purchase date and hours played.", "Read the result.", "If you're eligible, open Steam Support, pick the game under Purchases and choose “I would like a refund”."],
        faq: [["Does it work for DLC?", "Mostly yes, the same 14-day, 2-hour idea applies to DLC, though some in-game items are different."], ["Where do I see my hours played?", "In your Steam library, on the game's page, under Play Time."], ["Does Steam refund to my card?", "Usually to your original payment method, or to Steam Wallet if you pick that."]],
        related: ["steam-library-value", "discord-game-deals-bot", "free-game-alerts"]
    },
    "steam-deals-this-week": {
        dynamic: "deals",
        title: "Best Steam deals this week: the biggest discounts right now | Steam Value Checker",
        desc: "The best Steam sales this week: big discounts on games that are worth the money, refreshed every hour. Get a Discord ping when a game on your wishlist drops to the price you want.",
        h1: "The best Steam deals this week",
        lead: "These are the biggest savings on Steam right now, sorted by how many dollars you keep. Cheap games and tiny discounts are left out, so what's here is worth a look. The list refreshes every hour.",
        sections: [["How the list is picked", ["Only discounts of 50% or more on games that normally cost $10 or more. One entry per game, biggest dollar saving first.", "Prices come from IsThereAnyDeal and are shown in US dollars. Check the store page for your own region."]]],
        steps: ["Add the bot to your server, or to your own account.", "Bring in your Steam wishlist.", "Pick the alert you want and get a message when a game on your list goes on sale."],
        faq: [["How often does this page change?", "Every hour. Steam deals can end without warning, so check the price on the store before you buy."], ["Are these all-time lows?", "Not always. The bot shows a year of price history and whether a game has hit its low, so you can tell a good deal from an average one."], ["Can I get these in Discord?", "Yes. A weekly roundup posts every Friday, and wishlist alerts fire the moment your own games go on sale."]],
        related: ["steam-sale-dates", "discord-game-deals-bot", "free-game-alerts"]
    },
    "steam-sale-dates": {
        dynamic: true,
        title: "Steam sale dates: when is the next Steam sale?",
        desc: "The next Steam sale dates, with a live countdown: Winter, Spring and Summer sales and Next Fest. Plus how to get a Discord ping when each one starts.",
        h1: "When is the next Steam sale?",
        lead: "Here are the dates Valve has published for Steam's big sales and festivals, soonest first. Get a ping in Discord when one starts.",
        sections: [["Good to know", ["Valve announces sale dates ahead of time. Black Friday week deals are announced closer to the date.", "Steam events start at 10am Pacific.", "Winter is usually the deepest sale of the year, and Summer is second."]]],
        steps: ["Add the bot to your server.", "Turn on sale-start alerts for the channel.", "Add your wishlist so you see which of your games are on sale."],
        faq: [["How many Steam sales are there a year?", "Four big ones: Spring, Summer, Autumn and Winter, plus themed festivals and Next Fest, which is for demos."], ["Are these dates official?", "They come from Valve's published schedule. The page shows when it was last checked."], ["Should I wait for a sale?", "For most games the sale price is the lowest, but check the price history. The bot shows a year of prices and whether it has hit its low."]],
        related: ["discord-game-deals-bot", "free-game-alerts", "steam-library-value"]
    }
};

const NAV_LABEL = { "steam-library-value": "Steam library value", "discord-game-deals-bot": "Game deal alerts", "free-game-alerts": "Free game alerts", "steam-verified-role": "Steam Verified role", "discord-giveaway-bot": "Giveaway bot", "discord-timestamp-generator": "Discord timestamp generator", "steam-id-finder": "Steam ID finder", "steam-refund-calculator": "Steam refund calculator", "steam-sale-dates": "Steam sale dates", "steam-deals-this-week": "Best Steam deals this week" };

const dayFmt = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" });
function salesHtml(now = Date.now()) {
    const rows = upcomingSales(now, { limit: 8 }).map(ev => {
        const live = ev.start <= now, days = Math.max(0, Math.ceil((ev.start - now) / 86400_000));
        const when = live ? "On now" : days <= 1 ? "Starts tomorrow" : `In ${days} days`;
        return `<li class="sale"><div><b>${esc(ev.name)}</b><span>${dayFmt.format(ev.start)} to ${dayFmt.format(ev.end)}${ev.note ? ` · ${esc(ev.note)}` : ""}</span></div><time datetime="${new Date(ev.start).toISOString()}" data-end="${new Date(ev.end).toISOString()}">${when}</time></li>`;
    }).join("");
    return `<section class="tool"><ul class="sales">${rows}</ul><p class="muted">Dates checked ${dayFmt.format(Date.parse(SALES_UPDATED))}. Steam events start at 10am Pacific.</p></section>`;
}

function dealsHtml(deals) {
    const rows = (deals ?? []).map(d => {
        const art = d.appid ? steamArt(d.appid) : null;
        return `<li class="deal"><a href="${esc(d.url)}" rel="noopener noreferrer">${art ? `<img src="${esc(art)}" alt="" width="184" height="69" loading="lazy">` : ""}<span class="deal-name">${esc(d.title)}</span><span class="deal-price"><s>${esc(money(d.regular, d.currency))}</s> <b>${esc(money(d.price, d.currency))}</b> <em>-${Math.round(d.cut)}%</em></span></a></li>`;
    }).join("");
    if (!rows) return `<section class="tool"><p class="muted">The deals list is loading. Check back in a few minutes.</p></section>`;
    return `<section class="tool"><ul class="deals">${rows}</ul><p class="muted">Updated hourly. Prices in US dollars from IsThereAnyDeal.</p></section>`;
}

export const seoSlugs = () => Object.keys(SEO_PAGES);
export const seoIsLive = slug => !!SEO_PAGES[slug]?.dynamic;

export function renderSeoPage(slug, { origin, invite = null, deals = null } = {}) {
    const p = SEO_PAGES[slug];
    if (!p) return null;
    const url = `${origin}/${slug}`;
    const ld = [
        { "@context": "https://schema.org", "@type": "WebPage", name: p.title, description: p.desc, url, isPartOf: { "@type": "WebSite", name: "Steam Value Checker", url: origin } },
        { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Steam Value Checker", item: origin + "/" }, { "@type": "ListItem", position: 2, name: NAV_LABEL[slug], item: url }] },
        ...(p.tool ? [{ "@context": "https://schema.org", "@type": "WebApplication", name: p.h1, url, applicationCategory: "UtilitiesApplication", operatingSystem: "Any", offers: { "@type": "Offer", price: "0", priceCurrency: "USD" } }] : []),
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
<link rel="stylesheet" href="/scrollbar.css">
<link rel="stylesheet" href="/motion.css">
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
${p.tool ? p.html : p.dynamic === "deals" ? dealsHtml(deals) : p.dynamic ? salesHtml() : ""}
<div class="cta"><a class="btn go" href="${invite ? esc(`${invite}?src=seo-${slug}`) : "/"}">${invite ? "Add it to your server" : "Open the dashboard"}</a><a class="btn alt" href="/auth/steam">Sign in through Steam</a></div>
${p.sections.map(([h, body]) => `<section><h2>${esc(h)}</h2>${body.length > 1 && body.every(x => x.length < 130) ? list(body) : body.map(t => `<p>${esc(t)}</p>`).join("")}</section>`).join("\n")}
<section><h2>How to get started</h2><ol>${p.steps.map(s => `<li>${esc(s)}</li>`).join("")}</ol></section>
<section class="faq"><h2>Questions</h2>${p.faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}</section>
<section class="more"><h2>More from Steam Value Checker</h2><ul class="links">${p.related.map(r => `<li><a href="/${r}">${esc(NAV_LABEL[r])}</a></li>`).join("")}<li><a href="/ai">AI companion (beta)</a></li></ul></section>
</main>
<footer class="foot wrap"><span>Prices by <a href="https://isthereanydeal.com" rel="noopener noreferrer">IsThereAnyDeal</a>. Not affiliated with Valve, Steam or IsThereAnyDeal.</span>
<span>${seoSlugs().map(s => `<a href="/${s}">${esc(NAV_LABEL[s])}</a>`).join(" · ")} · <a href="/terms.html">Terms</a> · <a href="/privacy.html">Privacy</a></span></footer>
<script src="/motion.js" defer></script>
${p.script ? `<script src="${p.script}" defer></script>` : ""}${p.dynamic === true ? `<script src="/tools/sales.js" defer></script>` : ""}
</body>
</html>
`;
}
