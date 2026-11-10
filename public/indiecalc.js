// The maths behind the indie tools. Plain functions, no page in sight, so they can be tested on their own.
// Fee tiers and review labels are Valve's published ones. Wishlist and sales ratios are rules of thumb from public talks and
// post-mortems, so every one of them is shown as a range and never as a promise.
(function (root) {
  "use strict";
  const round = (n, d = 2) => { const f = 10 ** d; return Math.round((Number(n) + Number.EPSILON) * f) / f; };
  const num = (v, fallback = 0) => { const n = Number(String(v ?? "").replace(/[$,\s]/g, "")); return Number.isFinite(n) ? n : fallback; };

  /** Valve's cut by lifetime adjusted gross revenue of one app: 30% to $10M, 25% to $50M, 20% beyond. */
  const VALVE_TIERS = [{ upTo: 10_000_000, cut: 0.30 }, { upTo: 50_000_000, cut: 0.25 }, { upTo: Infinity, cut: 0.20 }];
  function valveCut(grossTotal) {
    let left = Math.max(0, num(grossTotal)), from = 0, cut = 0;
    for (const t of VALVE_TIERS) { const slice = Math.min(left, t.upTo - from); if (slice <= 0) break; cut += slice * t.cut; left -= slice; from = t.upTo; }
    return cut;
  }

  /**
   * What a studio keeps. Prices in most of the world already include VAT, so it comes out of the price first; refunded copies
   * come back out of revenue entirely. Valve's cut is taken on what's left, then the studio's own income tax estimate.
   */
  function fees({ price, copies = 1, vat = 0, refunds = 0, incomeTax = 0, platformCut = null }) {
    const p = Math.max(0, num(price)), n = Math.max(0, num(copies, 1));
    const vatRate = Math.min(60, Math.max(0, num(vat))) / 100, refundRate = Math.min(100, Math.max(0, num(refunds))) / 100, taxRate = Math.min(80, Math.max(0, num(incomeTax))) / 100;
    const sold = p * n, afterVat = sold / (1 + vatRate), vatAmount = sold - afterVat;
    const refunded = afterVat * refundRate, adjusted = afterVat - refunded;
    const valve = platformCut == null ? valveCut(adjusted) : adjusted * (Math.min(100, Math.max(0, num(platformCut))) / 100);
    const beforeTax = adjusted - valve, tax = Math.max(0, beforeTax) * taxRate, keep = beforeTax - tax;
    return { sold: round(sold), vat: round(vatAmount), refunded: round(refunded), valve: round(valve), beforeTax: round(beforeTax), tax: round(tax), keep: round(keep), perCopy: n ? round(keep / n) : 0, keepPct: sold ? round((keep / sold) * 100, 1) : 0 };
  }

  /** Copies needed to earn a budget back, and the reviews and wishlists that usually go with that many sales. */
  const COPIES_PER_REVIEW = { low: 50, typical: 35, high: 20 };      // sales per review: more sales per review means fewer reviews
  const YEAR_ONE_PER_WISHLIST = { low: 0.15, typical: 0.30, high: 0.45 };
  function breakEven({ budget, netPerCopy }) {
    const b = Math.max(0, num(budget)), net = num(netPerCopy);
    if (!(net > 0)) return null;
    const copies = Math.ceil(b / net);
    return { copies, reviews: { min: Math.ceil(copies / COPIES_PER_REVIEW.low), typical: Math.ceil(copies / COPIES_PER_REVIEW.typical), max: Math.ceil(copies / COPIES_PER_REVIEW.high) },
      wishlists: { min: Math.ceil(copies / YEAR_ONE_PER_WISHLIST.high), typical: Math.ceil(copies / YEAR_ONE_PER_WISHLIST.typical), max: Math.ceil(copies / YEAR_ONE_PER_WISHLIST.low) } };
  }

  /** Steam's review label for a count of positive and negative reviews. */
  function reviewLabel(pos, neg) {
    const p = Math.max(0, Math.floor(num(pos))), n = Math.max(0, Math.floor(num(neg))), total = p + n;
    if (total === 0) return { label: "No user reviews", pct: null, total };
    if (total < 10) return { label: `${total} user review${total === 1 ? "" : "s"}`, pct: round((p / total) * 100, 1), total };
    const pct = (p / total) * 100;
    let label;
    if (pct >= 95 && total >= 500) label = "Overwhelmingly Positive";
    else if (pct >= 80 && total >= 50) label = "Very Positive";
    else if (pct >= 80) label = "Positive";
    else if (pct >= 70) label = "Mostly Positive";
    else if (pct >= 40) label = "Mixed";
    else if (pct >= 20) label = "Mostly Negative";
    else if (total >= 500) label = "Overwhelmingly Negative";
    else if (total >= 50) label = "Very Negative";
    else label = "Negative";
    return { label, pct: round(pct, 1), total };
  }
  /** How many more positive reviews (with no new negatives) until the label changes, or null if it can't improve. */
  function nextLabel(pos, neg, cap = 200000) {
    const now = reviewLabel(pos, neg);
    if (now.total < 10) { const need = 10 - now.total; return { from: now.label, label: reviewLabel(num(pos) + need, neg).label, positives: need }; }
    for (let k = 1; k <= cap; k++) { const r = reviewLabel(num(pos) + k, neg); if (r.label !== now.label && r.pct >= now.pct) return { from: now.label, label: r.label, positives: k }; }
    return null;
  }

  /** Sales from review counts, the way people usually do it: reviews times a multiplier between about 20 and 50. */
  function revenueFromReviews({ reviews, price }) {
    const r = Math.max(0, Math.floor(num(reviews))), p = Math.max(0, num(price));
    const at = k => { const copies = Math.round(r * k), gross = copies * p; return { copies, gross: round(gross, 0), net: round(gross * 0.7, 0) }; };
    return { low: at(COPIES_PER_REVIEW.high), typical: at(COPIES_PER_REVIEW.typical), high: at(COPIES_PER_REVIEW.low) };
  }

  /** Wishlists to sales, or sales goal to wishlists. Ranges, because every game lands differently. */
  const WEEK_ONE = { low: 0.07, typical: 0.12, high: 0.20 };
  function wishlistSales({ wishlists }) {
    const w = Math.max(0, num(wishlists)), at = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(w * v)]));
    return { week: at(WEEK_ONE), year: at(YEAR_ONE_PER_WISHLIST) };
  }
  function wishlistsFor({ copies, window = "year" }) {
    const c = Math.max(0, num(copies)), t = window === "week" ? WEEK_ONE : YEAR_ONE_PER_WISHLIST;
    return { min: Math.ceil(c / t.high), typical: Math.ceil(c / t.typical), max: Math.ceil(c / t.low) };
  }
  /** Where a visits-to-wishlists rate sits. */
  function conversionBand(visits, wishlists) {
    const v = num(visits), w = num(wishlists);
    if (!(v > 0)) return null;
    const rate = (w / v) * 100;
    const band = rate < 5 ? { name: "Low", note: "Visitors are looking and leaving. The capsule may be pulling the wrong crowd, or the page isn't closing the deal: check the trailer, the first screenshots and the short description." }
      : rate < 10 ? { name: "Okay", note: "About what an average page sees. There's room to improve the first screen of the page." }
      : rate < 20 ? { name: "Good", note: "Your page turns a healthy share of visits into wishlists." }
      : { name: "Strong", note: "Unusually high. Check that your traffic is the right audience, then spend on getting more of it." };
    return { rate: round(rate, 1), ...band };
  }

  /** Pixel measurements of an image's brightness and contrast, from RGBA data. Brightness and spread are 0 to 255. */
  function imageStats(rgba) {
    let sum = 0, sumSq = 0, n = 0, sat = 0;
    for (let i = 0; i + 3 < rgba.length; i += 4) {
      if (rgba[i + 3] < 10) continue;
      const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2], y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sum += y; sumSq += y * y; n++;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b); sat += mx ? (mx - mn) / mx : 0;
    }
    if (!n) return { brightness: 0, contrast: 0, saturation: 0 };
    const mean = sum / n;
    return { brightness: round(mean, 1), contrast: round(Math.sqrt(Math.max(0, sumSq / n - mean * mean)), 1), saturation: round((sat / n) * 100, 1) };
  }
  /** Plain-language reading of those numbers for a picture that will be seen very small. */
  function capsuleVerdict(st) {
    const out = [];
    out.push(st.brightness < 55 ? ["bad", "Very dark. On Steam's dark pages it will melt into the background. Lift the shadows or add a lighter focal point."] : st.brightness < 85 ? ["warn", "A bit dark. Fine for a moody game, but make sure the logo and the subject still pop."] : st.brightness > 215 ? ["warn", "Very bright. Check it doesn't look washed out beside darker capsules."] : ["good", "Brightness is in a comfortable range."]);
    out.push(st.contrast < 30 ? ["bad", "Low contrast. At thumbnail size everything blends together. Separate the subject from the background."] : st.contrast < 45 ? ["warn", "Moderate contrast. A stronger light-and-dark split would read better when small."] : ["good", "Good contrast between light and dark areas."]);
    out.push(st.saturation < 12 ? ["warn", "Almost no color. That can look stylish, but it stands out less in a row of colorful capsules."] : ["good", "There's enough color to catch the eye."]);
    return out;
  }
  /** Which screenshots look weak: dark ones, and a suggested order with the strongest first. */
  function screenshotOrder(stats) {
    const score = s => s.brightness * 0.5 + s.contrast * 1.2 + s.saturation * 0.3;
    const rank = stats.map((s, i) => ({ i, score: score(s), dark: s.brightness < 60 })).sort((a, b) => b.score - a.score).map(x => x.i);
    return { order: rank, dark: stats.map((s, i) => (s.brightness < 60 ? i : -1)).filter(i => i >= 0) };
  }

  /** Steam's image sizes (width, height) with what each is for. */
  const CAPSULES = [
    { id: "header", name: "Header capsule", w: 920, h: 430, note: "Top of the store page and most lists. Also needed at 460 x 215." },
    { id: "small", name: "Small capsule", w: 462, h: 174, note: "Search results and the wishlist. Also needed at 231 x 87." },
    { id: "main", name: "Main capsule", w: 1232, h: 706, note: "The big banner on the store front when Valve features you." },
    { id: "vertical", name: "Vertical capsule", w: 748, h: 896, note: "Used on the store front and in recommendations." },
    { id: "library", name: "Library capsule", w: 600, h: 900, note: "The tall cover in a player's Steam library." },
    { id: "hero", name: "Library hero", w: 3840, h: 1240, note: "The wide banner on your page in the library. Keep the logo out of it." },
    { id: "logo", name: "Library logo", w: 1280, h: 720, note: "Transparent PNG laid over the hero. It's shown up to 1280 wide." },
    { id: "background", name: "Page background", w: 1438, h: 810, note: "Faint image behind your store page." }
  ];
  /** The source rectangle that fills a target size, centered on a focal point (0 to 1 each way). */
  function coverCrop(sw, sh, tw, th, fx = 0.5, fy = 0.5) {
    const scale = Math.max(tw / sw, th / sh), cw = tw / scale, ch = th / scale;
    return { sx: Math.min(sw - cw, Math.max(0, fx * sw - cw / 2)), sy: Math.min(sh - ch, Math.max(0, fy * sh - ch / 2)), sw: cw, sh: ch };
  }

  /** A zip with no compression. Files are { name, data: Uint8Array }. Enough for a folder of PNGs. */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = data => { let c = 0xFFFFFFFF; for (let i = 0; i < data.length; i++) c = CRC[(c ^ data[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zip(files) {
    const enc = new TextEncoder(), parts = [], central = [];
    let offset = 0;
    const u16 = n => [n & 255, (n >>> 8) & 255], u32 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
    for (const f of files) {
      const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
      const local = Uint8Array.from([0x50, 0x4B, 3, 4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0), ...name]);
      parts.push(local, f.data);
      central.push(Uint8Array.from([0x50, 0x4B, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name]));
      offset += local.length + size;
    }
    const cdSize = central.reduce((a, c) => a + c.length, 0);
    const end = Uint8Array.from([0x50, 0x4B, 5, 6, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
    const all = [...parts, ...central, end], out = new Uint8Array(all.reduce((a, c) => a + c.length, 0));
    let at = 0; for (const p of all) { out.set(p, at); at += p.length; }
    return out;
  }

  /** Short description checks. Returns a list of [state, text]. */
  const FILLER = /^(?:welcome to|in this game|this is a game|from the (?:creators|makers|team)|are you ready|get ready|experience the)/i;
  function gradeShortDescription(text, genre = "") {
    const t = String(text ?? "").replace(/\s+/g, " ").trim(), len = t.length, out = [];
    out.push(len === 0 ? ["bad", "Nothing written yet."] : len > 300 ? ["bad", `${len} characters. Steam cuts the short description off at 300.`] : len < 80 ? ["warn", `${len} characters is short. Aim for roughly 120 to 300 so there's room for a hook and what you do.`] : ["good", `${len} characters, a good length.`]);
    if (len) {
      const first = t.split(/(?<=[.!?])\s/)[0] ?? t;
      out.push(FILLER.test(t) ? ["warn", "It opens with a stock phrase. Lead with what the player does or what makes it different instead."] : ["good", "The opening gets to the point."]);
      out.push(first.length > 180 ? ["warn", "The first sentence is long. Search results often show only the start, so put the hook first and keep it short."] : ["good", "The first sentence is short enough to read at a glance."]);
      const g = String(genre ?? "").trim().toLowerCase();
      if (g) out.push(t.toLowerCase().includes(g) ? ["good", `It names the genre (${genre}) so people know what they're looking at.`] : ["warn", `It never says "${genre}". Players skimming search results should learn the genre straight away.`]);
      const letters = t.replace(/[^A-Za-z]/g, ""), caps = letters.replace(/[^A-Z]/g, "").length;
      out.push(letters.length > 20 && caps / letters.length > 0.35 ? ["warn", "A lot of capital letters read as shouting. Save them for the game's name."] : (t.match(/!/g) ?? []).length > 1 ? ["warn", "Several exclamation marks. One or none usually reads as more confident."] : ["good", "The tone is steady, with no shouting."]);
      const words = t.toLowerCase().match(/[a-z']+/g) ?? [], seen = new Map();
      for (const w of words) if (w.length > 4) seen.set(w, (seen.get(w) ?? 0) + 1);
      const rep = [...seen].filter(([, c]) => c >= 3).map(([w]) => w);
      out.push(rep.length ? ["warn", `"${rep[0]}" appears three times or more. Vary the wording so every word earns its spot.`] : ["good", "No word is overused."]);
    }
    return out;
  }

  /** Tag checks for a list of tags in order. */
  const BROAD_TAGS = ["indie", "singleplayer", "single-player", "action", "adventure", "casual", "2d", "3d", "simulation", "strategy", "rpg", "multiplayer", "great soundtrack", "colorful", "cute", "atmospheric", "story rich", "early access", "free to play", "difficult", "funny", "fantasy", "sci-fi", "co-op", "pixel graphics", "exploration"];
  function checkTags(list) {
    const tags = (Array.isArray(list) ? list : String(list ?? "").split(/[,\n]/)).map(t => t.trim()).filter(Boolean).filter((t, i, a) => a.findIndex(x => x.toLowerCase() === t.toLowerCase()) === i).slice(0, 40);
    const broad = new Set(BROAD_TAGS), top = tags.slice(0, 5), flagged = top.filter(t => broad.has(t.toLowerCase()));
    const specific = tags.filter(t => !broad.has(t.toLowerCase())), reordered = [...specific.slice(0, 5), ...tags.filter(t => !specific.slice(0, 5).includes(t))];
    return { tags, top, flagged, unused: Math.max(0, 20 - tags.length), reordered, broadCount: tags.filter(t => broad.has(t.toLowerCase())).length };
  }

  /** Sales and festivals around a date. `events` come from /api/indie/calendar. */
  function launchContext(dateMs, events) {
    const d = Number(dateMs), DAY = 86400000;
    const inside = events.filter(e => d >= e.start && d <= e.end + DAY);
    const before = events.filter(e => e.end + DAY < d).sort((a, b) => b.end - a.end)[0] ?? null;
    const after = events.filter(e => e.start > d).sort((a, b) => a.start - b.start)[0] ?? null;
    const days = ms => Math.round(ms / DAY);
    return { inside, before: before && { ...before, daysAgo: days(d - before.end) }, after: after && { ...after, daysAway: days(after.start - d) } };
  }

  /** Demo or playtest: answers are booleans keyed by question. */
  function demoOrPlaytest(a) {
    let demo = 0, play = 0; const why = [];
    if (a.vertical) { demo++; why.push("You have a polished slice, so players can try something that represents the game."); } else { play++; why.push("Your build is still rough. A playtest lets you gather feedback without a public first impression."); }
    if (a.page) { demo++; why.push("Your store page is live, so a demo button can turn visits into wishlists."); } else { play++; why.push("There's no public page yet. A playtest can start before one."); }
    if (a.fest) { demo++; why.push("A festival is coming up. Demos are what players look for there."); }
    if (a.feedback) { play++; why.push("You mostly want feedback on specific things, which a smaller playtest handles better."); } else { demo++; why.push("You mostly want reach and wishlists, which a demo brings."); }
    if (a.stable) { demo++; why.push("The build is stable enough for strangers to open without a crash."); } else { play++; why.push("Crashes are likely. Better to find them with a small group first."); }
    return { pick: demo >= play ? "demo" : "playtest", demo, play, why };
  }

  /** X counts every link as 23 characters, however long it is. */
  const xLen = t => String(t).replace(/https?:\/\/\S+/g, "x".repeat(23)).length;
  const X_KINDS = { announce: "Announce your game", launch: "Launch day", demo: "Demo or playtest", devlog: "Dev update", saturday: "Screenshot Saturday", sale: "Discount" };
  /** A ready-to-post tweet for an indie game. The pitch is trimmed so the whole thing fits in 280. */
  function xPost({ kind = "announce", name, pitch, url, genre, price, date, tags, now = Date.now() }) {
    const n = String(name ?? "").trim() || "My game", pt = String(pitch ?? "").replace(/\s+/g, " ").trim();
    const g = String(genre ?? "").replace(/[^A-Za-z0-9]/g, "");
    // The tags indie developers actually search and follow, by kind of post. Three is plenty: a wall of hashtags reads as spam and gets less reach.
    const POPULAR = { announce: ["#indiegame", "#gamedev", "#Steam"], launch: ["#indiegame", "#Steam", "#indiedev"], demo: ["#indiegame", "#Steam", "#gamedev"], devlog: ["#indiedev", "#gamedev", "#indiegame"], saturday: ["#ScreenshotSaturday", "#indiedev", "#gamedev"], sale: ["#SteamSale", "#indiegame", "#PCGaming"] };
    const weekday = new Date(now).getUTCDay(); // 3 is Wednesday, 6 is Saturday
    const auto = [...(POPULAR[kind] ?? POPULAR.announce)];
    if (kind === "announce" && weekday === 3) auto.unshift("#WishlistWednesday");
    if (kind === "devlog" && weekday === 6) auto.unshift("#ScreenshotSaturday");
    if (g && g.length > 2 && !auto.some(t => t.toLowerCase() === "#" + g.toLowerCase())) auto.splice(2, 0, "#" + g);
    const tagList = (tags ? String(tags).split(/[\s,]+/).filter(Boolean).map(t => "#" + t.replace(/^#/, "")) : auto).slice(0, 4);
    const lead = { announce: `${n} is coming to Steam${date ? ` on ${date}` : ""}. Wishlist it if it looks like your kind of game.`, launch: `${n} is out now on Steam${price ? ` for ${price}` : ""}. Thank you to everyone who wishlisted and played along.`,
      demo: `The ${n} demo is live on Steam. Try it free and tell me what you think.`, devlog: `A new update for ${n} is in the works. Here's what I've been up to.`, saturday: `#ScreenshotSaturday: this week in ${n}.`, sale: `${n} is on sale${price ? `, now ${price}` : ""} on Steam.` }[kind] ?? "";
    const tail = `${url ? "\n\n" + url : ""}${tagList.length ? "\n" + tagList.join(" ") : ""}`;
    let body = pt ? `${lead}\n\n${pt}` : lead;
    if (xLen(body + tail) > 280 && pt) { let cut = pt; while (cut.length > 12 && xLen(`${lead}\n\n${cut}…` + tail) > 280) cut = cut.slice(0, -4).trimEnd(); body = `${lead}\n\n${cut}…`; }
    let text = body + tail;
    if (xLen(text) > 280) text = lead + tail;
    return { text, length: xLen(text), fits: xLen(text) <= 280 };
  }

  root.IndieCalc = { xLen, xPost, X_KINDS, round, num, valveCut, fees, breakEven, reviewLabel, nextLabel, revenueFromReviews, wishlistSales, wishlistsFor, conversionBand, imageStats, capsuleVerdict, screenshotOrder, CAPSULES, coverCrop, zip, crc32, gradeShortDescription, checkTags, launchContext, demoOrPlaytest, COPIES_PER_REVIEW, YEAR_ONE_PER_WISHLIST, WEEK_ONE };
})(typeof globalThis !== "undefined" ? globalThis : this);
