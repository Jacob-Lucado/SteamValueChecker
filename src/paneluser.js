// What the people the owner lets into the admin panel may change. Everyone with a panel login can look at every page; changing
// things is switched on per area. Account security, the admin user list and backups stay with the owner and are not listed here.
export const PANEL_AREAS = [
    { id: "announce", label: "Announcements and weekly post", re: /^\/api\/admin\/(broadcast|weekly)/ },
    { id: "giveaway", label: "Giveaways", re: /^\/api\/admin\/giveaways\// },
    { id: "supporters", label: "Supporters", re: /^\/api\/admin\/supporters\// },
    { id: "servers", label: "Servers", re: /^\/api\/admin\/server\// },
    { id: "members", label: "People and restrictions", re: /^\/api\/admin\/(ban|user)(\/|$)/ },
    { id: "profiles", label: "Profile pages", re: /^\/api\/admin\/profiles/ },
    { id: "gifts", label: "Gift marks", re: /^\/api\/admin\/gifts/ },
    { id: "social", label: "Community", re: /^\/api\/admin\/(social|codes\/poll|bundles\/poll)/ },
    { id: "indie", label: "Indie showcase", re: /^\/api\/admin\/indie\// },
    { id: "xposts", label: "X posting", re: /^\/api\/admin\/xposter/ },
    { id: "tickets", label: "Support tickets and bug reports", re: /^\/api\/admin\/tickets\// },
    { id: "requests", label: "Feature requests", re: /^\/api\/admin\/requests\// },
    { id: "ai", label: "AI companion", re: /^\/api\/admin\/ai\// },
    { id: "settings", label: "Bot settings", re: /^\/api\/admin\/settings/ },
    { id: "music", label: "Music sessions", re: /^\/api\/admin\/music/ },
    { id: "system", label: "System health actions", re: /^\/api\/admin\/(logs\/clear|problems\/clear|clear-dm-failures|offsite\/verify)/ }
];
const FREE = /^\/api\/admin\/(self\/password|bugs\/seen|chat\/)/; // always fine for a panel user
export const areaOf = path => PANEL_AREAS.find(a => a.re.test(path))?.id ?? null;
/** May this panel user send this request? Reading is always fine; a change needs the area switched on ("*" means every area). */
export function mayChange(edit, method, rawPath) {
    const path = String(rawPath).split("?")[0];
    if (method !== "POST" || FREE.test(path)) return true;
    const area = areaOf(path);
    return Boolean(area) && (edit.includes("*") || edit.includes(area));
}
/** Cleans what the owner sent: known area ids only, or ["*"] for everything. */
export function cleanEdit(list) {
    const arr = Array.isArray(list) ? list.map(String) : [];
    if (arr.includes("*")) return ["*"];
    const ok = new Set(PANEL_AREAS.map(a => a.id));
    return [...new Set(arr.filter(x => ok.has(x)))];
}
