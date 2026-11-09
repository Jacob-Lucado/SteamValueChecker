// Counts down on the bundle page and lets the person stay instead. Without scripts, a meta refresh in the page's noscript block does the redirect instead.
(() => {
  const box = document.getElementById("go"); if (!box) return;
  const text = document.getElementById("goText"), stay = document.getElementById("stay");
  const store = (text.textContent.match(/Taking you to (.+?) in/) || [])[1] || "the store";
  let left = Number(box.dataset.seconds) || 6, timer = 0;
  const tick = () => {
    left -= 1;
    if (left <= 0) { clearInterval(timer); text.textContent = "Opening " + store + "…"; location.href = box.dataset.url; return; }
    text.textContent = "Taking you to " + store + " in " + left + (left === 1 ? " second…" : " seconds…");
  };
  timer = setInterval(tick, 1000);
  stay.addEventListener("click", () => {
    clearInterval(timer);
    box.classList.add("paused");
    text.textContent = "Paused. Take your time, the bundle is one tap away.";
    stay.remove();
  });
})();
