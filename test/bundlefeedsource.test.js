import { test } from "node:test";
import assert from "node:assert/strict";

test("Humble's card-based bundles page is read when the old JSON block is gone", async () => {
    const { parseHumbleList } = await import("../src/bundlefeedsource.js");
    const card = (slug, title, n) => `<div data-testid="product-card"><a data-testid="product-link" href="/games/${slug}"><img src="/_next/image?url=https%3A%2F%2Fhb-prd.imgix.net%2Fa.jpg&amp;w=3840"/></a><div data-testid="product-card-footer"><a data-testid="product-link" href="/games/${slug}"><div>${title}<!-- --> </div></a></div><div>Pay What You Want</div><div>${n}<!-- --> Items • $99.00 Value</div></div>`;
    const html = card("big-bundle", "Big Bundle", 9) + card("big-bundle", "Big Bundle", 9) + `<div data-testid="product-card"><a data-testid="product-link" href="/games/one-game"></a><div data-testid="product-card-footer"><a data-testid="product-link">One Game</a></div></div>`;
    const l = parseHumbleList(html);
    assert.equal(l.length, 1);
    assert.deepEqual([l[0].title, l[0].gameCount, l[0].image], ["Big Bundle", 9, "https://hb-prd.imgix.net/a.jpg"]);
});
