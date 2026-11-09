// /me profilecard: the public profile page drawn as one picture. It uses exactly what a stranger sees on the page (the
// look, the banner, the sections the member switched on for everyone), in the order they put them, so the card and the page match.
import { svgToPng, fetchImageDataUri } from "./imgrender.js";

const W = 1200, PAD = 56;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const tw = (s, size, bold = false) => [...String(s)].reduce((t, c) => t + (c === " " ? 0.28 : /[A-Z0-9MW]/.test(c) ? 0.68 : /[il.,'|:]/.test(c) ? 0.28 : 0.55), 0) * size * (bold ? 1.06 : 1);
const cut = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + "…" : String(s));
const fit = (s, size, maxW, bold = false) => { let t = String(s); while (t.length > 1 && tw(t, size, bold) > maxW) t = t.slice(0, -1); return t === String(s) ? t : t.replace(/\s+$/, "") + "…"; };
function wrap(text, size, maxW, maxLines) {
    const lines = []; let cur = "";
    for (const word of String(text).split(/\s+/).filter(Boolean)) {
        const next = cur ? cur + " " + word : word;
        if (tw(next, size) <= maxW || !cur) cur = next; else { lines.push(cur); cur = word; }
        if (lines.length === maxLines) break;
    }
    if (cur && lines.length < maxLines) lines.push(cur);
    return lines;
}

const SECTION_LIMIT = 7; // keeps the picture a sensible height
const TITLES = { favorites: "FAVORITE GAMES", wishlist: "WISHLIST", recent: "RECENTLY FINISHED", nowplaying: "PLAYING NOW", trophies: "TROPHIES", achievements: "RAREST ACHIEVEMENTS", activity: "RECENT ACTIVITY", steam: "STEAM STATS", value: "LIBRARY VALUE", streams: "STREAMING", posts: "LATEST POSTS" };

/** Pictures the card needs, by address, so they can be fetched once and put in as data. */
export function cardPictures(profile) {
    const urls = new Set();
    if (profile.avatar) urls.add(profile.avatar);
    if (profile.banner?.art) urls.add(profile.banner.art);
    for (const s of profile.sections.slice(0, SECTION_LIMIT + 3)) {
        if (["favorites", "wishlist", "recent"].includes(s.key)) for (const g of (s.games ?? []).slice(0, 4)) if (g.art) urls.add(g.art);
        if (s.key === "nowplaying" && s.now?.art) urls.add(s.now.art);
        if (s.key === "achievements") for (const t of (s.top ?? []).slice(0, 8)) if (t.icon) urls.add(t.icon);
        if (s.key === "activity") for (const g of (s.games ?? []).slice(0, 3)) if (g.art) urls.add(g.art);
    }
    return [...urls];
}

/** The card as SVG. `pics` maps an address to a data: URI; anything missing is drawn as a plain tile. */
export function profileCardSvg(profile, pics = {}) {
    const t = profile.theme, accent = t.accent, light = Boolean(t.light), bg = t.bg;
    const ink = light ? "#161a24" : "#ffffff", sub = light ? "#4a5163" : "#b9c2d4", panel = light ? "#ffffff" : "#ffffff", panelA = light ? 0.75 : 0.06;
    const defs = [], body = [];
    let clipN = 0;
    const image = (url, x, y, w, h, r = 12) => {
        const uri = pics[url];
        if (!uri) return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${accent}" fill-opacity="0.22"/>`;
        const id = "c" + clipN++;
        defs.push(`<clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/></clipPath>`);
        return `<image href="${uri}" x="${x}" y="${y}" width="${w}" height="${h}" clip-path="url(#${id})" preserveAspectRatio="xMidYMid slice"/>`;
    };
    // ---- header: banner, avatar, name
    const bannerH = 220;
    const bannerArt = profile.banner?.art && pics[profile.banner.art] ? image(profile.banner.art, 0, 0, W, bannerH, 0) + `<rect width="${W}" height="${bannerH}" fill="${bg}" fill-opacity="0.35"/>` : `<rect width="${W}" height="${bannerH}" fill="url(#bn)"/>`;
    body.push(bannerArt, `<rect y="${bannerH - 140}" width="${W}" height="140" fill="url(#fade)"/>`);
    const ax = PAD + 78, ay = bannerH + 6, R = 78;
    defs.push(`<clipPath id="av"><circle cx="${ax}" cy="${ay}" r="${R}"/></clipPath>`);
    body.push(`<circle cx="${ax}" cy="${ay}" r="${R + 7}" fill="${accent}"/>`);
    body.push(profile.avatar && pics[profile.avatar]
        ? `<image href="${pics[profile.avatar]}" x="${ax - R}" y="${ay - R}" width="${R * 2}" height="${R * 2}" clip-path="url(#av)" preserveAspectRatio="xMidYMid slice"/>`
        : `<circle cx="${ax}" cy="${ay}" r="${R}" fill="${light ? "#e9edf6" : "#262b38"}"/><text x="${ax}" y="${ay + 28}" text-anchor="middle" font-size="80" font-weight="700" fill="${accent}">${esc([...String(profile.name)][0]?.toUpperCase() ?? "?")}</text>`);
    const nx = ax + R + 34, nameSize = Math.max(36, Math.min(58, Math.floor(560 / (tw(profile.name, 1, true) || 1))));
    body.push(`<text x="${nx}" y="${bannerH + 6}" font-size="${nameSize}" font-weight="700" fill="${ink}">${esc(fit(profile.name, nameSize, 760, true))}</text>`);
    body.push(`<text x="${nx}" y="${bannerH + 46}" font-size="26" fill="${sub}">@${esc(profile.slug)}</text>`);
    let y = bannerH + R + 40;
    // ---- bio and links
    const about = profile.sections.find(s => s.key === "about");
    if (about !== undefined && profile.bio) {
        const lines = wrap(profile.bio, 28, W - PAD * 2, 3);
        lines.forEach((l, i) => body.push(`<text x="${PAD}" y="${y + 24 + i * 38}" font-size="28" fill="${ink}">${esc(l)}</text>`));
        y += lines.length * 38 + 14;
    }
    if (profile.links?.length) {
        let cx = PAD;
        for (const l of profile.links.slice(0, 8)) {
            const w = Math.round(tw(l.label, 22, true)) + 36;
            if (cx + w > W - PAD) break;
            body.push(`<rect x="${cx}" y="${y}" width="${w}" height="42" rx="21" fill="${accent}" fill-opacity="0.2" stroke="${accent}" stroke-width="2"/><text x="${cx + 18}" y="${y + 29}" font-size="22" font-weight="600" fill="${ink}">${esc(l.label)}</text>`);
            cx += w + 12;
        }
        y += 62;
    }
    // ---- sections
    const card = (h, draw) => {
        body.push(`<rect x="${PAD - 20}" y="${y}" width="${W - PAD * 2 + 40}" height="${h}" rx="20" fill="${panel}" fill-opacity="${panelA}"${light ? ` stroke="#d3d9e6"` : ""}/>`);
        draw(y); y += h + 18;
    };
    const label = (title, yy) => `<text x="${PAD}" y="${yy + 40}" font-size="20" font-weight="700" letter-spacing="4" fill="${accent}">${esc(title)}</text>`;
    const tiles = (games, yy, n = 4) => {
        const gw = Math.floor((W - PAD * 2 - (n - 1) * 16) / n), th = Math.round(gw * 0.465);
        return games.slice(0, n).map((g, i) => {
            const x = PAD + i * (gw + 16);
            return image(g.art, x, yy + 58, gw, th) + `<text x="${x}" y="${yy + 58 + th + 28}" font-size="21" fill="${ink}">${esc(fit(g.title, 21, gw))}</text>`;
        }).join("");
    };
    const tileH = games => Math.round(Math.floor((W - PAD * 2 - 48) / 4) * 0.465) + 58 + 44;
    const shown = profile.sections.filter(s => TITLES[s.key] && s.key !== "posts" && s.key !== "about").slice(0, SECTION_LIMIT);
    for (const s of shown) {
        if (y > 1500) break;
        if (["favorites", "wishlist", "recent"].includes(s.key)) {
            const games = s.games ?? [];
            if (!games.length) continue;
            const extra = s.key === "wishlist" && games.length > 4 ? `<text x="${W - PAD}" y="${y + 40}" text-anchor="end" font-size="20" fill="${sub}">${games.length} games</text>` : "";
            card(tileH(games), yy => body.push(label(TITLES[s.key], yy), extra, tiles(games, yy)));
        } else if (s.key === "steam") {
            const stats = [[s.games, "Steam games"], [s.hours, "Hours played"], [s.library, "In the library"], [s.finished, "Finished"]];
            card(130, yy => { body.push(label(TITLES.steam, yy)); stats.forEach(([n, l], i) => { const x = PAD + i * 270; body.push(`<text x="${x}" y="${yy + 92}" font-size="40" font-weight="700" fill="${ink}">${esc(Number(n ?? 0).toLocaleString("en-US"))}</text><text x="${x}" y="${yy + 118}" font-size="19" fill="${sub}">${esc(l)}</text>`); }); });
        } else if (s.key === "value") {
            const usd = n => "$" + Number(n).toLocaleString("en-US");
            const stats = [[usd(s.worth), "Library worth"], [usd(s.paid), "Actually paid"], [usd(s.saved), "Saved"], [Number(s.games).toLocaleString("en-US"), "Games counted"]];
            card(130, yy => { body.push(label(TITLES.value, yy)); stats.forEach(([n, l], i) => { const x = PAD + i * 270; body.push(`<text x="${x}" y="${yy + 92}" font-size="40" font-weight="700" fill="${ink}">${esc(n)}</text><text x="${x}" y="${yy + 118}" font-size="20" fill="${sub}">${esc(l)}</text>`); }); });
        } else if (s.key === "achievements") {
            const top = (s.top ?? []).slice(0, 8);
            card(150, yy => { body.push(label(TITLES.achievements, yy), `<text x="${W - PAD}" y="${yy + 40}" text-anchor="end" font-size="20" fill="${sub}">${esc(Number(s.done ?? 0).toLocaleString("en-US"))} unlocked · ${esc(s.rare ?? 0)} rare</text>`); top.forEach((a, i) => body.push(image(a.icon, PAD + i * 134, yy + 60, 82, 82, 10))); });
        } else if (s.key === "activity") {
            const games = (s.games ?? []).slice(0, 3);
            if (!games.length) continue;
            card(66 + games.length * 92, yy => { body.push(label(TITLES.activity, yy), `<text x="${W - PAD}" y="${yy + 40}" text-anchor="end" font-size="20" fill="${sub}">${esc(s.hours2w ?? 0)} hours in two weeks</text>`);
                games.forEach((g, i) => { const gy = yy + 62 + i * 92; body.push(image(g.art, PAD, gy, 170, 80, 10), `<text x="${PAD + 190}" y="${gy + 34}" font-size="26" font-weight="600" fill="${ink}">${esc(fit(g.title, 26, 720, true))}</text><text x="${PAD + 190}" y="${gy + 66}" font-size="21" fill="${sub}">${esc(g.hours ?? 0)} h</text>`); }); });
        } else if (s.key === "trophies") {
            card(110, yy => body.push(label(TITLES.trophies, yy), `<text x="${PAD}" y="${yy + 88}" font-size="36" font-weight="700" fill="${ink}">${esc(s.earned ?? 0)} <tspan font-size="22" font-weight="400" fill="${sub}">of ${esc(s.total ?? 0)} earned${(s.badges ?? []).length ? " · " + esc((s.badges).slice(0, 3).map(b => b.name).join(", ")) : ""}</tspan></text>`));
        } else if (s.key === "nowplaying") {
            if (!s.now) continue;
            card(150, yy => body.push(label(TITLES.nowplaying, yy), image(s.now.art, PAD, yy + 56, 220, 82, 10), `<text x="${PAD + 244}" y="${yy + 108}" font-size="30" font-weight="600" fill="${ink}">${esc(fit(s.now.title, 30, 760, true))}</text>`));
        } else if (s.key === "streams") {
            card(110, yy => body.push(label(TITLES.streams, yy), `<text x="${PAD}" y="${yy + 86}" font-size="30" font-weight="600" fill="${ink}">${esc(cut(`${s.platform === "twitch" ? "Twitch" : s.platform === "kick" ? "Kick" : "YouTube"}: ${s.handle}`, 50))}${s.live ? ` <tspan fill="#ff4d4d">● LIVE</tspan>` : ""}</text>`));
        }
    }
    y += 6;
    body.push(`<text x="${PAD}" y="${y + 34}" font-size="24" font-weight="600" fill="${sub}">steamvaluechecker.com/u/${esc(profile.slug)}</text>`);
    const H = y + 70;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="${light ? "#dfe5f2" : "#07080c"}"/></linearGradient>
<linearGradient id="bn" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${accent}" stop-opacity="0.85"/><stop offset="1" stop-color="${bg}"/></linearGradient>
<linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bg}" stop-opacity="0"/><stop offset="1" stop-color="${bg}" stop-opacity="0.95"/></linearGradient>${defs.join("")}</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
${body.join("\n")}
<rect y="${H - 8}" width="${W}" height="8" fill="${accent}"/>
</svg>`;
}

/** The finished card as a PNG. `profile` is what buildProfile gives for a stranger looking at the page. */
export async function renderProfileCard({ profile, fetchImpl = fetch }) {
    const urls = cardPictures(profile), pics = {};
    await Promise.all(urls.map(async u => { const d = await fetchImageDataUri(u, { fetchImpl }).catch(() => null); if (d) pics[u] = d; }));
    return svgToPng(profileCardSvg(profile, pics), 1200);
}
