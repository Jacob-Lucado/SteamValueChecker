// Two small tables for the AI companion: what a member asked it to remember about them (a few short notes, only what they said),
// and the guides a server's managers wrote themselves for questions about their own server.
export const aiSchema = `
CREATE TABLE IF NOT EXISTS ai_notes (
    discord_id TEXT NOT NULL,
    n          INTEGER NOT NULL,
    note       TEXT NOT NULL,
    at         INTEGER NOT NULL,
    PRIMARY KEY (discord_id, n)
);
CREATE TABLE IF NOT EXISTS server_guides (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT NOT NULL,
    title      TEXT NOT NULL,
    keywords   TEXT NOT NULL,
    body       TEXT NOT NULL,
    created_by TEXT,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS server_guides_guild ON server_guides(guild_id);`;

export const MAX_NOTES = 8, NOTE_LEN = 140, MAX_GUIDES = 25;

export function aiStore({ run, get, all, now }) {
    const getAiNotes = id => all("SELECT n, note FROM ai_notes WHERE discord_id = ? ORDER BY n", id).map(r => ({ n: r.n, note: r.note }));
    /** Adds a note; the oldest goes when the list is full. Returns the note kept, or null for an empty one. */
    function addAiNote(id, text) {
        const note = String(text ?? "").replace(/\s+/g, " ").trim().slice(0, NOTE_LEN);
        if (!note) return null;
        const have = getAiNotes(id);
        if (have.some(x => x.note.toLowerCase() === note.toLowerCase())) return note;
        if (have.length >= MAX_NOTES) run("DELETE FROM ai_notes WHERE discord_id = ? AND n = ?", id, have[0].n);
        const next = (get("SELECT MAX(n) AS m FROM ai_notes WHERE discord_id = ?", id)?.m ?? 0) + 1;
        run("INSERT INTO ai_notes (discord_id, n, note, at) VALUES (?,?,?,?)", id, next, note, now());
        return note;
    }
    /** Forgets notes containing `text`, or all of them when no text is given. Returns how many went. */
    function forgetAiNotes(id, text = null) {
        const q = String(text ?? "").trim().toLowerCase();
        if (!q) return run("DELETE FROM ai_notes WHERE discord_id = ?", id).changes;
        let n = 0;
        for (const x of getAiNotes(id)) if (x.note.toLowerCase().includes(q)) n += run("DELETE FROM ai_notes WHERE discord_id = ? AND n = ?", id, x.n).changes;
        return n;
    }

    const cleanKeywords = k => [...new Set((Array.isArray(k) ? k : String(k ?? "").split(/[,\n]/)).map(x => String(x).trim().toLowerCase().replace(/\s+/g, " ")).filter(x => x.length >= 3 && x.length <= 40))].slice(0, 12);
    const listServerGuides = gid => all("SELECT id, title, keywords, body FROM server_guides WHERE guild_id = ? ORDER BY id", gid).map(r => ({ ...r, keywords: r.keywords.split("|").filter(Boolean) }));
    /** { id } or { error }. */
    function addServerGuide(gid, { title, keywords, body }, by = null) {
        title = String(title ?? "").trim().slice(0, 80); body = String(body ?? "").trim().slice(0, 1500);
        const kw = cleanKeywords(keywords);
        if (!title) return { error: "Give the guide a title." };
        if (!kw.length) return { error: "Add at least one phrase people might type, like \"how do I get a role\"." };
        if (body.length < 10) return { error: "Write what the answer should say." };
        if ((get("SELECT COUNT(*) AS n FROM server_guides WHERE guild_id = ?", gid)?.n ?? 0) >= MAX_GUIDES) return { error: `A server can have ${MAX_GUIDES} guides. Remove one first.` };
        const r = run("INSERT INTO server_guides (guild_id, title, keywords, body, created_by, created_at) VALUES (?,?,?,?,?,?)", gid, title, kw.join("|"), body, by, now());
        return { id: Number(r.lastInsertRowid) };
    }
    const deleteServerGuide = (gid, id) => run("DELETE FROM server_guides WHERE guild_id = ? AND id = ?", gid, Number(id)).changes > 0;
    const forgetServerGuides = gid => run("DELETE FROM server_guides WHERE guild_id = ?", gid).changes;
    return { getAiNotes, addAiNote, forgetAiNotes, listServerGuides, addServerGuide, deleteServerGuide, forgetServerGuides };
}
