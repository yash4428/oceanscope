/* View 3: Cyclone Lab — replay Amphan, 16–21 May 2020 */
(function (OS) {
'use strict';
const U = OS.U, { el, clamp, lerp, smoothstep, fmtLon, fmtLat } = U, UI = OS.UI, S = OS.Scene, Store = OS.Store;
const V = { id: 'cyclone', title: 'Cyclone Lab', icon: '<path d="M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0"/><path d="M12 4a8 8 0 0 1 8 8"/><path d="M12 20a8 8 0 0 1-8-8"/><path d="M18 5a10 10 0 0 1 1 11"/><path d="M6 19a10 10 0 0 1-1-11"/>' };

/* Hand-authored storm data */
const TRACK = [[86.1, 10.6], [86.3, 12.1], [86.5, 13.9], [86.9, 16.6], [88.0, 20.4], [89.6, 23.6]];
const DATES = ['16 May', '17 May', '18 May', '19 May', '20 May', '21 May'];
const STAGE = ['Forming', 'Forming', 'Intensifying', 'Peak', 'Weakening', 'Dissipated'];
const FUEL = [78, 84, 91, 88, 71, 58];        // kJ/cm², ocean heat content under the eye
const RI = [18, 41, 72, 64, 22, 4];           // % risk of rapid intensification in next 24 h
const WIND = [35, 55, 130, 120, 85, 30];      // kt
const PRESS = [1002, 994, 925, 935, 968, 996]; // hPa
V.TRACK = TRACK; V.DATES = DATES; V.STAGE = STAGE; V.FUEL = FUEL; V.RI = RI;

const sampleArr = (arr, day) => { const t = clamp(day, 1, 6) - 1, i = Math.min(4, Math.floor(t)), f = t - i; return lerp(arr[i], arr[i + 1], f); };
function catmull(day) {
  const t = clamp(day, 1, 6) - 1, i = Math.min(4, Math.floor(t)), f = t - i;
  const P = (n) => TRACK[clamp(n, 0, 5)], p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
  const c = (a, b, cc, d) => 0.5 * ((2 * b) + (-a + cc) * f + (2 * a - 5 * b + 4 * cc - d) * f * f + (-a + 3 * b - 3 * cc + d) * f * f * f);
  return [c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])];
}
V.positionAt = catmull; V.sampleArr = sampleArr;

/* ---------- 3D storm marker ---------- */
let group, spiral, glow, trackLine, dots = [], built = false, wakeCache = -1, predictGuess = null, guessMarker, revealMarker;
function buildMarker() {
  group = new THREE.Group();
  const arms = new THREE.Group();
  for (let a = 0; a < 3; a++) {
    const pts = [];
    for (let i = 0; i <= 40; i++) { const t = i / 40, ang = a * Math.PI * 2 / 3 + t * 4.2, r = 0.02 + t * 0.22; pts.push(new THREE.Vector3(Math.cos(ang) * r, 0.002 + t * 0.01, Math.sin(ang) * r)); }
    arms.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xD9642A, transparent: true, opacity: 0.9 })));
  }
  spiral = arms; group.add(arms);
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 4, 64, 64, 64); gr.addColorStop(0, 'rgba(242,166,90,0.85)'); gr.addColorStop(0.35, 'rgba(217,100,42,0.35)'); gr.addColorStop(1, 'rgba(217,100,42,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false })); glow.scale.set(0.9, 0.9, 1); glow.position.y = 0.04; group.add(glow);
  const eye = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 8, 24), new THREE.MeshBasicMaterial({ color: 0x1C2A35 })); eye.rotation.x = Math.PI / 2; eye.position.y = 0.01; group.add(eye);
  /* full track (dashed) and daily dots */
  const tp = []; for (let i = 0; i <= 100; i++) { const p = catmull(1 + i / 20); tp.push(new THREE.Vector3(S.lonToX(p[0]), 0.012, S.latToZ(p[1]))); }
  trackLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(tp), new THREE.LineDashedMaterial({ color: 0x1C2A35, dashSize: 0.05, gapSize: 0.035, transparent: true, opacity: 0.6 })); trackLine.computeLineDistances();
  group.add(trackLine); trackLine.userData.static = true;
  TRACK.forEach((p, i) => { const d = new THREE.Mesh(new THREE.CircleGeometry(0.022, 16), new THREE.MeshBasicMaterial({ color: i === 3 ? 0xD9642A : 0x1C2A35 })); d.rotation.x = -Math.PI / 2; d.position.set(S.lonToX(p[0]), 0.013, S.latToZ(p[1])); dots.push(d); });
  const mk = (color) => { const m = new THREE.Group(); const r = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.008, 8, 32), new THREE.MeshBasicMaterial({ color })); r.rotation.x = Math.PI / 2; m.add(r); const pin = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.09, 12), new THREE.MeshBasicMaterial({ color })); pin.position.y = 0.06; pin.rotation.x = Math.PI; m.add(pin); m.visible = false; return m; };
  guessMarker = mk(0x1F6FA8); revealMarker = mk(0xD9642A);
  built = true;
}
function showMarker(on) {
  if (!built) buildMarker();
  if (OS.FX) OS.FX.storm.show(on);
  if (on) { S.add(group); dots.forEach((d) => S.add(d)); S.add(guessMarker); S.add(revealMarker); }
  else { S.remove(group); dots.forEach((d) => S.remove(d)); S.remove(guessMarker); S.remove(revealMarker); S.hudRemove('storm'); S.hudRemove('guess'); S.hudRemove('reveal'); }
}

/* ---------- Wake cooling ---------- */
const samples = 48;
function wakeFn(day) {
  const pts = []; const upto = clamp(day, 1, 6);
  for (let i = 0; i < samples; i++) { const u = 1 + (upto - 1) * i / (samples - 1); const p = catmull(u); pts.push([p[0], p[1], u, sampleArr(WIND, u) / 130]); }
  return (lon, lat) => {
    let best = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], d = Math.hypot((lon - p[0]) * 0.92, lat - p[1]); if (d > 3) continue;
      const since = upto - p[2]; if (since < 0.02) continue;
      const rec = (1 - Math.exp(-since * 4.5)) * Math.exp(-since / 3.2);
      /* cooling is strongest just right of the track (northern hemisphere) */
      const bias = 1 + 0.35 * clamp(lon - p[0], -1, 1);
      const v = p[3] * rec * Math.exp(-((d / 1.05) ** 2)) * bias;
      if (v > best) best = v;
    }
    return best * 0.95;
  };
}
function applyWake(day) {
  if (Math.abs(day - wakeCache) < 0.015) return; wakeCache = day;
  if (day <= 1.02) { S.setWake(null); return; }
  S.setWake(wakeFn(day));
}
V.coolestPoint = function () {
  const f = wakeFn(6.5); let best = 0, bl = 0, bt = 0;
  for (let lat = 9; lat <= 22; lat += 0.2) for (let lon = 83; lon <= 92; lon += 0.2) { if (S.landAt(lon, lat)) continue; const v = f(lon, lat); if (v > best) { best = v; bl = lon; bt = lat; } }
  return [bl, bt, best];
};

/* ---------- state + UI ---------- */
let root, daySlider, stepper, gauge, riStat, windStat, playBtn, playing = null, unsub = [], active = false, predictChip, predictNote, predictMode = false;
let curDay = 1;
V.setDay = function (day, silent) {
  curDay = clamp(day, 1, 6);
  if (!silent) Store.set({ day: curDay });
  if (built && active) {
    const p = catmull(curDay), wind = sampleArr(WIND, curDay), inten = clamp((wind - 30) / 100, 0, 1);
    group.position.set(S.lonToX(p[0]), 0.02, S.latToZ(p[1]));
    const sc = 0.55 + inten * 0.9; spiral.scale.set(sc, 1, sc); glow.scale.set(0.6 + inten * 1.4, 0.6 + inten * 1.4, 1);
    glow.material.opacity = 0.5 + 0.5 * inten;
    if (OS.FX) { OS.FX.storm.set(p[0], p[1], 0.25 + 0.75 * inten); spiral.visible = glow.visible = !OS.FX.on; }
    S.hud('storm', `${STAGE[Math.round(curDay) - 1]} · ${Math.round(wind)} kt`, () => new THREE.Vector3(group.position.x, 0.08, group.position.z), 'storm', 24 + inten * 26);
    S.setHiGlow(clamp((sampleArr(FUEL, curDay) - 58) / 33, 0, 1));
    applyWake(curDay);
  }
  syncUI();
};
function syncUI() {
  if (!root) return;
  const d = curDay, i = Math.round(d) - 1;
  daySlider.set(d);
  stepper.querySelectorAll('span').forEach((s, n) => { s.classList.toggle('on', n === i); s.classList.toggle('past', n < i); });
  const fuel = sampleArr(FUEL, d), ri = sampleArr(RI, d), wind = sampleArr(WIND, d), pr = sampleArr(PRESS, d);
  gauge.set((fuel - 40) / 60, fuel.toFixed(0), 'kJ/cm² ocean heat under the eye');
  riStat.querySelector('.v').innerHTML = `${ri.toFixed(0)}<small>%</small>`;
  riStat.classList.toggle('storm', ri > 50);
  windStat.querySelector('.v').innerHTML = `${wind.toFixed(0)}<small>kt</small>`; windStat.querySelector('.k').textContent = `Wind · ${pr.toFixed(0)} hPa`;
}
V.play = function () {
  if (playing) return;
  if (curDay >= 5.98) V.setDay(1);
  playBtn.textContent = 'Pause'; Store.set({ cyclonePlaying: true });
  const from = curDay, len = (6 - from) / 5 * 9000;
  playing = U.tween(len, (e, t) => V.setDay(lerp(from, 6, t)), () => { playing = null; playBtn.textContent = 'Replay the storm'; Store.set({ cyclonePlaying: false }); if (predictGuess) reveal(); }, (t) => t);
};
V.pause = function () { if (playing) { playing.cancel(); playing = null; playBtn.textContent = 'Play'; Store.set({ cyclonePlaying: false }); } };
V.isPlaying = () => !!playing;

function reveal() {
  const [lon, lat, v] = V.coolestPoint();
  revealMarker.position.set(S.lonToX(lon), 0, S.latToZ(lat)); revealMarker.visible = true;
  S.hud('reveal', `Coolest wake here`, () => new THREE.Vector3(revealMarker.position.x, 0.1, revealMarker.position.z), 'storm', 8);
  const km = U.km(predictGuess[0], predictGuess[1], lon, lat);
  predictNote.textContent = `The strongest cooling was near ${fmtLat(Math.round(lat * 10) / 10)}, ${fmtLon(Math.round(lon * 10) / 10)}, about ${Math.round(km)} km from your guess. ${km < 120 ? 'Very close.' : km < 300 ? 'Not bad: the cooling sits to the right of the track, where the storm dwelt longest.' : 'The cooling sits to the right of the track and where the storm lingered near peak strength.'}`;
  predictNote.hidden = false; predictGuess = null;
}

V.mount = function (r) {
  root = r;
  root.appendChild(el(`<p class="eyebrow">View 3 of 6</p>`));
  root.appendChild(el(`<h1>Cyclone Lab</h1>`));
  root.appendChild(el(`<p class="lede">Replay Cyclone Amphan day by day and watch the ocean that fed it: warm water in front, a cold scar behind.</p>`));

  const g1 = UI.group('Timeline', '16–21 May 2020');
  daySlider = UI.slider({ id: 'day', label: 'Day', min: 1, max: 6, step: 0.01, value: curDay, fmt: (v) => `${DATES[Math.round(v) - 1]} 2020`, onInput: (v) => { V.pause(); V.setDay(v); } });
  g1.appendChild(daySlider);
  stepper = el(`<div class="stepper">${STAGE.map((s) => `<span>${s}</span>`).join('')}</div>`); g1.appendChild(stepper);
  playBtn = UI.btn('Play', () => { if (playing) V.pause(); else V.play(); }, 'storm'); g1.appendChild(playBtn);
  root.appendChild(g1);

  const g2 = UI.group('Fuel gauge');
  gauge = UI.gauge('var(--storm)'); g2.appendChild(gauge);
  g2.appendChild(el(`<p class="note">Warm water above the 26 °C line is the storm's fuel. The line glows warmer on the cake as the fuel rises.</p>`));
  const row = el(`<div class="stat-row"></div>`);
  riStat = UI.stat('Rapid intensification, next 24 h', '0'); windStat = UI.stat('Wind', '0'); row.append(riStat, windStat); g2.appendChild(row);
  root.appendChild(g2);

  const g3 = UI.group('Predict, then reveal');
  g3.appendChild(el(`<p class="note">Before you press play, guess where the ocean will cool the most. Then watch the wake form.</p>`));
  predictChip = el(`<button type="button" class="chip storm" aria-pressed="false">Place my guess</button>`);
  predictChip.addEventListener('click', () => setPredict(!predictMode));
  const cr = el(`<div class="chips"></div>`); cr.appendChild(predictChip); g3.appendChild(cr);
  predictNote = el(`<p class="note" hidden></p>`); g3.appendChild(predictNote);
  root.appendChild(g3);
  const g4 = UI.group('Reading the cake');
  g4.appendChild(el(`<p class="note">The cut face south of the track shows how deep the warm layer runs: that depth is the fuel. The blue-grey tint on the surface is water the storm cooled; it warms back over a few days.</p>`));
  g4.appendChild(UI.chips([{ v: 'a', label: 'Cut under the track' }, { v: 'b', label: 'Whole ocean' }], (v) => S.animateKnife(v === 'a' ? [80, 9.5, 400] : [100, -15, 0], 1000)));
  root.appendChild(g4);
  syncUI();
};
function setPredict(on) {
  predictMode = on; predictChip.setAttribute('aria-pressed', String(on)); S.setClickMode(on ? 'pin' : 'float');
  if (on) { V.pause(); V.setDay(1); U.toast('Click the ocean where you think it will cool most'); }
}
V.enter = function () {
  active = true; showMarker(true);
  if (S.state.var !== 'T') S.setVar('T');
  S.setIdle(false);
  S.flyTo({ r: 6.4, theta: 0.12, phi: 0.92, target: [S.lonToX(87), -S.view.H * 0.22, S.latToZ(15)] }, 1500);
  S.animateKnife([80, 9.5, 400], 1400);
  S.setClickMode(predictMode ? 'pin' : 'float');
  V.setDay(Store.get('day') || 1, true);
  unsub.push(S.onSurfaceClick((info) => {
    if (info.mode !== 'pin' || info.land) return;
    predictGuess = [info.lon, info.lat]; guessMarker.position.set(S.lonToX(info.lon), 0, S.latToZ(info.lat)); guessMarker.visible = true; revealMarker.visible = false; S.hudHide('reveal');
    S.hud('guess', 'Your guess', () => new THREE.Vector3(guessMarker.position.x, 0.1, guessMarker.position.z), '', 8);
    setPredict(false); predictNote.hidden = true; U.toast('Guess placed. Press Play to watch the wake.');
  }));
  unsub.push(S.onFrame((dt) => { if (spiral) spiral.rotation.y -= dt * (0.8 + 2.5 * clamp((sampleArr(WIND, curDay) - 30) / 100, 0, 1)); }));
  unsub.push(Store.on('day', (d) => { if (Math.abs(d - curDay) > 0.005) V.setDay(d, true); }));
};
V.leave = function () {
  active = false; V.pause(); unsub.forEach((f) => f()); unsub = [];
  showMarker(false); S.setWake(null); S.setHiGlow(0); wakeCache = -1; S.setClickMode('float'); if (predictMode) setPredict(false);
};
/* Used by Story Mode: keep marker + wake alive while another view is active */
V.attachExternal = function () { active = true; showMarker(true); V.setDay(curDay, true); };
V.detachExternal = function () { active = false; showMarker(false); S.setWake(null); S.setHiGlow(0); wakeCache = -1; };
OS.Views.cyclone = V;
})(window.OS);
