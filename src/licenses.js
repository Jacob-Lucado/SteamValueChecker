// Builds the third-party notice list from what's actually installed, so it can't drift from the real dependencies.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const read = p => { try { return readFileSync(p, "utf8"); } catch { return null; } };
const LICENSE_FILE = /^(licen[sc]e|copying|notice)(\.(md|txt))?$/i;

/** Walks the production dependency tree and returns one row per package, with its license text when it ships one. */
export function collectLicenses(root = process.cwd()) {
    const top = JSON.parse(read(join(root, "package.json")) ?? "{}");
    const seen = new Map();
    const visit = (name, from) => {
        for (let dir = from; ; dir = join(dir, "..")) {
            const pj = read(join(dir, "node_modules", name, "package.json"));
            if (pj) {
                const p = JSON.parse(pj), at = join(dir, "node_modules", name);
                if (seen.has(p.name + "@" + p.version)) return;
                let text = null;
                try { const f = readdirSync(at).find(x => LICENSE_FILE.test(x)); if (f) text = (read(join(at, f)) ?? "").trim().slice(0, 12000) || null; } catch { /* no license file */ }
                const lic = typeof p.license === "string" ? p.license : p.license?.type ?? (p.licenses?.map(l => l.type).join(" OR ") || "Unknown");
                const url = (typeof p.repository === "string" ? p.repository : p.repository?.url ?? "").replace(/^git\+/, "").replace(/\.git$/, "").replace(/^git:\/\//, "https://").replace(/^github:/, "https://github.com/");
                seen.set(p.name + "@" + p.version, { name: p.name, version: p.version, license: lic, url: /^https:\/\//.test(url) ? url : /^[\w.-]+\/[\w.-]+$/.test(url) ? "https://github.com/" + url : null, text, direct: Boolean(top.dependencies?.[p.name] || top.optionalDependencies?.[p.name]) });
                for (const dep of Object.keys({ ...p.dependencies, ...p.optionalDependencies })) visit(dep, at);
                return;
            }
            if (dir === "/" || dir === join(dir, "..")) return;
        }
    };
    for (const dep of Object.keys({ ...top.dependencies, ...top.optionalDependencies })) visit(dep, root);
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Things we run or show that aren't npm packages. */
export const TOOLS = [
    { name: "FFmpeg", license: "LGPL / GPL", url: "https://ffmpeg.org/", note: "Runs as a separate program to decode audio for music." },
    { name: "yt-dlp", license: "Unlicense", url: "https://github.com/yt-dlp/yt-dlp", note: "Runs as a separate program to find playable streams." },
    { name: "Chromium", license: "BSD-3-Clause and others", url: "https://www.chromium.org/", note: "Opens pages that have no API, for a few seconds at a time." }
];

export const CREDITS = [
    { name: "Steam", by: "Valve", url: "https://store.steampowered.com/", note: "Game, price and profile data come from the Steam Web API and store." },
    { name: "IsThereAnyDeal", by: "IsThereAnyDeal", url: "https://isthereanydeal.com/", note: "Cheapest-price and deal data." },
    { name: "Fortnite-API", by: "Fortnite-API.com", url: "https://fortnite-api.com/", note: "Item shop, news, map and cosmetics on the Fortnite page." },
    { name: "Discord", by: "Discord Inc.", url: "https://discord.com/", note: "Sign-in, servers and the bot itself." },
    { name: "emoji.gg", by: "emoji.gg", url: "https://emoji.gg/", note: "Emoji packs. Each pack has its own license on emoji.gg." },
    { name: "YouTube, SoundCloud, Spotify", by: "their owners", url: "https://www.youtube.com/", note: "Players are embedded straight from each service." },
    { name: "GamerPower", by: "GamerPower", url: "https://www.gamerpower.com/", note: "Free game and giveaway listings." },
    { name: "SomaFM, Radio Paradise, NTS", by: "the stations", url: "https://somafm.com/", note: "Radio streams in the music player." }
];

export const TRADEMARKS = "Steam is a trademark of Valve Corporation. Fortnite and Epic Games are trademarks of Epic Games, Inc. Discord is a trademark of Discord Inc. All other names, logos and game artwork belong to their owners and are shown to identify their games and stores. Steam Value Checker is an independent project and isn't affiliated with or endorsed by any of them.";

const LONG = { "Apache-2.0": "https://www.apache.org/licenses/LICENSE-2.0", "MPL-2.0": "https://www.mozilla.org/MPL/2.0/", "LGPL / GPL": "https://www.gnu.org/licenses/" };
const SHORT_ORDER = ["MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "0BSD"];

/** One paragraph per blank-line block, with the hard line wraps joined. */
const paragraphs = t => t.replace(/\r/g, "").split(/\n\s*\n/).map(x => x.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);
const copyrightLines = t => [...new Set((t ?? "").split("\n").map(l => l.trim()).filter(l => l.length < 140 && /^copyright\s*(\(c\)|©)?\s*\d{4}/i.test(l)))];

/** The LICENSES.md that the Licenses page and PDF are made from. Run scripts/licenses-md.mjs after dependencies change. */
export function licensesMarkdown(root = process.cwd()) {
    const pk = collectLicenses(root), out = [];
    out.push("# Licenses", "", "Steam Value Checker is built on other people's work. This page credits the services and data it uses, the programs it runs, and the libraries it's made of, with their license notices.", "");
    out.push("## Trademarks", "", TRADEMARKS, "");
    out.push("## Services and data", "");
    for (const c of CREDITS) out.push(`- **${c.name}** (${c.by}): ${c.note} [${c.url.replace(/^https:\/\//, "")}](${c.url})`);
    out.push("", "## Programs it runs", "");
    for (const t of TOOLS) out.push(`- **${t.name}** (${t.license}): ${t.note} [${t.url.replace(/^https:\/\//, "")}](${t.url})`);
    out.push("", "## Libraries", "", `${pk.length} packages, each under its own license. The full text of each license is below the list.`, "");
    const kinds = new Map();
    for (const p of pk) {
        const notice = copyrightLines(p.text);
        out.push(`- **${p.name}** ${p.version}, ${p.license}${notice.length ? ". " + notice.slice(0, 3).join("; ") : ""}${p.url ? ` [${p.url.replace(/^https:\/\//, "")}](${p.url})` : ""}`);
        if (!kinds.has(p.license)) kinds.set(p.license, p.text);
    }
    out.push("", "## License texts", "");
    const order = [...kinds.keys()].sort((a, b) => (SHORT_ORDER.indexOf(a) + 99) % 99 - (SHORT_ORDER.indexOf(b) + 99) % 99 || a.localeCompare(b));
    for (const k of order) {
        out.push(`### ${k}`, "");
        const t = kinds.get(k);
        if (LONG[k]) out.push(`The full ${k} text is long, so it's linked here instead: [${LONG[k].replace(/^https:\/\//, "")}](${LONG[k]})`, "");
        else if (t) { for (const para of paragraphs(t.split("\n").filter(l => !/^\s*copyright\s*(\(c\)|©)?\s*\d{4}/i.test(l)).join("\n"))) out.push(para, ""); }
        else out.push(`Released under the ${k} license.`, "");
    }
    return out.join("\n");
}
