// Cross-server giveaways can be hosted by a partner and can ask entrants to do something first (follow on X, join a Discord...).
// These are the pure helpers: validating what the owner types, and turning it into the lines and buttons on the giveaway post.
// The steps are an honour system: Discord cannot check an X follow, so the post says winners may be checked.

export const STEP_KINDS = {
    follow_x: { label: "Follow on X", icon: "𝕏", hosts: ["x.com", "twitter.com"], hint: "Link to the profile, e.g. https://x.com/name" },
    repost_x: { label: "Repost on X", icon: "🔁", hosts: ["x.com", "twitter.com"], hint: "Link to the post to repost" },
    join_discord: { label: "Join the Discord", icon: "💬", hosts: ["discord.gg", "discord.com", "discordapp.com"], hint: "A Discord invite link" },
    follow_twitch: { label: "Follow on Twitch", icon: "🟣", hosts: ["twitch.tv"], hint: "Link to the channel" },
    youtube: { label: "Subscribe on YouTube", icon: "▶️", hosts: ["youtube.com", "youtu.be"], hint: "Link to the channel or video" },
    wishlist_steam: { label: "Wishlist on Steam", icon: "⭐", hosts: ["store.steampowered.com", "steamcommunity.com"], hint: "Link to the Steam store page" },
    follow_steam: { label: "Follow on Steam", icon: "🎮", hosts: ["store.steampowered.com", "steamcommunity.com"], hint: "Link to the developer, curator or game page" },
    newsletter: { label: "Join the newsletter", icon: "✉️", hosts: null, hint: "Link to the sign-up page" },
    visit: { label: "Visit the website", icon: "🌐", hosts: null, hint: "Any https link" },
    custom: { label: "Do this", icon: "✅", hosts: null, hint: "Any https link" }
};
export const MAX_STEPS = 8;
export const MAX_LINKS = 5;

const clip = (v, n) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
/** Only plain https links. Returns the cleaned URL or null. */
export function cleanUrl(v) {
    try {
        const u = new URL(String(v ?? "").trim());
        if (u.protocol !== "https:" || u.username || u.password || !u.hostname.includes(".")) return null;
        return u.toString().slice(0, 300);
    } catch { return null; }
}
const hostIs = (url, hosts) => { const h = new URL(url).hostname.toLowerCase().replace(/^www\./, ""); return hosts.some(x => h === x || h.endsWith("." + x)); };

export class StepError extends Error {}

/** [{ kind, url, label? }] -> cleaned steps. Throws StepError with a message the owner can act on. */
export function parseSteps(input) {
    const list = Array.isArray(input) ? input : [];
    const out = [];
    for (const raw of list) {
        if (!raw || (!raw.kind && !raw.url && !raw.label)) continue; // an empty row in the form
        const kind = STEP_KINDS[raw.kind] ? raw.kind : "custom";
        const url = cleanUrl(raw.url);
        if (!url) throw new StepError(`Step "${clip(raw.label || STEP_KINDS[kind].label, 40)}" needs an https link.`);
        const rule = STEP_KINDS[kind];
        if (rule.hosts && !hostIs(url, rule.hosts)) throw new StepError(`"${rule.label}" must link to ${rule.hosts.join(" or ")}.`);
        out.push({ kind, url, label: clip(raw.label, 80) || rule.label });
    }
    if (out.length > MAX_STEPS) throw new StepError(`Use at most ${MAX_STEPS} entry steps.`);
    return out;
}

/** The partner's own links: [{ label, url }] with labels like Website, Discord, X. */
export function parseLinks(input) {
    const out = [];
    for (const raw of Array.isArray(input) ? input : []) {
        if (!raw || (!raw.url && !raw.label)) continue;
        const url = cleanUrl(raw.url);
        if (!url) throw new StepError(`The link "${clip(raw.label, 30) || "partner link"}" needs to be an https address.`);
        out.push({ label: clip(raw.label, 30) || new URL(url).hostname.replace(/^www\./, ""), url });
    }
    if (out.length > MAX_LINKS) throw new StepError(`Use at most ${MAX_LINKS} partner links.`);
    return out;
}

/** The host block saved with a cross-server giveaway. kind "network" is the bot owner, "partner" is someone else. */
export function parseHost(input, ownerName) {
    const kind = input?.kind === "partner" ? "partner" : "network";
    if (kind === "network") return { host_kind: "network", host_name: clip(ownerName, 60) || "the bot owner", host_logo: null, host_links: null };
    const name = clip(input.name, 60);
    if (!name) throw new StepError("Give the partner's name.");
    const links = parseLinks(input.links);
    const logo = input.logo ? cleanUrl(input.logo) : null;
    if (input.logo && !logo) throw new StepError("The partner logo must be an https image link.");
    return { host_kind: "partner", host_name: name, host_logo: logo, host_links: links.length ? JSON.stringify(links) : null };
}

const safeJson = s => { try { const v = JSON.parse(s ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };
export const stepsOf = g => safeJson(g.steps);
export const linksOf = g => safeJson(g.host_links);

const md = (label, url) => `[${label.replace(/[\[\]]/g, "")}](${url})`;

/** The extra embed pieces for a cross-server giveaway: who hosts it, and what to do to be considered. */
export function crossServerParts(g) {
    const links = linksOf(g), steps = stepsOf(g);
    const partner = g.host_kind === "partner";
    const hostLine = partner
        ? `**${g.host_name}**${links.length ? "\n" + links.map(l => md(l.label, l.url)).join(" · ") : ""}`
        : `**${g.host_name}**, host of Steam Value Checker`;
    const author = { name: partner ? `🌐 Cross-server giveaway · hosted by ${g.host_name}` : `🌐 Cross-server giveaway · hosted by ${g.host_name}`, ...(partner && g.host_logo ? { icon_url: g.host_logo } : {}), ...(partner && links[0] ? { url: links[0].url } : {}) };
    const how = [...steps.map((s, i) => `${i + 1}. ${md(`${STEP_KINDS[s.kind]?.icon ?? "•"} ${s.label}`, s.url)}`), `${steps.length + 1}. Press **Enter giveaway** below`];
    return {
        author, hostLine,
        howToEnter: steps.length ? how.join("\n") : null,
        stepsNote: steps.length ? "Complete every step to be considered. Winners may be checked, and a new winner is drawn if a step was skipped." : null,
        footerNote: partner ? "Cross-server giveaway presented by Steam Value Checker" : "Open to every server that uses Steam Value Checker",
        buttons: steps.slice(0, MAX_STEPS).map(s => ({ type: 2, style: 5, label: s.label.slice(0, 80), url: s.url, emoji: undefined }))
    };
}

/** Button rows for the step links: at most 5 to a row. */
export function stepRows(buttons) {
    const rows = [];
    for (let i = 0; i < buttons.length; i += 5) rows.push({ type: 1, components: buttons.slice(i, i + 5) });
    return rows;
}
