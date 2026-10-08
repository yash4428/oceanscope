/* The show. Runs inside the page on the virtual clock; every await is virtual time. */
(() => {
  const OS = window.OS, S = OS.Scene, U = OS.U;
  const ev = (window.__events = []);
  const T0 = () => window.__T0 || 0;
  const log = (type, data) => ev.push(Object.assign({ t: +(performance.now() - T0()).toFixed(1), type }, data || {}));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const q = (sel) => document.querySelector(sel);
  const ease = U.easeInOut;

  /* ---------- overlay: cursor, click ring, chapter lower-third, fade ---------- */
  const css = document.createElement('style');
  css.textContent = `
    #vcur{position:fixed;left:0;top:0;width:28px;height:28px;z-index:100000;pointer-events:none;opacity:0;transition:opacity .4s ease;filter:drop-shadow(0 3px 8px rgba(0,0,0,.6))}
    #vcur.on{opacity:1}
    #vcur svg{width:28px;height:28px;transform-origin:4px 3px;transition:transform .12s ease}
    #vcur.down svg{transform:scale(.84)}
    .vring{position:fixed;z-index:99999;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;border:2px solid #9FF3FB;box-shadow:0 0 18px rgba(63,208,224,.85),inset 0 0 10px rgba(63,208,224,.5);pointer-events:none;animation:vring .65s cubic-bezier(.16,1,.3,1) forwards}
    @keyframes vring{from{transform:scale(.25);opacity:1}to{transform:scale(1.7);opacity:0}}
    #vchap{position:fixed;z-index:99998;display:flex;align-items:center;gap:16px;padding:13px 22px 13px 16px;border-radius:14px;background:rgba(6,18,28,.8);border:1px solid rgba(120,210,230,.24);backdrop-filter:blur(12px);box-shadow:0 18px 44px -16px rgba(0,0,0,.85);opacity:0;transform:translateY(16px);transition:opacity .6s cubic-bezier(.16,1,.3,1),transform .8s cubic-bezier(.16,1,.3,1);pointer-events:none}
    #vchap.show{opacity:1;transform:none}
    #vchap .n{font:700 34px/1 "Barlow Semi Condensed",sans-serif;color:transparent;background:linear-gradient(135deg,#FFB347,#3FD0E0);-webkit-background-clip:text;background-clip:text}
    #vchap .bar{width:2px;align-self:stretch;background:linear-gradient(180deg,#FFB347,#3FD0E0);border-radius:2px;box-shadow:0 0 10px rgba(63,208,224,.7)}
    #vchap b{display:block;font:700 24px/1.05 "Barlow Semi Condensed",sans-serif;letter-spacing:.13em;text-transform:uppercase;color:#F4FAFC}
    #vchap small{display:block;font:500 15px "Barlow",sans-serif;color:#A9C3CF;margin-top:4px;letter-spacing:.01em}
    #vtags{position:fixed;z-index:99998;display:flex;gap:8px;pointer-events:none}
    #vtags span{display:inline-flex;align-items:center;gap:8px;padding:7px 13px 7px 10px;border-radius:999px;background:rgba(6,18,28,.72);border:1px solid rgba(120,210,230,.2);backdrop-filter:blur(10px);font:600 14px "Barlow",sans-serif;color:#DDEEF3;letter-spacing:.01em;opacity:0;transform:translateY(10px);transition:opacity .5s cubic-bezier(.16,1,.3,1),transform .6s cubic-bezier(.16,1,.3,1)}
    #vtags span i{width:7px;height:7px;border-radius:50%;background:#3FD0E0;box-shadow:0 0 10px #3FD0E0}
    #vtags span.show{opacity:1;transform:none}
    #vend{position:fixed;right:5%;bottom:14.5%;z-index:99998;display:flex;flex-direction:column;align-items:flex-end;gap:7px;pointer-events:none}
    #vend .h{font:600 15px "Barlow Semi Condensed",sans-serif;letter-spacing:.22em;text-transform:uppercase;color:#9FC4D1;margin-bottom:4px;opacity:0;transition:opacity .8s ease}
    #vend span{display:inline-flex;align-items:center;gap:11px;padding:9px 17px 9px 14px;border-radius:999px;background:rgba(6,18,28,.6);border:1px solid rgba(120,210,230,.22);backdrop-filter:blur(8px);font:600 19px "Barlow",sans-serif;color:#F2FAFC;opacity:0;transform:translateX(18px);transition:opacity .6s cubic-bezier(.16,1,.3,1),transform .7s cubic-bezier(.16,1,.3,1)}
    #vend span b{font:700 16px "Barlow Semi Condensed",sans-serif;color:transparent;background:linear-gradient(135deg,#FFB347,#3FD0E0);-webkit-background-clip:text;background-clip:text}
    #vend.show .h,#vend span.show{opacity:1;transform:none}
    #vfade{position:fixed;inset:0;background:#000;z-index:100001;pointer-events:none;opacity:1;transition:opacity 1.6s ease}
    #vfade.clear{opacity:0}
    #film-progress,#film-exit,#hint{display:none!important}
    *{caret-color:transparent}`;
  document.head.appendChild(css);
  const cur = document.createElement('div'); cur.id = 'vcur';
  cur.innerHTML = '<svg viewBox="0 0 28 28"><path d="M4 3 L4 22 L9 17.2 L12.6 25 L16 23.4 L12.5 15.8 L19.5 15.8 Z" fill="#F4FAFC" stroke="#06121C" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  document.body.appendChild(cur);
  const chap = document.createElement('div'); chap.id = 'vchap'; chap.innerHTML = '<span class="n"></span><span class="bar"></span><div><b></b><small></small></div>';
  document.body.appendChild(chap);
  const fade = document.createElement('div'); fade.id = 'vfade'; document.body.appendChild(fade);
  const tagsEl = document.createElement('div'); tagsEl.id = 'vtags'; document.body.appendChild(tagsEl);
  const endEl = document.createElement('div'); endEl.id = 'vend'; document.body.appendChild(endEl);

  let cx = 1980, cy = 1150;
  const place = () => { cur.style.transform = `translate(${cx - 4}px, ${cy - 3}px)`; };
  place();
  const moveTo = (x, y, ms) => new Promise((res) => {
    const x0 = cx, y0 = cy, dist = Math.hypot(x - x0, y - y0), dur = ms || Math.min(1100, 420 + dist * 0.45);
    /* slight arc like a real hand */
    const nx = -(y - y0) / (dist || 1), ny = (x - x0) / (dist || 1), bow = Math.min(60, dist * 0.08);
    U.tween(dur, (e) => { const b = Math.sin(Math.PI * e) * bow; cx = x0 + (x - x0) * e + nx * b; cy = y0 + (y - y0) * e + ny * b; place(); }, res, ease);
  });
  const center = (el, fx, fy) => { const r = el.getBoundingClientRect(); return [r.left + r.width * (fx === undefined ? 0.5 : fx), r.top + r.height * (fy === undefined ? 0.5 : fy)]; };
  const ring = () => { const r = document.createElement('div'); r.className = 'vring'; r.style.left = `${cx}px`; r.style.top = `${cy}px`; document.body.appendChild(r); setTimeout(() => r.remove(), 800); };
  const press = async () => { cur.classList.add('down'); ring(); log('click'); await wait(110); cur.classList.remove('down'); };
  const showCursor = (on) => cur.classList.toggle('on', on);

  const panel = () => q('#panel');
  async function reveal(el) {
    const p = panel(); if (!p || !p.contains(el)) return;
    const pr = p.getBoundingClientRect(), er = el.getBoundingClientRect();
    if (er.top > pr.top + 40 && er.bottom < pr.bottom - 40) return;
    const from = p.scrollTop, to = Math.max(0, from + (er.top - pr.top) - pr.height * 0.4);
    await new Promise((res) => U.tween(650, (e) => { p.scrollTop = from + (to - from) * e; }, res, ease));
  }
  async function clickEl(sel, opts) {
    const el = typeof sel === 'string' ? q(sel) : sel;
    if (!el) { log('missing', { sel: String(sel) }); return; }
    await reveal(el);
    const [x, y] = center(el, opts && opts.fx, opts && opts.fy);
    await moveTo(x, y);
    await wait(90); await press();
    el.click();
    await wait(opts && opts.after !== undefined ? opts.after : 250);
  }
  async function hoverEl(sel) { const el = q(sel); if (!el) return; await reveal(el); const [x, y] = center(el); await moveTo(x, y); }
  async function clickWorld(lon, lat, act) {
    const st = q('#stage').getBoundingClientRect();
    const p = S.screenPos(new THREE.Vector3(S.lonToX(lon), 0, S.latToZ(lat)));
    await moveTo(st.left + p.x, st.top + p.y, 950);
    await wait(120); await press(); act();
  }
  async function drag(sel, to, ms) {
    const el = q(sel); if (!el) { log('missing', { sel }); return; }
    await reveal(el);
    const r = el.getBoundingClientRect(), mn = +el.min, mx = +el.max;
    const xAt = (v) => r.left + 8 + (v - mn) / (mx - mn) * (r.width - 16), y = r.top + r.height / 2;
    const from = +el.value;
    await moveTo(xAt(from), y); cur.classList.add('down'); ring();
    await new Promise((res) => U.tween(ms, (e) => { const v = from + (to - from) * e; el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); cx = xAt(v); cy = y; place(); }, res, ease));
    cur.classList.remove('down');
  }
  async function type(sel, text) {
    const el = q(sel); if (!el) return;
    el.focus();
    for (const ch of text) { el.value += ch; el.dispatchEvent(new Event('input', { bubbles: true })); await wait(55 + ((ch.charCodeAt(0) * 37) % 50)); }
  }
  function chapter(n, title, sub, tags) {
    const st = q('#stage').getBoundingClientRect();
    chap.style.left = `${st.left + 30}px`; chap.style.bottom = '34px';
    chap.querySelector('.n').textContent = n; chap.querySelector('b').textContent = title; chap.querySelector('small').textContent = sub;
    chap.classList.remove('show'); void chap.offsetWidth; chap.classList.add('show');
    tagsEl.innerHTML = (tags || []).map((t) => `<span><i></i>${t}</span>`).join('');
    tagsEl.style.left = `${st.left + 30}px`; tagsEl.style.bottom = '118px';
    [...tagsEl.children].forEach((c, i) => setTimeout(() => c.classList.add('show'), 650 + i * 260));
    log('whoosh', { name: title }); log('chapter', { n, title });
  }
  const hideChapter = () => { chap.classList.remove('show'); [...tagsEl.children].forEach((c) => c.classList.remove('show')); };

  /* ---------- narration queue ---------- */
  let voEnd = 0;
  function narrate(id) {
    const d = (window.__VO_DUR || {})[id]; if (!d) { log('missing', { vo: id }); return Promise.resolve(); }
    const nowT = performance.now() - T0();
    const start = Math.max(nowT, voEnd + 300);
    voEnd = start + d;
    return new Promise((res) => setTimeout(() => { log('vo', { id, dur: d }); setTimeout(res, d); }, start - nowT));
  }
  const voDone = () => wait(Math.max(0, voEnd - (performance.now() - T0())) + 350);

  const film = (o) => new Promise((res) => OS.Film.play(Object.assign({}, o, { onEnd: res })));

  /* ---------- the show ---------- */
  async function show() {
    log('section', { name: 'open' }); log('impact');
    fade.classList.add('clear');
    const openVO = { 0: 'v0', 1: 'v1', 2: 'v2', 3: 'v3', 4: 'v4', 5: 'v5' };
    await film({ shots: [0, 1, 2, 3, 4, 5], onTravel: () => log('whoosh', { name: 'travel' }), onHold: (i) => { if (openVO[i]) narrate(openVO[i]); } });
    log('whoosh', { name: 'to product' }); log('section', { name: 'demo' });
    await voDone(); await wait(900);

    /* 01 Ocean Slicer */
    showCursor(true);
    chapter('01', 'Ocean Slicer', 'Cut the ocean open like a cake');
    narrate('v6');
    await wait(700);
    await clickEl('#panel .chip[data-v="lat15"]', { after: 1500 });
    await clickEl('#panel .seg button[data-v="S"]', { after: 1500 });
    await clickEl('#panel .seg button[data-v="T"]', { after: 700 });
    await clickEl('#panel .chip[data-v="corner"]', { after: 1100 });
    await clickEl('#lMld', { after: 1300 });
    await voDone();
    narrate('v7');
    await clickWorld(88.5, 12.5, () => OS.Dossier.open(88.5, 12.5, 40));
    await wait(4300);
    await drag('#d-depth', 690, 2600);
    await wait(1300);
    await drag('#d-depth', 300, 1300);
    await voDone();
    await clickEl('#dossier .d-close', { after: 900 });
    await clickEl('#lMld', { after: 500 });
    hideChapter();

    /* 02 Truth Meter */
    await clickEl('#nav button[data-view="truth"]', { after: 300 });
    chapter('02', 'Truth Meter', 'Where the model disagrees with reality', ['Model vs Argo floats', 'Basin-wide error', 'Ranked blind spots']);
    narrate('v8');
    await wait(1500);
    await clickEl('#panel .rank li', { after: 3200 });
    await voDone();
    await clickEl('#p-close', { after: 400 });
    hideChapter();

    /* 03 Cyclone Lab */
    await clickEl('#nav button[data-view="cyclone"]', { after: 300 });
    chapter('03', 'Cyclone Lab', 'Replay Amphan, 16 to 21 May 2020');
    narrate('v9');
    await wait(1700);
    await clickEl('#panel .btn.storm', { after: 2600 });
    await hoverEl('#panel .gauge');
    await wait(4800);
    await voDone(); await wait(400);
    hideChapter();

    /* 04 Search & Rescue */
    await clickEl('#nav button[data-view="sar"]', { after: 300 });
    chapter('04', 'Search & Rescue', 'Where will the currents carry them?', ['700 virtual drifters', '2 to 24 hour windows', 'Ranked search boxes']);
    narrate('v10');
    await wait(1000);
    await clickEl('#panel .chip[data-v="24"]', { after: 400 });
    await clickWorld(66.5, 9.0, () => OS.Views.sar.drop(66.5, 9.0));
    await wait(5600);
    await hoverEl('#panel .rank li');
    await voDone(); await wait(500);
    hideChapter();

    /* 05 Sonar */
    await clickEl('#nav button[data-view="sonar"]', { after: 300 });
    chapter('05', 'Sonar', 'Find the quiet zones', ['Mackenzie sound speed', 'Ray tracing', 'Submarine shadow zones']);
    narrate('v11');
    await wait(2200);
    await clickEl('#panel .chip[data-v="storm"]', { after: 2000 });
    await clickEl('#panel .chip[data-v="sub"]', { after: 2400 });
    await voDone();
    hideChapter();

    /* 06 Learn */
    await clickEl('#nav button[data-view="learn"]', { after: 300 });
    chapter('06', 'Learn', 'Stories, marine life and quizzes', ['Guided story mode', 'Life by depth', 'Low-oxygen zone', 'Quizzes']);
    narrate('v12');
    await wait(700);
    await clickEl('#panel .tabs button[data-id="life"]', { after: 500 });
    await clickEl('#lifeToggle', { after: 2600 });
    await clickEl('#panel .omz', { after: 3300 });
    await clickEl('#caption .beat button', { after: 400 });
    await clickEl('#panel .tabs button[data-id="quiz"]', { after: 600 });
    await clickEl('#panel .opt', { after: 2400 });
    await voDone();
    hideChapter();

    /* 07 Copilot */
    chapter('07', 'Copilot', 'Ask in plain English', ['Drives every view', 'Understands depths, days and places', 'Float deployment advice']);
    narrate('v13');
    await clickEl('#cp-pill', { after: 500 });
    await clickEl('#cp-in', { after: 150 });
    await type('#cp-in', 'Show salinity at 300 m');
    await clickEl('#cp-form button', { after: 3600 });
    await clickEl('#cp-in', { after: 150 });
    await type('#cp-in', 'Replay Amphan');
    await clickEl('#cp-form button', { after: 4600 });
    await voDone();
    await clickEl('#cp-close', { after: 500 });
    hideChapter(); showCursor(false);

    /* Outro */
    log('whoosh', { name: 'outro' }); log('section', { name: 'outro' });
    await film({ shots: [6, 8], keep: true, onTravel: () => log('whoosh', { name: 'travel' }), onHold: (i) => { if (i === 1) { narrate('v14'); log('impact'); } } });
    await voDone();
    fade.classList.remove('clear');
    await wait(2000);
    log('end');
    window.__showDone = true;
  }
  window.__runShow = () => { show().catch((e) => { log('error', { msg: String(e && e.stack || e) }); window.__showDone = true; }); };
})();
