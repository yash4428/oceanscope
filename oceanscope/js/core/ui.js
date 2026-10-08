/* Reusable UI builders that match the shared design system */
(function (OS) {
'use strict';
const { el, clamp } = OS.U;
const UI = {};

/* Segmented control: opts = [{v, label, plain?}], returns element with .set(v) */
UI.seg = (opts, value, onChange, cls) => {
  const s = el(`<div class="seg ${cls || ''}" role="group"></div>`);
  opts.forEach((o) => {
    const b = el(`<button type="button" data-v="${o.v}" aria-pressed="${o.v === value}" ${o.plain ? `data-plain="${o.plain}" data-tech="${o.label}"` : ''}>${o.label}</button>`);
    b.addEventListener('click', () => { s.set(o.v); onChange(o.v); });
    s.appendChild(b);
  });
  s.set = (v) => s.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(v))));
  return s;
};

/* Chip row with optional single-select */
UI.chips = (opts, onPick, opt) => {
  opt = opt || {};
  const c = el(`<div class="chips"></div>`);
  opts.forEach((o) => {
    const b = el(`<button type="button" class="chip ${o.cls || ''}" data-v="${o.v}" ${opt.select ? `aria-pressed="${o.v === opt.value}"` : ''}>${o.label}</button>`);
    b.addEventListener('click', () => { if (opt.select) c.set(o.v); onPick(o.v, b); });
    c.appendChild(b);
  });
  c.set = (v) => c.querySelectorAll('.chip').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(v))));
  return c;
};

/* Labeled slider row. cfg = {id,label,min,max,step,value,fmt,onInput} */
UI.slider = (cfg) => {
  const r = el(`<div class="row"><div class="row-top"><label for="${cfg.id}">${cfg.label}</label><output id="o-${cfg.id}" for="${cfg.id}"></output></div><input id="${cfg.id}" type="range" min="${cfg.min}" max="${cfg.max}" step="${cfg.step}" value="${cfg.value}"></div>`);
  const inp = r.querySelector('input'), out = r.querySelector('output');
  const show = () => { out.textContent = cfg.fmt ? cfg.fmt(+inp.value) : inp.value; };
  inp.addEventListener('input', () => { show(); cfg.onInput(+inp.value); });
  r.set = (v) => { inp.value = v; show(); };
  r.input = inp; show();
  return r;
};

UI.check = (id, label, checked, onChange) => {
  const c = el(`<label class="check"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''}> ${label}</label>`);
  c.querySelector('input').addEventListener('change', (e) => onChange(e.target.checked));
  return c;
};

UI.btn = (label, onClick, cls) => { const b = el(`<button type="button" class="btn ${cls || ''}">${label}</button>`); b.addEventListener('click', onClick); return b; };
UI.group = (title, small) => el(`<div class="group"><h2>${title}${small ? `<small>${small}</small>` : ''}</h2></div>`);
UI.stat = (k, v, cls) => el(`<div class="stat ${cls || ''}"><span class="k">${k}</span><span class="v">${v}</span></div>`);

/* Draw a colormap bar into a canvas */
UI.drawColorbar = (cb, key, range, hi, dec, ticks) => {
  const dpr = Math.min(window.devicePixelRatio || 1, 2), cw = cb.clientWidth || 270, ch = 16;
  cb.width = cw * dpr; cb.height = ch * dpr; const g = cb.getContext('2d');
  for (let x = 0; x < cb.width; x++) { const c = OS.Ocean.cmapAt(key, x / (cb.width - 1)); g.fillStyle = `rgb(${c[0] * 255 | 0},${c[1] * 255 | 0},${c[2] * 255 | 0})`; g.fillRect(x, 0, 1, cb.height); }
  if (hi !== null && hi !== undefined) { const x = (hi - range[0]) / (range[1] - range[0]); if (x > 0 && x < 1) { g.fillStyle = '#fff'; g.fillRect(Math.round(x * cb.width) - dpr, 0, 2 * dpr, cb.height); } }
  if (ticks) { ticks[0].textContent = range[0].toFixed(dec); ticks[1].textContent = ((range[0] + range[1]) / 2).toFixed(dec); ticks[2].textContent = range[1].toFixed(dec); }
};

/* Semi-circular gauge. Returns {el, set(v01, text, sub)} */
UI.gauge = (color) => {
  const w = el(`<div class="gauge"><svg viewBox="0 0 180 110">
    <path d="M14 92 A76 76 0 0 1 166 92" fill="none" stroke="var(--rule-2)" stroke-width="12" stroke-linecap="round"/>
    <path class="g-arc" d="M14 92 A76 76 0 0 1 166 92" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round" stroke-dasharray="239" stroke-dashoffset="239"/>
    <g class="g-needle" style="transform-origin:90px 92px;transition:transform .5s cubic-bezier(.16,1,.3,1)"><line x1="90" y1="92" x2="90" y2="34" stroke="var(--ink)" stroke-width="2.2" stroke-linecap="round"/><circle cx="90" cy="92" r="5" fill="var(--ink)"/></g>
    </svg><div class="g-val"><span class="g-num">0</span><small class="g-sub"></small></div></div>`);
  const arc = w.querySelector('.g-arc'), needle = w.querySelector('.g-needle'), num = w.querySelector('.g-num'), sub = w.querySelector('.g-sub');
  arc.style.transition = 'stroke-dashoffset .5s cubic-bezier(.16,1,.3,1)';
  w.set = (v01, text, subText) => { v01 = clamp(v01, 0, 1); arc.style.strokeDashoffset = String(239 * (1 - v01)); needle.style.transform = `rotate(${-90 + 180 * v01}deg)`; num.textContent = text; sub.textContent = subText || ''; };
  return w;
};

/* Compass rose with an arrow. set(bearingDeg, label, sub) */
UI.compass = () => {
  const w = el(`<div class="compass"><svg viewBox="0 0 96 96">
    <circle cx="48" cy="48" r="44" fill="var(--panel-2)" stroke="var(--rule)"/>
    <g font-family="Barlow Semi Condensed" font-size="10" font-weight="600" fill="var(--ink-2)" text-anchor="middle"><text x="48" y="13">N</text><text x="48" y="90">S</text><text x="10" y="51">W</text><text x="87" y="51">E</text></g>
    <g class="c-arrow" style="transform-origin:48px 48px;transition:transform .6s cubic-bezier(.16,1,.3,1)"><path d="M48 14 L56 48 L48 42 L40 48 Z" fill="var(--rescue)"/><path d="M48 82 L40 48 L48 54 L56 48 Z" fill="var(--rule)"/></g>
    <circle cx="48" cy="48" r="3" fill="var(--ink)"/></svg><div class="c-txt"><b class="c-b"></b><span class="c-s"></span></div></div>`);
  const arrow = w.querySelector('.c-arrow'), b = w.querySelector('.c-b'), s = w.querySelector('.c-s');
  w.set = (deg, label, sub) => { arrow.style.transform = `rotate(${deg}deg)`; b.textContent = label; s.textContent = sub; };
  return w;
};

/* Tabs: tabs=[{id,label}], returns el with .set(id) */
UI.tabs = (tabs, active, onChange) => {
  const t = el(`<div class="tabs" role="tablist"></div>`);
  tabs.forEach((x) => { const b = el(`<button type="button" role="tab" data-id="${x.id}" aria-selected="${x.id === active}">${x.label}</button>`); b.addEventListener('click', () => { t.set(x.id); onChange(x.id); }); t.appendChild(b); });
  t.set = (id) => t.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.id === id)));
  return t;
};

/* Ranked list. rows=[{n,title,sub,value,bar01,onClick}] */
UI.rank = (rows, cls) => {
  const ul = el(`<ol class="rank ${cls || ''}"></ol>`);
  rows.forEach((r, i) => {
    const li = el(`<li><span class="n">${r.n || i + 1}</span><span class="t">${r.title}<small>${r.sub || ''}</small><span class="bar" style="width:0"></span></span><span class="v">${r.value}</span></li>`);
    li.addEventListener('click', () => { ul.querySelectorAll('li').forEach((x) => x.removeAttribute('aria-selected')); li.setAttribute('aria-selected', 'true'); r.onClick && r.onClick(); });
    ul.appendChild(li);
    if (r.bar01 !== undefined) requestAnimationFrame(() => setTimeout(() => { li.querySelector('.bar').style.width = `${Math.round(r.bar01 * 100)}%`; }, 40 + i * 40));
  });
  return ul;
};

/* Apply explore mode word swaps: any [data-plain] gets its plain text */
UI.applyExplore = (on) => {
  document.body.classList.toggle('explore', on);
  document.querySelectorAll('[data-plain]').forEach((n) => { n.textContent = on ? n.dataset.plain : n.dataset.tech; });
};

OS.UI = UI;
})(window.OS);
