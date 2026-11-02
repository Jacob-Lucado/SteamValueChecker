(() => {
  const $ = id => document.getElementById(id);
  const fg = $('fg'), head = $('fgHead'), menu = $('fgMenu'), exp = $('fgExport');
  const status = $('fgStatus'), count = $('fgCount');
  const sub = $('fgSub'), files = $('fgFiles');
  const setSub = o => { sub.classList.toggle('open', o); files.setAttribute('aria-expanded', o); files.textContent = o ? 'Save as file ▴' : 'Save as file ▾'; };
  const setMenu = o => { if (!o) setSub(false); menu.classList.toggle('open', o); exp.setAttribute('aria-expanded', o); };

  head.addEventListener('click', () => {
    const closed = fg.classList.toggle('closed');
    head.setAttribute('aria-expanded', !closed);
    if (closed) setMenu(false);
  });
  exp.addEventListener('click', () => setMenu(!menu.classList.contains('open')));
  menu.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b === files) { setSub(!sub.classList.contains('open')); return; }
    setMenu(false);
    status.textContent = b.id === 'fgSend' ? 'Status: Demo only, install the extension and paste your /library grabber code' : (b.textContent.includes('Queue') ? 'Status: Demo only, the real one queues your keys for Steam' : 'Status: Demo only, install the extension to export');
  });
  $('fgReveal').addEventListener('click', () => {
    status.textContent = 'Status: Ready'; count.textContent = 'Keys Revealed: 3 (demo)';
  });
  $('fgRedeem').addEventListener('click', () => {
    status.textContent = 'Status: Demo only, nothing is redeemed here';
  });
  document.addEventListener('click', e => { if (!fg.contains(e.target)) setMenu(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') setMenu(false); });

  // Demo tabs: the Fanatical panel and the Steam batch redeem panel.
  const panes = { fanatical: $('demoFanatical'), steam: $('demoSteam') };
  document.querySelectorAll('.demo-tabs button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.demo-tabs button').forEach(x => x.setAttribute('aria-selected', x === b));
    for (const k in panes) panes[k].hidden = k !== b.dataset.demo;
    document.documentElement.dataset.theme = b.dataset.demo === 'steam' ? 'steam' : '';
  }));

  // Steam demo: a pretend redeem with made-up keys. Nothing is sent anywhere.
  const sg = $('sg'), sgBox = $('sgBox'), sgCount = $('sgCount'), sgList = $('sgList'), sgSum = $('sgSum'), sgProg = $('sgProg'), sgGo = $('sgGo'), sgBanner = $('sgBanner');
  const KEY = /[A-Z0-9]{5}(?:-[A-Z0-9]{5}){2}/g;
  const toggle = o => { sg.classList.toggle('closed', !o); $('sgBar').setAttribute('aria-expanded', o); };
  $('sgBar').addEventListener('click', () => toggle(true));
  $('sgHead').addEventListener('click', () => toggle(false));
  const keys = () => [...new Set((sgBox.value.toUpperCase().match(KEY) || []))];
  sgBox.addEventListener('input', () => { const n = keys().length; sgCount.textContent = n ? n + ' key' + (n === 1 ? '' : 's') + ' found' : ''; });
  const SAMPLE = 'K7M2Q-9XW4D-LT83B\nH5R6N-2PC8Z-VY4JA\nF3G9S-W7E1M-QD62X\nB8T4K-5NH3C-RZ9UP\nY2L6V-D4A8J-X7S5E';
  const fill = () => { sgBox.value = SAMPLE; sgBox.dispatchEvent(new Event('input')); };
  $('sgQueue').addEventListener('click', () => { fill(); sgBanner.className = 'sg-banner info'; sgBanner.textContent = 'Loaded 5 unredeemed keys from your Fanatical orders (pretend ones, of course).'; });
  $('sgFile').addEventListener('click', () => { fill(); sgBanner.className = 'sg-banner info'; sgBanner.textContent = 'The real button opens a .txt file from your computer. Here it just fills in a few sample keys.'; });
  const OUTCOME = ['redeemed', 'owned', 'redeemed', 'used', 'redeemed', 'invalid'];
  let running = false, stopNow = false, results = [];
  $('sgStop').addEventListener('click', () => { stopNow = true; });
  $('sgReport').addEventListener('click', () => {
    const csv = 'key,result\n' + results.map(r => r.join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'steam_redeem_demo.csv'; a.click(); URL.revokeObjectURL(a.href);
  });
  sgGo.addEventListener('click', async () => {
    if (running) return;
    const list = keys();
    if (!list.length) { sgBanner.className = 'sg-banner info'; sgBanner.textContent = 'Paste a few keys first, or tap Load keys from Fanatical. Anything that looks like AAAAA-BBBBB-CCCCC works here.'; return; }
    running = true; stopNow = false; results = []; sgGo.hidden = true; $('sgStop').hidden = false; $('sgReport').hidden = true; sgProg.style.width = '0'; sgList.hidden = false; sgList.textContent = ''; sgSum.hidden = true;
    sgBanner.className = 'sg-banner'; sgBanner.textContent = 'Just a demo, so nothing goes to Steam. The real one takes about 3 seconds per key.';
    const tally = {};
    for (let i = 0; i < list.length; i++) {
      await new Promise(r => setTimeout(r, 450));
      if (stopNow) break;
      let st = OUTCOME[i % OUTCOME.length]; if (st === 'owned' && $('sgSkip').checked) st = 'skipped'; results.push([list[i], st]); tally[st] = (tally[st] || 0) + 1;
      const row = document.createElement('div'), code = document.createElement('code'), chip = document.createElement('span');
      code.textContent = list[i]; chip.className = 'sg-chip ' + st; chip.textContent = st;
      row.append(code, chip); sgList.append(row);
      sgProg.style.width = Math.round((i + 1) / list.length * 100) + '%';
    }
    sgSum.hidden = false;
    sgSum.textContent = (stopNow ? 'Stopped. ' : '') + ['redeemed', 'owned', 'used', 'invalid', 'skipped'].map(k => (tally[k] || 0) + ' ' + k).join(', ') + '. (Made-up results, just for show.)';
    running = false; sgGo.hidden = false; $('sgStop').hidden = true; $('sgReport').hidden = false;
  });
})();

// Visitor counter: totals only. A browser counts as a new visitor once (remembered in this browser), no cookies, no addresses stored.
// "Viewing now" uses a random id kept for this tab only (cleared when the tab closes); the server forgets it 75 seconds after the last ping.
document.addEventListener('DOMContentLoaded', () => {
  const out = document.getElementById('visits');
  if (!out) return;
  const BASE = '/api/visits/fanaticalgrabber';
  const rnd = new Uint8Array(12); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(rnd) : rnd.forEach((_, i) => { rnd[i] = Math.random() * 256; });
  let id = Array.from(rnd, b => (b % 36).toString(36)).join('');
  // Keep the same id across refreshes of this tab so reloading doesn't count as another viewer.
  try { const k = sessionStorage.getItem('fg_tab'); if (k && /^[a-z0-9]{12}$/.test(k)) id = k; else sessionStorage.setItem('fg_tab', id); } catch (e) { /* storage blocked */ }
  let isNew = false;
  try { isNew = !localStorage.getItem('fg_visited'); } catch (e) { /* storage blocked: count as a view only */ }
  let last = null;
  const show = d => {
    if (!d || typeof d.visitors !== 'number') return;
    last = d;
    const n = v => Number(v).toLocaleString();
    out.textContent = '';
    if (typeof d.online === 'number') {
      const dot = document.createElement('span'); dot.textContent = '● '; dot.className = 'visit-dot'; dot.setAttribute('aria-hidden', 'true');
      out.append(dot, n(Math.max(1, d.online)) + ' viewing now · ');
    }
    out.append(n(d.visitors) + ' visitors · ' + n(d.views) + ' page views');
    out.hidden = false;
  };
  fetch(BASE + '?id=' + id + (isNew ? '&new=1' : ''), { method: 'POST', mode: 'cors', keepalive: true })
    .then(r => (r.ok ? r.json() : null))
    .then(d => { show(d); if (d && isNew) { try { localStorage.setItem('fg_visited', '1'); } catch (e) { /* ignore */ } } })
    .catch(() => fetch(BASE).then(r => r.json()).then(show).catch(() => {}));
  // Heartbeat while the tab is visible, so "viewing now" is people actually looking at the page.
  const beat = () => {
    if (document.hidden || !last) return;
    fetch(BASE + '/ping?id=' + id, { method: 'POST', mode: 'cors' }).then(r => (r.ok ? r.json() : null)).then(show).catch(() => {});
  };
  setInterval(beat, 30000);
  document.addEventListener('visibilitychange', beat);
});
