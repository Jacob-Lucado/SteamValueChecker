// Spots the messages scam accounts paste into every channel they can reach: stolen cards for sale, cash-out and "flip" schemes, bank logs.
// It scores the text instead of matching one phrase, because these posts change wording but always mix the same kinds of giveaways:
// card talk, cash-out talk, and a "message me to buy" line. One strong term (like "fullz") is enough by itself; a normal chat mention of a
// credit card never is. Pure functions, no database, so it's easy to test.

const SIGNALS = [
    // Strong on their own: nobody says these in a game-deal server unless they're selling something.
    [/\bfullz\b/, 6, "fullz"],
    [/\blinkables?\b/, 6, "linkables"],
    [/\b(?:bank|cc|card)\s*logs?\b/, 6, "logs"],
    [/\bclon(?:e|ed)\s+(?:credit\s+|debit\s+|atm\s+)?cards?\b/, 6, "clone cards"],
    [/\bblank\s+atm\b/, 6, "blank atm"],
    [/\b(?:money|cash|cash\s*app|paypal|venmo|zelle|bank)\s*(?:flip|flips|drop|drops)\b/, 6, "flip"],
    [/\bcc\s*(?:dumps?|shop)\b|\bdumps?\s+with\s+pins?\b/, 6, "dumps"],
    // Strong when they sit next to the rest.
    [/\bcash\s*-?\s*out\b/, 3, "cashout"],
    [/\bno\s+charge\s*-?\s*backs?\b/, 3, "no chargeback"],
    [/\bhitting\s+instantly\b/, 3, "hitting instantly"],
    [/\b(?:fresh|valid|high\s+quality|good)\s+(?:and\s+\w+\s+)?(?:credit\s+cards?|ccs?|cards?)\b/, 3, "fresh cards"],
    [/\b(?:high\s+quality|fresh|valid)\s+ccs?\b/, 3, "fresh ccs"],
    [/\bdebit\b.{0,20}\bpins?\b/, 3, "debit with pins"],
    [/\bbalance\s*[:=]?\s*\$?\s*\d{3,5}\s*\$?/, 2, "balance"],
    [/\b(?:\$\s*\d{2,4}|\d{2,4}\s*\$)\s*(?:for|per)\s+(?:one|1|each|a)?\s*(?:card|cc|acc|account)/, 3, "price list"],
    [/\b(?:atm|cash\s*app|apple\s*pay|paypal|venmo|gpay|zelle)\b/, 1, "payment apps"],
    [/\b(?:credit|debit)\s*cards?\b|\bccs?\b|\b(?:visa|master\s*card)\b/, 1, "cards"],
    [/\bwalk\s*-?\s*through\b/, 1, "walkthrough"],
    // The "message me" line.
    [/\b(?:dm|pm|inbox|text|message|contact|hit)\s+(?:me|@\S+|us)\b|\bdm\s+(?:@\S+\s+)?to\s+(?:purchase|buy|order)\b|\bhit\s+me\s+up\b/, 2, "dm me"],
    [/\b(?:telegram|whatsapp|wickr|signal)\b|\bt\.me\/|\bwa\.me\//, 2, "off-site chat"],
    [/\b(?:who\s+needs?|anyone\s+needs?|for\s+sale|selling|to\s+purchase|available)\b/, 1, "sale cue"]
];

/** Lowercases, folds fancy Unicode letters (𝗕𝗼𝗹𝗱, ｗｉｄｅ) to plain ones, and drops zero-width characters and emoji so they can't be used to split a word. */
export function normalize(text) {
    return String(text ?? "").normalize("NFKC").toLowerCase()
        .replace(/[​-‏⁠﻿­]/g, "")
        .replace(/\p{Extended_Pictographic}|️/gu, " ")
        .replace(/\s+/g, " ").trim();
}

/** { scam, score, hits } for one message. `threshold` is how many points it takes; the defaults catch the posts above and leave normal chat alone. */
export function scamScore(text, { threshold = 6 } = {}) {
    const t = normalize(text);
    if (t.length < 20) return { scam: false, score: 0, hits: [] };
    let score = 0; const hits = [];
    for (const [re, w, name] of SIGNALS) if (re.test(t)) { score += w; hits.push(name); }
    return { scam: score >= threshold, score, hits };
}
