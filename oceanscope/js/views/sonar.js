/* View 5: Sonar — quiet-zone ray tracer (Mackenzie sound speed, Snell's law) */
(function (OS) {
'use strict';
const U = OS.U, { el, clamp, lerp, fmtLon, fmtLat, fmtDepth } = U, UI = OS.UI, S = OS.Scene, Store = OS.Store;
const V = { id: 'sonar', title: 'Sonar', icon: '<path d="M4 12a8 8 0 0 1 16 0"/><path d="M7 12a5 5 0 0 1 10 0"/><path d="M10 12a2 2 0 0 1 4 0"/><path d="M12 12v8"/>' };

const ZMAX = 1000, DZ = 4, NZ = ZMAX / DZ + 1, RMAX = 40; // km
const depths = []; for (let i = 0; i < NZ; i++) depths.push(i * DZ);
function mackenzie(T, Sa, D) { return 1448.96 + 4.591 * T - 5.304e-2 * T * T + 2.374e-4 * T * T * T + 1.340 * (Sa - 35) + 1.630e-2 * D + 1.675e-7 * D * D - 1.025e-2 * T * (Sa - 35) - 7.139e-13 * T * D * D * D; }
V.mackenzie = mackenzie;

const PRESETS = {
  calm: { label: 'Calm sea', src: 20, note: 'A warm, shallow mixed layer bends sound downward. Anything just below the layer sits in a quiet zone.' },
  storm: { label: 'After a cyclone', src: 20, note: 'The storm mixed the top 100 m: cooler and deeper layer, the quiet zone moves out and down.' },
  sub: { label: 'Submarine below the layer', src: 12, note: 'A shallow sonar looking for something below the layer. Rays refract down, then away; the target hides in the shadow.' }
};
let root, sheet, rayCanvas, sspCanvas, kv, site = { lon: 88, lat: 15, label: 'Bay of Bengal' }, preset = 'calm', srcDepth = 20, fan = 12, marker, unsub = [], noteEl, presetChips, srcSlider, fanSlider, siteEl, linkEl;
let lastResult = null;

function profile() {
  const p = S.profileAt(site.lon, site.lat, depths);
  let T = p.T.slice(), Sa = p.S.slice();
  if (preset === 'storm') {
    const shifted = depths.map((d) => { const dd = Math.min(ZMAX, d + 45); const i = Math.min(NZ - 1, Math.round(dd / DZ)); return p.T[i]; });
    T = shifted.map((t, i) => t - 0.9 * Math.exp(-depths[i] / 70));
  }
  const c = depths.map((d, i) => mackenzie(T[i], Sa[i], d));
  return { T, S: Sa, c, mld: p.mld, sst: p.sst };
}
function trace(prof) {
  const c = prof.c, cAt = (z) => { const f = clamp(z, 0, ZMAX) / DZ, i = Math.min(NZ - 2, Math.floor(f)); return lerp(c[i], c[i + 1], f - i); };
  const bottom = Math.min(ZMAX, Math.max(300, S.seafloorAt(site.lon, site.lat)));
  const dr = 0.05, nR = Math.round(RMAX / dr), rays = [], GX = 160, GY = 100, cov = new Uint8Array(GX * GY);
  const nRays = 33;
  for (let n = 0; n < nRays; n++) {
    const th0 = (-fan + 2 * fan * n / (nRays - 1)) * Math.PI / 180;
    let z = srcDepth, th = th0; const A = cAt(z) / Math.cos(th0); const pts = [0, z]; let turns = 0;
    for (let s = 1; s <= nR; s++) {
      const r = s * dr; const dz = Math.tan(th) * dr * 1000;
      z += dz;
      if (z < 0) { z = -z; th = -th; turns++; }
      if (z > bottom) { z = 2 * bottom - z; th = -th; turns++; }
      const cs = cAt(z) / A;
      if (cs >= 1) { th = -th; } else { th = Math.sign(th || 1) * Math.acos(cs); }
      if (s % 4 === 0) pts.push(r, z);
      const gx = Math.min(GX - 1, Math.floor(r / RMAX * GX)), gy = Math.min(GY - 1, Math.floor(z / ZMAX * GY)); cov[gy * GX + gx] = 1;
      if (turns > 6) break;
    }
    rays.push({ th0, pts });
  }
  /* smear coverage a little so gaps between rays don't read as shadow */
  const cov2 = new Uint8Array(cov);
  for (let y = 0; y < GY; y++) for (let x = 0; x < GX; x++) { if (!cov[y * GX + x]) continue; for (let dy = -2; dy <= 2; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < GY && xx >= 0 && xx < GX) cov2[yy * GX + xx] = 1; } }
  /* quiet-zone stats at a target depth just under the layer */
  const tDepth = clamp(prof.mld + 60, 60, 400), gy = Math.min(GY - 1, Math.floor(tDepth / ZMAX * GY));
  let start = -1; for (let x = 4; x < GX; x++) if (!cov2[gy * GX + x]) { start = x / GX * RMAX; break; }
  let quiet = 0, tot = 0; for (let y = 0; y < Math.floor(bottom / ZMAX * GY); y++) for (let x = 0; x < GX; x++) { tot++; if (!cov2[y * GX + x]) quiet++; }
  let minC = 1e9, axis = 0; c.forEach((v, i) => { if (v < minC) { minC = v; axis = depths[i]; } });
  return { rays, cov: cov2, GX, GY, bottom, tDepth, start, quietFrac: quiet / tot, axis, minC, cSurf: c[0], layerC: cAt(prof.mld) };
}
function draw() {
  if (!sheet) return;
  const prof = profile(), R = trace(prof); lastResult = R;
  const dpr = Math.min(window.devicePixelRatio || 1, 2), cw = rayCanvas.clientWidth, ch = rayCanvas.clientHeight;
  if (cw < 10 || ch < 10) return;
  rayCanvas.width = cw * dpr; rayCanvas.height = ch * dpr; const g = rayCanvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, cw, ch);
  const L = 44, Rr = 12, T = 10, B = 28, w = cw - L - Rr, h = ch - T - B, zShow = Math.min(ZMAX, Math.max(600, R.bottom + 40));
  const X = (r) => L + r / RMAX * w, Y = (z) => T + Math.sqrt(z / zShow) * h;
  /* water gradient */
  const grd = g.createLinearGradient(0, T, 0, T + h); const P = U.pal(), cine = document.body.classList.contains('cine'); grd.addColorStop(0, cine ? '#12476A' : '#E9F1F6'); grd.addColorStop(0.35, cine ? '#0A2A45' : '#DDE8EE'); grd.addColorStop(1, cine ? '#030C16' : '#C9D8E2'); g.fillStyle = grd; g.fillRect(L, T, w, h);
  /* quiet zone shading */
  g.fillStyle = cine ? 'rgba(120,110,255,0.20)' : 'rgba(78,95,181,0.22)';
  for (let y = 0; y < R.GY; y++) { const z0 = y / R.GY * ZMAX, z1 = (y + 1) / R.GY * ZMAX; if (z0 > R.bottom) break; let x = 0; while (x < R.GX) { if (R.cov[y * R.GX + x]) { x++; continue; } let x2 = x; while (x2 < R.GX && !R.cov[y * R.GX + x2]) x2++; g.fillRect(X(x / R.GX * RMAX), Y(z0), X(x2 / R.GX * RMAX) - X(x / R.GX * RMAX), Y(Math.min(z1, R.bottom)) - Y(z0) + 0.5); x = x2; } }
  /* seafloor */
  g.fillStyle = P.floor; g.fillRect(L, Y(Math.min(R.bottom, zShow)), w, T + h - Y(Math.min(R.bottom, zShow)));
  /* mixed layer line */
  g.strokeStyle = cine ? 'rgba(220,245,255,0.4)' : 'rgba(28,42,53,0.45)'; g.setLineDash([4, 4]); g.lineWidth = 1; g.beginPath(); g.moveTo(L, Y(prof.mld)); g.lineTo(L + w, Y(prof.mld)); g.stroke(); g.setLineDash([]);
  g.fillStyle = P.text; g.font = '500 11px "Barlow Semi Condensed", sans-serif'; g.textAlign = 'right'; g.textBaseline = 'bottom'; g.fillText(`mixed layer ${Math.round(prof.mld)} m`, L + w - 4, Y(prof.mld) - 2);
  /* rays */
  R.rays.forEach((ray) => {
    const k = Math.abs(ray.th0) / (fan * Math.PI / 180);
    if (cine) { g.globalCompositeOperation = 'lighter'; g.strokeStyle = `rgba(90,220,255,${0.42 - k * 0.22})`; g.shadowColor = 'rgba(90,220,255,0.8)'; g.shadowBlur = 4; } else g.strokeStyle = `rgba(28,42,53,${0.55 - k * 0.3})`;
    g.lineWidth = 1; g.beginPath();
    for (let i = 0; i < ray.pts.length; i += 2) { const x = X(ray.pts[i]), y = Y(Math.min(ray.pts[i + 1], zShow)); i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke(); g.globalCompositeOperation = 'source-over'; g.shadowBlur = 0;
  });
  /* source */
  g.fillStyle = '#E0A21B'; g.strokeStyle = P.ink; g.lineWidth = 1.2; if (cine) { g.shadowColor = '#FFB347'; g.shadowBlur = 14; } g.beginPath(); g.arc(X(0), Y(srcDepth), 5, 0, Math.PI * 2); g.fill(); g.stroke();
  /* target for the submarine preset */
  if (preset === 'sub') {
    /* park the submarine in the first real shadow pocket below the layer */
    let tz = clamp(prof.mld + 130, 150, 400), tr = 14;
    const c = (gx, gy) => R.cov[Math.min(R.GY - 1, gy) * R.GX + Math.min(R.GX - 1, gx)];
    search: for (let gx = Math.floor(6 / RMAX * R.GX); gx < Math.floor(30 / RMAX * R.GX); gx++) for (let gy = Math.floor((prof.mld + 40) / ZMAX * R.GY); gy < Math.floor(Math.min(420, R.bottom - 60) / ZMAX * R.GY); gy++) { if (!c(gx, gy) && !c(gx + 1, gy) && !c(gx - 1, gy) && !c(gx, gy + 1)) { tr = (gx + 0.5) / R.GX * RMAX; tz = (gy + 0.5) / R.GY * ZMAX; break search; } }
    const inShadow = !c(Math.floor(tr / RMAX * R.GX), Math.floor(tz / ZMAX * R.GY));
    g.fillStyle = inShadow ? '#4E5FB5' : '#A33A2A'; g.beginPath(); g.ellipse(X(tr), Y(tz), 12, 4, 0, 0, Math.PI * 2); g.fill();
    g.fillRect(X(tr) - 2, Y(tz) - 8, 4, 6);
    g.fillStyle = P.ink; g.font = '600 12px "Barlow Semi Condensed", sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(inShadow ? 'Hidden in the quiet zone' : 'Detected', X(tr) + 16, Y(tz));
    setSub(true, inShadow ? 'Hidden' : 'Detected');
  } else setSub(false);
  /* axes */
  g.shadowBlur = 0; g.strokeStyle = P.grid; g.fillStyle = P.text; g.font = '500 12px "Barlow Semi Condensed", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'top';
  for (let r = 0; r <= RMAX; r += 10) { g.beginPath(); g.moveTo(X(r), T + h); g.lineTo(X(r), T + h + 4); g.stroke(); g.fillText(`${r} km`, X(r), T + h + 6); }
  g.textAlign = 'right'; g.textBaseline = 'middle';
  [0, 50, 100, 200, 400, 700, 1000].filter((z) => z <= zShow).forEach((z) => { g.fillText(`${z} m`, L - 6, Y(z)); });
  g.strokeStyle = P.frame; g.lineWidth = 1; g.strokeRect(L + 0.5, T + 0.5, w - 1, h - 1);
  /* SSP mini chart */
  const sw = sspCanvas.clientWidth, sh = sspCanvas.clientHeight;
  if (sw > 10 && sh > 10) {
    sspCanvas.width = sw * dpr; sspCanvas.height = sh * dpr; const s = sspCanvas.getContext('2d'); s.setTransform(dpr, 0, 0, dpr, 0, 0); s.clearRect(0, 0, sw, sh);
    const l2 = 34, t2 = 8, b2 = 22, w2 = sw - l2 - 8, h2 = sh - t2 - b2, cs = prof.c.slice(0, Math.floor(zShow / DZ) + 1), lo = Math.min(...cs) - 2, hi = Math.max(...cs) + 2;
    const sx = (v) => l2 + (v - lo) / (hi - lo) * w2, sy = (z) => t2 + Math.sqrt(z / zShow) * h2;
    s.strokeStyle = P.grid; s.fillStyle = P.text; s.font = '500 10.5px "Barlow Semi Condensed", sans-serif'; s.textAlign = 'right'; s.textBaseline = 'middle';
    [0, 100, 300, 600, 1000].filter((z) => z <= zShow).forEach((z) => { s.beginPath(); s.moveTo(l2, sy(z)); s.lineTo(l2 + w2, sy(z)); s.stroke(); s.fillText(z, l2 - 4, sy(z)); });
    s.textAlign = 'center'; s.textBaseline = 'top'; s.fillText(`${lo.toFixed(0)}`, sx(lo), t2 + h2 + 4); s.fillText(`${hi.toFixed(0)} m/s`, sx(hi), t2 + h2 + 4);
    s.strokeStyle = cine ? '#9AA8FF' : '#4E5FB5'; s.lineWidth = 2; s.beginPath(); cs.forEach((v, i) => { const x = sx(v), y = sy(depths[i]); i ? s.lineTo(x, y) : s.moveTo(x, y); }); s.stroke();
    s.fillStyle = '#E0A21B'; s.beginPath(); s.arc(sx(prof.c[Math.round(srcDepth / DZ)]), sy(srcDepth), 3.5, 0, Math.PI * 2); s.fill();
  }
  kv.querySelector('.k-start b').textContent = R.start < 0 ? 'none' : `${R.start.toFixed(1)} km`;
  kv.querySelector('.k-frac b').textContent = `${Math.round(R.quietFrac * 100)}%`;
  kv.querySelector('.k-axis b').textContent = R.axis < 4 ? 'surface' : `${Math.round(R.axis)} m`;
  kv.querySelector('.k-c b').textContent = `${R.cSurf.toFixed(0)} m/s`;
  kv.querySelector('.k-td b').textContent = `${Math.round(R.tDepth)} m`;
}
V.stats = () => lastResult;
V.quick = function (lon, lat) { const sv = site, pv = preset, sd = srcDepth; site = { lon, lat }; preset = 'calm'; srcDepth = 20; const r = trace(profile()); site = sv; preset = pv; srcDepth = sd; return r; };

function buildSheet() {
  sheet = el(`<div class="sheet"><div class="sheet-head"><h3>Where sound can't reach</h3><span class="s-site"></span></div>
    <div class="sheet-body"><canvas class="rays" aria-label="Sound ray paths and quiet zone"></canvas>
    <div class="side"><canvas class="ssp" aria-label="Sound speed profile"></canvas>
    <div class="kv"><span>Quiet zone starts</span><b class="k-start"><b></b></b><span>at target depth</span><b class="k-td"><b></b></b><span>Water in shadow</span><b class="k-frac"><b></b></b><span>Sound channel axis</span><b class="k-axis"><b></b></b><span>Speed at surface</span><b class="k-c"><b></b></b><span class="k-sub-l" hidden>Submarine</span><b class="k-sub-v" hidden><b></b></b></div></div></div></div>`);
  rayCanvas = sheet.querySelector('.rays'); sspCanvas = sheet.querySelector('.ssp'); kv = sheet.querySelector('.kv');
}
function setSub(show, text) { kv.querySelector('.k-sub-l').hidden = !show; const v = kv.querySelector('.k-sub-v'); v.hidden = !show; if (show) v.firstElementChild.textContent = text; }
function buildMarker() {
  marker = new THREE.Group();
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0x4E5FB5, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
  cone.rotation.x = Math.PI; cone.position.y = -0.07; marker.add(cone);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 12), new THREE.MeshBasicMaterial({ color: 0x4E5FB5 })); head.position.y = 0.03; marker.add(head);
  const pulses = [];
  for (let i = 0; i < 3; i++) { const r = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.058, 40), new THREE.MeshBasicMaterial({ color: 0x4E5FB5, transparent: true, opacity: 0.5, side: THREE.DoubleSide })); r.rotation.x = -Math.PI / 2; r.position.y = 0.004; marker.add(r); pulses.push(r); }
  marker.userData.pulses = pulses;
}
function syncSite() {
  if (!root) return;
  siteEl.innerHTML = `<b>${site.label}</b><small>${fmtLat(Math.round(site.lat * 10) / 10)}, ${fmtLon(Math.round(site.lon * 10) / 10)} · seafloor ${fmtDepth(Math.round(S.seafloorAt(site.lon, site.lat) / 10) * 10)}</small>`;
  if (sheet) sheet.querySelector('.s-site').textContent = `${site.label} · ${fmtLat(Math.round(site.lat * 10) / 10)}, ${fmtLon(Math.round(site.lon * 10) / 10)}`;
  if (marker) marker.position.set(S.lonToX(site.lon), 0, S.latToZ(site.lat));
  const day = Store.get('day') || 1;
  linkEl.hidden = day < 3.9;
  if (!linkEl.hidden) linkEl.textContent = day < 4.9 ? 'Cyclone Lab is at Peak: the quiet zone has shifted ~1.2 km out and deepened ~35 m since the storm churned this water.' : 'After the storm passed, the mixed layer is deeper: the quiet zone starts ~1.6 km further out than before.';
}
V.setSite = function (s) { site = s; Store.set({ sonarSite: s }, true); syncSite(); draw(); };
V.setPreset = function (p) { preset = p; presetChips.set(p); srcDepth = PRESETS[p].src; srcSlider.set(srcDepth); noteEl.textContent = PRESETS[p].note; draw(); };

V.mount = function (r) {
  root = r;
  root.appendChild(el(`<p class="eyebrow">View 5 of 6</p>`));
  root.appendChild(el(`<h1>Sonar</h1>`));
  root.appendChild(el(`<p class="lede">Sound bends toward slower water. Trace where a ping travels and where it never arrives: the quiet zone.</p>`));
  const g0 = UI.group('Site');
  siteEl = el(`<div class="stat" style="padding:10px 12px"><span class="k">Profile taken from</span><span class="v" style="font-size:18px"></span></div>`); g0.appendChild(siteEl);
  siteEl.querySelector('.v').outerHTML = '<span class="v" style="font-size:18px"><b></b><small style="display:block;font:500 12.5px var(--body);color:var(--ink-2)"></small></span>';
  siteEl = siteEl.querySelector('.v');
  g0.appendChild(UI.chips([{ v: 'bay', label: 'Bay of Bengal' }, { v: 'arab', label: 'Arabian Sea' }, { v: 'eq', label: 'Equator' }], (v) => V.setSite(v === 'bay' ? { lon: 88, lat: 15, label: 'Bay of Bengal' } : v === 'arab' ? { lon: 64, lat: 15, label: 'Arabian Sea' } : { lon: 75, lat: -2, label: 'Equatorial Indian Ocean' })));
  g0.appendChild(el(`<p class="note">Or go to the Ocean Slicer, turn on “Place sonar here” and click any point of the cake.</p>`));
  linkEl = el(`<p class="note warn" hidden></p>`); g0.appendChild(linkEl);
  root.appendChild(g0);
  const g1 = UI.group('Scenario');
  presetChips = UI.chips(Object.keys(PRESETS).map((k) => ({ v: k, label: PRESETS[k].label })), (v) => V.setPreset(v), { select: true, value: preset });
  g1.appendChild(presetChips); noteEl = el(`<p class="note">${PRESETS[preset].note}</p>`); g1.appendChild(noteEl);
  root.appendChild(g1);
  const g2 = UI.group('Sonar');
  srcSlider = UI.slider({ id: 'srcDepth', label: 'Source depth', min: 5, max: 300, step: 1, value: srcDepth, fmt: (v) => fmtDepth(v), onInput: (v) => { srcDepth = v; draw(); } });
  fanSlider = UI.slider({ id: 'fan', label: 'Beam half-angle', min: 4, max: 20, step: 1, value: fan, fmt: (v) => `±${v}°`, onInput: (v) => { fan = v; draw(); } });
  g2.append(srcSlider, fanSlider);
  g2.appendChild(el(`<p class="note">Blue shading marks water no ray reaches. Speeds come from the Mackenzie equation using this site's temperature and salinity profile.</p>`));
  root.appendChild(g2);
  syncSite();
};
V.enter = function () {
  if (!sheet) buildSheet(); if (!marker) buildMarker();
  const s = Store.get('sonarSite'); if (s) site = s;
  U.$('overlay').appendChild(sheet); S.dim(true); S.add(marker); S.setIdle(false); S.setClickMode('float');
  S.showFloats(false);
  S.flyToLL(site.lon, site.lat, 6.5, 1300);
  syncSite(); requestAnimationFrame(() => { draw(); setTimeout(draw, 350); });
  S.onResize = draw;
  unsub.push(S.onFrame((dt, now) => { marker.userData.pulses.forEach((p, i) => { const t = ((now / 1000) * 0.5 + i / 3) % 1; p.scale.setScalar(1 + t * 3); p.material.opacity = 0.5 * (1 - t); }); }));
  unsub.push(Store.on('sonarSite', (s) => { if (s) { site = s; syncSite(); draw(); } }));
};
V.leave = function () { unsub.forEach((f) => f()); unsub = []; if (sheet) sheet.remove(); S.dim(false); S.remove(marker); S.onResize = null; S.showFloats(true); };
OS.Views.sonar = V;
})(window.OS);
