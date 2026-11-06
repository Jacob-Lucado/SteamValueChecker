(() => {
  const rows = document.querySelectorAll(".sales time");
  const draw = () => {
    const now = Date.now();
    for (const t of rows) {
      const start = Date.parse(t.dateTime), end = Date.parse(t.dataset.end);
      if (now >= end) { t.textContent = "Ended"; continue; }
      if (now >= start) { t.textContent = "On now"; continue; }
      const s = Math.floor((start - now) / 1000), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
      t.textContent = d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`;
    }
  };
  draw(); setInterval(draw, 30000);
})();
