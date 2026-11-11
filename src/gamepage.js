// Public, server-rendered price page for one game: current best price, a year of history, a buy-or-wait verdict and a way to get alerts.
// Plain HTML with the facts in the markup (and JSON-LD), so search engines and link previews can read it without running a script.

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n, cur = "USD") => { try { return new Intl.NumberFormat("en-US", { style: "currency", currency: cur }).format(n); } catch { return `$${Number(n).toFixed(2)}`; } };
const dateOf = t => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });

export const slugify = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "game";

/** A small inline SVG line chart of price over time. */
export function chartSvg(points, cur = "USD", { w = 760, h = 260 } = {}) {
    const pts = (points ?? []).filter(p => Number.isFinite(p.t) && Number.isFinite(p.price));
    if (pts.length < 2) return "";
    const padL = 56, padR = 14, padT = 14, padB = 28;
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t, hi = Math.max(...pts.map(p => p.price)), lo = Math.min(...pts.map(p => p.price));
    const top = hi === lo ? hi + 1 : hi, bot = hi === lo ? Math.max(0, lo - 1) : Math.max(0, lo - (hi - lo) * 0.05);
    const x = t => padL + ((t - t0) / Math.max(1, t1 - t0)) * (w - padL - padR);
    const y = p => padT + (1 - (p - bot) / (top - bot)) * (h - padT - padB);
    // Price history is a step line: it holds a price until the next change.
    let d = `M${x(pts[0].t).toFixed(1)},${y(pts[0].price).toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) d += ` L${x(pts[i].t).toFixed(1)},${y(pts[i - 1].price).toFixed(1)} L${x(pts[i].t).toFixed(1)},${y(pts[i].price).toFixed(1)}`;
    const area = `${d} L${x(t1).toFixed(1)},${(h - padB).toFixed(1)} L${x(t0).toFixed(1)},${(h - padB).toFixed(1)} Z`;
    const ticks = [0, 0.5, 1].map(f => { const v = bot + (top - bot) * f; return `<line x1="${padL}" x2="${w - padR}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="rgba(255,255,255,.08)"/><text x="${padL - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" fill="#8e9bb3" font-size="12">${esc(money(v, cur))}</text>`; }).join("");
    const lowPt = pts.reduce((a, b) => (b.price < a.price ? b : a));
    return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Price history chart" width="100%"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#62b8ff" stop-opacity=".35"/><stop offset="1" stop-color="#62b8ff" stop-opacity="0"/></linearGradient></defs>${ticks}<path d="${area}" fill="url(#g)"/><path d="${d}" fill="none" stroke="#62b8ff" stroke-width="2.2" stroke-linejoin="round"/><circle cx="${x(lowPt.t).toFixed(1)}" cy="${y(lowPt.price).toFixed(1)}" r="5" fill="#57f287"/><text x="${padL}" y="${h - 8}" fill="#8e9bb3" font-size="12">${esc(dateOf(t0))}</text><text x="${w - padR}" y="${h - 8}" text-anchor="end" fill="#8e9bb3" font-size="12">${esc(dateOf(t1))}</text></svg>`;
}

/**
 * data: { title, appid, itadId, currency, price, shop, shopUrl, msrp, low1y, atl, points, advice, image }
 * Returns a full HTML document.
 */
export function renderGamePage(data, { origin, nonce = "" } = {}) {
    const cur = data.currency || "USD";
    const slug = slugify(data.title), canonical = `${origin}/game/${data.appid}-${slug}`;
    const price = Number.isFinite(data.price) ? money(data.price, cur) : null;
    const cut = Number.isFinite(data.price) && Number.isFinite(data.msrp) && data.msrp > data.price ? Math.round((1 - data.price / data.msrp) * 100) : 0;
    const title = `${data.title} price history and best deal${price ? ` (${price} now)` : ""} | Steam Value Checker`;
    const desc = `${data.title}: ${price ? `best price right now is ${price}${data.shop ? ` at ${data.shop}` : ""}` : "price history and deals"}${Number.isFinite(data.low1y) ? `. 12-month low ${money(data.low1y, cur)}` : ""}. ${data.advice?.label ? `Verdict: ${data.advice.label}.` : ""} Get a Discord alert when it drops.`.replace(/\s+/g, " ");
    const verdictColor = { buy: "#57f287", lean_buy: "#57f287", lean_wait: "#ffab1f", wait: "#ff7a7a" }[data.advice?.verdict] ?? "#62b8ff";
    const stat = (k, v) => v ? `<div class="stat"><small>${esc(k)}</small><b>${esc(v)}</b></div>` : "";
    const ld = {
        "@context": "https://schema.org", "@type": "Product", name: data.title, image: data.image || undefined, url: canonical,
        ...(Number.isFinite(data.price) ? { offers: { "@type": "Offer", price: data.price.toFixed(2), priceCurrency: cur, availability: "https://schema.org/InStock", url: data.shopUrl || canonical } } : {})
    };
    const invite = `${origin}/invite?src=game-page`, wish = `${origin}/#/g/${encodeURIComponent(data.itadId)}`;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(canonical)}">
${data.image ? `<meta property="og:image" content="${esc(data.image)}"><meta name="twitter:card" content="summary_large_image">` : `<meta property="og:image" content="${esc(origin)}/preview.jpg"><meta name="twitter:card" content="summary_large_image">`}
<link rel="icon" href="/favicon.png"><script type="application/ld+json"${nonce ? ` nonce="${nonce}"` : ""}>${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>
<style>
*{box-sizing:border-box}body{margin:0;background:#0b111b;color:#e8eefc;font-family:Inter,system-ui,sans-serif;line-height:1.5;background-image:radial-gradient(900px 500px at 85% -10%,#1d3a63,transparent 60%),radial-gradient(700px 500px at 0 110%,#3a1d0c,transparent 60%)}
a{color:#8cc8ff}.wrap{max-width:900px;margin:0 auto;padding:28px 18px 70px}.top{display:flex;align-items:center;gap:12px;margin-bottom:26px;font-weight:700}.top img{width:34px;height:34px;border-radius:9px}.top a{color:#e8eefc;text-decoration:none}
h1{font-size:clamp(28px,5vw,44px);line-height:1.1;margin:0 0 6px}.sub{color:#a9b8d4;margin:0 0 22px}
.hero{display:flex;gap:22px;flex-wrap:wrap;align-items:center;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:22px}
.hero img.cap{width:260px;max-width:100%;border-radius:10px}.big{font-size:44px;font-weight:800}.big s{font-size:22px;color:#8e9bb3;font-weight:500;margin-left:8px}.badge{display:inline-block;background:#248046;border-radius:6px;padding:3px 10px;font-weight:700;margin-left:6px;font-size:18px}
.verdict{margin-top:18px;border-left:5px solid ${verdictColor};background:rgba(255,255,255,.04);border-radius:10px;padding:14px 18px}.verdict b{color:${verdictColor};font-size:20px}.verdict ul{margin:8px 0 0;padding-left:20px;color:#c9d4e4}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:18px 0}.stat{background:rgba(255,255,255,.05);border-radius:12px;padding:14px 16px}.stat small{display:block;color:#8e9bb3}.stat b{font-size:22px}
.card{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:18px;margin-top:18px}.card h2{margin:0 0 10px;font-size:20px}
.cta{display:flex;gap:12px;flex-wrap:wrap;margin-top:20px}.btn{display:inline-block;padding:13px 22px;border-radius:10px;font-weight:700;text-decoration:none;color:#fff;background:#5865f2}.btn.o{background:#ffab1f;color:#1b1200}.btn.g{background:rgba(255,255,255,.1)}
.foot{margin-top:40px;color:#8e9bb3;font-size:14px}
</style></head><body><div class="wrap">
<div class="top"><img src="/logo.png" alt=""><a href="${esc(origin)}/">Steam Value Checker</a></div>
<h1>${esc(data.title)}</h1><p class="sub">Price history, best current deal and whether to buy now or wait.</p>
<div class="hero">${data.image ? `<img class="cap" src="${esc(data.image)}" alt="${esc(data.title)}" loading="eager">` : ""}<div>
${price ? `<div class="big">${esc(price)}${cut ? `<span class="badge">-${cut}%</span>` : ""}${cut && Number.isFinite(data.msrp) ? `<s>${esc(money(data.msrp, cur))}</s>` : ""}</div><div style="color:#a9b8d4">${data.shop ? `Best price right now at <b>${esc(data.shop)}</b>` : ""}</div>` : `<div class="big">No price right now</div>`}
${data.shopUrl ? `<div class="cta"><a class="btn g" href="${esc(data.shopUrl)}" rel="nofollow noopener" target="_blank">Go to ${esc(data.shop || "store")}</a></div>` : ""}</div></div>
${data.advice ? `<div class="verdict"><b>${esc(data.advice.label)}</b><ul>${data.advice.reasons.map(r => `<li>${esc(r)}</li>`).join("")}</ul></div>` : ""}
<div class="stats">${stat("12-month low", Number.isFinite(data.low1y) ? money(data.low1y, cur) : "")}${stat("All-time low", Number.isFinite(data.atl) ? money(data.atl, cur) : "")}${stat("Usual price", Number.isFinite(data.msrp) ? money(data.msrp, cur) : "")}</div>
${data.points?.length > 1 ? `<div class="card"><h2>Price over the last year</h2>${chartSvg(data.points, cur)}<div style="color:#8e9bb3;font-size:13px;margin-top:6px">Green dot marks the lowest price in this period.</div></div>` : ""}
<div class="card"><h2>Get an alert when it drops</h2><p style="margin:0 0 6px;color:#c9d4e4">Set the price you want and Steam Value Checker messages you on Discord the moment it hits.</p>
<div class="cta"><a class="btn" href="${esc(invite)}">Add the bot to Discord</a><a class="btn o" href="${esc(wish)}">Add to my wishlist alerts</a></div></div>
<p class="foot">Prices come from many stores and are checked regularly, but they can change at any time. Check the store before you buy. Made by Jacob Lucado.</p>
</div></body></html>`;
}
