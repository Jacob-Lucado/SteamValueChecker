// Finds the video in a news post. Steam writes YouTube clips as [previewyoutube=ID] tags, and the RSS version of the same
// post carries an iframe or a plain link. Discord bots can't put a player inside an embed, but a bare video link in the
// message text is turned into a player by Discord itself, so that is what we hand back.
const YT_ID = "([A-Za-z0-9_-]{11})";
const PATTERNS = [
    new RegExp(`\\[previewyoutube=${YT_ID}`, "i"),
    new RegExp(`youtube(?:-nocookie)?\\.com/embed/${YT_ID}`, "i"),
    new RegExp(`youtube\\.com/watch\\?(?:[^\\s"'<>]*&(?:amp;)?)?v=${YT_ID}`, "i"),
    new RegExp(`youtu\\.be/${YT_ID}`, "i"),
    new RegExp(`youtube\\.com/(?:shorts|live)/${YT_ID}`, "i")
];
const FILE = /https:\/\/[^\s"'<>\]]+\.(?:mp4|webm|mov)(?:\?[^\s"'<>\]]*)?/i;

/** `{ url, thumb }` for the first video in a post, or null. The url is always https. */
export function findVideo(raw) {
    const text = String(raw ?? "").replace(/&amp;/g, "&");
    for (const re of PATTERNS) {
        const id = re.exec(text)?.[1];
        if (id) return { url: `https://www.youtube.com/watch?v=${id}`, thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` };
    }
    const f = FILE.exec(text)?.[0];
    return f ? { url: f, thumb: null } : null;
}
