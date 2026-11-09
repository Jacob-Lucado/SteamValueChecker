// A short DM to the owner once the bot is back up after a start: which version, whether it was an update or a plain restart,
// and whether anything went wrong in the first minute. A crash loop sends nothing here because it never gets this far;
// restarts close together are held to one message so a flapping machine can't fill the DMs.
export const MIN_GAP_MS = 10 * 60_000;

export function bootEmbed({ version, previous, servers, errors, topError }) {
    const kind = !previous ? "First start recorded" : previous === version ? "Restarted" : `Updated from ${previous}`;
    const fields = [
        { name: "Version", value: `**${version}**`, inline: true },
        { name: "Servers", value: `**${servers ?? "-"}**`, inline: true },
        { name: "Errors so far", value: `**${errors}**`, inline: true }
    ];
    if (topError) fields.push({ name: "Most common", value: String(topError).slice(0, 300) });
    return { color: errors ? 0xf0b232 : 0x57f287, title: errors ? "🟡 Back online, with errors" : "🟢 Back online", description: kind + ".", fields };
}

export async function runBootNotice({ db, ownerId, sendDm, version, servers, errors = 0, topError = null, now = () => Date.now() }) {
    if (!ownerId) return { sent: false };
    const previous = db.getMeta("boot:version") || null;
    const last = Number(db.getMeta("boot:noticeAt")) || 0;
    if (now() - last < MIN_GAP_MS) return { sent: false, why: "too soon" };
    db.setMeta("boot:version", version); // only once it has been told, so a held-back update still reads as an update next time
    db.setMeta("boot:noticeAt", String(now()));
    await sendDm(ownerId, { embeds: [bootEmbed({ version, previous, servers, errors, topError })] });
    return { sent: true };
}
