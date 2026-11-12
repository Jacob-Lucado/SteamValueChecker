// Turns the fields of a giveaway form into what the giveaway service takes. The server giveaway page and the stream giveaway panel
// share it, so both accept the same options and check them the same way.
import { UserError } from "./errors.js";
import { parseRegions } from "./gwregion.js";
import { videoFromBody } from "./gwmedia.js";
import { parseKeys, parseDuration, parseColor, parseImageUrl } from "./gwparse.js";
import { parseSteps, StepError } from "./gwpartner.js";
import { roleIds } from "./gwroles.js";

const text = v => (v === null || v === undefined || v === "" ? null : String(v));
const int = v => (v === null || v === undefined || v === "" ? undefined : Number(v));
const id = v => (/^[\w-]{1,40}$/.test(String(v ?? "")) ? String(v) : null);

/**
 * body: the form values. channelIds: the channels in the server, so a vouch channel can be checked. defaults: what to use when a field
 * is left blank (length, title). Returns { input, duplicates }; `input` has no guild, channel or host, the caller adds those.
 */
export function giveawayInput(body, { channelIds = [], defaults = {} } = {}) {
    const { keys, duplicates } = parseKeys(String(body.keys ?? "").slice(0, 20_000), text(body.game) ?? text(body.title) ?? defaults.prize ?? "Prize");
    let steps = [];
    try { steps = parseSteps(body.steps); } catch (e) { if (e instanceof StepError) throw new UserError(e.message); throw e; }
    return {
        duplicates,
        input: {
            title: text(body.title) ?? defaults.title, duration_ms: parseDuration(text(body.length) ?? defaults.length ?? "24h"),
            game_title: text(body.game), description: text(body.description), image_url: parseImageUrl(body.image, "image"), thumbnail_url: parseImageUrl(body.thumbnail, "thumbnail"),
            color: parseColor(body.color), button_label: text(body.button_label), ping_role_id: id(body.ping_role_id), require_role_ids: roleIds(body.require_role_ids ?? body.require_role_id), require_all: body.require_all === true || body.require_all === "all",
            bonus_role_ids: roleIds(body.bonus_role_ids ?? body.bonus_role_id), override_role_ids: roleIds(body.override_role_ids ?? body.override_role_id), bonus_entries: int(body.bonus_entries), claim_hours: int(body.claim_hours),
            min_account_days: int(body.min_account_days), min_member_days: int(body.min_member_days),
            vouch_channel_id: channelIds.includes(body.vouch_channel_id) ? body.vouch_channel_id : null,
            regions: parseRegions(body.regions), video: videoFromBody(body), auto_image: body.auto_image !== false, keys, require_boost: Boolean(body.boosters), require_steam: Boolean(body.steam_verified), steps,
            start_in_ms: text(body.start_in) ? parseDuration(text(body.start_in), { min: 0 }) : 0,
            rounds: int(body.rounds) ?? 1, repeat_ms: text(body.repeat_every) ? parseDuration(text(body.repeat_every)) : null
        }
    };
}
