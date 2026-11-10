// The small badge a developer can put on their own site or Steam page text: "Featured in the indie showcase", with the game's name.
const esc = t => String(t).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function indieBadgeSvg({ title, verified = false, likes = 0, dark = true }) {
    const name = esc(String(title || "").slice(0, 30)), bg = dark ? ["#2a1838", "#16101f"] : ["#fff3ea", "#ffe3d0"], ink = dark ? "#ffffff" : "#2a1838", sub = dark ? "#c9b6d9" : "#7a4a3a";
    const tail = `${verified ? "Verified · " : ""}${likes} like${likes === 1 ? "" : "s"}`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="64" viewBox="0 0 300 64" role="img" aria-label="${name} in the Steam Value Checker indie showcase" font-family="Segoe UI,Helvetica,Arial,sans-serif">
<defs><clipPath id="c"><rect width="300" height="64" rx="10"/></clipPath><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg[0]}"/><stop offset="1" stop-color="${bg[1]}"/></linearGradient><linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff8a4c"/><stop offset="1" stop-color="#ff4fa3"/></linearGradient></defs>
<g clip-path="url(#c)"><rect width="300" height="64" fill="url(#g)"/><rect width="6" height="64" fill="url(#a)"/></g>
<text x="20" y="25" font-size="10" font-weight="700" letter-spacing="1" fill="#ff8a4c">INDIE SHOWCASE</text>
<text x="20" y="45" font-size="16" font-weight="700" fill="${ink}">${name}</text><text x="284" y="45" font-size="10" text-anchor="end" fill="${sub}">${esc(tail)}</text>
<text x="284" y="25" font-size="9" text-anchor="end" fill="${sub}">Steam Value Checker</text>
</svg>`;
}
