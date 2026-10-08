/* View 2: Truth Meter — where the model disagrees with reality */
(function (OS) {
'use strict';
const { el, fmtLon, fmtLat, fmtDepth, countTo } = OS.U, UI = OS.UI, S = OS.Scene, Store = OS.Store, Oc = OS.Ocean;
const V = { id: 'truth', title: 'Truth Meter', icon: '<path d="M4 18h16"/><path d="M6 14l4-6 4 4 4-8"/><circle cx="18" cy="4" r="1.5"/>' };
let root, cbg, unsub = [], list, statEl, ranked = [];

/* Basin-wide stats derived from the synthetic field, not typed in */
function basinStats() {
  const O = S.O, N2 = Oc.N2, NZ = Oc.NZ, q = Oc.VARS.D.q;
  let sum = 0, n = 0, upper = 0, nu = 0;
  for (let kz = 0; kz < NZ; kz += 2) { const sN = kz / (NZ - 1), d = Oc.DMAX * sN * sN; for (let k = 0; k < N2; k += 3) { if (O.landLo[k]) continue; const v = q[0] + (q[1] - q[0]) * O.vol.D[kz * N2 + k]; sum += v; n++; if (d < 300) { upper += v; nu++; } } }
  return { avg: sum / n, upper: upper / nu };
}
function rankFloats() {
  return S.floats.map((f, i) => {
    /* field value at the float's thermocline plus the float's own model-obs error */
    const fieldErr = S.valueAt('D', f.lon, f.lat, f.worstD);
    return { i, f, score: 0.55 * f.errT + 0.45 * fieldErr, depth: f.worstD };
  }).sort((a, b) => b.score - a.score).slice(0, 10);
}
V.recommend = function () { return rankFloats().slice(0, 3); };

V.mount = function (r) {
  root = r;
  root.appendChild(el(`<p class="eyebrow">View 2 of 6</p>`));
  root.appendChild(el(`<h1>Truth Meter</h1>`));
  root.appendChild(el(`<p class="lede">Where the model and the Argo floats disagree. Bright colour means the model is furthest from what was measured.</p>`));
  const st = basinStats();
  const row = el(`<div class="stat-row"></div>`);
  statEl = UI.stat('Basin-wide average error', `<span class="n1">0.00</span><small>°C</small>`, 'error');
  const st2 = UI.stat('Upper 300 m', `<span class="n2">0.00</span><small>°C</small>`, 'error');
  row.append(statEl, st2); root.appendChild(row);
  countTo(statEl.querySelector('.n1'), st.avg, 2, 900); countTo(st2.querySelector('.n2'), st.upper, 2, 900);

  const g = UI.group('Most-wrong locations', 'top 10 of 34 floats');
  ranked = rankFloats();
  list = UI.rank(ranked.map((r, n) => ({ n: n + 1, title: `Float ${r.f.id}`, sub: `${fmtLat(Math.round(r.f.lat * 10) / 10)} ${fmtLon(Math.round(r.f.lon * 10) / 10)} · worst at ${fmtDepth(Math.round(r.depth / 5) * 5)}`, value: `${r.score.toFixed(2)} °C`, bar01: r.score / ranked[0].score, onClick: () => V.goTo(r.i) })));
  g.appendChild(list); g.appendChild(el(`<p class="note">Click a row to fly to that float and compare its profile with the model.</p>`)); root.appendChild(g);
  cbg = OS.colorbarGroup(); root.appendChild(cbg);
};
V.goTo = function (i) {
  const f = S.floats[i];
  S.setIdle(false);
  S.flyToLL(f.lon, f.lat, 4.2, 1400, () => S.selectFloat(i));
  if (list) { list.querySelectorAll('li').forEach((li) => li.removeAttribute('aria-selected')); const pos = ranked.findIndex((r) => r.i === i); if (pos >= 0) list.children[pos].setAttribute('aria-selected', 'true'); }
};
V.enter = function () {
  S.setVar('D'); S.setClickMode('float');
  if (S.knife.depth <= 1) S.animateKnife([80, 10, 600], 1200);
  S.onRange = () => cbg.draw(); S.onResize = () => cbg.draw(); cbg.draw();
};
V.leave = function () { unsub.forEach((f) => f()); unsub = []; S.onRange = null; S.onResize = null; };
OS.Views.truth = V;
})(window.OS);
