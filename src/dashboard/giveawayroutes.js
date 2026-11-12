// The server Giveaways page's API: list, create, end and remind, for the servers a person manages.
// server.js passes in the helpers it already has (ctx) and merges these routes into its table.
import { DiscordApiError } from "./discord.js";
import { HttpError } from "./http.js";
import { MAX_KEYS } from "../gwstore.js";
import { STEP_KINDS } from "../gwpartner.js";
import { UserError } from "../errors.js";
import { autoImage } from "../giveaway.js";
import { giveawayInput } from "../gwinput.js";
import { roleIds } from "../gwroles.js";

export function createGiveawayRoutes(ctx) {
    const { cooldown, db, giveawayOf, giveaways, itad, managerGuild, needGiveaways, outcomeOf, pendingClaimsFor, rest, session } = ctx;
    return {
        // What members see: games their servers' staff marked for future giveaways.
        "GET /api/giveaways/soon": async (req) => {
            const s = session(req);
            const names = new Map(s.guilds.map(g => [g.id, g.name]));
            return { games: db.listSoon([...names.keys()]).map(x => ({ ...x, server: names.get(x.guild_id) })) };
        },
        // ----- giveaways (server managers) -----
        "GET /api/giveaways": async (req, _b, url) => {
            const s = session(req);
            const g = managerGuild(s, url.searchParams.get("guild"));
            const rows = db.listGiveaways(g.id, { limit: 50 }).map(x => {
                const keys = db.listKeys(x.id);
                return { id: x.id, title: x.title, status: x.status, starts_at: x.starts_at, ends_at: x.ends_at, channel_id: x.channel_id, entries: db.countEntries(x.id), prizes: keys.length, redeemed: keys.filter(k => k.status === "confirmed").length, outcome: outcomeOf(x, keys) };
            });
            return { giveaways: rows, pending: await pendingClaimsFor(g.id), settings: db.getGiveawaySettings(g.id), max: MAX_KEYS, stepKinds: Object.entries(STEP_KINDS).map(([id, k]) => ({ id, label: k.label, hint: k.hint })) };
        },
        "GET /api/giveaways/templates": async (req, _b, url) => {
            const s = session(req); needGiveaways();
            const g = managerGuild(s, url.searchParams.get("guild"));
            return { templates: db.listTemplates(g.id) };
        },
        "POST /api/giveaways/templates": async (req, body) => {
            const s = session(req); needGiveaways();
            const g = managerGuild(s, String(body.guild_id));
            if (body.remove) { db.removeTemplate(g.id, Number(body.remove)); return { templates: db.listTemplates(g.id) }; }
            const name = String(body.name ?? "").trim().slice(0, 40);
            if (!name) throw new HttpError(400, "Give the template a name.");
            if (db.listTemplates(g.id).length >= 25 && !db.listTemplates(g.id).some(t => t.name === name)) throw new HttpError(400, "You can keep up to 25 templates.");
            // Only plain form values are kept: strings, numbers and booleans, never anything that looks like a prize list.
            const data = {};
            for (const [k, v] of Object.entries(body.data ?? {}).slice(0, 40)) if (/^[a-zA-Z]{1,24}$/.test(k) && k !== "keys" && ["string", "number", "boolean"].includes(typeof v)) data[k] = typeof v === "string" ? v.slice(0, 1500) : v;
            db.saveTemplate(g.id, name, data);
            return { templates: db.listTemplates(g.id) };
        },
        "GET /api/giveaways/art": async (req, _b, url) => {
            session(req);
            const q = (url.searchParams.get("game") ?? "").trim().slice(0, 100);
            if (!q) return { image: null };
            const art = await autoImage(itad, q);
            return { image: art?.image ?? null };
        },
        "GET /api/giveaways/info": async (req, _b, url) => {
            const s = session(req);
            const g = managerGuild(s, url.searchParams.get("guild"));
            const x = giveawayOf(g, url.searchParams.get("id"));
            // names only, never key values
            return { id: x.id, title: x.title, status: x.status, entries: db.countEntries(x.id), keys: db.listKeys(x.id).map(k => ({ position: k.position, label: k.label, status: k.status, winner_id: k.winner_id })) };
        },
        "POST /api/giveaways/create": async (req, body) => {
            const s = session(req);
            const g = managerGuild(s, body.guild_id);
            needGiveaways();
            const undo = cooldown(s.userId, "add");
            try {
            const channels = await rest.listChannels(g.id).catch(err => {
                if (err instanceof DiscordApiError && [403, 404].includes(err.status)) throw new HttpError(400, "The bot is not in that server yet. Invite it first.");
                throw err;
            });
            if (!channels.some(c => c.id === body.channel_id)) throw new HttpError(400, "Pick a text channel from the list.");
            const { input, duplicates } = giveawayInput(body, { channelIds: channels.map(c => c.id) });
            const r = await giveaways.create({ ...input, guild_id: g.id, channel_id: body.channel_id, host_id: s.userId });
            return { ...r, duplicates };
            } catch (err) { undo(); throw err; }
        },
        "POST /api/giveaways/end": async (req, body) => { const g = managerGuild(session(req), body.guild_id); needGiveaways(); const x = giveawayOf(g, body.id); const r = await giveaways.end(x.id); return { winners: r.winners.length, unused: r.unused }; },
        "POST /api/giveaways/cancel": async (req, body) => { const g = managerGuild(session(req), body.guild_id); needGiveaways(); const x = giveawayOf(g, body.id); return await giveaways.cancel(x.id); },
        "POST /api/giveaways/reroll": async (req, body) => { const g = managerGuild(session(req), body.guild_id); needGiveaways(); const x = giveawayOf(g, body.id); const r = await giveaways.reroll(x.id, { userId: body.user_id || null }); return { winners: r.winners.length }; },
        "POST /api/giveaways/rules": async (req, body) => {
            const g = managerGuild(session(req), body.guild_id); needGiveaways();
            const x = giveawayOf(g, body.id);
            const patch = { clear: body.clear === true, require_role_ids: roleIds(body.require_role_ids), override_role_ids: roleIds(body.override_role_ids), bonus_role_ids: roleIds(body.bonus_role_ids) };
            if (body.require_all !== undefined) patch.require_all = body.require_all === true || body.require_all === "all";
            if (body.bonus_entries !== undefined) patch.bonus_entries = Number(body.bonus_entries);
            if (body.regions !== undefined) patch.regions = String(body.regions);
            if (body.steam_verified !== undefined) patch.require_steam = body.steam_verified === true;
            await giveaways.updateRules(x.id, patch);
            return { ok: true };
        },
        "POST /api/giveaways/remind": async (req, body) => {
            const g = managerGuild(session(req), body.guild_id); needGiveaways();
            const k = db.getKey(Number(body.key_id)), x = k && db.getGiveaway(k.giveaway_id);
            if (!x || x.guild_id !== g.id) throw new HttpError(404, "That prize isn't in this server.");
            try { await giveaways.remind(k.id); } catch (e) { if (e instanceof UserError) throw new HttpError(400, e.message); throw e; }
            return { ok: true };
        },
        "POST /api/giveaways/replace": async (req, body) => {
            const g = managerGuild(session(req), body.guild_id); needGiveaways();
            const x = giveawayOf(g, body.id);
            return await giveaways.replaceKey(x.id, String(body.user_id ?? ""), body.key);
        },
        "POST /api/giveaways/setup": async (req, body) => {
            const g = managerGuild(session(req), body.guild_id);
            const ids = new Set([...(await rest.listChannels(g.id).catch(() => [])).map(c => c.id)]);
            const patch = {};
            if (body.vouch_channel_id !== undefined) {
                if (body.vouch_channel_id && !ids.has(body.vouch_channel_id)) throw new HttpError(400, "Pick a text channel from the list.");
                patch.vouch_channel_id = body.vouch_channel_id || null;
            }
            if (body.manager_role_id !== undefined) {
                const roles = body.manager_role_id ? await rest.listRoles(g.id).catch(() => []) : [];
                if (body.manager_role_id && !roles.some(r => r.id === body.manager_role_id)) throw new HttpError(400, "Pick a role from the list.");
                patch.manager_role_id = body.manager_role_id || null;
            }
            if (body.giveaway_channel_id !== undefined) {
                if (body.giveaway_channel_id && !ids.has(body.giveaway_channel_id)) throw new HttpError(400, "Pick a text channel from the list.");
                patch.giveaway_channel_id = body.giveaway_channel_id || null;
            }
            return { settings: db.setGiveawaySettings(g.id, patch) };
        },
    };
}
