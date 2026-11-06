(() => {
  const $ = id => document.getElementById(id);
  const date = $("rf-date"), hours = $("rf-hours"), pre = $("rf-pre"), out = $("rf-out");
  const today = new Date(); date.max = today.toISOString().slice(0, 10); date.value = today.toISOString().slice(0, 10);
  function say(cls, title, lines) {
    out.className = "rf-out " + cls; out.replaceChildren();
    const h = document.createElement("h3"); h.textContent = title; out.append(h);
    for (const l of lines) { const p = document.createElement("p"); p.textContent = l; out.append(p); }
  }
  function check() {
    if (pre.checked) return say("ok", "Likely refundable", ["Pre-orders can be refunded any time before the game is released, whatever your playtime. After release the normal 14-day, 2-hour rule applies."]);
    if (!date.value) return say("", "Pick the purchase date", []);
    const days = Math.floor((Date.now() - new Date(date.value + "T00:00:00").getTime()) / 864e5);
    const h = Number(hours.value || 0);
    const left = 14 - days, hLeft = Math.max(0, 2 - h);
    const dayOk = days <= 14, hourOk = h < 2;
    if (dayOk && hourOk) return say("ok", "Looks eligible for a refund", [`You bought it ${days <= 0 ? "today" : days + " day" + (days === 1 ? "" : "s") + " ago"}, so about ${Math.max(0, left)} day${left === 1 ? "" : "s"} are left, and you've used ${h} of your 2 hours (${hLeft.toFixed(1)} h to spare).`, "Open Steam Support, choose the game under Purchases, and pick “I would like a refund”."]);
    const why = [];
    if (!dayOk) why.push(`It was bought ${days} days ago, past the 14-day window.`);
    if (!hourOk) why.push(`${h} hours is over the 2-hour limit.`);
    say("no", "Probably not eligible", [...why, "Steam can still look at special cases, like a game that wouldn't run or a mistake on the purchase, so it can be worth asking support anyway."]);
  }
  for (const e of [date, hours, pre]) e.addEventListener("input", check);
  check();
})();
