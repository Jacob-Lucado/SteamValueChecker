(() => {
  const $ = s => document.querySelector(s);
  const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h !== undefined) e.textContent = h; return e; };
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Links to the invite and support server come from the site's own config.
  fetch("/api/config").then(r => r.json()).then(c => {
    if (c.inviteUrl) { $("#invite").href = c.inviteUrl; $("#invite2").href = c.inviteUrl; }
    if (c.supportUrl) $("#support").href = c.supportUrl; else $("#support").remove();
  }).catch(() => { $("#support").remove(); });

  // The chat: a few real-looking exchanges, typed out.
  const SCENES = [
    { tab: "Buy or wait", ask: "Hey AI is Wanderstop worth buying right now?", say: "It's at its **all-time low** of $11.99 and it's hit that price five times this year, so waiting won't beat it. **Buy now.** Steam reviews are Very Positive.", img: "/img/ai/history.png", btns: ["Buy at Steam", "Add to wishlist"] },
    { tab: "X vs Y", ask: "Hey AI Hades II or Silksong?", say: "**Silksong** is $10 cheaper right now, **Hades II** is the better reviewed by a few points. Either is a safe pick.", img: "/img/ai/compare.png", btns: ["Add Hades II", "Add Silksong"] },
    { tab: "Play plan", ask: "Hey AI I have 6 hours this weekend, what should I play?", say: "Finish what you started first. I picked three from your library.", img: "/img/ai/plan.png", btns: ["Open my library"] },
    { tab: "My stats", ask: "Hey AI what are my rarest achievements?", say: "You've unlocked **5,329** across 297 games. These four are the rarest.", img: "/img/ai/achievements.png", btns: ["Open my dashboard"] },
    { tab: "Guides", ask: "how do I get Steam verified?", say: "Here you go. It takes about a minute.", img: "/img/ai/guide.png", btns: ["Verify with Steam", "More guides"], bot: true }
  ];
  const body = $("#chatBody"), typing = $("#typing"), tabs = $("#chatTabs");
  let scene = 0, run = 0;
  const md = t => t.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  const sleep = ms => new Promise(r => setTimeout(r, reduce ? 0 : ms));
  SCENES.forEach((s, i) => { const b = el("button", "", s.tab); b.type = "button"; b.setAttribute("role", "tab"); b.onclick = () => { scene = i; play(); }; tabs.append(b); });
  const mark = () => [...tabs.children].forEach((b, i) => b.setAttribute("aria-selected", i === scene));
  const msg = (name, avatar, html, extra) => {
    const m = el("div", "msg"), a = el("div", "av" + (avatar ? " bot" : ""));
    if (avatar) { const i = el("img"); i.src = "/logo.png"; i.alt = ""; a.append(i); } else a.textContent = name[0];
    const r = el("div"), w = el("div", "who"); w.innerHTML = `${name}${avatar ? '<span class="app">APP</span>' : ""}<small>Today</small>`;
    const s = el("div", "say"); s.innerHTML = html; r.append(w, s); if (extra) r.append(extra); m.append(a, r); body.append(m); return m;
  };
  async function play() {
    const me = ++run; mark(); body.replaceChildren(); typing.textContent = "";
    const s = SCENES[scene];
    await sleep(500); if (me !== run) return;
    if (!s.bot) { for (const ch of s.ask) { if (me !== run) return; typing.textContent += ch; await sleep(30); } await sleep(350); typing.textContent = ""; }
    msg("Sam", false, s.ask.replace(/^Hey AI/, '<span class="m">Hey AI</span>'));
    const t = msg("Steam Value Checker", true, '<span class="think"><i></i><i></i><i></i></span>');
    await sleep(1300); if (me !== run) return;
    t.remove();
    const emb = el("div", "emb"), img = el("img"); img.src = s.img; img.alt = ""; emb.append(img);
    const row = el("div", "row"); s.btns.forEach((b, i) => row.append(el("span", "dbtn" + (i ? " link" : ""), b))); emb.append(row);
    msg("Steam Value Checker", true, md(s.say), emb);
    await sleep(5200); if (me !== run) return;
    scene = (scene + 1) % SCENES.length; play();
  }
  play();

  // Marquee.
  const WORDS = ["Prices", "Buy or wait", "Price graphs", "Compare games", "Library value", "Rare achievements", "Play plans", "Play together", "Free games", "Sale plans", "Wishlist alerts", "Step-by-step guides", "Group posts", "Server events", "Setup checks", "Remembers what you like"];
  $("#track").append(...[0, 1].flatMap(() => WORDS.map(w => el("span", "", w))));

  // Everything it can do.
  const HUES = { Prices: "#fbbf24", You: "#4ade80", Wishlist: "#22d3ee", Community: "#f472b6", Help: "#a5b4fc" };
  const POWERS = [
    ["Prices", "Check prices", "Cheapest store right now across every shop, with the discount and the all-time low."],
    ["Prices", "Buy or wait", "A verdict from a year of prices, upcoming Steam sales and reviews, with a graph."],
    ["Prices", "Compare two games", "Price, reviews, genre and year side by side in one picture."],
    ["Prices", "Game facts", "What a game is, genres, release date, review score and its picture."],
    ["Prices", "Other countries", "What a game costs in other regions, converted for you."],
    ["Prices", "Bundles", "Checks a bundle against what its games cost on their own."],
    ["Prices", "Free games", "What's free right now on Steam, Epic, GOG and others."],
    ["Prices", "Sale plan", "The next big sale and what on your list is worth waiting for or buying now."],
    ["You", "Library worth", "What your library costs today, what you paid, what you saved."],
    ["You", "Steam stats", "Hours played, most played, the games you never touched."],
    ["You", "Spending", "What you've spent, by month, and the games bought but never played."],
    ["You", "Rare achievements", "Your rarest unlocks across your whole account, as a picture."],
    ["You", "Badges and challenge", "Your badges, your monthly goal and your streak."],
    ["You", "What to play next", "A pick from your library and backlog, with the art."],
    ["You", "Backlog plan", "Games to fit the hours you have, filtered by genre or tag."],
    ["You", "Deals for you", "Discounts ranked by your taste and your wishlist."],
    ["Wishlist", "Add and remove", "Put a game on your wishlist or take it off, just by asking."],
    ["Wishlist", "Price targets", "\"Tell me when it's under $10\" or at 50% off. Done."],
    ["Wishlist", "Star a game", "Make a game a priority so its alerts always come through."],
    ["Wishlist", "Library and status", "Add what you own, mark it playing, finished or dropped."],
    ["Wishlist", "Goals", "Set a monthly finish goal and a yearly hours goal."],
    ["Wishlist", "Your settings", "Pause alerts, change your region, see how things are set."],
    ["Wishlist", "Game news", "Patch notes and news for the games you own and watch."],
    ["Wishlist", "What's coming", "Release dates, sales and events on your calendar."],
    ["Community", "Play together", "Co-op and multiplayer games you and a friend both own."],
    ["Community", "Looking for group", "Post a group call with a time and slots, and a Join button."],
    ["Community", "Server events", "Managers can add a calendar event just by asking."],
    ["Community", "Leaderboard", "Who in the server has saved the most, for people who opted in."],
    ["Community", "Friends", "Friend birthdays and what's on sale from their wishlists."],
    ["Community", "Levels and activity", "Your level, rank and what's happening in the server."],
    ["Help", "Step-by-step guides", "Pictures with the exact commands for any how-to."],
    ["Help", "Your server's guides", "Rules, roles and channels, written by your managers."],
    ["Help", "Setup checklist", "What's configured, what isn't, and the command for each."],
    ["Help", "Remembers you", "A few short notes about what you like. Forget any time."],
    ["Help", "What can you do?", "Ask it and it shows this list as a picture."]
  ];
  const cats = ["All", ...Object.keys(HUES)];
  const NAMES = { Prices: "Prices and deals", You: "Your account", Wishlist: "Wishlist and goals", Community: "Friends and servers", Help: "Help and setup", All: "All" };
  const fl = $("#filters"), cards = $("#cards");
  function draw(cat) {
    [...fl.children].forEach(b => b.setAttribute("aria-selected", b.dataset.c === cat));
    cards.replaceChildren(...POWERS.filter(p => cat === "All" || p[0] === cat).map(([c, t, d], i) => {
      const k = el("div", "card"); k.style.setProperty("--hue", HUES[c]); k.style.animationDelay = i * 20 + "ms";
      k.append(el("em", "", NAMES[c]), el("b", "", t), el("span", "", d)); return k;
    }));
  }
  cats.forEach(c => { const b = el("button", "", NAMES[c]); b.type = "button"; b.dataset.c = c; b.setAttribute("role", "tab"); b.onclick = () => draw(c); fl.append(b); });
  draw("All");

  // Ask-once examples.
  ["Add Hades to my wishlist", "Tell me when Celeste is under $5", "Mark Disco Elysium as playing", "Set my goal to 3 games a month", "Pause my alerts for a week", "Post a co-op night at 9", "Remember I like roguelikes", "Forget everything"]
    .forEach((t, i) => { const s = el("span", "", t); s.style.animationDelay = i * 70 + "ms"; $("#chips").append(s); });

  // Fade things in as they scroll into view.
  const io = "IntersectionObserver" in window ? new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: 0, rootMargin: "0px 0px -6% 0px" }) : null;
  const rev = [...document.querySelectorAll(".show,.glass,.faq details,.summon h2,.powers h2")];
  if (io) { rev.forEach(n => { n.classList.add("reveal"); io.observe(n); });
    // If the observer is slow to report, anything already on screen still appears.
    setTimeout(() => rev.forEach(n => { if (n.getBoundingClientRect().top < innerHeight) n.classList.add("in"); }), 900); }
})();
