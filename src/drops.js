// Promo drops: the posts, the blog watcher and the poll that puts each one in a server once.
import { CodeFeedError } from "./codesource.js";
import { sendNewsAlerts } from "./dropalerts.js";
import { findVideo } from "./video.js";

const sleepDefault = ms => new Promise(r => setTimeout(r, ms));
const TEAL = 0x1abc9c, GREY = 0x6b7280, GREEN = 0x76b900;
const MAX_NEWS_PER_RUN = 3;
const unix = ms => Math.floor(ms / 1000);

const steam = (key, name, appid) => ({ key, name, url: `https://store.steampowered.com/feeds/news/app/${appid}/`, kind: "game" });
// Hardware makers' blogs, plus the studios' own Steam announcements for games that hand out codes and giveaways.
export const NEWS_FEEDS = [
    { key: "nvidia", name: "NVIDIA", url: "https://blogs.nvidia.com/blog/category/gaming/feed/", kind: "blog" },
    { key: "steelseries", name: "SteelSeries", url: "https://steelseries.com/blog/feed", kind: "blog" },
    steam("dbd", "Dead by Daylight", 381210), steam("warframe", "Warframe", 230410), steam("destiny2", "Destiny 2", 1085660),
    steam("apex", "Apex Legends", 1172470), steam("r6", "Rainbow Six Siege", 359550), steam("rivals", "Marvel Rivals", 2767030),
    steam("wuwa", "Wuthering Waves", 3513350), steam("poe", "Path of Exile", 238960), steam("pubg", "PUBG", 578080)
];
// Only posts that talk about giving something away are worth an alert. The weekly GeForce NOW roundup is not.
const GIVEAWAY = /\b(giveaway|giving away|give away|sweepstakes|promo codes?|redeem(able)? codes?|gift codes?|code drop|redeem|claim (your|a|the|free)|free (key|keys|game|games|month|membership|trial|bundle|bloodpoints))\b/i;

const decode = s => String(s ?? "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&#8217;/g, "'").replace(/&#8211;/g, "-").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const tag = (xml, name) => decode(xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1] ?? "");

/** Pulls the items out of an RSS feed and keeps the ones that look like a giveaway. Never throws on odd input. */
export function parseNewsFeed(xml, source) {
    const out = [];
    for (const m of String(xml ?? "").matchAll(/<item>([\s\S]*?)<\/item>/g)) {
        const rawDesc = m[1].match(/<description[^>]*>([\s\S]*?)<\/description>/)?.[1] ?? "";
        const title = tag(m[1], "title"), url = tag(m[1], "link"), full = tag(m[1], "description"), summary = full.length > 300 ? full.slice(0, 300).replace(/\s+\S*$/, "") + "…" : full;
        const video = findVideo(rawDesc.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"') + " " + m[1]);
        if (!title || !/^https:\/\//.test(url)) continue;
        if (!GIVEAWAY.test(`${title} ${summary}`)) continue;
        out.push({ key: `${source.key}:${url}`, source: source.name, kind: source.kind ?? "blog", title: title.slice(0, 200), url, summary, video: video?.url ?? null, thumb: video?.thumb ?? null });
    }
    return out;
}

/** Reads every blog feed. One being down never hides the other. */
export async function fetchNews({ fetchImpl = globalThis.fetch, feeds = NEWS_FEEDS } = {}) {
    const items = [], errors = [];
    for (const f of feeds) {
        try {
            const res = await fetchImpl(f.url, { headers: { "user-agent": "SteamValueChecker/1.0 (+promo news)", accept: "application/rss+xml, text/xml" }, signal: AbortSignal.timeout?.(15_000) });
            if (!res.ok) throw new CodeFeedError(`${f.name} feed answered ${res.status}`);
            items.push(...parseNewsFeed(await res.text(), f));
        } catch (err) { errors.push(`${f.name}: ${err.message}`); }
    }
    if (errors.length === feeds.length) throw new CodeFeedError(errors.join("; "));
    return { items, errors };
}

/** What a manager typed, cleaned up, or an Error with a plain message. */
export function cleanDrop(input, at = Date.now()) {
    const title = String(input.title ?? "").trim().slice(0, 100);
    const code = String(input.code ?? "").trim();
    const url = String(input.url ?? "").trim();
    if (!title) throw new Error("Give it a short title, like \"SteelSeries Game On key\".");
    if (code.length > 120 || /[\s`]/.test(code)) throw new Error("That code looks wrong. Codes have no spaces and are under 120 characters.");
    if (url && !/^https:\/\/[^\s]+$/i.test(url)) throw new Error("The link has to start with https://");
    if (!code && !url) throw new Error("Add a code, a link, or both.");
    let expiresAt = null;
    if (input.days !== undefined && input.days !== null && input.days !== "") {
        const d = Number(input.days);
        if (!Number.isFinite(d) || d < 1 || d > 365) throw new Error("Days has to be between 1 and 365.");
        expiresAt = at + Math.round(d) * 86400_000;
    }
    return { title, code: code || null, url: url || null, source: String(input.source ?? "").trim().slice(0, 60) || null, note: String(input.note ?? "").trim().slice(0, 300) || null, expiresAt };
}

export function dropView(d, at = Date.now()) {
    return { id: d.id, title: d.title, source: d.source, code: d.code, url: d.url, note: d.note, expiresAt: d.expires_at ?? null, status: d.status === "active" && d.expires_at && d.expires_at < at ? "ended" : d.status, createdAt: d.created_at };
}

export function dropEmbed(d, { ended = false } = {}) {
    const fields = [];
    if (d.source) fields.push({ name: "From", value: d.source, inline: true });
    fields.push({ name: ended ? "Ended" : "Expires", value: ended ? "No longer available" : d.expires_at ? `<t:${unix(d.expires_at)}:D> (<t:${unix(d.expires_at)}:R>)` : "No end date given", inline: true });
    if (d.note) fields.push({ name: "Good to know", value: d.note, inline: false });
    const embed = {
        color: ended ? GREY : TEAL,
        author: { name: "Promo drop" },
        title: ended ? `Ended: ${d.title}` : d.title,
        description: ended ? (d.code ? `~~${d.code}~~\nThis one is over.` : "This one is over.") : d.code ? `\`\`\`\n${d.code}\n\`\`\`` : "Open the link to grab it.",
        fields,
        footer: { text: ended ? "Steam Value Checker · promo ended" : "Added by a server manager · these can run out early" }
    };
    const components = !ended && d.url ? [{ type: 1, components: [{ type: 2, style: 5, label: "Open link", url: d.url }] }] : [];
    return { embeds: [embed], components, allowed_mentions: { parse: [] } };
}

export function newsEmbed(n) {
    const video = /^https:\/\//.test(n.video ?? "") ? n.video : null;
    const thumb = findVideo(video ?? "")?.thumb ?? null;
    const watch = video ? [{ type: 2, style: 5, label: "▶ Watch the video", url: video }] : [];
    return { ...(video ? { content: video } : {}), embeds: [{ color: GREEN, author: { name: `${n.source} ${n.kind === "game" ? "news" : "blog"}` }, title: n.title, url: n.url,
        description: `${n.summary ? n.summary + "\n\n" : ""}This post mentions a giveaway or a code. Open it to see how to claim it.`,
        footer: { text: "Steam Value Checker · spotted automatically, so it can be a false alarm" }, ...(thumb ? { image: { url: thumb } } : {}) }],
        components: [{ type: 1, components: [{ type: 2, style: 5, label: "Read the post", url: n.url }, ...watch] }], allowed_mentions: { parse: [] } };
}

/** A role ping and a video link both live in the message text, so they are joined rather than one replacing the other. */
const joinMention = (post, m) => ({ ...post, ...m, content: [m.content, post.content].filter(Boolean).join("\n") || undefined });
const mention = (s, role) => { const r = s.role_id ?? role ?? null; return { content: r ? `<@&${r}>` : undefined, allowed_mentions: r ? { roles: [r] } : { parse: [] } }; };

/**
 * One pass: read the blogs, end what has run out, post what each server has not had, edit old posts.
 * `getNews` is injectable for tests.
 */
export async function runDrops({ db, api, notifier = null, getNews = fetchNews, now = Date.now, sleep = sleepDefault, pace = 500, log = () => {} }) {
    const stats = { news: 0, posted: 0, ended: 0, failed: 0, feedError: null };
    if (db.dropGuilds().some(s => s.news) || db.alertSubscribers("promos").length) {
        try {
            const r = await getNews();
            for (const n of r.items) if (db.upsertNews(n).isNew) stats.news++;
            if (r.errors?.length) { stats.feedError = r.errors.join("; "); log(`news (partial): ${stats.feedError}`); }
        } catch (err) { stats.feedError = err.message; log(`news: ${err.message}`); }
    }
    stats.ended += db.expireDrops(now()).length;
    if (notifier) {
        try { const a = await sendNewsAlerts({ db, notifier, now, log }); stats.alerted = a.delivered; stats.failed += a.failed; }
        catch (err) { log(`promo alerts: ${err.message}`); }
    }

    for (const s of db.dropGuilds()) {
        for (const d of db.unpostedDrops(s.guild_id)) {
            try {
                const msg = await api.sendMessage(s.channel_id, { ...dropEmbed(d), ...mention(s, db.getCommunity?.(s.guild_id)?.ping_promos) });
                db.addDropPost(d.id, s.channel_id, msg?.id ?? null);
                stats.posted++;
            } catch (err) { stats.failed++; log(`drop post failed (${err?.status ?? err?.name})`); break; }
            await sleep(pace);
        }
        if (!s.news) continue;
        const fresh = db.unpostedNews(s.guild_id);
        if (!fresh.length) continue;
        if (!db.hasAnyNewsPost(s.guild_id)) { for (const n of fresh) db.addNewsPost(n.id, s.guild_id, s.channel_id, null); continue; } // first time on: only future posts
        for (const n of fresh.slice(0, MAX_NEWS_PER_RUN).reverse()) {
            try {
                const msg = await api.sendMessage(s.channel_id, joinMention(newsEmbed(n), mention(s, db.getCommunity?.(s.guild_id)?.ping_promos)));
                db.addNewsPost(n.id, s.guild_id, s.channel_id, msg?.id ?? null);
                stats.posted++;
            } catch (err) { stats.failed++; log(`news post failed (${err?.status ?? err?.name})`); break; }
            await sleep(pace);
        }
        for (const n of fresh.slice(MAX_NEWS_PER_RUN)) db.addNewsPost(n.id, s.guild_id, s.channel_id, null); // a backlog is not worth a flood
    }

    for (const p of db.staleDropPosts()) {
        try { await api.editMessage(p.channel_id, p.message_id, dropEmbed(p, { ended: true })); db.markDropPostEnded(p.id); }
        catch (err) { if (err?.status === 404 || err?.status === 403) db.markDropPostEnded(p.id); else stats.failed++; }
        await sleep(pace);
    }
    db.pruneDrops(now());
    return stats;
}

/** Shared by /server promos and the dashboard. Throws an Error with a plain message. */
export function applyDropSettings(db, guildId, body) {
    const patch = {};
    if (body.channel_id !== undefined) patch.channel_id = body.channel_id || null;
    if (body.role_id !== undefined) patch.role_id = body.role_id || null;
    if (body.news !== undefined) patch.news = Boolean(body.news);
    return db.setDropSettings(guildId, patch);
}
