/* View 1: Ocean Slicer */
(function (OS) {
'use strict';
const { $, el, fmtLon, fmtLat, fmtDepth } = OS.U, UI = OS.UI, S = OS.Scene, Store = OS.Store, VARS = OS.Ocean.VARS;
OS.Views = OS.Views || {};

/* Shared colour-scale group used by Slicer and Truth Meter */
OS.colorbarGroup = function () {
  const g = UI.group('Colour scale');
  g.innerHTML += `<canvas class="cbar" aria-hidden="true"></canvas><div class="cticks"><span></span><span></span><span></span></div>
    <div class="range-row adv"><div><label>Lowest</label><input class="rmin" type="number" step="any"></div><div><label>Highest</label><input class="rmax" type="number" step="any"></div><button type="button" class="rreset">Reset</button></div>
    <p class="err" role="alert"></p><div class="swatches"><span><i style="background:#D8CBA8"></i>Land</span><span><i style="background:#74716A"></i>Seafloor</span></div>`;
  const cb = g.querySelector('.cbar'), ticks = g.querySelectorAll('.cticks span'), rmin = g.querySelector('.rmin'), rmax = g.querySelector('.rmax'), err = g.querySelector('.err'), title = g.querySelector('h2');
  const draw = () => { const cfg = VARS[S.state.var]; UI.drawColorbar(cb, S.state.var, S.state.range, cfg.hi, cfg.dec, ticks); rmin.value = +S.state.range[0].toFixed(cfg.dec); rmax.value = +S.state.range[1].toFixed(cfg.dec); title.textContent = `Colour scale, ${cfg.name.toLowerCase()} in ${cfg.unit}`; };
  const tryRange = () => { const a = parseFloat(rmin.value), b = parseFloat(rmax.value); if (!isFinite(a) || !isFinite(b)) { err.textContent = 'Enter a number in both boxes.'; return; } if (a >= b) { err.textContent = 'Lowest must be smaller than highest.'; return; } err.textContent = ''; S.setRange(a, b); };
  rmin.addEventListener('change', tryRange); rmax.addEventListener('change', tryRange);
  rmin.addEventListener('input', () => { err.textContent = ''; }); rmax.addEventListener('input', () => { err.textContent = ''; });
  g.querySelector('.rreset').addEventListener('click', () => S.setRange(...VARS[S.state.var].range));
  g.draw = draw; return g;
};

const V = { id: 'slicer', title: 'Ocean Slicer', icon: '<path d="M3 9h18v10H3z"/><path d="M3 9l4-4h14l-2 4"/><path d="M21 9v10"/><path d="M12 9v10M3 14h9"/>' };
let root, sliders = {}, varSeg, cbg, diveBtn, sonarChip, sonarMode = false, unsub = [];
const PRESETS = { corner: [75, 12, 1200], lat15: [40, 15, 4000], lon88: [88, 27, 4000], peel: [40, 27, 100], whole: [100, -15, 0] };

V.mount = function (r) {
  root = r;
  root.appendChild(el(`<p class="eyebrow">View 1 of 6</p>`));
  root.appendChild(el(`<h1>Ocean Slicer</h1>`));
  root.appendChild(el(`<p class="lede">Slice the North Indian Ocean open like a cake, peel back its layers, and click any point of the water to dive in.</p>`));

  const g1 = UI.group('What to show');
  varSeg = UI.seg([{ v: 'T', label: 'Temperature', plain: 'Warmth' }, { v: 'S', label: 'Salinity', plain: 'Saltiness' }, { v: 'V', label: 'Currents', plain: 'Flow' }], S.state.var === 'D' ? 'T' : S.state.var, (v) => S.setVar(v));
  g1.appendChild(varSeg); g1.appendChild(el(`<p class="note" id="varNote"></p>`)); root.appendChild(g1);

  const g2 = UI.group('Knife');
  sliders.lon = UI.slider({ id: 'kLon', label: 'Remove east of', min: 40, max: 100, step: 0.5, value: S.knife.lon, fmt: (v) => v >= 100 ? 'Nothing' : fmtLon(v), onInput: (v) => { S.stopKnife(); S.knife.lon = v; S.applyKnife(); } });
  sliders.lat = UI.slider({ id: 'kLat', label: 'Remove south of', min: -15, max: 27, step: 0.5, value: S.knife.lat, fmt: (v) => v <= -15 ? 'Nothing' : fmtLat(v), onInput: (v) => { S.stopKnife(); S.knife.lat = v; S.applyKnife(); } });
  sliders.dep = UI.slider({ id: 'kDep', label: 'Cut down to', min: 0, max: 1000, step: 1, value: S.sliderFromDepth(S.knife.depth), fmt: (v) => { const d = S.depthFromSlider(v); return d <= 1 ? 'No cut' : d >= 3999 ? 'Seafloor' : fmtDepth(S.roundDepth(d)); }, onInput: (v) => { S.stopKnife(); S.knife.depth = S.roundDepth(S.depthFromSlider(v)); S.applyKnife(); } });
  g2.append(sliders.lon, sliders.lat, sliders.dep);
  g2.appendChild(UI.chips([{ v: 'corner', label: 'Corner cut' }, { v: 'lat15', label: 'Along 15°N' }, { v: 'lon88', label: 'Along 88°E' }, { v: 'peel', label: 'Peel to 100 m' }, { v: 'whole', label: 'Whole ocean' }], (v) => S.animateKnife(PRESETS[v], 900)));
  diveBtn = UI.btn('Dive from surface to 2,000 m', () => {
    if (S.knifeAnimating()) { S.stopKnife(); return; }
    S.setKnife(40, 27, 0); diveBtn.textContent = 'Stop dive'; S.animateKnife([40, 27, 2000], 7000);
  });
  g2.appendChild(diveBtn); root.appendChild(g2);

  const gs = UI.group('Ocean surface', 'cinema'); gs.classList.add('cine-only');
  gs.appendChild(UI.seg([{ v: 'real', label: 'Real ocean colour' }, { v: 'data', label: 'Data colours' }], Store.get('surfaceData') ? 'data' : 'real', (v) => { Store.set({ surfaceData: v === 'data' }); OS.FX.setDataMix(v === 'data' ? 0.85 : 0); }));
  gs.appendChild(el(`<p class="note">Real colour comes from the ocean itself: warm water runs deep blue, upwelling turns green, the Ganges plume is olive and shoals glow turquoise.</p>`));
  gs.appendChild(UI.slider({ id: 'seaState', label: 'Sea state', min: 0.2, max: 2.4, step: 0.05, value: OS.FX ? OS.FX.seaState() : 1, fmt: (v) => v < 0.55 ? 'Glassy' : v < 1.25 ? 'Monsoon swell' : v < 1.85 ? 'Rough' : 'Storm', onInput: (v) => OS.FX.setSeaState(v) }));
  gs.appendChild(UI.check('lWx', 'Clouds and weather', Store.get('weather') !== false, (on) => { Store.set({ weather: on }); OS.FX.setWeather(on); }));
  root.appendChild(gs);

  const gl = UI.group('Layers', 'revealed by the cut');
  const lf = UI.check('lFlow', 'Flowing water on the surface', true, (on) => S.showFlowWater(on)); lf.classList.add('light-only'); gl.appendChild(lf);
  gl.appendChild(UI.check('lFlowP', 'Surface current streaks', S.particles.visible, (on) => S.showFlow(on)));
  gl.appendChild(UI.check('lFloats', 'Argo floats', S.floatGroup.visible, (on) => S.showFloats(on)));
  gl.appendChild(UI.check('lContours', 'Contour lines', true, (on) => S.showContours(on)));
  gl.appendChild(UI.check('lD26', '<i class="sw" style="background:#F2A65A"></i> 26 °C fuel line, as a sheet', S.sheetVisible('d26'), (on) => S.showSheet('d26', on)));
  gl.appendChild(UI.check('lMld', '<i class="sw" style="background:#8FCBE8"></i> Mixed layer depth', S.sheetVisible('mld'), (on) => S.showSheet('mld', on)));
  gl.appendChild(UI.check('lD20', '<i class="sw" style="background:#8C6BB1"></i> Thermocline (20 °C)', S.sheetVisible('d20'), (on) => S.showSheet('d20', on)));
  gl.appendChild(UI.check('lBathy', '<i class="sw" style="background:#74716A"></i> Seafloor relief', S.sheetVisible('bathy'), (on) => S.showSheet('bathy', on)));
  gl.appendChild(el(`<p class="note">Sheets show only inside the cut, like an excavation. Click any point of the water to dive in and read the whole column.</p>`));
  root.appendChild(gl);

  const g3 = UI.group('View');
  g3.appendChild(UI.slider({ id: 'exag', label: 'Cake height', min: 0.6, max: 3, step: 0.05, value: S.view.H, fmt: (v) => `${v.toFixed(2)} units`, onInput: (v) => S.setView(v) })).classList.add('adv');
  g3.appendChild(UI.check('stretch', 'Give the upper ocean more room', S.view.gamma < 1, (on) => S.setView(undefined, on ? 0.5 : 1)));
  sonarChip = el(`<button type="button" class="chip" aria-pressed="false">🎯 Place sonar here</button>`);
  sonarChip.addEventListener('click', () => setSonarMode(!sonarMode));
  const chipRow = el(`<div class="chips"></div>`); chipRow.appendChild(sonarChip); g3.appendChild(chipRow);
  g3.appendChild(el(`<p class="note">Turn this on, then click any point of the ocean to open the Sonar view with that spot's profile.</p>`));
  g3.appendChild(UI.btn('Reset camera', () => S.resetCamera(), 'ghost'));
  root.appendChild(g3);

  cbg = OS.colorbarGroup(); root.appendChild(cbg);
  syncAll();
};
function setSonarMode(on) {
  sonarMode = on; sonarChip.setAttribute('aria-pressed', String(on)); S.setClickMode(on ? 'sonar' : 'float');
  if (on) OS.U.toast('Click a point in the ocean to place the sonar');
}
function syncAll() {
  const cfg = VARS[S.state.var];
  $('varNote').textContent = cfg.note; varSeg.set(S.state.var); cbg.draw();
  sliders.lon.set(S.knife.lon); sliders.lat.set(S.knife.lat); sliders.dep.set(S.sliderFromDepth(S.knife.depth));
}
V.enter = function () {
  if (S.state.var === 'D') S.setVar('T');
  S.setClickMode(sonarMode ? 'sonar' : 'float');
  unsub.push(Store.on('variable', syncAll), Store.on('cutPlanes', () => { if (!root) return; sliders.lon.set(S.knife.lon); sliders.lat.set(S.knife.lat); sliders.dep.set(S.sliderFromDepth(S.knife.depth)); }));
  S.onRange = () => cbg.draw(); S.onKnifeAnimEnd = () => { diveBtn.textContent = 'Dive from surface to 2,000 m'; }; S.onResize = () => cbg.draw();
  unsub.push(S.onSurfaceClick((info) => {
    if (info.mode === 'float') { if (info.land) return; if (info.depth > info.seafloor + 1) { OS.U.toast('That is the seafloor. Click the water above it.'); return; } OS.Dossier.open(info.lon, info.lat, info.depth); return; }
    if (info.mode !== 'sonar' || info.land) { if (info.mode === 'sonar') OS.U.toast('That is land. Pick a point in the water.'); return; }
    Store.set({ sonarSite: { lon: info.lon, lat: info.lat, label: 'Placed from the slicer' } });
    setSonarMode(false); OS.App.go('sonar');
  }));
  syncAll();
};
V.leave = function () { OS.Dossier.close(); unsub.forEach((f) => f()); unsub = []; S.onRange = null; S.onKnifeAnimEnd = null; S.onResize = null; if (sonarMode) setSonarMode(false); };
OS.Views.slicer = V;
})(window.OS);
