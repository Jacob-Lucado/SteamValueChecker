// "Sign in through Steam": Steam's OpenID 2.0. Steam proves which account the person owns, with no password or API key
// involved here. We only ever learn the public SteamID64. The reply is checked by asking Steam itself (check_authentication).

const ENDPOINT = "https://steamcommunity.com/openid/login";
const NS = "http://specs.openid.net/auth/2.0";
const CLAIMED = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;

/** Where to send the browser. `returnTo` is our own return URL (it carries our one-time state), `realm` our site's origin. */
export function steamLoginUrl(returnTo, realm) {
    const q = new URLSearchParams({
        "openid.ns": NS, "openid.mode": "checkid_setup",
        "openid.return_to": returnTo, "openid.realm": realm,
        "openid.identity": `${NS}/identifier_select`, "openid.claimed_id": `${NS}/identifier_select`
    });
    return `${ENDPOINT}?${q}`;
}

/**
 * Checks what Steam sent back. `params` are the query parameters of our return URL, `expectedReturnTo` the exact URL we asked
 * Steam to use. Returns the SteamID64, or throws Error("steam_openid") for anything that does not check out.
 */
export async function verifySteamLogin(params, expectedReturnTo, fetchImpl = globalThis.fetch) {
    const get = k => params.get ? params.get(k) : params[k];
    if (get("openid.mode") !== "id_res" || get("openid.ns") !== NS) throw new Error("steam_openid");
    if (get("openid.op_endpoint") !== ENDPOINT) throw new Error("steam_openid");
    if (get("openid.return_to") !== expectedReturnTo) throw new Error("steam_openid");
    const id = CLAIMED.exec(get("openid.claimed_id") ?? "")?.[1];
    if (!id || get("openid.identity") !== get("openid.claimed_id")) throw new Error("steam_openid");

    const body = new URLSearchParams();
    for (const [k, v] of (params.entries ? params.entries() : Object.entries(params))) if (k.startsWith("openid.")) body.set(k, v);
    body.set("openid.mode", "check_authentication");
    let text;
    try {
        const res = await fetchImpl(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error(String(res.status));
        text = await res.text();
    } catch { throw new Error("steam_openid"); }
    if (!/^is_valid\s*:\s*true\s*$/m.test(text)) throw new Error("steam_openid");
    return id;
}
