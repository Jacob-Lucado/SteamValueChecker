// Stream cards overlay for OBS. The look is set in the address (anchor, theme, scale, hold, accent); the cards come from the bot.
(() => {
  "use strict";
  const q = new URLSearchParams(location.search);
  const pick = (k, list, d) => (list.includes(q.get(k)) ? q.get(k) : d);
  const num = (k, d, lo, hi) => { const v = Number(q.get(k)); return q.get(k) !== null && q.get(k) !== "" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
  const cfg = { token: q.get("token") || "", demo: q.has("demo") && q.get("demo") !== "0", theme: pick("theme", ["dark", "light", "glass"], "dark"), anchor: pick("anchor", ["tl", "tc", "tr", "ml", "mc", "mr", "bl", "bc", "br"], "bl"),
    scale: num("scale", 1, 0.5, 3), hold: num("hold", 12, 4, 120), accent: /^[0-9a-fA-F]{6}$/.test(q.get("accent") || "") ? "#" + q.get("accent") : "#4da3ff" };
  const root = document.getElementById("sc");
  root.dataset.theme = cfg.theme;
  root.dataset.anchor = [cfg.anchor[0] === "t" ? "t" : cfg.anchor[0] === "m" ? "m" : "b", cfg.anchor[1] === "l" ? "l" : cfg.anchor[1] === "r" ? "r" : "c"].join(" ");
  root.style.setProperty("--accent", cfg.accent); root.style.zoom = String(cfg.scale);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const money = (n, cur) => { try { return new Intl.NumberFormat(undefined, { style: "currency", currency: cur || "USD" }).format(n); } catch { return Number(n).toFixed(2); } };
  const safeImg = u => (/^https:\/\//i.test(u || "") ? u : "");
  const DEMO = [{ kind: "game", title: "Elden Ring", appid: 1245620, hours: 142.5 }, { kind: "deal", title: "Hades II", price: 23.99, regular: 29.99, discount: 20, currency: "USD", shop: "Steam", appid: 1145350 }, { kind: "free", title: "Example Free Game", shop: "Epic Games Store" }, { kind: "gift", text: "Gift me a game", url: "https://example.com/#/u/you" }];

  function build(c) {
    const card = el("div", "card"), body = el("div");
    if (c.kind === "deal") {
      const img = el("img"); img.alt = ""; img.referrerPolicy = "no-referrer"; if (c.appid) img.src = "https://cdn.cloudflare.steamstatic.com/steam/apps/" + Number(c.appid) + "/header.jpg"; else img.hidden = true; card.append(img);
      body.append(el("div", "tag", c.spot ? "Spotlight" : "On sale now"), el("div", "name", c.title));
      const p = el("div", "line"), pr = el("span", "price", money(c.price, c.currency)); p.append(pr);
      if (c.discount) p.append(el("span", "off", "-" + Math.round(c.discount) + "%"));
      if (c.regular) p.append(el("s", null, money(c.regular, c.currency)));
      body.append(p); if (c.shop) body.append(el("div", "line", "at " + c.shop));
    } else if (c.kind === "game") {
      const img = el("img"); img.alt = ""; img.referrerPolicy = "no-referrer"; img.src = "https://cdn.cloudflare.steamstatic.com/steam/apps/" + Number(c.appid) + "/header.jpg"; card.append(img);
      body.append(el("div", "tag", "Playing now"), el("div", "name", c.title)); if (c.hours) body.append(el("div", "line", c.hours + " hours in this game"));
    } else if (c.kind === "free") {
      const a = safeImg(c.art); if (a) { const img = el("img"); img.alt = ""; img.referrerPolicy = "no-referrer"; img.src = a; card.append(img); }
      body.append(el("div", "tag", "Free right now"), el("div", "name", c.title), el("div", "line", [c.shop, c.expiry ? "until " + new Date(c.expiry).toLocaleDateString() : ""].filter(Boolean).join(" · ")));
    } else {
      card.append(el("div", "gift", "🎁"));
      let host = ""; try { host = new URL(c.url).host; } catch { /* none */ }
      body.append(el("div", "tag", "Wishlist"), el("div", "name", c.text || "Gift me a game"), el("div", "line", host ? host + "/#/u/…" : ""));
    }
    card.append(body); return card;
  }

  let cards = [], idx = 0, shown = null;
  function show() {
    if (!cards.length) { root.replaceChildren(); shown = null; return; }
    idx = (idx + 1) % cards.length;
    const next = build(cards[idx]), old = shown;
    if (old) { old.classList.remove("in"); setTimeout(() => old.remove(), 500); }
    root.append(next); requestAnimationFrame(() => requestAnimationFrame(() => next.classList.add("in"))); shown = next;
  }
  async function load() {
    if (cfg.demo) { cards = DEMO; return; }
    if (!cfg.token) return;
    try {
      const r = await fetch("/api/streamcard/data?token=" + encodeURIComponent(cfg.token), { cache: "no-store" });
      if (r.ok) { const d = await r.json(); cards = Array.isArray(d.cards) ? d.cards : []; }
      else if (r.status === 404) cards = [];
    } catch { /* keep what we have */ }
  }
  (async () => { await load(); idx = -1; show(); setInterval(show, cfg.hold * 1000); setInterval(load, 45_000); })();
})();
