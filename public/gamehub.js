(() => {
  const $ = s => document.querySelector(s);
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- pixel lettering: a small 5x7 font drawn on a canvas, so the page needs no font files ----
  const G = {
    A: "01110 10001 10001 11111 10001 10001 10001", B: "11110 10001 10001 11110 10001 10001 11110", C: "01110 10001 10000 10000 10000 10001 01110",
    D: "11110 10001 10001 10001 10001 10001 11110", E: "11111 10000 10000 11110 10000 10000 11111", F: "11111 10000 10000 11110 10000 10000 10000",
    G: "01110 10001 10000 10111 10001 10001 01111", H: "10001 10001 10001 11111 10001 10001 10001", I: "01110 00100 00100 00100 00100 00100 01110",
    J: "00111 00010 00010 00010 00010 10010 01100", K: "10001 10010 10100 11000 10100 10010 10001", L: "10000 10000 10000 10000 10000 10000 11111",
    M: "10001 11011 10101 10101 10001 10001 10001", N: "10001 11001 10101 10011 10001 10001 10001", O: "01110 10001 10001 10001 10001 10001 01110",
    P: "11110 10001 10001 11110 10000 10000 10000", Q: "01110 10001 10001 10001 10101 10010 01101", R: "11110 10001 10001 11110 10100 10010 10001",
    S: "01111 10000 10000 01110 00001 00001 11110", T: "11111 00100 00100 00100 00100 00100 00100", U: "10001 10001 10001 10001 10001 10001 01110",
    V: "10001 10001 10001 10001 10001 01010 00100", W: "10001 10001 10001 10101 10101 11011 10001", X: "10001 10001 01010 00100 01010 10001 10001",
    Y: "10001 10001 01010 00100 00100 00100 00100", Z: "11111 00001 00010 00100 01000 10000 11111",
    0: "01110 10001 10011 10101 11001 10001 01110", 1: "00100 01100 00100 00100 00100 00100 01110", 2: "01110 10001 00001 00010 00100 01000 11111",
    3: "11110 00001 00001 01110 00001 00001 11110", 4: "00010 00110 01010 10010 11111 00010 00010", 5: "11111 10000 11110 00001 00001 10001 01110",
    6: "00110 01000 10000 11110 10001 10001 01110", 7: "11111 00001 00010 00100 01000 01000 01000", 8: "01110 10001 10001 01110 10001 10001 01110",
    9: "01110 10001 10001 01111 00001 00010 01100", " ": "00000 00000 00000 00000 00000 00000 00000", "/": "00001 00001 00010 00100 01000 10000 10000",
    "-": "00000 00000 00000 11111 00000 00000 00000", "+": "00000 00100 00100 11111 00100 00100 00000", ":": "00000 00100 00100 00000 00100 00100 00000"
  };
  function paint(el, text) {
    const s = Number(el.dataset.s) || 4, chars = [...String(text).toUpperCase()].filter(c => G[c]);
    const c = el.querySelector("canvas") || el.appendChild(document.createElement("canvas"));
    c.width = Math.max(1, chars.length * 6 - 1); c.height = 7;
    c.style.setProperty("width", c.width * s + "px"); c.style.setProperty("height", 7 * s + "px");
    const x = c.getContext("2d"); x.clearRect(0, 0, c.width, 7); x.fillStyle = getComputedStyle(el).color;
    chars.forEach((ch, i) => G[ch].split(" ").forEach((row, y) => [...row].forEach((b, k) => { if (b === "1") x.fillRect(i * 6 + k, y, 1, 1); })));
    el.dataset.text = text;
  }
  const px = () => document.querySelectorAll(".px[data-px]").forEach(e => paint(e, e.dataset.px));

  // ---- the animations: row on the sheet, frame count, and speed ----
  const ANIMS = [
    ["idle", "Idle", 4, 5], ["walk", "Walk", 6, 8], ["run", "Run", 6, 12], ["jump", "Jump", 4, 7], ["fall", "Fall", 3, 6],
    ["zap", "Zap", 5, 10], ["hurt", "Hurt", 3, 6], ["dead", "Dead", 5, 6], ["cheer", "Cheer", 4, 6]
  ];
  const FR = 128; // one frame on the sheet, in pixels
  let cur = 0, frame = 0, playing = !calm, timer = null, flip = false;

  const spr = $("#spr"), stage = $("#stage"), strip = $("#strip");
  const size = () => Math.max(96, Math.min(300, Math.floor(Math.min(stage.clientWidth - 30, stage.clientHeight - 40) / 32) * 32));
  function draw() {
    const [, name, n] = ANIMS[cur], z = size() / FR;
    spr.style.setProperty("width", FR * z + "px"); spr.style.setProperty("height", FR * z + "px");
    spr.style.setProperty("background-size", 768 * z + "px " + 1152 * z + "px");
    spr.style.setProperty("background-position", `${-frame * FR * z}px ${-cur * FR * z}px`);
    spr.classList.toggle("flip", flip);
    $("#rd-frame").textContent = `FRAME ${frame + 1} / ${n}`;
    [...strip.children].forEach((b, i) => b.classList.toggle("on", i === frame));
    spr.setAttribute("aria-label", `Byte, ${name.toLowerCase()} animation, frame ${frame + 1} of ${n}`);
  }
  function tick() {
    clearTimeout(timer);
    if (!playing) return;
    timer = setTimeout(() => { frame = (frame + 1) % ANIMS[cur][2]; draw(); tick(); }, 1000 / ANIMS[cur][3]);
  }
  function pick(i) {
    cur = i; frame = 0;
    document.querySelectorAll(".anim").forEach((b, k) => b.setAttribute("aria-selected", k === i));
    document.querySelectorAll(".row-btn").forEach((b, k) => b.classList.toggle("on", k === i));
    const name = $("#rd-name"); paint(name, ANIMS[i][0].toUpperCase());
    strip.replaceChildren(...Array.from({ length: ANIMS[i][2] }, (_, f) => {
      const b = document.createElement("button"); b.type = "button"; b.className = "frame"; b.setAttribute("aria-label", `Frame ${f + 1}`);
      b.style.setProperty("background-position", `${-f * 72}px ${-i * 72}px`);
      b.addEventListener("click", () => { playing = false; sync(); frame = f; draw(); tick(); });
      return b;
    }));
    draw(); tick();
  }
  function sync() { const b = $("#b-play"); b.textContent = playing ? "Pause" : "Play"; b.setAttribute("aria-pressed", String(playing)); }

  // tabs
  const tabs = $("#anims");
  ANIMS.forEach(([key, name], i) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "anim"; b.setAttribute("role", "tab"); b.setAttribute("aria-label", name);
    const t = document.createElement("span"); t.className = "thumb"; t.style.setProperty("background-position", `0px ${-i * 64}px`);
    const l = document.createElement("span"); l.className = "px"; l.dataset.px = key.toUpperCase(); l.dataset.s = "2"; l.setAttribute("aria-hidden", "true");
    b.append(t, l); b.addEventListener("click", () => pick(i)); tabs.append(b);
  });
  // row labels beside the full sheet
  const rows = $("#sheet-rows");
  ANIMS.forEach(([key, name], i) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "row-btn"; b.setAttribute("aria-label", `Play ${name}`);
    const l = document.createElement("span"); l.className = "px"; l.dataset.px = key.toUpperCase(); l.dataset.s = "2"; l.setAttribute("aria-hidden", "true");
    b.append(l); b.addEventListener("click", () => { pick(i); $("#play").scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" }); }); rows.append(b);
  });

  $("#b-play").addEventListener("click", () => { playing = !playing; sync(); tick(); });
  $("#b-flip").addEventListener("click", e => { flip = !flip; e.currentTarget.textContent = flip ? "Face right" : "Face left"; e.currentTarget.setAttribute("aria-pressed", String(flip)); draw(); });
  $("#b-step").addEventListener("click", () => { playing = false; sync(); frame = (frame + 1) % ANIMS[cur][2]; draw(); });
  new ResizeObserver(draw).observe(stage);

  // ---- loot ----
  const LOOT = [["Coin", "coin"], ["Freebie", "freebie"], ["Deal tag", "deal-tag"], ["Game key", "game-key"], ["Heart", "heart"], ["Controller", "controller"], ["Trophy", "trophy"], ["XP gem", "xp-gem"]];
  const lootRow = $("#loot-row"); let got = 0;
  LOOT.forEach(([name, file]) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "item";
    const ico = document.createElement("img"); ico.className = "ico"; ico.src = `/img/gamehub/loot/${file}.png`; ico.alt = ""; ico.width = 72; ico.height = 72;
    b.append(ico, document.createTextNode(name));
    b.addEventListener("click", () => {
      got++; b.classList.remove("got"); void b.offsetWidth; b.classList.add("got");
      $("#pickup").textContent = `Picked up: ${name}. That's ${got} so far.`;
      pick(8); if (!calm) { playing = true; sync(); tick(); }
    });
    lootRow.append(b);
  });

  // ---- palette ----
  document.querySelectorAll(".sw").forEach(b => {
    b.style.setProperty("--c", b.dataset.hex);
    b.addEventListener("click", async () => {
      const note = $("#swnote");
      try { await navigator.clipboard.writeText(b.dataset.hex.toUpperCase()); note.textContent = `Copied ${b.dataset.hex.toUpperCase()}.`; }
      catch { note.textContent = `That one is ${b.dataset.hex.toUpperCase()}.`; }
    });
  });

  // small always-looping Byte figures (the big one up top, the one in the sheet header)
  document.querySelectorAll(".mini").forEach(el => {
    const row = Number(el.dataset.row), n = Number(el.dataset.n), fps = Number(el.dataset.fps), want = Number(el.dataset.size);
    let f = 0;
    const show = () => {
      const w = Math.min(want, el.parentElement.clientWidth || want), z = w / FR;
      el.style.setProperty("width", w + "px"); el.style.setProperty("height", w + "px");
      el.style.setProperty("background-size", 768 * z + "px " + 1152 * z + "px");
      el.style.setProperty("background-position", `${-f * FR * z}px ${-row * FR * z}px`);
    };
    show(); addEventListener("resize", show);
    if (!calm) setInterval(() => { f = (f + 1) % n; show(); }, 1000 / fps);
  });

  px(); pick(0); sync();
})();
