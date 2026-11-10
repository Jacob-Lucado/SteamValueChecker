// The indie developer toolbox: what each tool is called and says, for the tools page, search results and link previews.
// The tools themselves run in the visitor's browser (public/indietools.js); nothing a person types or drops in is uploaded.
export const INDIE_CATS = [
    { id: "page", name: "Check your store page", blurb: "Quick checks before you press the button." },
    { id: "art", name: "Capsules and screenshots", blurb: "Your first impression is a thumbnail the size of a postage stamp." },
    { id: "money", name: "Price and revenue", blurb: "What a sale is really worth to you." },
    { id: "launch", name: "Wishlists and launch", blurb: "Numbers and dates for the big day." },
    { id: "press", name: "Press and creators", blurb: "Emails and fact sheets written from your game's own details." },
    { id: "research", name: "Market research", blurb: "Look up any game on Steam." }
];

export const INDIE_TOOLS = [
    { id: "short-description", cat: "page", name: "Short Description Grader", desc: "Checks the length, the hook and the filler words in your Steam short description." },
    { id: "tag-checker", cat: "page", name: "Tag Checker", desc: "Flags broad tags crowding your top five and shows how many tag slots you haven't used." },
    { id: "page-checklist", cat: "page", name: "Steam Page Checklist", desc: "Every piece of a store page worth finishing, with progress you can come back to." },
    { id: "next-fest-checklist", cat: "page", name: "Next Fest Checklist", desc: "What to finish before Next Fest traffic arrives: demo, capsule, screenshots and copy." },
    { id: "trailer-check", cat: "art", name: "Trailer First-Seconds Check", desc: "Looks at the first five seconds of your trailer for dark openings and still frames. Your video stays on your computer." },
    { id: "capsule-analyzer", cat: "art", name: "Capsule Analyzer", desc: "Shrinks your capsule to its smallest size and measures brightness and contrast.", fresh: true },
    { id: "capsule-sizes", cat: "art", name: "Capsule Sizes and Resizer", desc: "Every Steam image size in one list, and one picture cropped to all of them as a zip." },
    { id: "screenshot-checker", cat: "art", name: "Screenshot Checker", desc: "Finds dark screenshots in your first five and suggests a better order." },
    { id: "fee-calculator", cat: "money", name: "Steam Fee and Tax Calculator", desc: "What you keep from each sale after Valve's cut, VAT and refunds." },
    { id: "break-even", cat: "money", name: "Break-Even Calculator", desc: "How many copies, reviews and wishlists it takes to earn your budget back." },
    { id: "review-score", cat: "money", name: "Review Score Calculator", desc: "Your Steam review label and how many positive reviews the next one takes." },
    { id: "revenue-estimator", cat: "money", name: "Steam Revenue Estimator", desc: "Estimates a game's sales and revenue from its review count. Paste a store link.", fresh: true },
    { id: "wishlist-calculator", cat: "launch", name: "Wishlist Calculator", desc: "Turns wishlists into likely first-week and first-year sales, or works backward from a goal." },
    { id: "wishlist-conversion", cat: "launch", name: "Wishlist Conversion Check", desc: "Compares your visits-to-wishlist rate with what healthy pages tend to see." },
    { id: "next-fest-score", cat: "launch", name: "Next Fest Readiness Score", desc: "Answer a few questions and get a 0 to 100 score with the gaps worth fixing first." },
    { id: "launch-planner", cat: "launch", name: "Launch Date Planner", desc: "Pick a date and see which Steam sales and festivals sit around it." },
    { id: "demo-or-playtest", cat: "launch", name: "Demo or Playtest?", desc: "Five questions to decide which one fits your build right now." },
    { id: "x-post", cat: "press", name: "X Post Generator", desc: "Ready-to-post tweets for your announcement, launch, demo, dev updates and Screenshot Saturday.", fresh: true },
    { id: "press-email", cat: "press", name: "Press Email Generator", desc: "A first pitch, a review key offer and a launch email, written from your game's details.", fresh: true },
    { id: "creator-pitch", cat: "press", name: "Creator Pitch Generator", desc: "Emails, DMs and follow-ups for YouTube, Twitch and TikTok creators.", fresh: true },
    { id: "fact-sheet", cat: "press", name: "Game Fact Sheet Generator", desc: "A press fact sheet in Markdown, HTML, plain text or JSON.", fresh: true },
    { id: "appid-finder", cat: "research", name: "Steam App ID Finder", desc: "Find any game's app ID from its name or store link." },
    { id: "rival-compare", cat: "research", name: "Rival Comparison", desc: "Put two games' price, reviews, genres and release dates side by side.", fresh: true }
];

/** The kinds of developer news, with how they read in a message and on the page. */
export const INDIE_KIND_LABEL = {
    news: { icon: "📰", name: "News", cta: "Read more" }, demo: { icon: "🎮", name: "Demo", cta: "Get the demo" },
    playtest: { icon: "🧪", name: "Playtest", cta: "Sign up" }, release: { icon: "🚀", name: "Release", cta: "See it on Steam" }, sale: { icon: "🏷️", name: "Sale", cta: "See the deal" }
};

const BY_ID = new Map(INDIE_TOOLS.map(t => [t.id, t]));
export const indieTool = id => BY_ID.get(id) ?? null;

/** Title, description and short answers for any /indie page, or null when the path isn't one of them. */
export function indieSeo(path, game = null) {
    const p = String(path).replace(/\/+$/, "");
    if (p === "/indie") return {
        title: "Indie games on Steam: discover and submit | Steam Value Checker",
        desc: "A showcase for indie games on Steam. Browse what small studios are making, submit your own game for free, and use a toolbox of free Steam developer tools.",
        alt: "Indie game showcase and developer tools by Steam Value Checker", slug: "indie",
        faq: [["What is the indie showcase?", "A free place to find games from small studios and to show off your own. Every game links straight to its Steam page."],
            ["How do I submit my game?", "Sign in with Discord, paste your Steam store link and add a short pitch. A person looks at every submission before it goes public."],
            ["Does it cost anything?", "No. Submitting, browsing and every tool are free."]]
    };
    if (p === "/indie/tools") return {
        title: `${INDIE_TOOLS.length} free Steam tools for indie game developers | Steam Value Checker`,
        desc: `${INDIE_TOOLS.length} free tools for Steam developers: fee and tax calculator, wishlist calculator, capsule analyzer and resizer, tag checker, press email generator and more. No sign-in, nothing uploaded.`,
        alt: "Free Steam tools for indie game developers", slug: "indie-tools",
        faq: [["Are the tools really free?", "Yes. There's no sign-in and no limit."], ["Is my game or my artwork uploaded?", "No. The calculators and image tools run in your browser, so pictures you drop in never leave your computer."],
            ["How accurate are the estimates?", "They use Valve's published fee tiers and review labels, and rules of thumb for wishlists and sales. Treat those as planning ranges, not promises."]]
    };
    const t = /^\/indie\/tools\/([a-z0-9-]+)$/.exec(p);
    if (t && BY_ID.has(t[1])) { const x = BY_ID.get(t[1]); return { title: `${x.name}: free tool for Steam developers | Steam Value Checker`, desc: `${x.desc} Free, no sign-in.`.slice(0, 200), alt: `${x.name} for Steam developers`, slug: "indie-tools", faq: [[`What does the ${x.name} do?`, x.desc], ["Is it free?", "Yes, with no sign-in. It runs in your browser."]] }; }
    if (p === "/indie/submit") return { title: "Submit your indie game | Steam Value Checker", desc: "Submit your Steam game to the indie showcase. Free, and every submission is read by a person before it goes live.", alt: "Submit your indie game", slug: "indie", noindex: true };
    if (p === "/indie/mine") return { title: "Your indie submissions | Steam Value Checker", desc: "Your games in the indie showcase.", alt: "Your indie submissions", slug: "indie", noindex: true };
    if (/^\/indie\/game\/\d{1,9}$/.test(p) && game) return {
        title: `${game.title} by ${game.studio || "an indie studio"} | Indie showcase`, desc: (game.pitch || game.blurb || `${game.title} is an indie game on Steam.`).slice(0, 200),
        alt: `${game.title} on Steam`, slug: "indie", image: game.image, game: true
    };
    return null;
}

/** The post the project's own X account sends when it spotlights a showcase game. Links count as 23 characters. */
export function indieSpotlightText(game, url, { wednesday = false } = {}) {
    const len = t => t.replace(/https?:\/\/\S+/g, "x".repeat(23)).length;
    const tags = `${wednesday ? "#WishlistWednesday " : ""}#indiegame #gamedev #Steam`, head = `Indie spotlight: ${game.title}${game.studio ? ` by ${game.studio}` : ""}`;
    let pitch = String(game.pitch || game.blurb || "").replace(/\s+/g, " ").trim();
    const build = p => `${head}\n\n${p ? p + "\n\n" : ""}${url}\n${tags}`;
    while (pitch.length > 12 && len(build(pitch)) > 280) pitch = pitch.slice(0, -6).trimEnd() + "…";
    return len(build(pitch)) <= 280 ? build(pitch) : `${head.slice(0, 120)}\n\n${url}\n${tags}`;
}
