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

const endsText = (ms, now, free = false) => {
    if (!ms) return free ? "Free for now, so claim it while it lasts" : "No end date listed, so grab it while it lasts";
    if (ms <= now) return free ? "This offer has ended" : "This bundle has ended";
    const left = ms - now, d = Math.floor(left / 86_400_000), h = Math.floor(left % 86_400_000 / 3_600_000);
    const when = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(ms));
    return `${free ? "Claim it by" : "Ends"} ${when} Eastern${d > 0 ? ` (${d} day${d === 1 ? "" : "s"} left)` : h > 0 ? ` (${h} hour${h === 1 ? "" : "s"} left)` : " (less than an hour left)"}`;
};

/** Free games and the like: any public https address from our own feeds, never an IP address or a local name. */
export function dealDestination(url) {
    const u = safePictureUrl(url); // same rules: https, a real hostname
    return u ?? null;
}

/** Bundle row or free-game row to one shape for the page. */
function modelOf(kind, r, now) {
    if (kind === "bundle") {
        const store = BUNDLE_STORES[r.store] ?? { name: r.store ?? "the store", emoji: "📦" };
        return { path: "b", kind: "bundle", id: r.id, free: false, storeName: store.name, emoji: store.emoji ?? "📦", title: r.title, price: r.price, count: r.game_count ?? (r.games?.length || null), games: r.games ?? [], expires: r.expires_at, ended: Boolean(r.expires_at && r.expires_at <= now) || r.status === "expired", dest: bundleDestination(r.url), picture: r.image, blurb: null };
    }
    const shop = r.shop || "the store";
    return { path: "d", kind: r.kind, id: r.id, free: r.kind === "free", storeName: shop, emoji: r.kind === "bundle" ? "📦" : r.kind === "deal" ? "🏷️" : "🎁", title: r.title, price: r.kind === "free" ? "Free" : r.price, count: r.games?.length || null, games: r.games ?? [], expires: r.expiry, ended: Boolean(r.expiry && r.expiry <= now), dest: dealDestination(r.url), picture: r.image, blurb: r.blurb };
}

function page(m, { origin, inviteUrl, supportUrl, now }) {
    const hasPicture = Boolean(safePictureUrl(m.picture));
        const title = m.free ? `${m.title} is free on ${m.storeName}` : m.kind === "bundle" ? `${m.title} | ${m.storeName} bundle` : `${m.title} on ${m.storeName}`;
    const desc = `${m.free ? "Free to keep. " : m.price ? m.price + ". " : ""}${m.count && !m.free ? m.count + " games" + (m.games.length ? ", including " + m.games.slice(0, 3).join(", ") : "") + ". " : ""}${endsText(m.expires, now, m.free)}. Found by the Steam Value Checker Discord bot.`.replace(/\s+/g, " ");
    const base = `${origin}/${m.path}/${m.id}`, go = `${base}/go`, local = `/${m.path}/${m.id}`;
    const games = m.games.slice(0, 10), more = (m.count ?? games.length) - games.length;
    const redirect = Boolean(m.dest) && !m.ended;
    const head = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#0f1724">
<link rel="canonical" href="${esc(base)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Steam Value Checker">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(base)}">
${hasPicture ? `<meta property="og:image" content="${esc(base)}/img">\n<meta property="og:image:secure_url" content="${esc(base)}/img">\n<meta property="og:image:alt" content="${esc(m.title)}">\n<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:image" content="${esc(base)}/img">\n<meta name="twitter:image:alt" content="${esc(m.title)}">` : `<meta property="og:image" content="${esc(origin)}/banner.png">\n<meta name="twitter:card" content="summary">\n<meta name="twitter:image" content="${esc(origin)}/banner.png">`}
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="stylesheet" href="/go.css">
${redirect ? `<noscript><meta http-equiv="refresh" content="${REDIRECT_SECONDS};url=${esc(go)}"></noscript>` : ""}
</head>`;
    const body = `<body>
<header class="top"><a class="brand" href="/"><img src="/logo.png" alt="" width="30" height="30"><span>Steam Value Checker</span></a></header>
<main class="wrap">
<article class="card">
${hasPicture ? `<img class="pic" src="${local}/img" alt="" width="460" height="215">` : ""}
<div class="body">
<span class="pill">${esc(m.emoji)} ${m.free ? "FREE · " : ""}${esc(m.storeName)}</span>
<h1>${esc(m.title)}</h1>
<div class="facts">
${m.price ? `<div><b>${esc(m.price)}</b><span>Price</span></div>` : ""}
${m.count && !m.free ? `<div><b>${esc(m.count)}</b><span>Games</span></div>` : ""}
</div>
${m.blurb ? `<p class="blurb">${esc(m.blurb)}</p>` : ""}
${games.length && !m.free ? `<ul class="games">${games.map(g => `<li>${esc(g)}</li>`).join("")}${more > 0 ? `<li class="more">and ${more} more</li>` : ""}</ul>` : ""}
<p class="ends${m.ended ? " over" : ""}">${esc(endsText(m.expires, now, m.free))}</p>
${redirect ? `<div class="redirect" id="go" data-seconds="${REDIRECT_SECONDS}" data-url="${esc(go)}">
<p><span id="goText">Taking you to ${esc(m.storeName)} in ${REDIRECT_SECONDS} seconds…</span></p>
<div class="bar"><i></i></div>
<div class="actions"><a class="btn main" href="${esc(go)}">${m.free ? "Claim it now" : m.kind === "bundle" ? "Go to the bundle now" : "Take me there"}</a><button class="btn" id="stay" type="button">Stay on this page</button></div>
</div>` : m.dest && !m.ended ? `<div class="actions"><a class="btn main" href="${esc(go)}">See it on ${esc(m.storeName)}</a></div>` : `<div class="actions"><a class="btn main" href="/">See what's on now</a></div>`}
</div>
</article>
<section class="promo">
<span class="spark">✨ While you wait</span>
<h2>${m.free ? "That one's free. Want to never miss the next?" : "Found a good one? There's a lot more where that came from."}</h2>
<p class="lead">Steam Value Checker is a free Discord bot that watches every store for you, so the best stuff finds you instead of the other way around.</p>
<div class="tiles">
<div class="tile"><b>🎁 Free games</b><span>Posted the moment they drop on Epic, Steam, GOG and Prime</span></div>
<div class="tile"><b>📦 Bundles</b><span>Humble, Fanatical, IndieGala and Steam, with end dates</span></div>
<div class="tile"><b>🔔 Price alerts</b><span>A ping when a game on your wishlist hits its lowest price</span></div>
<div class="tile"><b>💰 Library worth</b><span>A shareable profile card showing what your collection is worth</span></div>
</div>
<div class="mock" aria-hidden="true"><div class="mockbar"><i></i><i></i><i></i><span>Your dashboard</span></div>
<div class="mockrow"><div><b>$4,212</b><span>Library worth</span></div><div><b>312</b><span>Games</span></div><div><b>7</b><span>Free right now</span></div><div><b>-85%</b><span>Best wishlist deal</span></div></div></div>
<div class="actions">
${inviteUrl ? `<a class="btn main big" href="${esc(inviteUrl)}">Add the bot to Discord, free</a>` : ""}
<a class="btn" href="/">Open the dashboard</a>
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

/** A bundle from the feed (`b` is the stored row, games as an array). */
export function renderBundleLanding(b, { origin, inviteUrl = null, supportUrl = null, now = Date.now(), hasPicture = false } = {}) {
    return page(modelOf("bundle", hasPicture ? b : { ...b, image: null }, now), { origin, inviteUrl, supportUrl, now });
}
/** A free game or other deal from `deal_pages`. */
export function renderDealLanding(d, { origin, inviteUrl = null, supportUrl = null, now = Date.now(), hasPicture = true } = {}) {
    return page(modelOf("deal", hasPicture ? d : { ...d, image: null }, now), { origin, inviteUrl, supportUrl, now });
}

/** A friendly page when the link is old or the bundle is gone. */
export function renderBundleGone({ origin }) {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Bundle not found | Steam Value Checker</title><meta name="robots" content="noindex"><link rel="icon" type="image/png" href="/favicon.png"><link rel="stylesheet" href="/go.css"></head>
<body><header class="top"><a class="brand" href="/"><img src="/logo.png" alt="" width="30" height="30"><span>Steam Value Checker</span></a></header>
<main class="wrap"><section class="cta"><h2>That bundle isn't here any more</h2><p>Bundles come and go quickly, and this one has been taken down. The bot posts new ones as they appear.</p><div class="actions"><a class="btn main" href="${esc(origin)}/">See what Steam Value Checker does</a></div></section></main></body></html>`;
}
