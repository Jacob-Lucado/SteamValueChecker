// A giveaway can name several roles for each rule, so each rule is stored as a short comma list of role ids. These helpers
// turn what a form, command or old row holds (one id, a list, or nothing) into that list and back.
export const MAX_ROLES = 10;

/** One id, a comma list or an array in; a clean array of ids out. */
export function roleIds(v) {
    const raw = Array.isArray(v) ? v : String(v ?? "").split(",");
    return [...new Set(raw.map(x => String(x ?? "").trim()).filter(x => /^[\w-]{1,40}$/.test(x)))].slice(0, MAX_ROLES);
}
/** What gets saved: null when empty. */
export const roleList = v => { const a = roleIds(v); return a.length ? a.join(",") : null; };
export const hasAnyRole = (have, want) => roleIds(want).some(r => (have ?? []).includes(r));
export const hasAllRoles = (have, want) => roleIds(want).every(r => (have ?? []).includes(r));
