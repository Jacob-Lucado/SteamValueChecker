// The public numbers page: how big the bot is and which listed servers played the most this week.
// Plain HTML with nothing to run, so it loads fast and can be read by anything.
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const n = v => Number(v ?? 0).toLocaleString("en-US");

export function renderStats({ servers, stats, board, origin }) {
    const tile = (k, v) => `<div class="t"><b>${esc(n(v))}</b><span>${esc(k)}</span></div>`;
    const rows = board.length ? board.map((b, i) => `<li><span class="r">${i + 1}</span><span class="nm">${esc(b.name)}</span><span class="h">${esc(n(b.hours))} hours <small>from ${esc(n(b.players))} players</small></span></li>`).join("") : `<li class="none">Not enough listed servers have played yet this week.</li>`;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Steam Value Checker in numbers</title>
<meta name="description" content="How many servers and people use Steam Value Checker, how many games it watches and which servers played the most this week."><link rel="canonical" href="${esc(origin)}/stats"><link rel="icon" href="/favicon.png"><style>
*{box-sizing:border-box}body{margin:0;background:#0b111b;color:#e8eefc;font-family:Inter,system-ui,sans-serif;line-height:1.5}.w{max-width:820px;margin:0 auto;padding:30px 18px 70px}a{color:#8cc8ff}
h1{font-size:clamp(28px,5vw,42px);margin:6px 0}.sub{color:#a9b8d4;margin:0 0 24px}.g{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}.t{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:16px}.t b{display:block;font-size:30px}.t span{color:#a9b8d4;font-size:14px}
h2{margin:30px 0 10px;font-size:22px}ol{list-style:none;margin:0;padding:0}li{display:flex;gap:12px;align-items:center;background:rgba(255,255,255,.05);border-radius:12px;padding:12px 14px;margin-bottom:8px}.r{font-weight:800;color:#ffab1f;width:24px}.nm{flex:1;font-weight:600}.h small{color:#8e9bb3}.none{color:#a9b8d4}.foot{margin-top:30px;color:#8e9bb3;font-size:14px}
</style></head><body><div class="w"><a href="${esc(origin)}/">Steam Value Checker</a><h1>In numbers</h1><p class="sub">Live counts, updated every few minutes.</p>
<div class="g">${tile("servers", servers)}${tile("people", stats.users)}${tile("games watched for price drops", stats.uniqueGames)}${tile("wishlist entries", stats.wishlistGames)}${tile("alerts sent this week", stats.alertsWeek)}</div>
<h2>Most played this week</h2><p class="sub" style="margin-top:0">Only servers that chose to be listed, and only with at least three players, so nobody is singled out.</p><ol>${rows}</ol>
<p class="foot">Totals leave out hidden test servers. Made by Jacob Lucado.</p></div></body></html>`;
}
