import { linkPayload } from "./deallinks.js";
// One look for everything the bot says. Individual commands still choose their own colors and fields; this fills in what they left out:
// a color, the bot's name and logo in the footer, and a proper card instead of bare text. It never overwrites anything a command set.
export const BRAND_COLOR = 0xff9800;
export const BRAND_NAME = "Steam Value Checker";

const BAD = /^(⚠️|❌|🚫|⛔)/u;
const GOOD = /^(✅|🎉|☑️|👍)/u;
const noteOf = text => {
    const t = String(text).trim();
    const m = t.match(/^(\p{Extended_Pictographic}️?)\s*(.*)$/su);
    const bad = BAD.test(t);
    return { color: bad ? 0xed4245 : GOOD.test(t) ? 0x57f287 : BRAND_COLOR, description: m && !bad ? `${m[1]}  ${m[2]}` : t.slice(0, 4000) };
};

/** Brands one embed (plain object or an EmbedBuilder). Returns a new object; the original is left alone. */
export function brandEmbed(e, { logo = null } = {}) {
    const o = typeof e?.toJSON === "function" ? e.toJSON() : { ...e };
    if (o.color === undefined || o.color === null) o.color = BRAND_COLOR;
    if (!o.footer?.text) o.footer = { ...(o.footer ?? {}), text: BRAND_NAME };
    if (logo && !o.footer.icon_url) o.footer = { ...o.footer, icon_url: logo };
    return o;
}

/** Brands a message payload: its embeds, and a bare-text reply becomes a card (unless it pings someone, since an embed can't). */
export function brandPayload(payload, opts = {}) {
    if (payload == null) return payload;
    if (typeof payload === "string") payload = { content: payload };
    if (typeof payload !== "object" || Array.isArray(payload)) return payload;
    if (Number(payload.flags) & (1 << 15)) return payload; // components v2 messages can't carry embeds
    let out = payload;
    if (Array.isArray(out.embeds) && out.embeds.length) out = { ...out, embeds: out.embeds.map(e => brandEmbed(e, opts)) };
    else if (out.content && !out.embeds && !out.files && !/<(?:@|@&|#)\d+>|@everyone|@here/.test(out.content) && String(out.content).length <= 4000) {
        const { content, ...rest } = out;
        out = { ...rest, embeds: [brandEmbed(noteOf(content), opts)] };
    }
    return linkPayload(out);
}

/** Makes every reply to this interaction go through the brand. Safe to call once per interaction. */
export function brandInteraction(i, opts = {}) {
    for (const m of ["reply", "editReply", "followUp", "update"]) {
        const fn = i[m];
        if (typeof fn !== "function") continue;
        i[m] = (p, ...rest) => fn.call(i, brandPayload(p, opts), ...rest);
    }
    return i;
}

/** Same for the bot's own REST helper (channel posts, edits and DMs). */
export function brandRest(api, opts = {}) {
    for (const m of ["sendMessage", "editMessage", "sendDm", "sendChannel"]) {
        const fn = api?.[m];
        if (typeof fn !== "function") continue;
        api[m] = (...args) => {
            const at = m === "editMessage" ? 2 : 1;
            args[at] = brandPayload(args[at], opts);
            return fn.apply(api, args);
        };
    }
    return api;
}
