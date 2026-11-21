// Higher or lower: the bot shows one game's number (launch price, Steam review count or Metacritic score) and you guess whether
// the next game's number is higher or lower. Each right guess makes the second game the new first one, so a streak builds until
// you miss. Everything comes from Steam's public store data (cached with the trivia facts), nothing about anyone's library.
//
// The Discord game keeps no state: the buttons carry the two games and the streak. The dashboard signs the same details into a
// token so a page can't claim a different answer.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { MessageFlags } from "discord.js";
import { POOL, factsFrom } from "./trivia.js";
import { UserError } from "./errors.js";

export const hiloSchema = `
CREATE TABLE IF NOT EXISTS hilo_scores (
    guild_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    best     INTEGER NOT NULL DEFAULT 0,
    games    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
);
`;

export function hiloStore({ run, all, get }) {
    return {
        /** Keeps the member's best streak. `ended` counts a finished game. */
        noteHilo: (guild, user, streak, ended = false) => run(
            "INSERT INTO hilo_scores (guild_id, user_id, best, games) VALUES (?,?,?,?) ON CONFLICT(guild_id, user_id) DO UPDATE SET best = MAX(best, excluded.best), games = games + excluded.games",
            String(guild), String(user), Math.max(0, streak), ended ? 1 : 0),
        hiloTop: (guild, limit = 10) => all("SELECT user_id, best, games FROM hilo_scores WHERE guild_id = ? AND best > 0 ORDER BY best DESC, games ASC, user_id LIMIT ?", String(guild), limit),
        hiloBest: (guild, user) => get("SELECT best, games FROM hilo_scores WHERE guild_id = ? AND user_id = ?", String(guild), String(user)) ?? null
    };
}

const usd = cents => (cents === 0 ? "Free" : `$${(cents / 100).toFixed(2)}`);
const num = n => Number(n).toLocaleString("en-US");

/** What can be compared. `min` is how far apart two values must be so a round is never a coin flip. */
export const STATS = {
    price: { label: "launch price on Steam", short: "price", get: f => (Number.isFinite(f.price) ? f.price : null), fmt: usd, tooClose: (a, b) => a === b || Math.abs(a - b) < 100 },
    reviews: { label: "number of Steam reviews", short: "reviews", get: f => (Number.isFinite(f.recs) && f.recs > 0 ? f.recs : null), fmt: n => `${num(n)} reviews`, tooClose: (a, b) => Math.abs(a - b) / Math.max(a, b) < 0.08 },
    meta: { label: "Metacritic score", short: "Metacritic", get: f => (Number.isFinite(f.meta) && f.meta > 0 ? f.meta : null), fmt: n => `${n} on Metacritic`, tooClose: (a, b) => Math.abs(a - b) < 2 }
};
export const STAT_KEYS = Object.keys(STATS);
export const MAX_STREAK = 99;

/** A random game and stat pair from the facts, or null when nothing in them can be compared. `prev` keeps the last game as the new first one. */
export function pickRound(facts, { rand = Math.random, prev = null } = {}) {
    const list = facts.filter(Boolean);
    const pick = arr => arr[Math.floor(rand() * arr.length)];
    for (let tries = 0; tries < 40; tries++) {
        const stat = pick(STAT_KEYS), S = STATS[stat];
        const first = prev && S.get(prev) !== null && tries < 20 ? prev : pick(list.filter(f => S.get(f) !== null));
        if (!first) continue;
        const a = S.get(first);
        const others = list.filter(f => f.appid !== first.appid && S.get(f) !== null && !S.tooClose(a, S.get(f)));
        if (!others.length) continue;
        return { stat, a: first, b: pick(others) };
    }
    return null;
}

/** Was the guess ("h" or "l") right? Returns { correct, a, b } with the two values. */
export function judge({ stat, a, b }, dir) {
    const S = STATS[stat], x = S.get(a), y = S.get(b);
    if (x === null || y === null) return null;
    return { correct: dir === "h" ? y > x : y < x, a: x, b: y };
}

export const questionLines = (round) => {
    const S = STATS[round.stat], x = S.get(round.a);
    return `**${round.a.name}** has a ${S.label} of **${S.fmt(x)}**.\n\nDoes **${round.b.name}** have a **higher** or **lower** ${S.label}?`;
};

/** Cached facts, fetched from Steam (in US dollars) when they're missing or from before the price and review fields existed. */
export function createFactsLoader({ db, fetchImpl = fetch }) {
    return async function loadFacts(appid) {
        const cached = db.getTriviaFacts(appid);
        if (cached && cached.v === 2) return cached;
        try {
            const res = await fetchImpl(`https://store.steampowered.com/api/appdetails?appids=${appid}&l=english&cc=us`, { headers: { "Accept-Language": "en" }, signal: AbortSignal.timeout(8000) });
            if (!res.ok) return cached ?? null;
            const j = await res.json();
            const facts = j?.[appid]?.success ? factsFrom(appid, j[appid].data) : null;
            if (facts) db.saveTriviaFacts(appid, facts);
            return facts ?? cached ?? null;
        } catch { return cached ?? null; }
    };
}

export function createHilo({ db, fetchImpl = fetch, rand = Math.random, pool = POOL, secret = randomBytes(32), loadFacts = createFactsLoader({ db, fetchImpl }) }) {
    const sign = body => createHmac("sha256", secret).update(body).digest("base64url").slice(0, 22);

    /** A fresh round. With `prev` (a game's facts) the second game of the last round becomes the first. */
    async function newRound(prev = null) {
        const ids = [...pool].sort(() => rand() - 0.5).slice(0, 16);
        const facts = (await Promise.all(ids.map(loadFacts))).filter(Boolean);
        if (prev && !facts.some(f => f.appid === prev.appid)) facts.push(prev);
        const round = pickRound(facts, { rand, prev });
        if (!round) throw new UserError("I couldn't reach Steam for game info just now. Try again in a minute.");
        return round;
    }
    const reload = async (appid) => (await loadFacts(appid));

    // ---- the dashboard's version: signed tokens instead of button ids ----
    const publicRound = r => ({ stat: r.stat, label: STATS[r.stat].label, a: { appid: r.a.appid, name: r.a.name, header: r.a.header, value: STATS[r.stat].fmt(STATS[r.stat].get(r.a)) }, b: { appid: r.b.appid, name: r.b.name, header: r.b.header } });
    const token = (r, streak, userId) => { const body = Buffer.from(JSON.stringify([r.stat, r.a.appid, r.b.appid, streak, String(userId), Date.now()])).toString("base64url"); return `${body}.${sign(body)}`; };
    async function open(token_) {
        const [body, sig] = String(token_ ?? "").split(".");
        if (!body || !sig || sig.length !== 22) return null;
        const want = Buffer.from(sign(body)), got = Buffer.from(sig);
        if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
        let t; try { t = JSON.parse(Buffer.from(body, "base64url").toString()); } catch { return null; }
        if (!Array.isArray(t) || !STATS[t[0]] || Date.now() - Number(t[5]) > 3600_000) return null;
        const [a, b] = await Promise.all([reload(t[1]), reload(t[2])]);
        return a && b ? { round: { stat: t[0], a, b }, streak: Number(t[3]) || 0, userId: String(t[4]) } : null;
    }
    /** The page asks for a round (no token) or answers one. Returns the result and the next round. */
    async function webStep({ guildId, userId, token: tk, dir }) {
        if (!tk) { const r = await newRound(); return { round: publicRound(r), token: token(r, 0, userId), streak: 0 }; }
        if (dir !== "h" && dir !== "l") throw new UserError("Pick higher or lower.");
        const t = await open(tk);
        if (!t || t.userId !== String(userId)) throw new UserError("That round expired. Start a new one.");
        const j = judge(t.round, dir);
        if (!j) throw new UserError("That round expired. Start a new one.");
        const S = STATS[t.round.stat];
        const reveal = { value: S.fmt(j.b), name: t.round.b.name };
        if (!j.correct) { db.noteHilo(guildId, userId, t.streak, true); return { correct: false, reveal, streak: t.streak, best: db.hiloBest(guildId, userId)?.best ?? t.streak }; }
        const streak = Math.min(MAX_STREAK, t.streak + 1);
        db.noteHilo(guildId, userId, streak);
        const next = await newRound(t.round.b);
        return { correct: true, reveal, streak, round: publicRound(next), token: token(next, streak, userId) };
    }

    return { newRound, webStep, loadFacts, reload, publicRound };
}

// ---------- Discord ----------
const medal = i => ["🥇", "🥈", "🥉"][i] ?? `${i + 1}.`;
const idFor = (uid, streak, round, dir) => `hilo:${uid}:${streak}:${round.a.appid}:${round.b.appid}:${round.stat}:${dir}`;

export function hiloMessage(round, { uid, streak, note = null }) {
    return {
        embeds: [{
            color: 0x57f287, title: `🔼🔽 Higher or lower?${streak ? `  •  Streak ${streak}` : ""}`,
            description: `${note ? note + "\n\n" : ""}${questionLines(round)}`,
            ...(round.b.header ? { thumbnail: { url: round.b.header } } : {}),
            footer: { text: "Only the player who started can answer  •  /server trivia hilo" }
        }],
        components: [{ type: 1, components: [
            { type: 2, style: 3, label: "Higher ⬆️", custom_id: idFor(uid, streak, round, "h") },
            { type: 2, style: 4, label: "Lower ⬇️", custom_id: idFor(uid, streak, round, "l") }
        ] }]
    };
}

export function createHiloHandlers({ hilo, db }) {
    const eph = (i, content) => i.reply({ content, flags: MessageFlags.Ephemeral });
    /** `/server trivia hilo`: starts a game for the caller in this channel. */
    async function start(i) {
        if (!i.guildId) throw new UserError("Use this in a server.");
        await i.deferReply();
        const round = await hilo.newRound();
        await i.editReply(hiloMessage(round, { uid: i.user.id, streak: 0 }));
    }
    async function handleButton(i) {
        const [, uid, streak, a, b, stat, dir] = i.customId.split(":");
        if (uid !== i.user.id) return void await eph(i, "That one belongs to someone else. Start your own with `/server trivia hilo`.").catch(() => {});
        if (!STATS[stat] || (dir !== "h" && dir !== "l")) return;
        try {
            await i.deferUpdate();
            const [fa, fb] = await Promise.all([hilo.reload(Number(a)), hilo.reload(Number(b))]);
            const round = { stat, a: fa, b: fb };
            const j = fa && fb ? judge(round, dir) : null;
            if (!j) return void await i.editReply({ embeds: [{ color: 0xed4245, description: "I lost track of that round. Start a new one with `/server trivia hilo`." }], components: [] });
            const S = STATS[stat], n = Number(streak) || 0;
            const reveal = `**${fb.name}** has **${S.fmt(j.b)}**.`;
            if (!j.correct) {
                db.noteHilo(i.guildId, i.user.id, n, true);
                const best = db.hiloBest(i.guildId, i.user.id)?.best ?? n;
                return void await i.editReply({ embeds: [{ color: 0xed4245, title: `❌ Not this time${n ? `  •  Streak ${n}` : ""}`, description: `${reveal}\n\n${n ? `You got **${n}** in a row.` : "No streak this time."} Your best in this server is **${best}**. Play again with \`/server trivia hilo\`.` }], components: [] });
            }
            const next = n + 1;
            db.noteHilo(i.guildId, i.user.id, next);
            if (next >= MAX_STREAK) { db.noteHilo(i.guildId, i.user.id, next, true); return void await i.editReply({ embeds: [{ color: 0xfee75c, title: `🏆 ${MAX_STREAK} in a row`, description: `${reveal}\n\nThat's the top of the board. Nobody gets a longer streak than that.` }], components: [] }); }
            const nextRound = await hilo.newRound(fb);
            await i.editReply(hiloMessage(nextRound, { uid: i.user.id, streak: next, note: `✅ ${reveal}` }));
        } catch (err) {
            if (!(err instanceof UserError)) console.error(`[hilo] ${err.message}`);
            await i.editReply({ embeds: [{ color: 0xed4245, description: err instanceof UserError ? err.message : "Something went wrong. Start a new game with `/server trivia hilo`." }], components: [] }).catch(() => {});
        }
    }
    const topLines = (guildId) => db.hiloTop(guildId, 5).map((r, i) => `${medal(i)} <@${r.user_id}>: **${r.best}** in a row`);
    return { start, handleButton, topLines };
}
