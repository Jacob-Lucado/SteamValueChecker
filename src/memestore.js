// Which memes each server has already been given, so the same post never repeats.
export const memeSchema = `
CREATE TABLE IF NOT EXISTS meme_posted (
    guild_id TEXT NOT NULL,
    link     TEXT NOT NULL,
    at       INTEGER NOT NULL,
    PRIMARY KEY (guild_id, link)
);
`;
const KEEP = 300;
export function memeStore({ run, all }) {
    const memeSeen = guildId => new Set(all("SELECT link FROM meme_posted WHERE guild_id = ?", guildId).map(r => r.link));
    const memeMark = (guildId, link, at) => {
        run("INSERT OR REPLACE INTO meme_posted (guild_id, link, at) VALUES (?, ?, ?)", guildId, link, at);
        run("DELETE FROM meme_posted WHERE guild_id = ? AND link NOT IN (SELECT link FROM meme_posted WHERE guild_id = ? ORDER BY at DESC LIMIT ?)", guildId, guildId, KEEP);
    };
    return { memeSeen, memeMark };
}
