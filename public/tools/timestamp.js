(() => {
  const $ = id => document.getElementById(id);
  const when = $("when"), zone = $("zone"), out = $("styles"), unixBox = $("unix");
  const zones = (Intl.supportedValuesOf ? Intl.supportedValuesOf("timeZone") : ["UTC"]);
  const mine = Intl.DateTimeFormat().resolvedOptions().timeZone;
  for (const z of [...new Set([mine, "UTC", ...zones])]) { const o = document.createElement("option"); o.value = z; o.textContent = z === mine ? `${z} (yours)` : z; zone.append(o); }
  zone.value = mine;
  const pad = n => String(n).padStart(2, "0");
  const d0 = new Date(Date.now() + 3600e3);
  when.value = `${d0.getFullYear()}-${pad(d0.getMonth() + 1)}-${pad(d0.getDate())}T${pad(d0.getHours())}:00`;

  // Turn "this wall-clock time in that time zone" into a real moment.
  const offsetAt = (tz, ms) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
  };
  function toUnix() {
    const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(when.value);
    if (!m) return null;
    const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    let ms = guess - offsetAt(zone.value, guess);
    ms = guess - offsetAt(zone.value, ms);
    return Math.floor(ms / 1000);
  }
  const STYLES = [["t", "Short time", { timeStyle: "short" }], ["T", "Long time", { timeStyle: "medium" }], ["d", "Short date", { dateStyle: "short" }], ["D", "Long date", { dateStyle: "long" }], ["f", "Short date and time", { dateStyle: "long", timeStyle: "short" }], ["F", "Long date and time", { dateStyle: "full", timeStyle: "short" }], ["R", "Relative", null]];
  const rel = s => { const d = s - Date.now() / 1000, a = Math.abs(d), f = new Intl.RelativeTimeFormat("en", { numeric: "always" }); const u = a < 60 ? ["second", 1] : a < 3600 ? ["minute", 60] : a < 86400 ? ["hour", 3600] : a < 2592000 ? ["day", 86400] : a < 31536000 ? ["month", 2592000] : ["year", 31536000]; return f.format(Math.round(d / u[1]), u[0]); };
  function draw() {
    const s = toUnix();
    out.replaceChildren();
    if (s === null) { unixBox.textContent = "Pick a date and time"; return; }
    unixBox.textContent = String(s);
    for (const [k, label, opt] of STYLES) {
      const code = `<t:${s}:${k}>`, row = document.createElement("div"); row.className = "ts-row";
      const text = document.createElement("div"); text.className = "ts-text";
      const b = document.createElement("b"); b.textContent = label;
      const prev = document.createElement("span"); prev.textContent = opt ? new Intl.DateTimeFormat(undefined, { ...opt, timeZone: mine }).format(new Date(s * 1000)) : rel(s);
      text.append(b, prev);
      const c = document.createElement("code"); c.textContent = code;
      const btn = document.createElement("button"); btn.type = "button"; btn.textContent = "Copy";
      btn.onclick = async () => { try { await navigator.clipboard.writeText(code); btn.textContent = "Copied"; } catch { btn.textContent = "Select and copy"; } setTimeout(() => (btn.textContent = "Copy"), 1400); };
      row.append(text, c, btn); out.append(row);
    }
  }
  when.addEventListener("input", draw); zone.addEventListener("change", draw);
  draw(); setInterval(() => { if (!document.hidden) draw(); }, 30000);
})();
