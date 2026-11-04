// /me profile: the same settings as the dashboard's profile editor, one small change at a time.
import { MessageFlags } from "discord.js";
import { UserError } from "./errors.js";
import { cleanProfile, withDefaults, cleanLink, SECTIONS, VISIBILITY } from "./profilepage.js";

const EPH = MessageFlags.Ephemeral;
const VIS_TEXT = { public: "everyone", server: "members of your server", hidden: "nobody (hidden)" };

export function createProfileHandlers({ db, publicUrl = null }) {
    const link = u => (publicUrl && u.profile_slug && u.profile_public ? `${publicUrl}/u/${u.profile_slug}` : null);
    const reply = (i, text, u) => {
        const url = link(u);
        const editor = publicUrl ? `${publicUrl}/#/profile` : null;
        return i.reply({ flags: EPH, content: [text, url ? `Your profile: ${url}` : "Your page is off. Turn it on with `/me publicpage enabled:true name:yourname` and it goes live.", editor ? `Fine-tune it with a live preview: ${editor}` : null].filter(Boolean).join("\n") });
    };
    const save = (u, patch) => { const { data } = db.getProfileData(u.discord_id); db.setProfileData(u.discord_id, cleanProfile(patch, data)); };

    async function handle(i) {
        const u = db.ensureUser(i.user.id, i.guildId);
        const sub = i.options.getSubcommand();
        try {
            switch (sub) {
                case "view": {
                    const c = withDefaults(db.getProfileData(u.discord_id).data);
                    const show = c.sections.map(s => `${s.vis === "hidden" ? "▫️" : s.vis === "server" ? "👥" : "✅"} ${SECTIONS[s.key]}${s.vis === "hidden" ? "" : ` (${VIS_TEXT[s.vis]})`}`);
                    return i.reply({ flags: EPH, embeds: [{ color: 0x5865f2, title: `${c.name || u.profile_slug || "Your"} profile`, url: link(u) ?? undefined,
                        description: [c.bio || "No bio yet. Add one with `/me profile bio`.", "", ...show].join("\n"),
                        fields: [{ name: "Look", value: `${c.theme} theme · ${c.bgstyle} background · ${c.layout} layout`, inline: true },
                            { name: "Song", value: c.song ? `${c.song.title || c.song.provider}` : "None", inline: true },
                            { name: "Links", value: c.links.length ? c.links.map(l => l.kind).join(", ") : "None", inline: true },
                            { name: "Favorites", value: c.favorites.length ? c.favorites.join(", ") : "None" }],
                        footer: { text: link(u) ? "Open it from the title" : "Your page is off. Turn it on with /me publicpage" } }] });
                }
                case "bio": save(u, { bio: i.options.getString("text", true) }); return reply(i, "Bio saved.", u);
                case "name": save(u, { name: i.options.getString("text", true) }); return reply(i, "Display name saved.", u);
                case "look": {
                    const patch = {};
                    for (const [opt, key] of [["theme", "theme"], ["accent", "accent"], ["background", "bgstyle"], ["layout", "layout"], ["banner", "banner"]]) {
                        const v = i.options.getString(opt);
                        if (v !== null && v !== undefined) patch[key] = opt === "accent" && /^(none|reset|default)$/i.test(v) ? null : v;
                    }
                    if (!Object.keys(patch).length) throw new UserError("Pick at least one thing to change: theme, accent, background, layout or banner.");
                    save(u, patch); return reply(i, "Look updated.", u);
                }
                case "song": {
                    if (i.options.getBoolean("remove")) { save(u, { song: null }); return reply(i, "Profile song removed.", u); }
                    const url = i.options.getString("url");
                    if (!url) throw new UserError("Paste a YouTube, SoundCloud or Spotify link, or use remove:true.");
                    save(u, { song: { url, title: i.options.getString("title") ?? "" } });
                    return reply(i, "Profile song set. Visitors press play to hear it.", u);
                }
                case "link": {
                    const l = cleanLink(i.options.getString("kind", true), i.options.getString("url", true));
                    const { data } = db.getProfileData(u.discord_id);
                    const links = (data.links ?? []).filter(x => x.kind !== l.kind);
                    if (links.length >= 6) throw new UserError("You can have up to 6 links. Remove one with `/me profile unlink`.");
                    save(u, { links: [...links, l] }); return reply(i, `Added your ${l.kind} link.`, u);
                }
                case "unlink": {
                    const kind = i.options.getString("kind", true), { data } = db.getProfileData(u.discord_id);
                    const links = (data.links ?? []).filter(x => x.kind !== kind);
                    if (links.length === (data.links ?? []).length) throw new UserError("You don't have a link of that kind.");
                    save(u, { links }); return reply(i, "Link removed.", u);
                }
                case "favorite": case "unfavorite": {
                    const t = i.options.getString("game", true).trim(), { data } = db.getProfileData(u.discord_id);
                    const favs = data.favorites ?? [];
                    if (sub === "favorite") {
                        if (favs.some(x => x.toLowerCase() === t.toLowerCase())) throw new UserError("That one is already a favorite.");
                        if (favs.length >= 5) throw new UserError("You can have 5 favorites. Remove one with `/me profile unfavorite`.");
                        save(u, { favorites: [...favs, t] }); return reply(i, `**${t}** is now one of your favorites.`, u);
                    }
                    const rest = favs.filter(x => x.toLowerCase() !== t.toLowerCase());
                    if (rest.length === favs.length) throw new UserError("That game is not in your favorites.");
                    save(u, { favorites: rest }); return reply(i, "Removed from your favorites.", u);
                }
                case "show": {
                    const key = i.options.getString("section", true), vis = i.options.getString("who", true);
                    if (!SECTIONS[key] || !VISIBILITY.includes(vis)) throw new UserError("Pick a section and who can see it.");
                    const c = withDefaults(db.getProfileData(u.discord_id).data);
                    save(u, { sections: c.sections.map(s => (s.key === key ? { ...s, vis } : s)) });
                    return reply(i, `**${SECTIONS[key]}** is now visible to ${VIS_TEXT[vis]}.`, u);
                }
            }
        } catch (err) {
            if (err instanceof UserError) return i.reply({ flags: EPH, content: err.message });
            throw err;
        }
    }
    return { handle };
}
