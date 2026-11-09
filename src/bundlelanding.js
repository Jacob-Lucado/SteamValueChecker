// The page a bundle post on X links to: it shows the bundle, counts the visit, and sends the person on to the store after a few seconds.
// Without scripts, a meta refresh in <noscript> does the redirect. With them the page counts down, and "Stay on this page" can stop it.
// There are no inline styles or scripts, because the site's CSP doesn't allow them.
import { BUNDLE_STORES } from "./bundlefeedsource.js";

export const REDIRECT_SECONDS = 6;
const esc = t => String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const STORE_HOSTS = [...new Set(Object.values(BUNDLE_STORES).map(s => new URL(s.home).hostname.replace(/^www\./, "")))];

/** Only https links to the stores we know get an automatic redirect. Anything else is shown, never followed. */
export function bundleDestination(url) {
    try {
        const u = new URL(String(url));
        if (u.protocol !== "https:") return null;
        const host = u.hostname.replace(/^www\./, "");
        return STORE_HOSTS.some(h => host === h || host.endsWith("." + h)) ? u.href : null;
    } catch { return null; }
}

/** Pictures are fetched by us and served from our own address, so the page's CSP can stay strict. https only, no IP addresses or local names. */
export const safePictureUrl = url => {
    try { const u = new URL(String(url)); return u.protocol === "https:" && /\.[a-z]{2,}$/i.test(u.hostname) && !/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname) ? u.href : null; } catch { return null; }
};

const endsText = (ms, now) => {
    if (!ms) return "No end date listed, so grab it while it lasts";
    if (ms <= now) return "This bundle has ended";
    const left = ms - now, d = Math.floor(left / 86_400_000), h = Math.floor(left % 86_400_000 / 3_600_000);
    const when = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(ms));
    return `Ends ${when} Eastern${d > 0 ? ` (${d} day${d === 1 ? "" : "s"} left)` : h > 0 ? ` (${h} hour${h === 1 ? "" : "s"} left)` : " (less than an hour left)"}`;
};

/** The whole page. `b` is the stored bundle row (games as an array). */
export function renderBundleLanding(b, { origin, inviteUrl = null, supportUrl = null, now = Date.now(), hasPicture = false } = {}) {
    const store = BUNDLE_STORES[b.store] ?? { name: b.store ?? "the store", emoji: "📦" };
    const dest = bundleDestination(b.url), ended = Boolean(b.expires_at && b.expires_at <= now) || b.status === "expired";
    const count = b.game_count ?? (b.games?.length || null);
    const title = `${b.title} | ${store.name} bundle`;
    const desc = `${b.price ? b.price + ". " : ""}${count ? count + " games. " : ""}${endsText(b.expires_at, now)}. Found by the Steam Value Checker Discord bot.`.replace(/\s+/g, " ");
    const go = `${origin}/b/${b.id}/go`, page = `${origin}/b/${b.id}`;
    const games = (b.games ?? []).slice(0, 10);
    const more = (count ?? games.length) - games.length;
    const redirect = dest && !ended;
    const head = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#0f1724">
<link rel="canonical" href="${esc(page)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Steam Value Checker">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(page)}">
${hasPicture ? `<meta property="og:image" content="${esc(page)}/img">\n<meta name="twitter:card" content="summary_large_image">` : `<meta property="og:image" content="${esc(origin)}/banner.png">\n<meta name="twitter:card" content="summary">`}
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="stylesheet" href="/go.css">
${redirect ? `<noscript><meta http-equiv="refresh" content="${REDIRECT_SECONDS};url=${esc(go)}"></noscript>` : ""}
</head>`;
    const body = `<body>
<header class="top"><a class="brand" href="/"><img src="/logo.png" alt="" width="30" height="30"><span>Steam Value Checker</span></a></header>
<main class="wrap">
<article class="card">
${hasPicture ? `<img class="pic" src="/b/${b.id}/img" alt="" width="460" height="215">` : ""}
<div class="body">
<span class="pill">${esc(store.emoji ?? "📦")} ${esc(store.name)}</span>
<h1>${esc(b.title)}</h1>
<div class="facts">
${b.price ? `<div><b>${esc(b.price)}</b><span>Price</span></div>` : ""}
${count ? `<div><b>${esc(count)}</b><span>Games</span></div>` : ""}
</div>
${games.length ? `<ul class="games">${games.map(g => `<li>${esc(g)}</li>`).join("")}${more > 0 ? `<li class="more">and ${more} more</li>` : ""}</ul>` : ""}
<p class="ends${ended ? " over" : ""}">${esc(endsText(b.expires_at, now))}</p>
${redirect ? `<div class="redirect" id="go" data-seconds="${REDIRECT_SECONDS}" data-url="${esc(go)}">
<p><span id="goText">Taking you to ${esc(store.name)} in ${REDIRECT_SECONDS} seconds…</span></p>
<div class="bar"><i></i></div>
<div class="actions"><a class="btn main" href="${esc(go)}">Go to the bundle now</a><button class="btn" id="stay" type="button">Stay on this page</button></div>
</div>` : dest ? `<div class="actions"><a class="btn main" href="${esc(go)}">See it on ${esc(store.name)}</a></div>` : `<div class="actions"><a class="btn main" href="/">See what's on now</a></div>`}
</div>
</article>
<section class="cta">
<h2>Never miss a bundle</h2>
<p>Steam Value Checker is a free Discord bot. It posts new bundles from Humble, Fanatical, IndieGala and Steam to your server, pings you when a game on your wishlist goes on sale, shares every free game as it drops, and builds a profile card with what your library is worth.</p>
<div class="actions">
${inviteUrl ? `<a class="btn main" href="${esc(inviteUrl)}">Add the bot to Discord, free</a>` : ""}
<a class="btn" href="/">See everything it does</a>
${supportUrl ? `<a class="btn" href="${esc(supportUrl)}">Join the community</a>` : ""}
</div>
</section>
</main>
<footer class="foot"><a href="/privacy.html">Privacy</a> · <a href="/terms.html">Terms</a> · steamvaluechecker.com</footer>
${redirect ? '<script src="/go.js" defer></script>' : ""}
</body>
</html>`;
    return head + "\n" + body;
}

/** A friendly page when the link is old or the bundle is gone. */
export function renderBundleGone({ origin }) {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Bundle not found | Steam Value Checker</title><meta name="robots" content="noindex"><link rel="icon" type="image/png" href="/favicon.png"><link rel="stylesheet" href="/go.css"></head>
<body><header class="top"><a class="brand" href="/"><img src="/logo.png" alt="" width="30" height="30"><span>Steam Value Checker</span></a></header>
<main class="wrap"><section class="cta"><h2>That bundle isn't here any more</h2><p>Bundles come and go quickly, and this one has been taken down. The bot posts new ones as they appear.</p><div class="actions"><a class="btn main" href="${esc(origin)}/">See what Steam Value Checker does</a></div></section></main></body></html>`;
}
