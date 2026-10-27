// Downloads and parses a FanaticalGrabber export attached in Discord.
import { parseUpload } from "./parse.js";
import { UserError } from "./errors.js";

export const MAX_FILE_BYTES = 200_000;
export const FILE_TYPES = [".csv", ".json", ".txt", ".md"];
const ALLOWED_HOSTS = [/(^|\.)discordapp\.com$/i, /(^|\.)discordapp\.net$/i, /(^|\.)discord\.com$/i];

export async function readUpload(file) {
    const name = file.name.toLowerCase();
    if (!FILE_TYPES.some(ext => name.endsWith(ext))) {
        throw new UserError(`Unsupported file type. Upload a ${FILE_TYPES.join(", ")} export.`);
    }
    if (file.size > MAX_FILE_BYTES) throw new UserError("That file is too large (200 KB max).");
    const host = new URL(file.url).hostname;
    if (!ALLOWED_HOSTS.some(re => re.test(host))) throw new UserError("That attachment could not be read.");

    const res = await fetch(file.url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new UserError("Discord would not let the bot download that file.");
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_FILE_BYTES) throw new UserError("That file is too large (200 KB max).");
    return parseUpload(new TextDecoder("utf-8").decode(buf), name);
}

/** Raw text of an attached .txt/.csv/.json/.md file (for /redeem, which looks for keys rather than game titles). */
export async function readUploadText(file) {
    const name = file.name.toLowerCase();
    if (!FILE_TYPES.some(ext => name.endsWith(ext))) throw new UserError(`Unsupported file type. Upload a ${FILE_TYPES.join(", ")} file.`);
    if (file.size > MAX_FILE_BYTES) throw new UserError("That file is too large (200 KB max).");
    const host = new URL(file.url).hostname;
    if (!ALLOWED_HOSTS.some(re => re.test(host))) throw new UserError("That attachment could not be read.");
    const res = await fetch(file.url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new UserError("Discord would not let the bot download that file.");
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_FILE_BYTES) throw new UserError("That file is too large (200 KB max).");
    return new TextDecoder("utf-8").decode(buf);
}
