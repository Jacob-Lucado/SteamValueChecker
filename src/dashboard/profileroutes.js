// Profiles, guestbooks, friends and the club.
// server.js passes in the helpers it already has (ctx) and merges these routes into its table.
import { HttpError } from "./http.js";
import { MAX_BG_STORED, decodeUpload, fetchSteamBackground } from "../profilebg.js";
import { PROFILE_STYLES, PROFILE_THEMES, buildProfile, cleanProfile, withDefaults } from "../profilepage.js";
import { cleanBirthday, cleanFriendName, friendDeals, friendRows, saveFriend, saveOwnBirthday, syncFollowedFriends } from "../friends.js";
import { clubProgress, setPick } from "../gameclub.js";
import { isSupporter } from "../supporters.js";
import { setProfile } from "../profile.js";

export function createProfileRoutes(ctx) {
    const { authorCard, bgLimit, config, cooldown, db, guildFor, isManager, isOwner, itad, mayPost, notifySocial, now, nowPlaying, profileEditorPayload, rest, session, slugOwner, socialWrite, steamFetch, userRow } = ctx;
    return {
        "GET /api/friends": async (req) => { const s = session(req); userRow(s); syncFollowedFriends(db, s.userId, id => authorCard(id).name); return { friends: friendRows(db, s.userId) }; },
        "POST /api/friends/birthday": async (req, body) => { const s = session(req); userRow(s); if (!db.setFriendBirthday(s.userId, cleanFriendName(body.name), cleanBirthday(body.birthday))) throw new HttpError(404, "I can't find that friend."); return { ok: true }; },
        "POST /api/friends/add": async (req, body) => { const s = session(req); userRow(s); return saveFriend(db, s.userId, { name: body.name, birthday: body.birthday, page: body.page }); },
        "POST /api/friends/remove": async (req, body) => { const s = session(req); if (!db.removeFriend(s.userId, String(body.name ?? ""))) throw new HttpError(404, "No friend by that name."); return { removed: true }; },
        "GET /api/friends/deals": async (req, _b, url) => {
            const s = session(req);
            const f = db.getFriend(s.userId, String(url.searchParams.get("name") ?? ""));
            if (!f) throw new HttpError(404, "No friend by that name.");
            if (!f.slug) throw new HttpError(400, "Add their public page name first.");
            cooldown(s.userId, "deals");
            const deals = await friendDeals(db, itad, f.slug, 10);
            if (!deals) throw new HttpError(404, "That page is not public, or does not exist.");
            return { name: f.name, deals };
        },
        // The viewer's Twitch account, as Discord shows it. It is read from their Discord connections (never typed in), so it can't be faked.
        "GET /api/twitchlink": async (req) => { const s = session(req), l = db.getTwitchLink(s.userId); return { linked: Boolean(l), login: l?.login ?? null }; },
        "POST /api/twitchlink": async (req, body) => {
            const s = session(req);
            if (body.action !== "remove") throw new HttpError(400, "Unknown action.");
            return { linked: false, removed: db.removeTwitchLink(s.userId) };
        },
        // Game club: the server's game of the month. Anyone in the server can look; Manage Server changes it.
        "GET /api/club": async (req, _b, url) => {
            const s = session(req), g = guildFor(s, String(url.searchParams.get("guild") ?? ""));
            const club = db.getClub(g.id), canManage = isManager(g) || isOwner(s);
            const channels = canManage ? (await rest.listChannels(g.id).catch(() => [])).filter(c => c.type === undefined || c.type === 0 || c.type === 5).map(c => ({ id: c.id, name: c.name })) : [];
            if (!club?.title) return { club: null, canManage, channels, channel: club?.channel_id ?? null };
            const prog = clubProgress(db, club);
            const owners = await Promise.all(prog.owners.map(async r => ({ ...r, name: (await rest.memberName(g.id, r.userId).catch(() => null)) || "Member " + String(r.userId).slice(-4) })));
            return { club: { title: club.title, appid: club.appid, month: club.month, channel: club.channel_id }, owners, sharing: prog.sharing, canManage, channels, channel: club.channel_id };
        },
        "POST /api/club": async (req, body) => {
            const s = session(req), g = guildFor(s, String(body.guild_id ?? ""));
            if (!(isManager(g) || isOwner(s))) throw new HttpError(403, "You need the Manage Server permission to change the game club.");
            if (body.action === "off") { db.removeClub(g.id); return { ok: true }; }
            if (body.action === "channel") { const id = String(body.channel_id ?? ""); if (id && !(await rest.listChannels(g.id).catch(() => [])).some(c => c.id === id)) throw new HttpError(400, "That channel is not in this server."); db.setClub(g.id, { channel_id: id || null }); return { ok: true }; }
            if (body.action === "pick") { try { setPick(db, g.id, body.title, s.userId, now()); } catch (e) { throw new HttpError(400, e.message); } return { ok: true }; }
            throw new HttpError(400, "Unknown action.");
        },
        "GET /api/profile": async (req) => { const s = session(req); const u = userRow(s); return { slug: u.profile_slug ?? null, public: Boolean(u.profile_public), claims: db.countGiftClaims(s.userId), giftsPaused: db.giftsPaused(s.userId) }; },
        "POST /api/profile": async (req, body) => {
            const s = session(req); userRow(s);
            const r = setProfile(db, s.userId, { enabled: Boolean(body.enabled), slug: body.slug });
            const cleared = body.resetClaims ? db.clearGiftClaims(s.userId) : 0;
            return { ...r, cleared, claims: db.countGiftClaims(s.userId) };
        },
        // Public on purpose (anyone with the link), but only for members who switched their page on.
        // ---------- full profiles ----------
        // The owner's editor: saved settings, the choices the editor offers, and a preview exactly as visitors would see it.
        "GET /api/profile/page": async (req) => {
            const s = session(req); const u = userRow(s);
            return await profileEditorPayload(u);
        },
        // The member's own birthday (month and day). Shared only when they tick the box, and then only as a reminder for people who have their page on their friends list.
        "POST /api/profile/birthday": async (req, body) => { const s = session(req); userRow(s); return saveOwnBirthday(db, s.userId, { birthday: body.birthday, share: body.share }); },
        "POST /api/profile/page": async (req, body) => {
            const s = session(req); const u = userRow(s);
            const { data } = db.getProfileData(s.userId);
            const next = cleanProfile(body ?? {}, data);
            if (next.theme && PROFILE_THEMES[next.theme]?.supporter && next.theme !== data.theme && !isSupporter(db, s.userId, now())) throw new HttpError(403, "That theme is for supporters. You can get a pass on the Chip in page.");
            if (next.style && PROFILE_STYLES[next.style]?.supporter && next.style !== data.style && !isSupporter(db, s.userId, now())) throw new HttpError(403, "That style is for supporters. You can get a pass on the Chip in page.");
            db.setProfileData(s.userId, next);
            return await profileEditorPayload(db.getUser(s.userId));
        },
        // The picture behind the page: upload one (a few are kept), copy the Steam background, switch between them, or delete one.
        "POST /api/profile/background": async (req, body) => {
            const s = session(req); const u = userRow(s);
            if (!bgLimit.hit(s.userId).ok) throw new HttpError(429, "Slow down a little.");
            const { data } = db.getProfileData(s.userId);
            const setActive = (bg) => db.setProfileData(s.userId, cleanProfile({ pagebg: bg }, data));
            const action = String(body.action ?? "");
            if (action === "upload") {
                let img; try { img = decodeUpload(body.data); } catch (e) { throw new HttpError(400, e.message); }
                if (db.countProfileBgs(s.userId) >= MAX_BG_STORED) throw new HttpError(400, `You can keep up to ${MAX_BG_STORED} pictures. Delete one first.`);
                setActive({ kind: "image", image: db.addProfileBg(s.userId, img.mime, img.buf, "upload") });
            } else if (action === "steam") {
                const link = db.getSteamLink(s.userId);
                if (!link) throw new HttpError(400, "Link your Steam account first (Steam page, or /steam link).");
                let img; try { img = await fetchSteamBackground(link.steamid, steamFetch); } catch (e) { throw new HttpError(502, e.message); }
                if (!img) throw new HttpError(404, "No background found on your Steam profile. Equip one there first, and make sure the profile is public.");
                if (img.video) { setActive({ kind: "video", video: img.video }); return await profileEditorPayload(db.getUser(s.userId)); }
                db.deleteSteamProfileBg(s.userId);
                if (db.countProfileBgs(s.userId) >= MAX_BG_STORED) throw new HttpError(400, `You can keep up to ${MAX_BG_STORED} pictures. Delete one first.`);
                setActive({ kind: "image", image: db.addProfileBg(s.userId, img.mime, img.buf, "steam") });
            } else if (action === "use") {
                const row = db.getProfileBg(Number(body.id));
                if (!row || row.discord_id !== s.userId) throw new HttpError(404, "That picture is not yours.");
                setActive({ kind: "image", image: row.id });
            } else if (action === "remove") {
                const row = db.getProfileBg(Number(body.id));
                if (!row || row.discord_id !== s.userId || !db.deleteProfileBg(s.userId, row.id)) throw new HttpError(404, "That picture is not yours.");
                if (data.pagebg?.image === row.id) setActive({ kind: "none", image: null });
            } else throw new HttpError(400, "Unknown action.");
            return await profileEditorPayload(db.getUser(s.userId));
        },
        // Preview unsaved changes. Nothing is stored.
        "POST /api/profile/preview": async (req, body) => {
            const s = session(req); const u = userRow(s);
            if (!u.profile_slug) throw new HttpError(400, "Choose a page name first.");
            const draft = withDefaults(cleanProfile(body ?? {}, {}));
            return { profile: await buildProfile({ db, itad, nowPlaying }, u, { owner: true, sameServer: true }, { draft }) };
        },
        // The list's owner lets go of a mark (and can report it) or pauses marking. They still never learn who made it.
        "POST /api/profile/gifts": async (req, body) => {
            const s = session(req);
            const u = userRow(s);
            if (body.action === "pause") { db.setGiftsPaused(s.userId, Boolean(body.on)); return { paused: db.giftsPaused(s.userId) }; }
            if (body.action !== "release") throw new HttpError(400, "Unknown action.");
            const id = String(body.id ?? "");
            const game = db.listItems(s.userId).find(g => g.itad_id === id);
            const r = db.releaseGift(s.userId, id, { report: Boolean(body.report), slug: u.profile_slug ?? "", title: game?.title ?? "" });
            if (!r.released) throw new HttpError(404, "Nobody has marked that one.");
            return { released: true, reported: Boolean(body.report) };
        },
        "POST /api/guestbook/post": async (req, body) => {
            const s = session(req); userRow(s); mayPost(s);
            if (!socialWrite.hit("u" + s.userId).ok) throw new HttpError(429, "Slow down a little.");
            const o = slugOwner(body.slug);
            const r = db.guestbookPost(o.discord_id, s.userId, body.body, { staff: s.userId === config.ownerId });
            if (r.error) throw new HttpError(r.status ?? 400, r.error);
            const me = authorCard(s.userId);
            notifySocial(o.discord_id, { title: `${me.name} signed your guestbook`, body: String(body.body ?? "").trim().slice(0, 140), url: o.profile_slug ? "/u/" + o.profile_slug : "/feed" });
            return { id: r.id };
        },
        "POST /api/guestbook/delete": async (req, body) => {
            const s = session(req);
            const e = db.guestbookEntry(Number(body.id));
            if (!e) throw new HttpError(404, "That note is gone.");
            if (e.author !== s.userId && e.owner !== s.userId && !isOwner(s)) throw new HttpError(403, "That one is not yours to remove.");
            db.guestbookDelete(e.id);
            return { deleted: true };
        },
    };
}
