// Trophy case: badges worked out from the library and the monthly challenge. Nothing is stored; they are recalculated each time.
import { challengeView } from "./challenge.js";

const TIERS = ["Bronze", "Silver", "Gold", "Platinum"];
const ladder = (id, icon, name, value, steps, unit) => {
    const tier = steps.filter(s => value >= s).length;
    return { id, icon, name, value, tier: tier ? TIERS[tier - 1] : null, next: tier < steps.length ? steps[tier] : null, unit };
};

export function badgeList(lib, { best = 0 } = {}) {
    const hours = g => (g.minutes ?? 0) / 60;
    const finished = lib.filter(g => g.status === "finished").length;
    const backlog = lib.filter(g => g.status === "backlog").length;
    const cheap = lib.filter(g => g.paid > 0 && hours(g) >= 10 && g.paid / hours(g) < 1).length;
    const longest = Math.max(0, ...lib.map(hours));
    const list = [
        ladder("collector", "📚", "Collector", lib.length, [10, 50, 100, 250], "games"),
        ladder("finisher", "🏁", "Finisher", finished, [1, 10, 25, 50], "finished"),
        ladder("streak", "🔥", "Streak keeper", best, [2, 3, 6, 12], "months in a row"),
        ladder("value", "💸", "Money's worth", cheap, [1, 5, 10, 25], "games under 1 per hour"),
        ladder("marathon", "⏱️", "Marathoner", Math.floor(longest), [50, 100, 250, 500], "hours in one game")
    ];
    const clean = lib.length >= 10 && backlog === 0;
    list.push({ id: "clean", icon: "✨", name: "Clean slate", value: clean ? 1 : 0, tier: clean ? "Gold" : null, next: clean ? null : 1, unit: "empty backlog with 10+ games" });
    return list;
}

export function trophyCase(db, userId) {
    const best = challengeView(db, userId).best;
    const badges = badgeList(db.listLibrary(userId), { best });
    return { badges, earned: badges.filter(b => b.tier).length, total: badges.length };
}
