// A small image of someone's library numbers that they can paste into a bio, a forum signature or a post.
const esc = t => String(t).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const usd = n => "$" + Math.round(Number(n) || 0).toLocaleString("en-US");

export function valueBadgeSvg({ name, games, worth, paid, saved }) {
    const who = esc(String(name || "").slice(0, 22));
    const cell = (x, label, value, color) => `<text x="${x}" y="52" font-size="19" font-weight="700" fill="${color}">${esc(value)}</text><text x="${x}" y="68" font-size="10" fill="#8f98a0" letter-spacing=".6">${label}</text>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="84" viewBox="0 0 360 84" role="img" aria-label="${who}: ${esc(usd(worth))} library worth, ${esc(usd(saved))} saved" font-family="Segoe UI,Helvetica,Arial,sans-serif">
<defs><clipPath id="c"><rect width="360" height="84" rx="12"/></clipPath><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1b2838"/><stop offset="1" stop-color="#101821"/></linearGradient></defs>
<g clip-path="url(#c)"><rect width="360" height="84" fill="url(#g)"/><rect width="5" height="84" fill="#ff9800"/></g>
<text x="20" y="22" font-size="12" font-weight="600" fill="#c7d5e0">${who}</text><text x="340" y="22" font-size="10" text-anchor="end" fill="#8f98a0">${Number(games).toLocaleString("en-US")} games · Steam Value Checker</text>
${cell(20, "LIBRARY WORTH", usd(worth), "#ffffff")}${cell(135, "PAID", usd(paid), "#66c0f4")}${cell(235, "SAVED", usd(saved), "#a4d007")}
</svg>`;
}
