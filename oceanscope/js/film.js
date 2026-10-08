/* Film mode: a hands-free cinematic tour for recording the demo video. */
(function (OS) {
'use strict';
const U = OS.U, S = OS.Scene, Store = OS.Store;
const F = {};
let playing = false, shotIdx = 0, t0 = 0, total = 0, raf = 0, dayAnim = null, pending = [], list = [], opts = {};
const sine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
const cubic = U.easeInOut;
const X = (lon) => S.lonToX(lon), Z = (lat) => S.latToZ(lat);
const later = (ms, fn) => { const id = setTimeout(() => { if (playing) fn(); }, ms); pending.push(id); };
const CY = () => OS.Views.cyclone;

const SHOTS = [
  { title: 'OceanScope', sub: 'The North Indian Ocean, alive in three dimensions', travel: 0, hold: 7000,
    start: () => ({ r: S.fitRadius() * 1.75, theta: -0.4, phi: 0.6, target: [0.15, -S.view.H * 0.45, 0.2] }),
    cam: () => ({ r: S.fitRadius() * 1.02, theta: 0.5, phi: 0.97, target: [0.15, -S.view.H * 0.45, 0.2] }), drift: { theta: 0.25 },
    setup() { S.setVar('T'); S.setKnife(100, -15, 0); later(1400, () => S.animateKnife([75, 12, 1200], 3600)); OS.FX.setWeather(true); OS.FX.setDataMix(0); S.showSheet('d26', true); S.showFloats(true); S.showFlow(true); } },
  { title: 'Arabian Sea', sub: 'Southwest monsoon swell · July', travel: 3200, hold: 4800,
    cam: () => ({ r: 1.45, theta: 1.35, phi: 1.24, target: [X(63), -0.02, Z(13)] }), drift: { theta: 0.35, r: -0.15 },
    setup() { S.animateKnife([100, -15, 0], 2600); } },
  { title: 'The Great Whirl', sub: 'A 500 km eddy spun up by the Somali Current', travel: 3000, hold: 4600,
    cam: () => ({ r: 1.25, theta: 0.6, phi: 0.98, target: [X(54), 0, Z(7)] }), drift: { theta: 0.5 } },
  { title: 'Lakshadweep · Maldives', sub: 'Coral shoals along the Chagos–Laccadive Ridge', travel: 3000, hold: 4300,
    cam: () => ({ r: 1.15, theta: 1.65, phi: 1.12, target: [X(73), 0, Z(5)] }), drift: { theta: -0.35 } },
  { title: 'Bay of Bengal', sub: 'Ganges water floats as a warm, fresh lid', travel: 3300, hold: 4400,
    cam: () => ({ r: 1.6, theta: 0.25, phi: 1.14, target: [X(89), 0, Z(19)] }), drift: { theta: 0.3 } },
  { title: 'Cyclone Amphan', sub: '19 May 2020 · 130 knots over 30 °C water', travel: 3000, hold: 7600,
    cam: () => ({ r: 2.9, theta: 0.1, phi: 0.92, target: [X(86.6), 0, Z(15)] }), drift: { theta: 0.5, r: -0.55 },
    setup() {
      CY().attachExternal(); CY().setDay(1);
      later(600, () => { dayAnim = U.tween(9000, (e, t) => CY().setDay(1 + t * 3.25), null, (t) => t); });
    },
    teardown() { if (dayAnim) dayAnim.cancel(); CY().detachExternal(); } },
  { title: 'Inside the ocean', sub: 'The 26 °C fuel line, cut open', travel: 3000, hold: 5600,
    cam: () => ({ r: 4.1, theta: 0.8, phi: 1.12, target: [X(86), -S.view.H * 0.3, Z(10)] }), drift: { theta: 0.35 },
    setup() { S.animateKnife([84, 10, 1500], 3400); S.showSheet('d26', false); U.tween(2500, (e) => S.setHiGlow(e)); },
    teardown() { U.tween(1200, (e) => S.setHiGlow(1 - e)); } },
  { title: '2,000 metres down', sub: 'Temperature, salt and sound, layer by layer', travel: 2800, hold: 5400,
    cam: () => ({ r: 2.3, theta: 0.95, phi: 1.3, target: [X(84), -S.view.H * 0.52, Z(10)] }), drift: { theta: 0.3, r: 0.25 },
    setup() { later(2600, () => S.setVar('S')); } },
  { title: 'OceanScope', sub: 'See the ocean the way scientists do', travel: 3600, hold: 5200,
    cam: () => ({ r: S.fitRadius() * 1.12, theta: 0.72, phi: 0.98, target: [0.15, -S.view.H * 0.45, 0.2] }), drift: { theta: 0.22 },
    setup() { S.setVar('T'); S.animateKnife([75, 12, 1200], 3000); S.showSheet('mld', false); } }
];

function runShot(i) {
  if (!playing) return;
  if (i >= list.length) { if (opts.keep) { if (opts.onEnd) opts.onEnd(); } else { F.stop(); if (opts.onEnd) opts.onEnd(); } return; }
  shotIdx = i;
  const sh = list[i];
  if (sh.start) { const c = sh.start(); S.flyTo(c, 1, null); }
  if (sh.setup) sh.setup();
  const dest = sh.cam();
  const hold = () => {
    if (!playing) return;
    if (opts.onHold) opts.onHold(i, sh);
    OS.FX.title(sh.title, sh.sub, sh.hold - 1000);
    const d = sh.drift || {};
    S.flyTo({ theta: dest.theta + (d.theta || 0.25), r: dest.r * (1 + (d.r || 0)), phi: dest.phi + (d.phi || 0), target: dest.target, ease: sine, lock: true }, sh.hold, () => { if (sh.teardown) sh.teardown(); runShot(i + 1); });
  };
  if (sh.travel && opts.onTravel) opts.onTravel(i, sh);
  if (sh.travel) { OS.FX.hideTitle(); S.flyTo(Object.assign({}, dest, { arc: 0.3, ease: cubic, lock: true }), sh.travel, hold); }
  else later(40, hold);
}
function progress() {
  if (!playing) return;
  const p = Math.min(1, (performance.now() - t0) / total);
  U.$('film-progress').style.width = `${p * 100}%`;
  raf = requestAnimationFrame(progress);
}
F.play = function (o) {
  if (playing || !S.ready) return;
  opts = o || {}; list = opts.shots ? opts.shots.map((k) => SHOTS[k]) : SHOTS.slice();
  const go = OS.App.go('slicer');
  go.then(() => {
    playing = true; pending = [];
    if (OS.Dossier) OS.Dossier.close();
    S.deselect(); OS.Copilot.open(false);
    if (!OS.FX.on) { U.$('cine').checked = true; OS.FX.setCine(true); }
    document.body.classList.add('film'); S.resize();
    S.lockInput = true; S.setIdle(false);
    OS.FX.letterbox(true); OS.FX.film(true);
    total = list.reduce((s, x) => s + (x.travel || 0) + x.hold, 0); t0 = performance.now(); progress();
    Store.set({ filmPlaying: true });
    runShot(0);
  });
};
F.stop = function () {
  if (!playing) return;
  playing = false; cancelAnimationFrame(raf); pending.forEach(clearTimeout); pending = [];
  const sh = list[shotIdx]; if (sh && sh.teardown) sh.teardown();
  S.stopCamera(); S.lockInput = false;
  document.body.classList.remove('film'); S.resize();
  OS.FX.letterbox(false); OS.FX.film(false); OS.FX.hideTitle();
  S.setVar('T'); S.showSheet('mld', false); S.animateKnife([75, 12, 1200], 1000); S.resetCamera(1400);
  Store.set({ filmPlaying: false });
};
F.playing = () => playing;
F.SHOTS = SHOTS;
F.init = function () {
  U.$('film-btn').addEventListener('click', () => (playing ? F.stop() : F.play()));
  const exit = document.createElement('button'); exit.id = 'film-exit'; exit.type = 'button'; exit.textContent = 'Exit film · Esc'; exit.addEventListener('click', F.stop); document.body.appendChild(exit);
  const bar = document.createElement('div'); bar.id = 'film-progress'; document.body.appendChild(bar);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && playing) F.stop(); });
};
OS.Film = F;
})(window.OS);
