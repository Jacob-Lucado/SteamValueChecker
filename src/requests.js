// Feature request rules shared by the /feature command and the dashboard.
import { UserError } from "./errors.js";
import { REQUEST_STATUSES, MAX_OPEN_PER_USER, MAX_TITLE, MAX_BODY } from "./requeststore.js";

export function cleanRequest({ title, body }) {
    const t = String(title ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TITLE);
    if (t.length < 4) throw new UserError("Give your idea a short title (at least 4 characters).");
    return { title: t, body: String(body ?? "").trim().slice(0, MAX_BODY) };
}
export const limitMessage = () => `You can have ${MAX_OPEN_PER_USER} requests waiting at once. Vote on existing ones or wait for a reply.`;

/** Adds a request for someone, or throws a UserError. `publish(id)` posts it to the servers' forums (best effort). */
export function submitRequest({ db, userId, userName, title, body, publish = null }) {
    const c = cleanRequest({ title, body });
    if (db.openCountFor(userId) >= MAX_OPEN_PER_USER) throw new UserError(limitMessage());
    const id = db.addRequest({ userId, userName: userName ?? null, ...c });
    if (publish) Promise.resolve(publish(id)).catch(() => {});
    return id;
}

/** The embed for /feature list. */
export function requestListEmbed(rows, { status = null, base = null } = {}) {
    const icon = { open: "🗳️", planned: "📌", in_development: "🛠️", shipped: "🚀", rejected: "🚫", duplicate: "♻️", on_hold: "⏸️" };
    return { color: 0x5865f2, title: status ? `Feature requests: ${REQUEST_STATUSES[status]}` : "Feature requests",
        description: (rows.length ? rows.map(r => `${icon[r.status] ?? "•"} **#${r.id}** ${r.title}\n└ ${REQUEST_STATUSES[r.status]} · ▲ ${r.votes}${r.voted ? " (you voted)" : ""}${r.note ? ` · ${r.note.slice(0, 80)}` : ""}`).join("\n") : "Nothing here yet. Be the first with `/feature request`.").slice(0, 4000),
        footer: { text: "Vote with /feature vote id:<number>" + (base ? ` · ${base.replace(/^https?:\/\//, "")}/#/requests` : "") } };
}
