// Veto draft: game night without the arguing. The group takes turns striking games off the list of what everyone owns,
// like a map veto in a shooter, until one is left. State lives in the small key/value store under the message id.
export const GN_VETO = "gn_veto", GN_VETO_PICK = "gn_vetopick", GN_VETO_SKIP = "gn_vetoskip";
export const VETO_MAX_GAMES = 8, VETO_MIN_GAMES = 3, SKIP_AFTER_MS = 5 * 60_000, VETO_LIFE_MS = 6 * 3600_000;

const shuffle = (list, rand) => { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/** r is a game night result. Co-op games go first when there are more than fit; null means there is not enough to veto. */
export function startVeto(r, { rand = Math.random, now = Date.now() } = {}) {
    const pool = r.allOwn.length >= VETO_MIN_GAMES ? r.allOwn : [...r.allOwn, ...r.almost];
    if (pool.length < VETO_MIN_GAMES || r.people.length < 2) return null;
    const together = shuffle(pool.filter(g => g.coop), rand), rest = shuffle(pool.filter(g => !g.coop), rand);
    const games = [...together, ...rest].slice(0, VETO_MAX_GAMES).map(g => ({ id: g.id, title: g.title, coop: Boolean(g.coop) }));
    return { players: shuffle(r.people, rand), games, gone: [], turn: 0, turnAt: now, winner: null, log: [], until: now + VETO_LIFE_MS };
}

export const remaining = s => s.games.filter(g => !s.gone.includes(g.id));
export const currentPlayer = s => s.players[s.turn % s.players.length];

function advance(s, now) {
    const left = remaining(s);
    if (left.length === 1) s.winner = left[0].id;
    else { s.turn = (s.turn + 1) % s.players.length; s.turnAt = now; }
}

/** Returns { ok, error }. Only the player whose turn it is can veto, and only a game still on the board. */
export function veto(s, userId, gameId, now = Date.now()) {
    if (s.winner) return { ok: false, error: "The draft is over." };
    if (now > s.until) return { ok: false, error: "This draft timed out." };
    if (!s.players.includes(userId)) return { ok: false, error: "This draft is for the people who were in the channel when it started." };
    if (currentPlayer(s) !== userId) return { ok: false, error: `Hold on, it's <@${currentPlayer(s)}>'s turn.` };
    const g = remaining(s).find(x => x.id === gameId);
    if (!g) return { ok: false, error: "That game is already off the board." };
    s.gone.push(g.id); s.log.push({ by: userId, title: g.title });
    advance(s, now);
    return { ok: true };
}

/** Anyone in the draft can skip a player who has sat on their turn for five minutes. The skipped player's turn is lost, nothing is vetoed. */
export function skip(s, userId, now = Date.now()) {
    if (s.winner) return { ok: false, error: "The draft is over." };
    if (!s.players.includes(userId)) return { ok: false, error: "This draft is for the people who were in the channel when it started." };
    const wait = SKIP_AFTER_MS - (now - s.turnAt);
    if (wait > 0) return { ok: false, error: `Give <@${currentPlayer(s)}> a moment. You can skip them in ${Math.ceil(wait / 60_000)} min.` };
    s.log.push({ by: currentPlayer(s), title: null });
    s.turn = (s.turn + 1) % s.players.length; s.turnAt = now;
    return { ok: true };
}

export function vetoEmbed(s) {
    const left = remaining(s), won = s.winner ? s.games.find(g => g.id === s.winner) : null;
    const board = s.games.map(g => s.gone.includes(g.id) ? `~~${g.title}~~` : `**${g.title}**${g.coop ? " 🤝" : ""}${won?.id === g.id ? " 🏆" : ""}`).join("\n");
    const last = s.log.at(-1);
    return {
        color: won ? 0x57f287 : 0xff9800,
        title: won ? `🎮 Tonight: ${won.title}` : "🗳️ Veto draft",
        description: won ? `Everyone else's picks got struck. **${won.title}** is what you're playing.\n\n${board}`
            : `<@${currentPlayer(s)}>, it's your turn. Strike one game you don't want to play.\n\n${board}`,
        fields: [
            ...(last ? [{ name: "Last move", value: last.title ? `<@${last.by}> struck **${last.title}**` : `<@${last.by}> was skipped`, inline: false }] : []),
            ...(won ? [] : [{ name: `Order (${left.length} games left)`, value: s.players.map((p, i) => `${i === s.turn % s.players.length ? "👉 " : ""}<@${p}>`).join("  "), inline: false }])
        ],
        footer: { text: won ? "Steam Value Checker · veto draft" : "Only the player on turn can strike a game. If they go quiet, anyone can skip them after 5 minutes." }
    };
}

export function vetoComponents(s) {
    if (s.winner) return [];
    return [
        { type: 1, components: [{ type: 3, custom_id: GN_VETO_PICK, placeholder: "Strike a game…", options: remaining(s).map(g => ({ label: g.title.slice(0, 100), value: String(g.id).slice(0, 100) })) }] },
        { type: 1, components: [{ type: 2, style: 2, label: "Skip a quiet player", emoji: { name: "⏭️" }, custom_id: GN_VETO_SKIP }] }
    ];
}
