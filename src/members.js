// How many people are in a server. Discord's own member count includes bots, so every count the bot shows comes from here.
// With the Server Members intent the bot knows exactly which members are bots; without it, it knows at least about itself.

/** Members who aren't bots. `guild` is a discord.js guild (or anything with memberCount and members.cache). */
export function humanCount(guild) {
    const total = Number(guild?.memberCount ?? 0);
    const cache = guild?.members?.cache;
    const bots = cache && typeof cache.filter === "function" ? cache.filter(m => m?.user?.bot).size : 0;
    const self = guild?.members?.me ? 1 : 0; // the bot is always one of them, even when nobody else is cached
    return Math.max(0, total - Math.max(bots, self));
}

/** Loads every member of each server so the bots among them can be told apart. Smaller servers first, one at a time, never throws. */
export async function warmMembers(guilds, { max = 10000, log = () => {} } = {}) {
    const list = [...guilds.values()].filter(g => g.memberCount <= max).sort((a, b) => a.memberCount - b.memberCount);
    for (const g of list) {
        try { await g.members.fetch({ time: 30_000 }); }
        catch (err) { log(`could not load the members of ${g.id}: ${err.message}`); }
    }
}
