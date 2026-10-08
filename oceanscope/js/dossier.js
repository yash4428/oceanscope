/* Dive dossier: click a point in the ocean and open a full water-column panel for that spot */
(function (OS) {
'use strict';
const U = OS.U, { $, el, clamp, lerp, fmtLon, fmtLat, fmtDepth } = U, UI = OS.UI, S = OS.Scene, Store = OS.Store, Oc = OS.Ocean;
const D = {};
let root, chart, cursorOut, depthSlider, site = null, prof = null, depth = 0, open = false, dragging = false, floorD = 0, prevKnife = null, hidSheets = [];
const DEPTHS = []; for (let i = 0; i <= 220; i++) DEPTHS.push(Math.round(2000 * Math.pow(i / 220, 2)));

function build() {
  root = el(`<section id="dossier" hidden aria-label="Water column">
    <div class="d-head"><div><p class="eyebrow d-eye">Inside the ocean</p><h3 class="d-title"></h3><p class="d-sub"></p></div><button type="button" class="x d-close" aria-label="Close">×</button></div>
    <div class="d-body">
      <div class="d-col">
        <canvas class="d-chart" aria-label="Vertical profiles at this point"></canvas>
        <div class="d-legend"><span><i style="background:#ea7d5a"></i>Temperature</span><span><i style="background:#3b9981"></i>Salinity</span><span><i style="background:#4E5FB5"></i>Sound speed</span><span><i style="background:#C4472F"></i>Model error</span></div>
        <div class="row"><div class="row-top"><label for="d-depth">Depth cursor</label><output class="d-cur"></output></div><input id="d-depth" type="range" min="0" max="1000" step="1" value="0"></div>
        <div class="d-at"></div>
      </div>
      <div class="d-cards"></div>
    </div>
  </section>`);
  $('stage').appendChild(root);
  chart = root.querySelector('.d-chart'); cursorOut = root.querySelector('.d-cur'); depthSlider = root.querySelector('#d-depth');
  root.querySelector('.d-close').addEventListener('click', D.close);
  depthSlider.addEventListener('input', () => setDepth(sliderToDepth(+depthSlider.value)));
  const ptr = (e) => { const r = chart.getBoundingClientRect(); const y = (e.clientY - r.top) / r.height; setDepth(yToDepth(y)); };
  chart.addEventListener('pointerdown', (e) => { dragging = true; chart.setPointerCapture(e.pointerId); ptr(e); });
  chart.addEventListener('pointermove', (e) => { if (dragging) ptr(e); });
  chart.addEventListener('pointerup', () => { dragging = false; }); chart.addEventListener('pointercancel', () => { dragging = false; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) D.close(); });
  window.addEventListener('resize', () => { if (open) draw(); });
}
const zMax = () => Math.min(2000, Math.max(300, floorD));
const sliderToDepth = (v) => zMax() * Math.pow(v / 1000, 2), depthToSlider = (d) => Math.sqrt(clamp(d, 0, zMax()) / zMax()) * 1000;
const yToDepth = (y) => zMax() * Math.pow(clamp(y, 0, 1), 2);
const T0 = 8, B0 = 26;

function computeProfile(lon, lat) {
  const p = S.profileAt(lon, lat, DEPTHS);
  const c = DEPTHS.map((d, i) => OS.Views.sonar.mackenzie(p.T[i], p.S[i], d));
  const err = DEPTHS.map((d) => S.valueAt('D', lon, lat, d));
  const spd = DEPTHS.map((d) => { const v = S.surfaceVel(lon, lat, d); return Math.hypot(v[0], v[1]); });
  const fuel = DEPTHS.reduce((sum, d, i) => { if (i === 0 || p.T[i] <= 26) return sum; return sum + (p.T[i] - 26) * (DEPTHS[i] - DEPTHS[i - 1]); }, 0) * 0.41;
  return { T: p.T, S: p.S, c, err, spd, mld: p.mld, sst: p.sst, sss: p.sss, fuel, d26: S.d26At(lon, lat) };
}
const at = (arr, d) => { const i = DEPTHS.findIndex((x) => x >= d); if (i <= 0) return arr[0]; const f = (d - DEPTHS[i - 1]) / (DEPTHS[i] - DEPTHS[i - 1]); return lerp(arr[i - 1], arr[i], f); };

const snowP = []; for (let i = 0; i < 70; i++) snowP.push({ x: Math.random(), y: Math.random(), s: 0.6 + Math.random() * 1.6, v: 0.01 + Math.random() * 0.03, ph: Math.random() * 6.28 });
let loopRaf = 0, lastT = 0;
function draw() {
  if (!prof) return;
  const now = performance.now(), dtl = lastT ? Math.min(0.1, (now - lastT) / 1000) : 0; lastT = now;
  const cine = document.body.classList.contains('cine'), P = U.pal();
  const dpr = Math.min(window.devicePixelRatio || 1, 2), cw = chart.clientWidth, ch = chart.clientHeight; if (cw < 10) return;
  if (chart.width !== Math.round(cw * dpr) || chart.height !== Math.round(ch * dpr)) { chart.width = cw * dpr; chart.height = ch * dpr; }
  const g = chart.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, cw, ch);
  const L = 46, R = 12, T = T0, B = B0, w = cw - L - R, h = ch - T - B, zm = zMax();
  const Y = (d) => T + Math.sqrt(clamp(d, 0, zm) / zm) * h;
  if (cine) {
    /* sunlight fading into the deep */
    const bg = g.createLinearGradient(0, T, 0, T + h);
    bg.addColorStop(0, 'rgba(70,190,230,0.55)'); bg.addColorStop(0.18, 'rgba(22,110,160,0.45)'); bg.addColorStop(0.5, 'rgba(8,40,74,0.6)'); bg.addColorStop(1, 'rgba(2,8,18,0.95)');
    g.fillStyle = bg; g.fillRect(L, T, w, h);
    /* god rays */
    g.save(); g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 4; i++) { const x0 = L + w * (0.15 + i * 0.24) + Math.sin(now / 1800 + i) * 10; const gr = g.createLinearGradient(0, T, 0, T + h * 0.55); gr.addColorStop(0, 'rgba(160,235,255,0.16)'); gr.addColorStop(1, 'rgba(160,235,255,0)'); g.fillStyle = gr; g.beginPath(); g.moveTo(x0 - 6, T); g.lineTo(x0 + 6, T); g.lineTo(x0 + 34, T + h * 0.55); g.lineTo(x0 - 20, T + h * 0.55); g.closePath(); g.fill(); }
    /* marine snow */
    snowP.forEach((q) => { q.y += q.v * dtl; if (q.y > 1) { q.y = 0; q.x = Math.random(); } const x = L + (q.x + Math.sin(now / 2000 + q.ph) * 0.01) * w, y = T + q.y * h; g.fillStyle = `rgba(190,240,255,${0.25 + 0.35 * (1 - q.y)})`; g.beginPath(); g.arc(x, y, q.s * 0.7, 0, 6.283); g.fill(); });
    g.restore();
    /* temperature ribbon on the left edge */
    for (let y = 0; y < h; y += 2) { const d = zm * Math.pow(y / h, 2); const c = Oc.cmapAt('T', (at(prof.T, d) - 2) / 28); g.fillStyle = `rgb(${c[0] * 255 | 0},${c[1] * 255 | 0},${c[2] * 255 | 0})`; g.fillRect(L, T + y, 6, 2); }
  } else {
    for (let y = 0; y < h; y++) { const d = zm * Math.pow(y / h, 2); const t = at(prof.T, d); const c = Oc.cmapAt('T', (t - 2) / 28); g.fillStyle = `rgba(${c[0] * 255 | 0},${c[1] * 255 | 0},${c[2] * 255 | 0},0.28)`; g.fillRect(L, T + y, w, 1.5); }
  }
  if (floorD < zm) { const fy = Y(floorD); const fg = g.createLinearGradient(0, fy, 0, T + h); fg.addColorStop(0, cine ? '#5A5147' : '#74716A'); fg.addColorStop(1, cine ? '#1E1A16' : '#5E5B55'); g.fillStyle = fg; g.fillRect(L, fy, w, T + h - fy); }
  g.strokeStyle = cine ? 'rgba(220,245,255,0.35)' : 'rgba(28,42,53,0.35)'; g.setLineDash([4, 4]); g.lineWidth = 1;
  [[prof.mld, 'mixed layer', 'bottom', -1], [prof.d26 > 0 ? prof.d26 : -1, '26 °C', 'top', 2]].forEach(([d, lab, base, off]) => { if (d <= 0 || d > zm) return; g.beginPath(); g.moveTo(L, Y(d)); g.lineTo(L + w, Y(d)); g.stroke(); g.fillStyle = cine ? '#CFEFF7' : '#556570'; g.font = '500 11px "Barlow Semi Condensed", sans-serif'; g.textAlign = 'right'; g.textBaseline = base; g.fillText(`${lab} ${Math.round(d)} m`, L + w - 4, Y(d) + off); });
  g.setLineDash([]);
  g.strokeStyle = P.grid; g.fillStyle = P.text; g.font = '500 12px "Barlow Semi Condensed", sans-serif'; g.textAlign = 'right'; g.textBaseline = 'middle';
  [0, 50, 100, 200, 400, 700, 1000, 1500, 2000].filter((d) => d <= zm).forEach((d) => { const y = Math.round(Y(d)) + 0.5; g.beginPath(); g.moveTo(L, y); g.lineTo(L + w, y); g.stroke(); g.fillText(`${d} m`, L - 6, y); });
  /* species at their depths */
  if (cine && OS.Views.learn.SPECIES) {
    g.font = '15px serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    OS.Views.learn.SPECIES.filter((q) => q.d < Math.min(zm, floorD)).forEach((q, i) => { const y = Y(q.d) + Math.sin(now / 900 + i) * 2, x = L + w - 16 - (i % 3) * 18 + Math.cos(now / 1300 + i) * 3; g.globalAlpha = 0.85; g.fillText(q.ic, x, y); });
    g.globalAlpha = 1;
  }
  const curve = (arr, color, lo, hi, width) => { g.strokeStyle = color; g.lineWidth = width || 2; if (cine) { g.shadowColor = color; g.shadowBlur = 10; } g.beginPath(); DEPTHS.forEach((d, i) => { if (d > Math.min(zm, floorD)) return; const x = L + clamp((arr[i] - lo) / (hi - lo), 0, 1) * (w - 22) + 10, y = Y(d); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); g.shadowBlur = 0; };
  curve(prof.T, cine ? '#FF9A6B' : '#ea7d5a', 0, 31, cine ? 2.4 : 2);
  curve(prof.S, cine ? '#4BE3B0' : '#3b9981', 33, 36.8, cine ? 2.2 : 2);
  curve(prof.c, cine ? '#9AA8FF' : '#4E5FB5', 1460, 1550, cine ? 2.2 : 2);
  curve(prof.err, cine ? '#FF6F59' : '#C4472F', 0, 2.6, 1.5);
  const yc = Y(depth);
  if (cine) { g.shadowColor = '#56D4E8'; g.shadowBlur = 12; }
  g.strokeStyle = cine ? '#BFF6FB' : '#1C2A35'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(L, yc); g.lineTo(L + w, yc); g.stroke();
  g.fillStyle = cine ? '#56D4E8' : '#1F6FA8'; g.beginPath(); g.arc(L, yc, 4.5, 0, Math.PI * 2); g.fill(); g.beginPath(); g.arc(L + w, yc, 4.5, 0, Math.PI * 2); g.fill();
  g.shadowBlur = 0;
  g.strokeStyle = P.frame; g.lineWidth = 1; g.strokeRect(L + 0.5, T + 0.5, w - 1, h - 1);
}
function loop() { if (!open) { loopRaf = 0; return; } if (document.body.classList.contains('cine') && !U.reduceMotion) draw(); loopRaf = requestAnimationFrame(loop); }
function setDepth(d) {
  depth = clamp(d, 0, Math.min(zMax(), floorD)); depthSlider.value = depthToSlider(depth);
  cursorOut.textContent = depth < 1 ? 'Surface' : fmtDepth(Math.round(depth));
  const t = at(prof.T, depth), sa = at(prof.S, depth), c = at(prof.c, depth), e = at(prof.err, depth), sp = at(prof.spd, depth);
  const band = depth <= 200 ? 'Sunlit zone' : depth <= 1000 ? 'Twilight zone' : 'Midnight zone';
  root.querySelector('.d-at').innerHTML = `<b>${band}</b><span>${t.toFixed(1)} °C</span><span>${sa.toFixed(2)} PSU</span><span>${c.toFixed(0)} m/s sound</span><span>${sp < 0.01 ? 'still' : sp.toFixed(2) + ' m/s flow'}</span><span class="e">±${e.toFixed(2)} °C model error</span>`;
  S.setProbe(site.lon, site.lat, depth);
  draw();
}
function card(title, html, cls) { return el(`<div class="d-card ${cls || ''}"><h4>${title}</h4>${html}</div>`); }
function buildCards() {
  const host = root.querySelector('.d-cards'); host.innerHTML = '';
  const { lon, lat } = site;
  /* Water */
  const v = S.surfaceVel(lon, lat, 0), spd = Math.hypot(v[0], v[1]), brg = (Math.atan2(v[0], v[1]) * 180 / Math.PI + 360) % 360;
  host.appendChild(card('This water', `<div class="kv"><span>Surface</span><b>${prof.sst.toFixed(1)} °C · ${prof.sss.toFixed(2)} PSU</b><span>Mixed layer</span><b>${Math.round(prof.mld)} m</b><span>26 °C line</span><b>${prof.d26 > 0 ? fmtDepth(Math.round(prof.d26)) : 'not reached'}</b><span>Seafloor</span><b>${fmtDepth(Math.round(floorD / 10) * 10)}</b><span>Surface current</span><b>${spd < 0.02 ? 'calm' : `${spd.toFixed(2)} m/s toward ${U.compass(brg)}`}</b></div>`));
  /* Cyclone fuel */
  const cy = OS.Views.cyclone, dTrack = Math.min(...cy.TRACK.map((p) => U.km(lon, lat, p[0], p[1])));
  const fuelPct = clamp(prof.fuel / 110, 0, 1);
  host.appendChild(card('Cyclone fuel', `<div class="d-bar"><i style="width:${Math.round(fuelPct * 100)}%"></i></div><div class="kv"><span>Ocean heat above 26 °C</span><b>${prof.fuel.toFixed(0)} kJ/cm²</b><span>Amphan's track</span><b>${dTrack < 250 ? `${Math.round(dTrack)} km away` : `${Math.round(dTrack)} km away`}</b></div><p class="note">${prof.fuel > 70 ? 'Plenty of fuel here: a storm passing over this water could intensify fast.' : prof.fuel > 35 ? 'Moderate fuel. A storm would draw on it but not explode.' : 'Little fuel. Storms weaken over water like this.'}</p><button type="button" class="chip storm" data-act="cyclone">Open Cyclone Lab</button>`, 'storm'));
  /* Truth meter */
  const errHere = S.valueAt('D', lon, lat, Math.max(prof.d26, 60)), ni = S.nearestFloat(lon, lat), nf = S.floats[ni], nkm = U.km(lon, lat, nf.lon, nf.lat);
  const ranked = OS.Views.truth.recommend ? OS.Views.truth.recommend() : [];
  const rankPos = ranked.findIndex((r) => r.i === ni);
  host.appendChild(card('Truth Meter', `<div class="kv"><span>Model error here</span><b class="${errHere > 0.6 ? 'bad' : ''}">${errHere.toFixed(2)} °C at the thermocline</b><span>Nearest float</span><b>${nf.id} · ${Math.round(nkm)} km</b><span>Its average error</span><b class="${nf.errT > 0.5 ? 'bad' : ''}">${nf.errT.toFixed(2)} °C${rankPos >= 0 ? ` · #${rankPos + 1} most wrong` : ''}</b></div><p class="note">${errHere > 0.6 ? 'The model struggles here: restless water where eddies move the thermocline around.' : errHere > 0.35 ? 'Ordinary disagreement. The model gets the shape right and the depth slightly wrong.' : 'The model and the floats agree well in this water.'}</p><div class="chips"><button type="button" class="chip" data-act="float">Open float ${nf.id}</button><button type="button" class="chip" data-act="truth">Truth Meter map</button></div>`, 'error'));
  /* Sonar */
  const q = OS.Views.sonar.quick(lon, lat);
  host.appendChild(card('Sonar', `<div class="kv"><span>Quiet zone starts</span><b>${q.start < 0 ? 'none within 40 km' : `${q.start.toFixed(1)} km out`}</b><span>Water in shadow</span><b>${Math.round(q.quietFrac * 100)}%</b><span>Sound speed at surface</span><b>${q.cSurf.toFixed(0)} m/s</b></div><button type="button" class="chip" data-act="sonar">Trace rays here</button>`, 'sonar'));
  /* Life */
  const sp = OS.Views.learn.SPECIES.filter((s) => s.d < floorD);
  const bands = [['Sunlit', sp.filter((s) => s.d <= 200)], ['Twilight', sp.filter((s) => s.d > 200 && s.d <= 1000)], ['Midnight', sp.filter((s) => s.d > 1000)]];
  const omz = lon > 62 && lon < 73.5 && lat > 8 && lat < 21.5;
  host.appendChild(card('Who lives here', `${bands.map(([b, list]) => `<div class="d-life"><b>${b}</b><span>${list.length ? list.map((s) => `<i title="${s.n}">${s.ic}</i>`).join('') : '<em>too shallow</em>'}</span></div>`).join('')}${omz ? '<p class="note omz-note">Low-oxygen zone between 150 and 1,000 m: the twilight band is nearly empty here.</p>' : ''}<button type="button" class="chip" data-act="life">Marine life map</button>`, 'life'));
  /* Actions */
  host.appendChild(card('Do something here', `<div class="chips"><button type="button" class="chip" data-act="cut">Cut the cake here</button><button type="button" class="chip rescue" data-act="sar">Search from here</button><button type="button" class="chip" data-act="copilot">Ask the copilot</button></div>`));
  host.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => act(b.dataset.act, { lon, lat, ni, nf })));
}
function act(a, ctx) {
  const { lon, lat, ni, nf } = ctx;
  if (a === 'cut') { prevKnife = null; D.close(); S.animateKnife([lon, lat, Math.min(1200, floorD)], 1100); return; }
  if (a === 'float') { D.close(); S.flyToLL(nf.lon, nf.lat, 4.2, 1300, () => S.selectFloat(ni)); return; }
  if (a === 'copilot') { OS.Copilot.open(true); $('cp-in').value = `What is happening at ${fmtLat(Math.round(lat * 10) / 10)}, ${fmtLon(Math.round(lon * 10) / 10)}?`; return; }
  D.close();
  if (a === 'cyclone') OS.App.go('cyclone');
  if (a === 'truth') OS.App.go('truth').then(() => OS.Views.truth.goTo(ni));
  if (a === 'sonar') { Store.set({ sonarSite: { lon, lat, label: 'Dive point' } }); OS.App.go('sonar'); }
  if (a === 'life') OS.App.go('learn').then(() => { OS.Views.learn.openTab('life'); OS.Views.learn.setLife(true); });
  if (a === 'sar') OS.App.go('sar').then(() => OS.Views.sar.drop(lon, lat));
}

function regionName(lon, lat) {
  if (lon > 78 && lat > 5) return lat > 18 ? 'Head of the Bay of Bengal' : lon > 91.5 ? 'Andaman Sea' : 'Bay of Bengal';
  if (lon < 58.5 && lat > 3 && lat < 12.5) return 'Somali Basin · Great Whirl';
  if (lon > 70 && lon < 75.5 && lat > -8 && lat < 14) return 'Lakshadweep–Maldives Ridge';
  if (lat > 18 && lon < 67) return 'Arabian Sea · Oman coast';
  if (lat < -3) return 'Southern Indian Ocean';
  if (lat < 4) return 'Equatorial Indian Ocean';
  return 'Arabian Sea';
}
function countUp() {
  root.querySelectorAll('.d-card .kv b').forEach((b, i) => {
    const m = b.textContent.match(/^(-?\d[\d,]*(?:\.\d+)?)(.*)$/s); if (!m) return;
    const raw = m[1].replace(/,/g, ''), to = parseFloat(raw), dec = (raw.split('.')[1] || '').length, rest = m[2], comma = m[1].includes(',');
    U.tween(900 + i * 60, (e) => { const v = to * e; b.textContent = (comma ? Math.round(v).toLocaleString('en-US') : v.toFixed(dec)) + rest; }, null, U.easeOut);
  });
}
function showPanel() {
  root.hidden = false; $('profile').hidden = true;
  buildCards(); setDepth(depth);
  if (document.body.classList.contains('cine')) countUp();
  requestAnimationFrame(() => { draw(); setTimeout(draw, 320); });
  if (!loopRaf) loop();
}
let seq = [];
const later = (ms, fn) => { seq.push(setTimeout(fn, ms)); };
D.open = function (lon, lat, startDepth) {
  if (!root) build();
  seq.forEach(clearTimeout); seq = [];
  site = { lon, lat }; floorD = S.seafloorAt(lon, lat); prof = computeProfile(lon, lat); open = true; depth = clamp(startDepth || 0, 0, floorD);
  $('stage').classList.add('diving');
  const region = regionName(lon, lat), coords = `${fmtLat(Math.round(lat * 10) / 10)} · ${fmtLon(Math.round(lon * 10) / 10)}`;
  root.querySelector('.d-title').textContent = `${fmtLat(Math.round(lat * 10) / 10)}, ${fmtLon(Math.round(lon * 10) / 10)}`;
  root.querySelector('.d-sub').textContent = `${region} · water column to ${fmtDepth(Math.round(floorD / 10) * 10)} · drag the cursor or the chart to move through the depths`;
  S.setIdle(false); S.deselect();
  if (!prevKnife) prevKnife = { lon: S.knife.lon, lat: S.knife.lat, depth: S.knife.depth };
  ['d26', 'mld', 'd20'].forEach((n) => { if (S.sheetVisible(n) && !hidSheets.includes(n)) { hidSheets.push(n); S.showSheet(n, false); } });
  const x = S.lonToX(lon), z = S.latToZ(lat);
  const theta = 0.7, wide = window.innerWidth > 760, shift = wide ? 0.95 : 0, right = [Math.cos(theta) * shift, 0, -Math.sin(theta) * shift];
  const settle = { r: 3.1, theta, phi: 1.14, target: [x + right[0], S.depthToY(Math.min(600, floorD * 0.5)), z + right[2]], fov: 32 };
  const cinematic = OS.FX && OS.FX.on && !U.reduceMotion && !(OS.Film && OS.Film.playing());
  if (!cinematic) {
    root.hidden = true;
    S.animateKnife([lon, lat, Math.min(2000, floorD)], 1200);
    S.flyTo(settle, 1400);
    showPanel();
    return;
  }
  /* 1: swoop down to the water where you clicked */
  root.hidden = true; S.lockInput = true;
  OS.FX.ripple(x, z, 1.4); OS.FX.letterbox(true);
  OS.FX.title(region, `${coords} · ${fmtDepth(Math.round(floorD / 10) * 10)} deep`, 3300);
  S.flyTo({ r: 1.0, theta: S.cam.theta + 0.35, phi: 1.3, target: [x, -0.01, z], arc: 0.22, fov: 40, ease: U.easeInOut, lock: true }, 1500, () => {
    /* 2: plunge under the surface while the knife excavates the column */
    OS.FX.plunge();
    S.animateKnife([lon, lat, Math.min(2000, floorD)], 1150);
    S.flyTo(Object.assign({}, settle, { ease: U.easeOut, lock: true }), 1600, () => { S.lockInput = false; OS.FX.letterbox(false); });
    later(380, showPanel);
  });
};
D.close = function () {
  if (!open) return; open = false; seq.forEach(clearTimeout); seq = [];
  root.hidden = true; $('stage').classList.remove('diving'); S.hideProbe(); S.lockInput = false;
  if (OS.FX) { OS.FX.letterbox(false); OS.FX.hideTitle(); }
  if (S.camera.fov !== 32) { S.camera.fov = 32; S.camera.updateProjectionMatrix(); }
  hidSheets.forEach((n) => S.showSheet(n, true)); hidSheets = [];
  if (prevKnife) { const k = prevKnife; prevKnife = null; S.animateKnife([k.lon, k.lat, k.depth], 900); }
};
D.redraw = () => { if (open) draw(); };
D.isOpen = () => open;
OS.Dossier = D;
})(window.OS);
