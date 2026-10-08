/* View 4: Search & Rescue drift predictor */
(function (OS) {
'use strict';
const U = OS.U, { el, clamp, fmtLon, fmtLat } = U, UI = OS.UI, S = OS.Scene, Store = OS.Store;
const V = { id: 'sar', title: 'Search & Rescue', icon: '<circle cx="12" cy="12" r="8"/><path d="M12 4v3M12 17v3M4 12h3M17 12h3"/><path d="M12 12l3-3"/><circle cx="12" cy="12" r="1"/>' };

const NP = 700, EX = 4;   /* cloud is drawn EX times life size so hours of drift are visible */
const dx = (lon) => pin ? pin.lon + (lon - pin.lon) * EX : lon, dy = (lat) => pin ? pin.lat + (lat - pin.lat) * EX : lat;
let root, pin = null, hours = 6, pts, geo, pos, alpha, lonA, latA, windage, built = false, sim = null, boxes = [], boxGroup, pinMesh, unsub = [], list, compass, statsEl, clearBtn, chips, results = null, ringPulse = 0;
function build() {
  lonA = new Float32Array(NP); latA = new Float32Array(NP); windage = new Float32Array(NP * 2);
  pos = new Float32Array(NP * 3); alpha = new Float32Array(NP);
  geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('a', new THREE.BufferAttribute(alpha, 1));
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: new THREE.CanvasTexture(c) }, uColor: { value: new THREE.Color(0x1E8C8A) }, uSize: { value: 26 * Math.min(window.devicePixelRatio || 1, 2) } },
    transparent: true, depthWrite: false, blending: THREE.NormalBlending,
    vertexShader: `attribute float a; varying float vA; uniform float uSize; void main(){ vA = a; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = uSize * (0.55 / -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D uMap; uniform vec3 uColor; varying float vA; void main(){ vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(mix(uColor, vec3(1.0), t.r*0.35), t.a * vA * 0.75); }`
  });
  pts = new THREE.Points(geo, mat); pts.frustumCulled = false;
  boxGroup = new THREE.Group();
  pinMesh = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.008, 8, 32), new THREE.MeshBasicMaterial({ color: 0xA33A2A })); ring.rotation.x = Math.PI / 2; pinMesh.add(ring);
  const pulse = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.06, 40), new THREE.MeshBasicMaterial({ color: 0xA33A2A, transparent: true, opacity: 0.6, side: THREE.DoubleSide })); pulse.rotation.x = -Math.PI / 2; pulse.position.y = 0.002; pinMesh.add(pulse); pinMesh.userData.pulse = pulse;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.16, 8), new THREE.MeshBasicMaterial({ color: 0x1C2A35 })); post.position.y = 0.08; pinMesh.add(post);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.045), new THREE.MeshBasicMaterial({ color: 0xA33A2A, side: THREE.DoubleSide })); flag.position.set(0.035, 0.14, 0); pinMesh.add(flag);
  pinMesh.visible = false;
  built = true;
}
function show(on) { if (!built) build(); pts.material.blending = OS.FX && OS.FX.on ? THREE.AdditiveBlending : THREE.NormalBlending; pts.material.needsUpdate = true; if (on) { S.add(pts); S.add(boxGroup); S.add(pinMesh); } else { S.remove(pts); S.remove(boxGroup); S.remove(pinMesh); clearBoxes(); S.hudRemove('pin'); } }
function clearBoxes() { boxes.forEach((b, i) => { boxGroup.remove(b); S.hudRemove('box' + i); }); boxes = []; }

function seed() {
  for (let i = 0; i < NP; i++) {
    const r = Math.sqrt(Math.random()) * 0.06, a = Math.random() * Math.PI * 2;
    lonA[i] = pin.lon + Math.cos(a) * r; latA[i] = pin.lat + Math.sin(a) * r;
    windage[i * 2] = (Math.random() - 0.5) * 0.008; windage[i * 2 + 1] = (Math.random() - 0.5) * 0.008;
    alpha[i] = 1;
  }
}
function stepSim(dtH) {
  const cosl = Math.cos(pin.lat * Math.PI / 180), kx = 3.6 / (111 * cosl), ky = 3.6 / 111, dif = 0.02 * Math.sqrt(dtH);
  for (let i = 0; i < NP; i++) {
    if (alpha[i] <= 0) continue;
    const v = S.surfaceVel(lonA[i], latA[i], 0);
    let lon = lonA[i] + (v[0] * kx + windage[i * 2]) * dtH + (Math.random() - 0.5) * dif;
    let lat = latA[i] + (v[1] * ky + windage[i * 2 + 1]) * dtH + (Math.random() - 0.5) * dif;
    if (S.landAt(lon, lat)) { alpha[i] = 0.25; continue; }   /* beached: stays where it hit */
    lonA[i] = lon; latA[i] = lat;
  }
}
function writePositions() {
  for (let i = 0; i < NP; i++) { const px = S.lonToX(dx(lonA[i])), pz = S.latToZ(dy(latA[i])); pos[i * 3] = px; pos[i * 3 + 1] = 0.006 + (OS.FX ? OS.FX.waveAt(px, pz) : 0); pos[i * 3 + 2] = pz; }
  geo.attributes.position.needsUpdate = true; geo.attributes.a.needsUpdate = true;
}
function run() {
  if (sim) sim.cancel();
  seed(); writePositions(); clearBoxes(); results = null; renderResults(null);
  const total = hours, steps = Math.max(60, hours * 12), dtH = total / steps;
  let done = 0;
  const ms = 2200 + hours * 60;
  sim = U.tween(ms, (e, t) => {
    const target = Math.floor(steps * t);
    while (done < target) { stepSim(dtH); done++; }
    writePositions();
    if (statsEl) statsEl.querySelector('.n1').textContent = `${(t * hours).toFixed(1)} h`;
  }, () => { while (done < steps) { stepSim(dtH); done++; } writePositions(); sim = null; finish(); }, (t) => t);
}
function finish() {
  /* density grid over final positions */
  const cell = 0.12; let lo0 = 1e9, la0 = 1e9, lo1 = -1e9, la1 = -1e9;
  for (let i = 0; i < NP; i++) { lo0 = Math.min(lo0, lonA[i]); lo1 = Math.max(lo1, lonA[i]); la0 = Math.min(la0, latA[i]); la1 = Math.max(la1, latA[i]); }
  const nx = Math.max(1, Math.ceil((lo1 - lo0) / cell)), ny = Math.max(1, Math.ceil((la1 - la0) / cell)), grid = new Float32Array(nx * ny);
  let cx = 0, cy = 0;
  for (let i = 0; i < NP; i++) { const ix = Math.min(nx - 1, Math.floor((lonA[i] - lo0) / cell)), iy = Math.min(ny - 1, Math.floor((latA[i] - la0) / cell)); grid[iy * nx + ix] += alpha[i] >= 1 ? 1 : 0.3; cx += lonA[i]; cy += latA[i]; }
  cx /= NP; cy /= NP;
  const cells = []; for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (grid[j * nx + i] > 0) cells.push({ i, j, n: grid[j * nx + i] });
  cells.sort((a, b) => b.n - a.n);
  const tot = cells.reduce((s, c) => s + c.n, 0), top = cells.slice(0, 5);
  results = { boxes: top.map((c, k) => { const lon = lo0 + (c.i + 0.5) * cell, lat = la0 + (c.j + 0.5) * cell; return { rank: k + 1, lon, lat, cell, share: c.n / tot, km: U.km(pin.lon, pin.lat, lon, lat), brg: U.bearing(pin.lon, pin.lat, lon, lat) }; }), centroid: [cx, cy], drift: U.km(pin.lon, pin.lat, cx, cy), bearing: U.bearing(pin.lon, pin.lat, cx, cy) };
  /* draw boxes */
  results.boxes.forEach((b, k) => {
    const h = b.cell / 2, y = 0.008 + k * 0.0005;
    const corners = [[b.lon - h, b.lat - h], [b.lon + h, b.lat - h], [b.lon + h, b.lat + h], [b.lon - h, b.lat + h], [b.lon - h, b.lat - h]].map((p) => new THREE.Vector3(S.lonToX(dx(p[0])), y, S.latToZ(dy(p[1]))));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(corners), new THREE.LineBasicMaterial({ color: k === 0 ? 0xA33A2A : 0x1E8C8A, transparent: true, opacity: k === 0 ? 1 : 0.85 - k * 0.12 }));
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(b.cell * EX / 60 * 6, b.cell * EX / 42 * 4.2), new THREE.MeshBasicMaterial({ color: k === 0 ? 0xA33A2A : 0x1E8C8A, transparent: true, opacity: 0.16 - k * 0.02, depthWrite: false }));
    fill.rotation.x = -Math.PI / 2; fill.position.set(S.lonToX(dx(b.lon)), y, S.latToZ(dy(b.lat)));
    const grp = new THREE.Group(); grp.add(line); grp.add(fill); boxGroup.add(grp); boxes.push(grp);
    S.hud('box' + k, `${k + 1}`, () => new THREE.Vector3(S.lonToX(dx(b.lon)), 0.012, S.latToZ(dy(b.lat))), k === 0 ? 'storm' : 'rescue', 4);
  });
  renderResults(results);
}
function renderResults(r) {
  if (!root) return;
  list.innerHTML = '';
  if (!r) { compass.set(0, sim ? 'Drifting…' : '—', sim ? 'Running the currents forward' : 'Drop a pin to start'); statsEl.querySelector('.n2').textContent = '—'; return; }
  compass.set(r.bearing, `${U.compass(r.bearing)} · ${Math.round(r.bearing)}°`, `Cloud centre drifted ${r.drift.toFixed(1)} km in ${hours} h`);
  statsEl.querySelector('.n1').textContent = `${hours} h`; statsEl.querySelector('.n2').textContent = `${r.drift.toFixed(1)} km`;
  list.appendChild(UI.rank(r.boxes.map((b) => ({ n: b.rank, title: `${U.compass(b.brg)} ${Math.round(b.brg)}°, ${b.km.toFixed(1)} km out`, sub: `${fmtLat(Math.round(b.lat * 100) / 100)}, ${fmtLon(Math.round(b.lon * 100) / 100)} · box ${Math.round(b.cell * 111)} km`, value: `${Math.round(b.share * 100)}%`, bar01: b.share / r.boxes[0].share, onClick: () => S.flyTo({ r: 0.7, target: [S.lonToX(dx(b.lon)), 0, S.latToZ(dy(b.lat))] }, 900) })), 'rescue'));
}
V.drop = function (lon, lat) {
  if (!built) build();
  if (S.landAt(lon, lat)) { U.toast('That is land. Drop the pin in open water.'); return; }
  pin = { lon, lat }; Store.set({ sarPin: { lon, lat, hours } });
  pinMesh.position.set(S.lonToX(lon), 0, S.latToZ(lat)); pinMesh.visible = true; pinMesh.scale.setScalar(0.3);
  S.hud('pin', `Last known · ${fmtLat(Math.round(lat * 10) / 10)}, ${fmtLon(Math.round(lon * 10) / 10)}`, () => new THREE.Vector3(pinMesh.position.x, 0.055, pinMesh.position.z), 'storm', 6);
  clearBtn.hidden = false; statsEl.hidden = false;
  S.flyTo({ r: 1.1, phi: 0.62, target: [S.lonToX(lon), 0, S.latToZ(lat)] }, 1300);
  run();
};
V.setHours = function (h) { hours = h; if (chips) chips.set(h); if (pin) { Store.set({ sarPin: { lon: pin.lon, lat: pin.lat, hours } }); run(); } };

V.mount = function (r) {
  root = r;
  root.appendChild(el(`<p class="eyebrow">View 4 of 6</p>`));
  root.appendChild(el(`<h1>Search &amp; Rescue</h1>`));
  root.appendChild(el(`<p class="lede">Drop a pin on the last-known position and watch where the currents would carry a person or a raft.</p>`));
  const g1 = UI.group('How long ago');
  chips = UI.chips([{ v: 2, label: '2 h', cls: 'rescue' }, { v: 6, label: '6 h', cls: 'rescue' }, { v: 12, label: '12 h', cls: 'rescue' }, { v: 24, label: '24 h', cls: 'rescue' }], (v) => V.setHours(+v), { select: true, value: hours });
  g1.appendChild(chips);
  g1.appendChild(el(`<p class="note">Then click anywhere on the water. ${NP} drifters are released and pushed by the July surface currents, with a little random scatter. The cloud is drawn ${EX}× life size so hours of drift stay visible.</p>`));
  clearBtn = UI.btn('Clear the pin', () => { pin = null; pinMesh.visible = false; clearBoxes(); results = null; for (let i = 0; i < NP; i++) alpha[i] = 0; writePositions(); S.hudRemove('pin'); renderResults(null); clearBtn.hidden = true; Store.set({ sarPin: null }); }, 'ghost');
  clearBtn.hidden = true; g1.appendChild(clearBtn);
  root.appendChild(g1);
  const g2 = UI.group('Drift');
  statsEl = el(`<div class="stat-row"><div class="stat rescue"><span class="k">Simulated</span><span class="v n1">0 h</span></div><div class="stat rescue"><span class="k">Centre moved (true)</span><span class="v n2">—</span></div></div>`); statsEl.hidden = true; g2.appendChild(statsEl);
  compass = UI.compass(); g2.appendChild(compass);
  root.appendChild(g2);
  const g3 = UI.group('Priority search boxes', 'search 1 first');
  list = el(`<div></div>`); g3.appendChild(list); root.appendChild(g3);
  renderResults(results);
};
V.enter = function () {
  show(true); S.setClickMode('pin'); S.setIdle(false);
  if (S.state.var !== 'V') S.setVar('V');
  if (S.knife.depth > 1) S.animateKnife([100, -15, 0], 900);
  S.showFlow(true); S.showFloats(false);
  unsub.push(S.onSurfaceClick((info) => { if (info.mode === 'pin') V.drop(info.lon, info.lat); }));
  unsub.push(S.onFrame((dt) => { if (pinMesh.visible) { ringPulse = (ringPulse + dt * 0.8) % 1; const p = pinMesh.userData.pulse; p.scale.setScalar(1 + ringPulse * 2.6); p.material.opacity = 0.6 * (1 - ringPulse); } }));
  if (pin) { renderResults(results); clearBtn.hidden = false; statsEl.hidden = false; }
};
V.leave = function () { unsub.forEach((f) => f()); unsub = []; if (sim) { sim.cancel(); sim = null; } show(false); S.setClickMode('float'); S.showFloats(true); };
OS.Views.sar = V;
})(window.OS);
