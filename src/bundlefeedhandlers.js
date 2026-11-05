// Discord side of the bundle feed: /server promos bundles. With no options it shows the settings and the newest bundles.
import { MessageFlags, PermissionFlagsBits } from "discord.js";
import { UserError } from "./errors.js";
import { applyBundleFeedSettings, describeStores } from "./bundlefeed.js";
import { BUNDLE_STORES, BUNDLE_STORE_KEYS } from "./bundlefeedsource.js";

const eph = (i, payload) => i.reply({ ...(typeof payload === "string" ? { content: payload } : payload), flags: MessageFlags.Ephemeral });

export function createBundleFeedHandlers({ db, runNow = null }) {
    const summary = (gid, s = db.getBundleFeedSettings(gid)) => [
        s.channel_id ? `Bundles are posted in <#${s.channel_id}>.` : "No bundles channel yet. Pick one with `/server promos bundles channel:#channel`.",
        `Stores: ${describeStores(s.stores)}.`,
        s.role_id ? `Pings <@&${s.role_id}>.` : "No role is pinged."
    ].join("\n");

    async function handle(i) {
        try {
            if (!i.inGuild()) throw new UserError("Use this in a server.");
            const ch = i.options.getChannel("channel"), store = i.options.getString("store"), on = i.options.getBoolean("on"), role = i.options.getRole("role"), clear = i.options.getBoolean("clear");
            const gid = i.guildId;
            const changing = Boolean(ch || store || role || clear);
            if (!changing) {
                const latest = db.listFeedBundles({ status: "active", stores: db.getBundleFeedSettings(gid).stores, limit: 5 });
                const lines = latest.map(b => `**${BUNDLE_STORES[b.store]?.name ?? b.store}** · [${b.title}](${b.url})${b.expires_at ? ` · ends <t:${Math.floor(b.expires_at / 1000)}:R>` : ""}`);
                return await eph(i, { embeds: [{ color: 0x4da3ff, title: "Game bundles", description: (lines.length ? lines.join("\n") : "No bundles are listed right now. New ones show up as soon as a store lists them.") + "\n\n" + summary(gid),
                    footer: { text: "Humble Bundle, Fanatical, IndieGala and Steam" } }] });
            }
            if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) throw new UserError("You need the Manage Server permission to change this.");
            const patch = {};
            if (clear) patch.channel_id = null;
            if (ch) {
                try { await ch.send({ content: "Game bundles will be posted in this channel: new ones from Humble, Fanatical, IndieGala and Steam, marked when they end.", allowedMentions: { parse: [] } }); }
                catch { throw new UserError("I can't post in that channel. Give me View Channel, Send Messages and Embed Links there."); }
                patch.channel_id = ch.id;
            }
            if (role) patch.role_id = role.id;
            if (store) {
                const cur = db.getBundleFeedSettings(gid).stores, base = cur.length ? cur : BUNDLE_STORE_KEYS;
                const next = on === false ? base.filter(k => k !== store) : [...new Set([...base, store])];
                if (!next.length) throw new UserError("Keep at least one store, or turn the bundles channel off with `clear:true`.");
                patch.stores = next;
            }
            const s = applyBundleFeedSettings(db, gid, patch);
            if (patch.channel_id) runNow?.().catch(() => {});
            return await eph(i, "Saved.\n" + summary(gid, s));
        } catch (err) {
            if (!(err instanceof UserError)) console.error(`[bundles] ${err.name}: ${err.message}`);
            const content = err instanceof UserError ? err.message : "Something went wrong. Try again in a moment.";
            if (i.deferred || i.replied) await i.editReply({ content }).catch(() => {}); else await eph(i, content).catch(() => {});
        }
    }
    return { handle };
}
