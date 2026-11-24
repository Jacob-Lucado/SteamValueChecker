import test from "node:test";
import assert from "node:assert/strict";
import { scamScore, normalize } from "../src/scamfilter.js";

test("scam filter catches card-selling and cash-out posts, including fancy-font and split-up wording", () => {
    for (const t of ["selling fullz and cvv, hit me up on telegram", "𝗙𝗿𝗲𝘀𝗵 𝗖𝗖𝘀 𝗳𝗼𝗿 𝘀𝗮𝗹𝗲, cash out same day, dm me to purchase", "cash app flip, send $50 get $500 back dm me now", "Fresh linkables available 💳 dm me to buy"]) assert.ok(scamScore(t).scam, t);
});
test("scam filter leaves normal talk alone", () => {
    for (const t of ["I paid for it with my credit card on Steam, the sale price was great", "anyone know if the visa gift card works on GOG? my balance is 20", "dm me your steam id and I'll add you to the game night", "my cc got declined at Humble, any idea why? contact me if you know", "short"]) assert.ok(!scamScore(t).scam, t);
});
test("normalize drops zero-width characters and emoji", () => assert.equal(normalize("c​ash 💳out"), "cash out"));

import { scamName } from "../src/scamfilter.js";
test("scam names: only unmistakable trade words", () => {
    for (const n of ["BINERO LINKABLES V2", "fullz_shop", "Crypto Recovery Expert", "CC.Dumps.Vendor", "𝗖𝗟𝗢𝗡𝗘𝗗 𝗖𝗔𝗥𝗗𝗦"]) assert.ok(scamName(n), n);
    for (const n of ["Jacob", "SteamDealHunter", "linkin_park_fan", "Card Collector", "CashApp Cat", "recovering gamer"]) assert.ok(!scamName(n), n);
});
