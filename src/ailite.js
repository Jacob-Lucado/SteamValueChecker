// The AI companion without the AI: while there is no AI key the bot still answers the questions people ask most, by looking
// them up itself with the same tools the full AI uses. Anything else gets an honest "coming soon" and a list of what works.

const EXAMPLES = [
    "`Hey AI is Hades on sale?`",
    "`Hey AI what's free right now?`",
    "`Hey AI what's on my wishlist?`",
    "`Hey AI what should I play next?`",
    "`Hey AI how much is Celeste?`"
];
export const LITE_HELP = `I can't chat freely yet, the full AI is coming soon. Until then I can look things up. Try:\n${EXAMPLES.map(e => `• ${e}`).join("\n")}`;

const clean = s => String(s ?? "").replace(/^[\s"'“”‘’`]+|[\s"'“”‘’`?!.,:;]+$/g, "").replace(/\s+/g, " ").trim();

/** Pulls a game title out of "is X on sale", "how much is X", "price of X", or a title in quotes. */
export function titleFrom(q) {
    const quoted = /["“”`]([^"“”`]{2,80})["“”`]/.exec(q);
    if (quoted) return clean(quoted[1]);
    const m =
        /\b(?:price|cost|prices|deal|deals|sale)s?\s+(?:of|for|on)\s+(.+)$/i.exec(q) ||
        /\bhow\s+much\s+(?:is|does|for|are)\s+(.+?)(?:\s+(?:cost|right now|now|today))?$/i.exec(q) ||
        /\b(?:is|are)\s+(.+?)\s+(?:on\s+sale|cheap|discounted|worth\s+it|a\s+good\s+(?:deal|price))\b/i.exec(q) ||
        /\b(?:check|look\s*up|find)\s+(?:the\s+)?(?:price\s+(?:of|for)\s+)?(.+)$/i.exec(q);
    const t = m ? clean(m[1].replace(/\b(?:on sale|right now|today|please)\b/gi, "")) : "";
    return t.length >= 2 && t.length <= 80 ? t : null;
}

// Everything else the AI can look up. Each row: what the question looks like, the tool, and how to put its answer in words.
const bullets = (head, list) => `${head}\n${list.map(x => `• ${x}`).join("\n")}`;
const MORE = [
    [/\b(rarest|rare)\b.*\b(achievements?|trophies)\b|\bmy achievements\b/, "my_achievements", r => r.rarest ? bullets(`You've unlocked **${r.unlocked}** achievements across ${r.gamesWithAchievements} games. Your rarest:`, r.rarest.slice(0, 6).map(a => `**${a.achievement}** in ${a.game} (${a.ownedByPercentOfPlayers}% of players)`)) : r.note],
    [/\b(hours|playtime|most played|play most|steam stats)\b/, "my_steam", r => r.games ? `You have **${r.games}** Steam games and about **${r.totalHours} h** played. Most played: ${r.mostPlayed.slice(0, 3).map(g => `${g.title} (${g.hours})`).join(", ")}.` : r.note],
    [/\b(spent|spending|how much (have|did) i (spend|pay))\b/, "my_spending", r => r.total !== undefined ? `You've spent **${r.total} ${r.currency}** on ${r.games} games (${r.thisYear.total} this year). Bought but never played: ${r.boughtButUnplayed.count}.` : r.note],
    [/\b(badges?|trophy case)\b/, "my_badges", r => bullets(`You've earned **${r.earned}** of ${r.total} badges:`, r.badges.filter(b => b.tier).slice(0, 8).map(b => `${b.name} (${b.tier})`))],
    [/\b(challenge|streak|goal)\b/, "my_challenge", r => `This month: **${r.finishedThisMonth}**${r.goal ? ` of ${r.goal}` : ""} finished, ${r.daysLeft} days left. Streak: ${r.streakMonths} month${r.streakMonths === 1 ? "" : "s"}.`],
    [/\b(deals? for me|what should i buy|recommend|picks? for me)\b/, "deals_for_you", r => r.deals ? bullets("Deals that fit you:", r.deals.slice(0, 5).map(d => `**${d.title}**: ${d.price} (-${d.discountPct}%) at ${d.shop}`)) : r.note],
    [/\b(upcoming|coming up|calendar|events?|releases?)\b/, "upcoming", r => r.entries ? bullets("Coming up:", r.entries.slice(0, 8).map(e => `${e.date}: ${e.title}`)) : r.note],
    [/\b(sale plan|next sale|steam sale|what to buy)\b/, "sale_plan", r => `${r.nextSale ? `Next big sale: **${r.nextSale.name}** (${r.nextSale.starts}).\n` : ""}${r.buyNow.length ? bullets("Worth buying now:", r.buyNow.slice(0, 5).map(g => `**${g.title}**: ${g.price}`)) : "Nothing on your wishlist is a great buy right now."}`],
    [/\b(news|patch notes|updates)\b/, "game_news", r => r.posts ? bullets("Latest for your games:", r.posts.slice(0, 5).map(p => `**${p.game}**: ${p.title}`)) : r.note],
    [/\b(birthdays?|friends)\b/, "my_friends", r => r.friends ? bullets("Your friends:", r.friends.slice(0, 8).map(f => `${f.name}${f.daysUntil !== null ? `: ${f.daysUntil} days to their birthday` : ""}`)) : r.note],
    [/\b(my settings|alert settings)\b/, "my_settings", r => `Alerts are **${r.alerts}**, delivered by ${r.delivery}. Region ${r.region}, ${r.gamesWatched} games watched, quiet hours: ${r.quietHours}.`]
];

export function intentOf(question) {
    const q = String(question ?? "").toLowerCase();
    if (/\b(what (all )?(can|do) you (do|help)|what are you (able|capable)|your (features|abilities|commands)|how (can|do) you help|what do you know|abilities|capabilities)\b|^help\b/.test(q)) return { kind: "abilities" };
    if (!q.trim() || /^(hi|hey|hello|yo|sup|commands)\b/.test(q.trim()) && q.split(" ").length <= 4) return { kind: "help" };
    if (/\bfree\b.*\b(games?|now|today|right now|claim|epic|steam|gog)\b|\bwhat'?s free\b|\bfree (games?|stuff)\b/.test(q)) return { kind: "free" };
    if (/\b(my )?wish ?list\b/.test(q)) return { kind: "wishlist" };
    if (/\b(play next|what (should|do) i play|what to play|something to play)\b/.test(q)) return { kind: "next" };
    if (/\b(backlog|my library|library|(steam|library|games?) (worth|value))\b|\bworth\b/.test(q)) return { kind: "library" };
    if (/\b(leaderboard|top savers|who saved)\b/.test(q)) return { kind: "board" };
    const more = MORE.findIndex(([re]) => re.test(q));
    if (more >= 0) return { kind: "more", more };
    const title = titleFrom(String(question));
    if (title) return { kind: "price", title };
    return { kind: "unknown" };
}

/** Writes the reply for one question using the tools. Always returns text. */
export async function liteAnswer({ question, userId, guildId, tools, cards }) {
    const it = intentOf(question);
    const run = (name, input) => tools.run(name, input, { userId, guildId, cards });
    if (it.kind === "abilities") { const r = await run("what_can_you_do", {}); return `**Here's what I can do:**\n${r.abilities.map(x => `• ${x}`).join("\n")}`; }
    if (it.kind === "help" || it.kind === "unknown") return LITE_HELP;

    if (it.kind === "more") {
        const [, tool, say] = MORE[it.more];
        const r = await run(tool, {});
        return r.error ? `I couldn't look that up just now: ${r.error}` : r.empty ? r.note : r.linked === false ? r.note : say(r);
    }
    if (it.kind === "free") {
        const r = await run("free_games", {});
        if (r.error) return "I couldn't check the free games just now. Try `/games freegames`.";
        if (!r.games.length) return "Nothing is free to claim right now. I'll tell you in your alerts when something shows up.";
        return `**Free to claim right now:**\n${r.games.slice(0, 8).map(g => `• **${g.title}** on ${g.store} (until ${g.endsAt})`).join("\n")}`;
    }
    if (it.kind === "price") {
        const r = await run("check_prices", { titles: [it.title] });
        const g = r.games?.[0];
        if (r.error || !g) return "I couldn't look that up just now. Try `/games value`.";
        if (g.found === false) return `I couldn't find a game called **${it.title}**. Try the full title.`;
        const lines = [`**${g.matched}**${g.closeMatchOnly ? " (closest match)" : ""}`];
        if (g.fullPrice) lines.push(`Full price: ${g.fullPrice}`);
        if (g.steamNow) lines.push(`Steam now: ${g.steamNow}${g.steamDiscountPct ? ` (-${g.steamDiscountPct}%)` : ""}`);
        if (g.cheapestNow) lines.push(`Cheapest now: ${g.cheapestNow}`);
        if (g.allTimeLow) lines.push(`All-time low: ${g.allTimeLow}`);
        return lines.length > 1 ? lines.join("\n") : `I found **${g.matched}** but no prices for it yet.`;
    }
    if (it.kind === "wishlist") {
        const r = await run("my_wishlist", {});
        if (r.error) return "I couldn't read your wishlist just now. Try `/me wishlist view`.";
        if (r.empty) return "Your wishlist is empty. Import it with `/me wishlist import` or add a game with `/me wishlist add`.";
        const sale = r.games.filter(g => g.discountPct > 0);
        const head = `Your wishlist has **${r.total}** game${r.total === 1 ? "" : "s"}, **${r.onSale}** on sale.`;
        const list = (sale.length ? sale : r.games).slice(0, 6).map(g => `• **${g.title}**${g.bestNow ? `: ${g.bestNow}` : ""}${g.discountPct ? ` (-${g.discountPct}%)` : ""}`).join("\n");
        return `${head}\n${list}`;
    }
    if (it.kind === "next") {
        const r = await run("play_next", {});
        return r.error ? "I couldn't read your library just now. Try `/me library view`." : r.empty ? r.note : `Play **${r.pick}** next. ${r.why}`;
    }
    if (it.kind === "library") {
        const r = await run("my_library", {});
        if (r.error) return "I couldn't read your library just now. Try `/me library view`.";
        if (r.empty) return "Your library is empty. It fills from a Steam sign-in or `/me library import`.";
        return `You own **${r.games}** games, paid ${r.paid} (worth ${r.worthAtFullPrice} at full price). **${r.backlogGames}** still in the backlog.`;
    }
    if (it.kind === "board") {
        const r = await run("server_leaderboard", {});
        if (r.error || r.empty) return r.note || r.error;
        return `**Top savers here:**\n${r.top.map(t => `${t.rank}. ${t.member}: ${t.savedPct}% saved on ${t.games} games`).join("\n")}`;
    }
    return LITE_HELP;
}
