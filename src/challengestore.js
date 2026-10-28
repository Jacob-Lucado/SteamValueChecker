// Backlog challenge goals, one per member per month. Progress is read from the library, not stored.
export const challengeSchema = `
CREATE TABLE IF NOT EXISTS challenges (
    discord_id TEXT NOT NULL REFERENCES users(discord_id) ON DELETE CASCADE,
    month      TEXT NOT NULL,
    goal       INTEGER NOT NULL,
    PRIMARY KEY (discord_id, month)
);`;

export function challengeStore({ run, all }) {
    const setChallenge = (id, month, goal) => goal > 0
        ? run("INSERT INTO challenges (discord_id, month, goal) VALUES (?,?,?) ON CONFLICT(discord_id, month) DO UPDATE SET goal = excluded.goal", id, month, goal)
        : run("DELETE FROM challenges WHERE discord_id = ? AND month = ?", id, month);
    const challengeRows = id => all("SELECT month, goal FROM challenges WHERE discord_id = ? ORDER BY month DESC LIMIT 36", id);
    /** Titles of games marked finished between two times (ms). */
    const finishedBetween = (id, from, to) => all("SELECT title FROM library WHERE discord_id = ? AND status = 'finished' AND status_at >= ? AND status_at < ? ORDER BY status_at", id, from, to).map(r => r.title);
    return { setChallenge, challengeRows, finishedBetween };
}
