const base = "https://store.steampowered.com/appreviews/1145360?json=1";
const UA = { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36" };
const tries = [
  ["as the bot asks", base + "&language=all&purchase_type=all&num_per_page=0", {}],
  ["same, browser UA", base + "&language=all&purchase_type=all&num_per_page=0", UA],
  ["same, Accept json", base + "&language=all&purchase_type=all&num_per_page=0", { Accept: "application/json" }],
  ["num_per_page=1", base + "&language=all&purchase_type=all&num_per_page=1", {}],
  ["no num_per_page", base + "&language=all&purchase_type=all", {}],
  ["bare", base, {}],
  ["bare, browser UA", base, UA],
  ["trailing slash", "https://store.steampowered.com/appreviews/1145360/?json=1&language=all&purchase_type=all&num_per_page=0", {}],
  ["no redirect follow", base + "&language=all&purchase_type=all&num_per_page=0", {}, "manual"],
];
for (const [name, url, headers, redirect] of tries) {
  try {
    const res = await fetch(url, { headers, redirect: redirect ?? "follow", signal: AbortSignal.timeout(20000) });
    const text = await res.text();
    console.log(`PROBE ${name}: HTTP ${res.status} ${res.headers.get("content-type")} loc=${res.headers.get("location")} final=${res.url.slice(0, 90)} :: ${text.slice(0, 160).replace(/\s+/g, " ")}`);
  } catch (e) { console.log(`PROBE ${name}: ${e.name} ${e.message}`); }
  await new Promise(r => setTimeout(r, 1500));
}
