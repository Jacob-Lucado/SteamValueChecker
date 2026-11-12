// Slash commands and button presses for the server tools (see servertools.js for what each one does).

import { UserError } from "./errors.js";
import { parseEmoji, emojiText, parseOptions, getStarboard, cleanStarboard, getSuggestCfg, cleanSuggest, SUGGEST_STATUS, saveTagChecked, cleanTagName, roleIsSafe } from "./servertools.js";

const EPH = 64n;
const MANAGE = 0x20n, ADMIN = 0x8n;
const eph = (i, p) => (i.deferred || i.replied ? i.editReply(p) : i.reply({ ...(typeof p === "string" ? { content: p } : p), flags: 64 }));
const isManager = i => Boolean(i.memberPermissions?.has?.(MANAGE) || i.memberPermissions?.has?.(ADMIN));

export function createToolsHandlers({ db, api, menus, starboard, polls, suggestions, publicUrl = null }) {
    const need = i => { if (!i.inGuild()) throw new UserError("Use this in a server."); if (!isManager(i)) throw new UserError("You need the Manage Server permission for that."); };
    const guard = (fn) => async i => { try { return await fn(i); } catch (e) { if (e instanceof UserError || e?.name === "Error" && !e.status) return eph(i, e.message); if (e?.status === 403 || e?.status === 50013) return eph(i, "I'm missing a permission there. Give me View Channel, Send Messages and Embed Links in that channel."); throw e; } };
    const url = (path) => (publicUrl ? `\nSet it up on the web: ${publicUrl}/#/${path}` : "");

    // /manage rolemenu
    const rolemenu = guard(async i => {
        need(i);
        const sub = i.options.getSubcommand(), gid = i.guildId;
        if (sub === "create") {
            const ch = i.options.getChannel("channel", true);
            await i.deferReply({ flags: 64 });
            const m = await menus.create({ guildId: gid, channelId: ch.id, title: i.options.getString("title", true), description: i.options.getString("description"), mode: i.options.getString("mode") ?? "toggle" });
            return eph(i, `Role menu **#${m.id}** is up in <#${ch.id}>. Add roles with \`/manage rolemenu add menu:${m.id} role:@Role\`.${url("tools")}`);
        }
        if (sub === "list") {
            const list = db.listRoleMenus(gid);
            if (!list.length) return eph(i, "No role menus yet. Make one with `/manage rolemenu create`.");
            return eph(i, { embeds: [{ color: 0x5865f2, title: "Role menus", description: list.map(m => `**#${m.id}** ${m.title} · <#${m.channel_id}> · ${db.roleMenuItems(m.id).length} roles · ${m.mode === "single" ? "pick one" : "pick any"}`).join("\n").slice(0, 4000) }] });
        }
        const menuId = i.options.getInteger("menu", true);
        await i.deferReply({ flags: 64 });
        if (sub === "add") {
            const role = i.options.getRole("role", true);
            const full = (await api.allRoles(gid)).find(r => r.id === role.id);
            if (full && !roleIsSafe(full, gid)) throw new UserError("Members can't pick that role themselves: it is managed by an app, or it can moderate or manage the server. Pick a plain role.");
            await menus.addRole({ guildId: gid, menuId, roleId: role.id, label: i.options.getString("label"), emoji: i.options.getString("emoji") });
            return eph(i, `Added <@&${role.id}> to menu #${menuId}.`);
        }
        if (sub === "remove") { await menus.removeRole({ guildId: gid, menuId, roleId: i.options.getRole("role", true).id }); return eph(i, `Removed it from menu #${menuId}.`); }
        if (sub === "delete") { await menus.remove({ guildId: gid, menuId }); return eph(i, `Deleted menu #${menuId}.`); }
    });

    // /manage starboard
    const starboardCmd = guard(async i => {
        need(i);
        const sub = i.options.getSubcommand(), gid = i.guildId, cur = getStarboard(db, gid);
        if (sub === "setup") {
            const ch = i.options.getChannel("channel"), th = i.options.getInteger("threshold"), em = i.options.getString("emoji"), self = i.options.getBoolean("selfstar");
            if (em && !parseEmoji(em)) throw new UserError("That doesn't look like an emoji.");
            const next = cleanStarboard({ ...cur, on: true, ...(ch ? { channel: ch.id } : {}), ...(th ? { threshold: th } : {}), ...(em ? { emoji: em } : {}), ...(self !== null ? { selfStar: self } : {}) });
            if (!next.channel) throw new UserError("Pick the channel where starred messages go: `/manage starboard setup channel:#starboard`.");
            db.setToolSetting("starboard", gid, next);
            return eph(i, `Starboard is **on**. A message that gets **${next.threshold}** ${next.emoji} goes to <#${next.channel}>.${next.selfStar ? "" : " Your own reaction doesn't count."}${url("tools")}`);
        }
        if (sub === "off") { db.setToolSetting("starboard", gid, { ...cur, on: false }); return eph(i, "Starboard is off. Posts already on it stay."); }
        if (sub === "status" || sub === "top") {
            const top = db.topStarPosts(gid, 5);
            return eph(i, { embeds: [{ color: 0xffac33, title: "⭐ Starboard", description: [`**Status:** ${cur.on ? "on" : "off"}`, `**Channel:** ${cur.channel ? `<#${cur.channel}>` : "not set"}`, `**Needs:** ${cur.threshold} × ${cur.emoji}`, `**Posts so far:** ${db.starCount(gid)}`, ...(top.length ? ["", "**Top posts**", ...top.map(p => `⭐ ${p.stars} · [message](https://discord.com/channels/${gid}/${p.source_channel}/${p.source_id})${p.author_id ? ` by <@${p.author_id}>` : ""}`)] : [])].join("\n") }] });
        }
    });

    // /manage suggestions
    const suggestionsCmd = guard(async i => {
        need(i);
        const sub = i.options.getSubcommand(), gid = i.guildId;
        if (sub === "setup") {
            const ch = i.options.getChannel("channel", true), role = i.options.getRole("role");
            db.setToolSetting("suggest", gid, cleanSuggest({ channel: ch.id, role: role?.id ?? getSuggestCfg(db, gid).role }));
            return eph(i, `Suggestions go to <#${ch.id}>. Members use \`/server suggest\`; you answer with \`/manage suggestions decide\`.${url("tools")}`);
        }
        if (sub === "decide") {
            await i.deferReply({ flags: 64 });
            const s = await suggestions.decide({ guildId: gid, id: i.options.getInteger("id", true), status: i.options.getString("status", true), note: i.options.getString("note"), by: i.user.id });
            return eph(i, `Suggestion #${s.id} is now **${SUGGEST_STATUS[s.status].label}**.`);
        }
        if (sub === "list") {
            const rows = db.listSuggestions(gid, { status: i.options.getString("status"), limit: 15 });
            if (!rows.length) return eph(i, "No suggestions yet.");
            return eph(i, { embeds: [{ color: 0x5865f2, title: "Suggestions", description: rows.map(s => `**#${s.id}** ${SUGGEST_STATUS[s.status]?.icon ?? ""} ${s.text.slice(0, 80)}${s.text.length > 80 ? "…" : ""}`).join("\n").slice(0, 4000) }] });
        }
    });

    // /manage tags
    const tagsCmd = guard(async i => {
        need(i);
        const sub = i.options.getSubcommand(), gid = i.guildId;
        if (sub === "add") { const name = saveTagChecked(db, gid, i.options.getString("name", true), i.options.getString("response", true), i.user.id); return eph(i, `Saved. Members can now use it with \`/server tag name:${name}\`.${url("tools")}`); }
        if (sub === "remove") return eph(i, db.deleteTag(gid, cleanTagName(i.options.getString("name", true))) ? "Removed." : "There is no command by that name.");
        if (sub === "list") { const t = db.listTags(gid); return eph(i, t.length ? { embeds: [{ color: 0x5865f2, title: "Custom commands", description: t.map(x => `\`${x.name}\` · used ${x.uses}×`).join("\n").slice(0, 4000) }] } : "No custom commands yet."); }
    });

    // /manage poll
    const pollCmd = guard(async i => {
        if (!i.inGuild()) throw new UserError("Use this in a server.");
        const sub = i.options.getSubcommand(), gid = i.guildId;
        if (sub === "create") {
            if (!isManager(i) && !i.memberPermissions?.has?.(0x2000n)) throw new UserError("You need Manage Messages or Manage Server to start a poll.");
            await i.deferReply({ flags: 64 });
            const ch = i.options.getChannel("channel") ?? i.channel;
            const p = await polls.create({ guildId: gid, channelId: ch.id, question: i.options.getString("question", true), options: parseOptions(i.options.getString("options", true)), hours: i.options.getInteger("hours") ?? 0, multi: i.options.getBoolean("multi") === true, by: i.user.id });
            return eph(i, `Poll **#${p.id}** is live in <#${ch.id}>.${p.ends_at ? "" : ` End it with \`/manage poll end id:${p.id}\`.`}`);
        }
        if (sub === "end") {
            if (!isManager(i) && !i.memberPermissions?.has?.(0x2000n)) throw new UserError("You need Manage Messages or Manage Server to end a poll.");
            await i.deferReply({ flags: 64 });
            await polls.end(i.options.getInteger("id", true), gid);
            return eph(i, "The poll has ended and the results are posted on it.");
        }
    });

    const suggest = guard(async i => {
        if (!i.inGuild()) throw new UserError("Use this in a server.");
        await i.deferReply({ flags: 64 });
        const s = await suggestions.submit({ guildId: i.guildId, userId: i.user.id, text: i.options.getString("idea", true) });
        return eph(i, `Thanks! Your suggestion is posted as **#${s.id}** in <#${s.channel_id}>.`);
    });

    // /server tag
    const tag = guard(async i => {
        if (!i.inGuild()) throw new UserError("Use this in a server.");
        const name = cleanTagName(i.options.getString("name", true)), t = db.getTag(i.guildId, name);
        if (!t) return eph(i, "There is no command by that name. Try typing a few letters and pick one from the list.");
        db.bumpTag(i.guildId, name);
        return i.reply({ content: t.response, allowedMentions: { parse: [] } });
    });
    async function tagAutocomplete(i) {
        const q = cleanTagName(i.options.getFocused());
        return i.respond(i.guildId ? db.listTags(i.guildId).filter(t => t.name.includes(q)).slice(0, 25).map(t => ({ name: t.name, value: t.name })) : []);
    }

    /** Buttons: role menus (rm:), polls (pl:) and suggestions (sg:). */
    async function button(i) {
        if (!i.inGuild()) return eph(i, "Use this in a server.");
        if (i.customId.startsWith("rm:")) return eph(i, await menus.press(i));
        if (i.customId.startsWith("pl:")) return polls.vote(i);
        if (i.customId.startsWith("sg:")) return suggestions.vote(i);
    }

    return { rolemenu, starboard: starboardCmd, suggestions: suggestionsCmd, tags: tagsCmd, poll: pollCmd, suggest, tag, tagAutocomplete, button };
}
