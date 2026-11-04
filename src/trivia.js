// Game trivia for a server. Each round shows clues for a Steam game that get easier every few seconds (genre and year, then the
// developer, then a blurb with the name blanked out and a screenshot). Players tap one of four titles; earlier right answers
// score more. Facts come from the public Steam store and are cached, so a game only costs a lookup the first time.
import { MessageFlags, PermissionFlagsBits } from "discord.js";
import { UserError } from "./errors.js";

export const triviaSchema = `
CREATE TABLE IF NOT EXISTS trivia_facts (
    appid      INTEGER PRIMARY KEY,
    facts      TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS trivia_scores (
    guild_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    points   INTEGER NOT NULL DEFAULT 0,
    correct  INTEGER NOT NULL DEFAULT 0,
    played   INTEGER NOT NULL DEFAULT 0,
    wins     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
);
`;

const FACT_TTL = 30 * 86400;

export function triviaStore({ run, get, all, now }) {
    return {
        getTriviaFacts: appid => {
            const r = get("SELECT facts, fetched_at FROM trivia_facts WHERE appid = ?", Number(appid));
            if (!r || now() - r.fetched_at > FACT_TTL) return null;
            try { return JSON.parse(r.facts); } catch { return null; }
        },
        saveTriviaFacts: (appid, facts) => run("INSERT INTO trivia_facts (appid, facts, fetched_at) VALUES (?,?,?) ON CONFLICT(appid) DO UPDATE SET facts = excluded.facts, fetched_at = excluded.fetched_at", Number(appid), JSON.stringify(facts), now()),
        addTriviaScore: (guild, user, { points = 0, correct = 0, won = false }) => run(
            "INSERT INTO trivia_scores (guild_id, user_id, points, correct, played, wins) VALUES (?,?,?,?,1,?) ON CONFLICT(guild_id, user_id) DO UPDATE SET points = points + excluded.points, correct = correct + excluded.correct, played = played + 1, wins = wins + excluded.wins",
            String(guild), String(user), points, correct, won ? 1 : 0),
        triviaTop: (guild, limit = 10) => all("SELECT user_id, points, correct, played, wins FROM trivia_scores WHERE guild_id = ? AND points > 0 ORDER BY points DESC, wins DESC, user_id LIMIT ?", String(guild), limit),
        triviaRank: (guild, user) => get("SELECT points, correct, played, wins FROM trivia_scores WHERE guild_id = ? AND user_id = ?", String(guild), String(user)) ?? null
    };
}

/** Well known Steam games the questions are drawn from. Any that fail to load are simply skipped. */
export const POOL = [
    730, 570, 440, 292030, 1245620, 1091500, 271590, 1174180, 413150, 105600, 252490, 346110, 1145360, 367520, 504230, 1086940,
    489830, 1172470, 578080, 220, 400, 620, 550, 4000, 252950, 381210, 1426210, 892970, 1623730, 1593500, 1817070, 814380, 374320,
    524220, 1237970, 1085660, 227300, 294100, 255710, 289070, 1158310, 275850, 632360, 646570, 322330, 427520, 648800, 1966720,
    2358720, 1151640, 359550, 304930, 8930, 236850, 1328670, 435150, 1062090, 1449850, 1501750, 678960
];

export const ROUND_STAGES = 3;
export const POINTS = [3, 2, 1];

const strip = s => String(s ?? "").replace(/<[^>]*>/g, " ").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Blanks out the game's name (and the part before a colon, so "Portal 2: Aperture" can't leak) from its own blurb. */
export function maskTitle(text, name) {
    let out = strip(text);
    const names = [...new Set([name, name.split(/[:\-–]/)[0]].map(n => n.trim()).filter(n => n.length >= 3))].sort((a, b) => b.length - a.length);
    for (const n of names) out = out.replace(new RegExp(esc(n), "gi"), "▒▒▒▒");
    return out.length > 330 ? out.slice(0, 327).trimEnd() + "…" : out;
}

/** Turns a Steam appdetails payload into the few facts a round needs, or null when it can't be used. */
export function factsFrom(appid, data) {
    if (!data?.name) return null;
    const year = String(data.release_date?.date ?? "").match(/(19|20)\d{2}/)?.[0];
    const genres = (data.genres ?? []).map(g => g.description).filter(Boolean).slice(0, 3);
    const blurb = strip(data.short_description);
    if (!year || !genres.length || blurb.length < 30) return null;
    return {
        appid: Number(appid), name: data.name, year, genres,
        developer: (data.developers ?? [])[0] ?? null,
        blurb, shot: data.screenshots?.[0]?.path_full ?? null, header: data.header_image ?? null
    };
}

export function createTrivia({ db, fetchImpl = fetch, sendMessage, editMessage, rand = Math.random, schedule = setTimeout, clear = clearTimeout, stageMs = 15000, breakMs = 6000, pool = POOL, log = () => {} }) {
    const games = new Map(); // guild id -> the round in progress. Lives in memory only, so a restart ends it.

    async function loadFacts(appid) {
        const cached = db.getTriviaFacts(appid);
        if (cached) return cached;
        try {
            const res = await fetchImpl(`https://store.steampowered.com/api/appdetails?appids=${appid}&l=english`, { headers: { "Accept-Language": "en" }, signal: AbortSignal.timeout(8000) });
            if (!res.ok) return null;
            const j = await res.json();
            const facts = j?.[appid]?.success ? factsFrom(appid, j[appid].data) : null;
            if (facts) db.saveTriviaFacts(appid, facts);
            return facts;
        } catch { return null; }
    }

    const shuffle = arr => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

    /** Picks the questions: the right game plus three others, leaning toward ones with a shared genre so it isn't a giveaway. */
    async function buildRounds(count) {
        const picked = shuffle(pool).slice(0, count + 14);
        const facts = (await Promise.all(picked.map(loadFacts))).filter(Boolean);
        if (facts.length < count + 3) throw new UserError("I couldn't reach Steam for game info just now. Try again in a minute.");
        const answers = facts.slice(0, count), rest = facts.slice(count);
        return answers.map(a => {
            const near = shuffle(rest.filter(f => f.genres[0] === a.genres[0]));
            const far = shuffle(rest.filter(f => f.genres[0] !== a.genres[0]));
            const wrong = [...near, ...far].slice(0, 3);
            const options = shuffle([a, ...wrong]);
            return { facts: a, options: options.map(o => ({ appid: o.appid, name: o.name })), correct: options.indexOf(a) };
        });
    }

    const buttons = (round, n, disabled = false) => ({
        components: [0, 2].map(s => ({ type: 1, components: [s, s + 1].map(i => ({ type: 2, style: 2, label: round.options[i].name.slice(0, 80), custom_id: `trivia:${n}:${i}`, disabled })) }))
    });

    function clueEmbed(g, round, stage) {
        const f = round.facts, last = stage >= ROUND_STAGES - 1;
        const clues = [`🎭 **Genre:** ${f.genres.join(", ")}`, `📅 **Released:** ${f.year}`];
        if (stage >= 1) clues.push(`🛠️ **Developer:** ${f.developer ?? "Unknown"}`);
        if (stage >= 2) clues.push(`\n> ${maskTitle(f.blurb, f.name)}`);
        return {
            color: 0x9b59b6,
            title: `🎮 Round ${g.index + 1} of ${g.rounds.length}: which game is this?`,
            description: clues.join("\n"),
            ...(stage >= 2 && f.shot ? { image: { url: f.shot } } : {}),
            footer: { text: `Worth ${POINTS[stage]} point${POINTS[stage] === 1 ? "" : "s"} now${last ? "" : ", fewer as more clues appear"}  •  one guess each` }
        };
    }

    const medal = i => ["🥇", "🥈", "🥉"][i] ?? `**${i + 1}.**`;
    function scoreboard(g, { title, stopped = false }) {
        const rows = [...g.scores.entries()].sort((a, b) => b[1].points - a[1].points || b[1].correct - a[1].correct).slice(0, 10);
        return {
            color: 0x9b59b6,
            title,
            description: rows.length ? rows.map(([id, s], i) => `${medal(i)} <@${id}>: **${s.points}** pts (${s.correct} right)`).join("\n") : "Nobody scored this time.",
            footer: { text: stopped ? "Stopped early. Scores so far are saved." : "Scores are added to the server's trivia board  •  /server trivia top" }
        };
    }

    function save(g) {
        const top = [...g.scores.entries()].sort((a, b) => b[1].points - a[1].points)[0];
        for (const [id, s] of g.scores) db.addTriviaScore(g.guildId, id, { points: s.points, correct: s.correct, won: !g.stopped && top && top[0] === id && s.points > 0 });
    }

    const pause = (g, ms) => new Promise(resolve => { g.wake = resolve; g.timer = schedule(resolve, ms); });

    async function play(g) {
        try {
            for (g.index = 0; g.index < g.rounds.length && !g.stopped; g.index++) {
                const round = g.rounds[g.index];
                g.answers = new Map(); g.stage = 0;
                const n = g.index + 1;
                const msg = await sendMessage(g.channelId, { embeds: [clueEmbed(g, round, 0)], ...buttons(round, n), allowed_mentions: { parse: [] } });
                g.messageId = msg?.id;
                for (let stage = 0; stage < ROUND_STAGES && !g.stopped; stage++) {
                    g.stage = stage;
                    if (stage > 0) await editMessage(g.channelId, g.messageId, { embeds: [clueEmbed(g, round, stage)], ...buttons(round, n), allowed_mentions: { parse: [] } }).catch(() => {});
                    await pause(g, stageMs);
                }
                if (g.stopped) break;
                const right = [];
                for (const [uid, a] of g.answers) {
                    const s = g.scores.get(uid) ?? { points: 0, correct: 0 };
                    if (a.idx === round.correct) { s.points += POINTS[a.stage]; s.correct += 1; right.push(`<@${uid}> +${POINTS[a.stage]}`); }
                    g.scores.set(uid, s);
                }
                const f = round.facts;
                await editMessage(g.channelId, g.messageId, {
                    embeds: [{
                        color: 0x2ecc71, title: `✅ It was ${f.name}`,
                        description: `${f.genres.join(", ")} • ${f.year}${f.developer ? " • " + f.developer : ""}\n\n${right.length ? right.join("\n") : "Nobody got it."}`,
                        ...(f.header ? { image: { url: f.header } } : {}),
                        footer: { text: `${g.answers.size} ${g.answers.size === 1 ? "guess" : "guesses"}` }
                    }],
                    components: [], allowed_mentions: { parse: [] }
                }).catch(() => {});
                if (g.index < g.rounds.length - 1) await pause(g, breakMs);
            }
            if (!g.stopped) await sendMessage(g.channelId, { embeds: [scoreboard(g, { title: "🏆 Trivia results" })], allowed_mentions: { parse: [] } }).catch(() => {});
        } catch (e) {
            log(`round failed in ${g.guildId}: ${e.message}`);
            await sendMessage(g.channelId, { content: "Trivia hit a snag and had to stop. Scores so far are saved." }).catch(() => {});
        } finally {
            save(g);
            if (games.get(g.guildId) === g) games.delete(g.guildId);
        }
    }

    return {
        /** Starts a game in a channel. Resolves once the first question is up; the rest plays itself out. */
        async start({ guildId, channelId, rounds = 5, by = null }) {
            if (games.has(String(guildId))) throw new UserError("A trivia game is already going in this server.");
            const count = Math.max(3, Math.min(10, Math.floor(Number(rounds) || 5)));
            const g = { guildId: String(guildId), channelId: String(channelId), by, rounds: [], scores: new Map(), stopped: false, index: 0, answers: new Map(), stage: 0 };
            games.set(g.guildId, g); // claimed before the Steam lookups so two starts can't race
            try {
                g.rounds = await buildRounds(count);
            } catch (e) { games.delete(g.guildId); throw e; }
            // Let the first post fail loudly (missing permissions) instead of silently dying in the background.
            try { await sendMessage(g.channelId, { content: `🎮 **Trivia time!** ${count} rounds, first question coming up. Tap the right game before the clues run out.`, allowed_mentions: { parse: [] } }); }
            catch { games.delete(g.guildId); throw new UserError("I can't post in that channel. I need View Channel and Send Messages there."); }
            void play(g);
            return { rounds: count };
        },
        stop(guildId, { announce = true } = {}) {
            const g = games.get(String(guildId));
            if (!g) throw new UserError("There's no trivia game going right now.");
            g.stopped = true; clear(g.timer); g.wake?.();
            if (announce) void sendMessage(g.channelId, { embeds: [scoreboard(g, { title: "🛑 Trivia stopped", stopped: true })], allowed_mentions: { parse: [] } }).catch(() => {});
            return { channelId: g.channelId };
        },
        /** A player tapped an answer. Returns the private reply. */
        answer({ guildId, round, idx, userId }) {
            const g = games.get(String(guildId));
            if (!g || g.index + 1 !== Number(round) || g.stopped) return "That round is over.";
            if (g.answers.has(String(userId))) return "You already locked in an answer for this round.";
            g.answers.set(String(userId), { idx: Number(idx), stage: g.stage });
            return `Locked in: **${g.rounds[g.index].options[Number(idx)]?.name ?? "?"}**. The answer shows when the round ends.`;
        },
        active: guildId => { const g = games.get(String(guildId)); return g ? { channelId: g.channelId, round: g.index + 1, rounds: g.rounds.length, by: g.by } : null; },
        top: (guildId, limit = 10) => db.triviaTop(guildId, limit),
        topEmbed(guildId, guildName = null) {
            const rows = db.triviaTop(guildId, 10);
            return {
                color: 0x9b59b6, title: `🏆 Trivia leaderboard${guildName ? " • " + guildName : ""}`,
                description: rows.length ? rows.map((r, i) => `${medal(i)} <@${r.user_id}>: **${r.points}** pts, ${r.correct} right, ${r.wins} win${r.wins === 1 ? "" : "s"}`).join("\n") : "No games played yet. A manager can start one with `/server trivia start`.",
                footer: { text: "All-time for this server" }
            };
        }
    };
}

export function createTriviaHandlers({ trivia }) {
    const eph = (i, content) => i.reply({ content, flags: MessageFlags.Ephemeral });
    const manage = i => { if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) throw new UserError("You need the Manage Server permission for that."); };
    async function handle(i) {
        try {
            if (!i.guildId) throw new UserError("Use this in a server.");
            const sub = i.options.getSubcommand();
            if (sub === "top") return void await i.reply({ embeds: [trivia.topEmbed(i.guildId, i.guild?.name)], allowedMentions: { parse: [] } });
            manage(i);
            if (sub === "start") {
                await i.deferReply({ flags: MessageFlags.Ephemeral });
                const ch = i.options.getChannel("channel")?.id ?? i.channelId;
                const r = await trivia.start({ guildId: i.guildId, channelId: ch, rounds: i.options.getInteger("rounds") ?? 5, by: i.user.id });
                return void await i.editReply(`Started: ${r.rounds} rounds in <#${ch}>.`);
            }
            if (sub === "stop") { trivia.stop(i.guildId); return void await eph(i, "Stopped. Scores so far are saved."); }
        } catch (err) {
            const content = err instanceof UserError ? err.message : "Something went wrong. Try again in a moment.";
            if (!(err instanceof UserError)) console.error(`[trivia] ${err.message}`);
            if (i.deferred || i.replied) await i.editReply({ content }).catch(() => {}); else await eph(i, content).catch(() => {});
        }
    }
    async function handleButton(i) {
        const [, round, idx] = i.customId.split(":");
        if (!i.guildId) return;
        await eph(i, trivia.answer({ guildId: i.guildId, round, idx, userId: i.user.id })).catch(() => {});
    }
    return { handle, handleButton };
}
