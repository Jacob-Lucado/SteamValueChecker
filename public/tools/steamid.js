(() => {
  const $ = id => document.getElementById(id);
  const form = $("sid-form"), input = $("sid-in"), out = $("sid-out"), msg = $("sid-msg");
  const BASE = 76561197960265728n;
  const forms = id64 => { const n = BigInt(id64) - BASE; return [["SteamID64", id64], ["SteamID", `STEAM_0:${n % 2n}:${n / 2n}`], ["SteamID3", `[U:1:${n}]`], ["Profile link", `https://steamcommunity.com/profiles/${id64}`]]; };
  // Anything people paste in: 64-bit id, STEAM_0:x:y, [U:1:n], a profile link or a custom name.
  function local(s) {
    s = s.trim();
    let m;
    if (/^7656119\d{10}$/.test(s)) return s;
    if ((m = /^STEAM_[0-5]:([01]):(\d{1,10})$/i.exec(s))) return String(BASE + BigInt(m[2]) * 2n + BigInt(m[1]));
    if ((m = /^\[U:1:(\d{1,10})\]$/i.exec(s))) return String(BASE + BigInt(m[1]));
    if ((m = /steamcommunity\.com\/profiles\/(7656119\d{10})/i.exec(s))) return m[1];
    return null;
  }
  function show(id64, card) {
    out.replaceChildren();
    if (card && card.name) { const h = document.createElement("div"); h.className = "sid-card"; if (card.avatar) { const i = document.createElement("img"); i.src = card.avatar; i.alt = ""; i.width = 48; i.height = 48; h.append(i); } const t = document.createElement("b"); t.textContent = card.name; h.append(t); out.append(h); }
    for (const [label, value] of forms(id64)) {
      const row = document.createElement("div"); row.className = "ts-row";
      const text = document.createElement("div"); text.className = "ts-text"; const b = document.createElement("b"); b.textContent = label; text.append(b);
      const c = document.createElement("code"); c.textContent = value;
      const btn = document.createElement("button"); btn.type = "button"; btn.textContent = "Copy";
      btn.onclick = async () => { try { await navigator.clipboard.writeText(value); btn.textContent = "Copied"; } catch { btn.textContent = "Select and copy"; } setTimeout(() => (btn.textContent = "Copy"), 1400); };
      row.append(text, c, btn); out.append(row);
    }
  }
  form.addEventListener("submit", async e => {
    e.preventDefault(); msg.textContent = ""; out.replaceChildren();
    const q = input.value.trim();
    if (!q) return;
    const id = local(q);
    if (id) { show(id, null); return; }
    msg.textContent = "Looking it up…";
    try {
      const r = await fetch("/api/steamid?q=" + encodeURIComponent(q));
      const j = await r.json();
      if (!r.ok) { msg.textContent = j.error || "Couldn't find that profile."; return; }
      msg.textContent = ""; show(j.steamid, j.card);
    } catch { msg.textContent = "Couldn't reach the server. Try again."; }
  });
})();
