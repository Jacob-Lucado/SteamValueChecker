// The My servers page's API: what each managed server has set up, channels and roles, feeds, drops and events.
// server.js passes in the helpers it already has (ctx) and merges these routes into its table.
import { BUNDLE_STORES } from "../bundlefeedsource.js";
import { DiscordApiError } from "./discord.js";
import { EXTRA_BOARDS, extraBoard, finishedLeague, leaderboard, serverStats } from "../library.js";
import { HttpError } from "./http.js";
import { addToServerList, removeFromServerList, serverListView } from "../serverlist.js";
import { applyBundleFeedSettings, bundleFeedView } from "../bundlefeed.js";
import { applyCodeSettings, codeFamilies, codeGames } from "../codes.js";
import { applyDropSettings, cleanDrop, dropView } from "../drops.js";
import { autoSetup, setupStatus } from "../setup.js";

export function createServerRoutes(ctx) {
    const { botGuilds, bundleFeed, cd, codes, comm, config, cooldown, db, drops, guildChoices, guildFor, isManager, itad, managedGuild, managerGuild, names, now, rest, session, userRow } = ctx;
    return {
        "GET /api/servers/bundles": async (req, _b, url) => {
            const s = session(req);
            const g = s.guilds.find(x => x.id === url.searchParams.get("guild"));
            if (!g || !isManager(g)) throw new HttpError(403, "You need the Manage Server permission there.");
            let channels, roles = [];
            try { channels = await rest.listChannels(g.id); roles = await Promise.resolve(rest.listRoles?.(g.id) ?? []).catch(() => []); }
            catch (err) {
                if (err instanceof DiscordApiError && [403, 404].includes(err.status)) throw new HttpError(400, "The bot is not in that server yet. Invite it first.");
                throw err;
            }
            const settings = db.getBundleFeedSettings(g.id);
            return { settings, channels, roles, stores: Object.entries(BUNDLE_STORES).map(([key, v]) => ({ key, name: v.name })), latest: db.listFeedBundles({ status: "active", stores: settings.stores, limit: 6, adult: settings.adult }).map(bundleFeedView) };
        },
        "POST /api/servers/bundles": async (req, body) => {
            const s = session(req);
            const g = s.guilds.find(x => x.id === body.guild_id);
            if (!g || !isManager(g)) throw new HttpError(403, "You need the Manage Server permission there.");
            const patch = {};
            if (body.channel_id !== undefined) {
                if (body.channel_id) {
                    let channels;
                    try { channels = await rest.listChannels(g.id); }
                    catch (err) {
                        if (err instanceof DiscordApiError && [403, 404].includes(err.status)) throw new HttpError(400, "The bot is not in that server yet. Invite it first.");
                        throw err;
                    }
                    const channel = channels.find(c => c.id === body.channel_id);
                    if (!channel) throw new HttpError(400, "Pick a text channel from the list.");
                    if (channel.id !== db.getBundleFeedSettings(g.id).channel_id) {
                        try { await rest.sendMessage(channel.id, { content: `Game bundles will be posted in this channel (set from the dashboard by <@${s.userId}>).`, allowed_mentions: { parse: [] } }); }
                        catch { throw new HttpError(400, `I cannot post in #${channel.name}. Give the bot View Channel, Send Messages and Embed Links there, then try again.`); }
                    }
                }
                patch.channel_id = body.channel_id || null;
            }
            if (body.role_id !== undefined) {
                if (body.role_id) {
                    const roles = await Promise.resolve(rest.listRoles?.(g.id) ?? []).catch(() => []);
                    if (!roles.some(r => r.id === body.role_id)) throw new HttpError(400, "Pick a role from the list.");
                }
                patch.role_id = body.role_id || null;
            }
            if (body.stores !== undefined) patch.stores = body.stores;
            if (body.adult !== undefined) patch.adult = body.adult;
            let settings;
            try { settings = applyBundleFeedSettings(db, g.id, patch); } catch (err) { throw new HttpError(400, err.message); }
            if (patch.channel_id) bundleFeed?.poll?.().catch(() => {}); // post what is current right away
            return { settings };
        },
        "GET /api/servers/codes": async (req, _b, url) => {
            const s = session(req);
            const g = s.guilds.find(x => x.id === url.searchParams.get("guild"));
            if (!g || !isManager(g)) throw new HttpError(403, "You need the Manage Server permission there.");
            let channels, roles = [];
            try { channels = await rest.listChannels(g.id); roles = await Promise.resolve(rest.listRoles?.(g.id) ?? []).catch(() => []); }
            catch (err) {
                if (err instanceof DiscordApiError && [403, 404].includes(err.status)) throw new HttpError(400, "The bot is not in that server yet. Invite it first.");
                throw err;
            }
            return { settings: db.getCodeSettings(g.id), channels, roles, games: codeGames(), families: codeFamilies() };
        },
        "POST /api/servers/codes": async (req, body) => {
            const s = session(req);
            const g = s.guilds.find(x => x.id === body.guild_id);
            if (!g || !isManager(g)) throw new HttpError(403, "You need the Manage Server permission there.");
            const patch = {};
            if (body.channel_id !== undefined) {
                if (body.channel_id) {
                    let channels;
                    try { channels = await rest.listChannels(g.id); }
                    catch (err) {
                        if (err instanceof DiscordApiError && [403, 404].includes(err.status)) throw new HttpError(400, "The bot is not in that server yet. Invite it first.");
                        throw err;
                    }
                    const channel = channels.find(c => c.id === body.channel_id);
                    if (!channel) throw new HttpError(400, "Pick a text channel from the list.");
                    if (channel.id !== db.getCodeSettings(g.id).channel_id) {
                        try { await rest.sendMessage(channel.id, { content: `Game codes will be posted in this channel (set from the dashboard by <@${s.userId}>).`, allowed_mentions: { parse: [] } }); }
                        catch { throw new HttpError(400, `I cannot post in #${channel.name}. Give the bot View Channel, Send Messages and Embed Links there, then try again.`); }
                    }
                }
                patch.channel_id = body.channel_id || null;
            }
            if (body.role_id !== undefined) {
                if (body.role_id) {
                    const roles = await Promise.resolve(rest.listRoles?.(g.id) ?? []).catch(() => []);
                    if (!roles.some(r => r.id === body.role_id)) throw new HttpError(400, "Pick a role from the list.");
                }
                patch.role_id = body.role_id || null;
            }
            if (body.games !== undefined) patch.games = body.games;
            let settings;
            try { settings = applyCodeSettings(db, g.id, patch); } catch (err) { throw new HttpError(400, err.message); }
            if (patch.channel_id) codes?.poll?.().catch(() => {}); // post what is current right away
            return { settings };
        },
        // ----- promo drops (SteelSeries, NVIDIA and the like) -----
        "GET /api/servers/drops": async (req, _b, url) => {
            const g = managedGuild(req, url.searchParams.get("guild"));
            const { channels, roles } = await guildChoices(g.id);
            const at = now();
            db.expireDrops(at);
            return { settings: db.getDropSettings(g.id), channels, roles, drops: db.listDrops(g.id, { limit: 25 }).map(d => dropView(d, at)), news: db.listNews(8) };
        },
        "POST /api/servers/drops": async (req, body) => {
            const s = session(req);
            const g = managedGuild(req, body.guild_id);
            const patch = {};
            if (body.channel_id !== undefined) {
                if (body.channel_id) {
                    const { channels } = await guildChoices(g.id, false);
                    const channel = channels.find(c => c.id === body.channel_id);
                    if (!channel) throw new HttpError(400, "Pick a text channel from the list.");
                    if (channel.id !== db.getDropSettings(g.id).channel_id) {
                        try { await rest.sendMessage(channel.id, { content: `Promo drops will be posted in this channel (set from the dashboard by <@${s.userId}>).`, allowed_mentions: { parse: [] } }); }
                        catch { throw new HttpError(400, `I cannot post in #${channel.name}. Give the bot View Channel, Send Messages and Embed Links there, then try again.`); }
                    }
                }
                patch.channel_id = body.channel_id || null;
            }
            if (body.role_id !== undefined) {
                if (body.role_id) {
                    const { roles } = await guildChoices(g.id);
                    if (!roles.some(r => r.id === body.role_id)) throw new HttpError(400, "Pick a role from the list.");
                }
                patch.role_id = body.role_id || null;
            }
            if (body.news !== undefined) patch.news = Boolean(body.news);
            if (patch.news && !(patch.channel_id ?? db.getDropSettings(g.id).channel_id)) throw new HttpError(400, "Pick a channel first, then turn blog watching on.");
            const settings = applyDropSettings(db, g.id, patch);
            if (patch.channel_id) drops?.poll?.().catch(() => {});
            return { settings };
        },
        "POST /api/servers/drops/add": async (req, body) => {
            const s = session(req);
            const g = managedGuild(req, body.guild_id);
            let clean;
            try { clean = cleanDrop(body, now()); } catch (err) { throw new HttpError(400, err.message); }
            if (!db.getDropSettings(g.id).channel_id) throw new HttpError(400, "Pick a promo channel first, then add the drop.");
            const id = db.addDrop({ guildId: g.id, ...clean, createdBy: s.userId });
            drops?.poll?.().catch(() => {});
            return { id };
        },
        "POST /api/servers/drops/end": async (req, body) => {
            const g = managedGuild(req, body.guild_id);
            const d = db.getDrop(Number(body.id));
            if (!d || d.guild_id !== g.id) throw new HttpError(404, "No such drop in this server.");
            if (!db.endDrop(d.id)) throw new HttpError(400, "That one has already ended.");
            drops?.poll?.().catch(() => {});
            return { id: d.id, status: "ended" };
        },
        "GET /api/servers/channels": async (req, _b, url) => {
            const s = session(req);
            const g = s.guilds.find(x => x.id === url.searchParams.get("guild"));
            if (!g || !isManager(g)) throw new HttpError(403, "You need the Manage Server permission there.");
            try {
                return { channels: await rest.listChannels(g.id), current: db.getGuild(g.id)?.channel_id ?? null };
            } catch (err) {
                if (err instanceof DiscordApiError && [403, 404].includes(err.status)) throw new HttpError(400, "The bot is not in that server yet. Invite it first.");
                throw err;
            }
        },
        "POST /api/servers/channel": async (req, body) => {
            const s = session(req);
            const g = s.guilds.find(x => x.id === body.guild_id);
            if (!g || !isManager(g)) throw new HttpError(403, "You need the Manage Server permission there.");
            if (body.clear) return { cleared: db.clearGuildChannel(g.id) };

            let channels;
            try { channels = await rest.listChannels(g.id); }
            catch (err) {
                if (err instanceof DiscordApiError && [403, 404].includes(err.status)) throw new HttpError(400, "The bot is not in that server yet. Invite it first.");
                throw err;
            }
            const channel = channels.find(c => c.id === body.channel_id);
            if (!channel) throw new HttpError(400, "Pick a text channel from the list.");

            // Posting a message proves the bot can use the channel, and tells the server who changed it.
            try {
                await rest.sendMessage(channel.id, {
                    content: `Wishlist alert channel set from the dashboard by <@${s.userId}>. Members get sale alerts here when a DM cannot be delivered, or when they choose channel delivery.`,
                    allowed_mentions: { parse: [] }
                });
            } catch {
                throw new HttpError(400, `I cannot post in #${channel.name}. Give the bot View Channel, Send Messages and Embed Links there, then try again.`);
            }
            db.setGuildChannel(g.id, channel.id, s.userId);
            return { channel };
        },
        // ----- shared server list, leaderboard, group alerts -----
        "GET /api/servers/list": async (req, _b, url) => {
            const s = session(req);
            const g = guildFor(s, url.searchParams.get("guild"));
            const u = userRow(s);
            return { ...(await serverListView(db, itad, g.id, u)), manager: isManager(g) };
        },
        "POST /api/servers/list/add": async (req, body) => {
            const s = session(req);
            const g = guildFor(s, body.guild_id);
            cooldown(s.userId, "add");
            userRow(s);
            return await addToServerList(db, itad, g.id, s.userId, body.title);
        },
        "POST /api/servers/list/vote": async (req, body) => {
            const s = session(req);
            const g = guildFor(s, body.guild_id);
            const game = db.listServerGames(g.id, s.userId).find(x => x.itad_id === body.itad_id);
            if (!game) throw new HttpError(404, "That game is not on the server list.");
            const voted = db.toggleVote(game.id, s.userId);
            return { voted, votes: game.votes + (voted ? 1 : -1) };
        },
        "POST /api/servers/list/remove": async (req, body) => {
            const s = session(req);
            const g = guildFor(s, body.guild_id);
            const game = db.listServerGames(g.id, s.userId).find(x => x.itad_id === body.itad_id);
            if (!game) throw new HttpError(404, "That game is not on the server list.");
            return removeFromServerList(db, g.id, s.userId, game.title, isManager(g));
        },
        "GET /api/servers/leaderboard": async (req, _b, url) => {
            const s = session(req);
            const g = guildFor(s, url.searchParams.get("guild"));
            const which = url.searchParams.get("board");
            const finished = which === "finished";
            const entries = finished ? finishedLeague(db, g.id, now()) : EXTRA_BOARDS[which] ? extraBoard(db, g.id, which, now()) : leaderboard(db, g.id);
            const t = now();
            const out = [];
            for (const e of entries) {
                const key = `${g.id}:${e.discord_id}`;
                let hit = names.get(key);
                if (!hit || hit.until < t) {
                    hit = { name: await rest.memberName(g.id, e.discord_id).catch(() => null), until: t + 10 * 60_000 };
                    names.set(key, hit);
                    if (names.size > 2000) names.delete(names.keys().next().value);
                }
                out.push({ name: hit.name ?? "A member", savedPct: e.savedPct, games: e.games, done: e.done, label: e.label, you: e.discord_id === s.userId });
            }
            return { entries: out, joined: Boolean(userRow(s).share) };
        },
        "POST /api/servers/group": async (req, body) => {
            const s = session(req);
            const g = guildFor(s, body.guild_id);
            if (!isManager(g)) throw new HttpError(403, "You need the Manage Server permission there.");
            if (!db.getGuild(g.id)) throw new HttpError(400, "Set an alert channel for that server first.");
            const n = Number(body.minimum);
            if (!Number.isInteger(n) || n < 0 || n === 1 || n > 20) throw new HttpError(400, "Use 2 to 20, or 0 to turn it off.");
            db.setGroupMin(g.id, n);
            return { groupMin: n };
        },
        "POST /api/servers/hot": async (req, body) => {
            const s = session(req);
            const g = guildFor(s, body.guild_id);
            if (!isManager(g)) throw new HttpError(403, "You need the Manage Server permission there.");
            if (!db.getGuild(g.id)) throw new HttpError(400, "Set an alert channel for that server first.");
            const n = Math.round(Number(body.minimum));
            if (!Number.isFinite(n) || n < 0 || n > 95 || (n !== 0 && n < 30)) throw new HttpError(400, "Pick 30 to 95, or 0 to turn it off.");
            db.setHotMin(g.id, n);
            return { hotMin: n };
        },
        "POST /api/servers/sales": async (req, body) => {
            const s = session(req);
            const g = guildFor(s, body.guild_id);
            if (!isManager(g)) throw new HttpError(403, "You need the Manage Server permission there.");
            if (!db.getGuild(g.id)) throw new HttpError(400, "Set an alert channel for that server first.");
            db.setSaleFeed(g.id, Boolean(body.enabled));
            return { saleFeed: Boolean(body.enabled) };
        },
        "POST /api/servers/feed": async (req, body) => {
            const s = session(req);
            const g = guildFor(s, body.guild_id);
            if (!isManager(g)) throw new HttpError(403, "You need the Manage Server permission there.");
            if (!db.getGuild(g.id)) throw new HttpError(400, "Set an alert channel for that server first.");
            db.setFreeFeed(g.id, Boolean(body.enabled));
            return { freeFeed: Boolean(body.enabled) };
        },
        "POST /api/servers/digest": async (req, body) => {
            const s = session(req);
            const g = guildFor(s, body.guild_id);
            if (!isManager(g)) throw new HttpError(403, "You need the Manage Server permission there.");
            if (!db.getGuild(g.id)) throw new HttpError(400, "Set an alert channel for that server first.");
            db.setWeeklyDigest(g.id, Boolean(body.enabled));
            return { weeklyDigest: Boolean(body.enabled) };
        },
        // The same checklist as /manage setup in Discord.
        "GET /api/servers/channelmap": async (req, _b, url) => {
            const g = managerGuild(session(req), url.searchParams.get("guild"));
            return { guild: g.id, channels: cd.channelMap(g.id), alert: db.getGuild(g.id)?.channel_id ?? null };
        },
        "POST /api/servers/channelmap": async (req, body) => {
            const g = managerGuild(session(req), String(body.guild_id));
            return comm(() => cd.setChannel(g.id, String(body.key), body.channel_id || null));
        },
        "GET /api/servers/setup": async (req, _b, url) => {
            const s = session(req);
            const g = managerGuild(s, url.searchParams.get("guild"));
            return { ...setupStatus(db, g.id), gameNightOn: db.gameNightOn(g.id), staffRole: db.getTicketSettings(g.id).staff_role_id, bot: botGuilds ? Boolean(botGuilds(g.id)) : null };
        },
        "POST /api/servers/gamenight": async (req, body) => {
            const g = managerGuild(session(req), String(body.guild_id));
            db.setGameNight(g.id, Boolean(body.enabled));
            return { gameNight: Boolean(body.enabled) };
        },
        "GET /api/servers/forums": async (req, _b, url) => {
            const s = session(req);
            const g = managerGuild(s, url.searchParams.get("guild"));
            try { return { forums: await rest.listForums(g.id) }; }
            catch (err) { if (err instanceof DiscordApiError && [403, 404].includes(err.status)) throw new HttpError(400, "The bot is not in that server yet. Invite it first."); throw err; }
        },
        "POST /api/servers/setup/auto": async (req, body) => {
            const s = session(req);
            const g = managerGuild(s, String(body.guild_id));
            if (botGuilds && !botGuilds(g.id)) throw new HttpError(400, "The bot is not in that server yet. Invite it first.");
            const roles = body.staff_role_id ? await rest.listRoles(g.id).catch(() => []) : [];
            const staffRoleId = body.staff_role_id && roles.some(r => r.id === body.staff_role_id) ? body.staff_role_id : null;
            try { return { ...(await autoSetup({ api: rest, db, guildId: g.id, botId: config.clientId, userId: s.userId, staffRoleId })), status: setupStatus(db, g.id) }; }
            catch (e) { if (e.userFacing) throw new HttpError(400, e.message); if (e instanceof DiscordApiError && e.status === 403) throw new HttpError(400, "I need the Manage Channels permission to create channels."); throw e; }
        },
        "GET /api/servers/stats": async (req, _b, url) => {
            const s = session(req);
            const g = guildFor(s, url.searchParams.get("guild"));
            return serverStats(db, g.id);
        },
        "GET /api/servers/roles": async (req, _b, url) => {
            const g = managerGuild(session(req), url.searchParams.get("guild"));
            try { return { roles: await rest.listRoles(g.id) }; }
            catch (err) {
                if (err instanceof DiscordApiError && [403, 404].includes(err.status)) throw new HttpError(400, "The bot is not in that server yet. Invite it first.");
                throw err;
            }
        },
    };
}
