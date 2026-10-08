/* View 6: Learn — Story Mode, marine life map, quiz */
(function (OS) {
'use strict';
const U = OS.U, { el, clamp, lerp, fmtDepth } = U, UI = OS.UI, S = OS.Scene, Store = OS.Store;
const V = { id: 'learn', title: 'Learn', icon: '<path d="M4 5h6a3 3 0 0 1 3 3v12a2 2 0 0 0-2-2H4z"/><path d="M20 5h-6a3 3 0 0 0-3 3v12a2 2 0 0 1 2-2h7z"/>' };
let root, tabs, body, tab = 'story', unsub = [];

/* =============== 9.1 Story Mode =============== */
const CY = () => OS.Views.cyclone;
let story = null, captionEl, storyBtn, storyStatus;
const STEPS = [
  { t: 'Bay of Bengal, May 2020', c: 'A warm sea, a calm week. Under the surface, the water is already storing more heat than usual.', dur: 4200,
    do: () => { S.setVar('T'); S.setKnife(100, -15, 0); CY().setDay(1); S.flyTo({ r: 7.5, theta: 0.5, phi: 0.85, target: [S.lonToX(87), -S.view.H * 0.2, S.latToZ(15)] }, 3800); } },
  { t: 'The fuel line', c: 'The glowing contour marks 26 °C. Everything above it is fuel a cyclone can burn.', dur: 4200,
    do: () => { S.animateKnife([80, 9.5, 400], 2200); S.flyTo({ r: 5.8, theta: 0.15, phi: 0.8, target: [S.lonToX(87), -S.view.H * 0.3, S.latToZ(13)] }, 3500); } },
  { beat: true, t: 'Predict', c: 'Amphan is about to cross this water. What happens to the sea surface behind the storm?', opts: ['It warms up', 'It cools down', 'Nothing changes'], right: 1,
    explain: ['Not quite. The wind mixes cooler water up from below, so the surface cools.', 'Right. The storm mixes cooler water up from below, leaving a cold scar.', 'The wind churns the top 100 m, so the surface does change: it cools.'] },
  { t: 'Days 1 to 3: intensifying', c: 'Warm water, low wind shear. The storm spins up over the richest fuel in the basin.', dur: 5600,
    do: () => { S.flyTo({ r: 6.2, theta: 0.12, phi: 0.92, target: [S.lonToX(87), -S.view.H * 0.22, S.latToZ(15)] }, 2500); playDays(1, 3.4, 5200); } },
  { t: 'Day 3 to 4: peak', c: 'Winds reach 130 knots. Behind the eye, the sea surface is already 2–3 °C cooler.', dur: 5000,
    do: () => { playDays(3.4, 4.3, 4600); } },
  { beat: true, t: 'Predict', c: 'The storm is nearing the coast. Will it keep strengthening?', opts: ['Yes, it keeps building', 'No, it weakens'], right: 1,
    explain: ['Near the coast the water is shallower and cooler, and the storm loses its fuel supply. It weakens.', 'Right. Cooler shelf water and then land cut off the fuel. Amphan weakened before landfall.'] },
  { t: 'Days 5 and 6: landfall', c: 'Over shallow shelf water and then land, the fuel runs out. The storm weakens and dissipates, leaving a cold wake behind.', dur: 5600,
    do: () => { S.flyTo({ r: 6.4, theta: 0.2, phi: 0.8, target: [S.lonToX(88), -S.view.H * 0.2, S.latToZ(18)] }, 3000); playDays(4.3, 6, 5000); } },
  { t: 'A float caught it', c: 'One Argo float surfaced right through the wake. Its profile shows the mixed layer deepening: proof of the churn.', dur: 5200,
    do: () => { const i = S.nearestFloat(87.5, 14.5); const f = S.floats[i]; S.flyToLL(f.lon, f.lat, 3.6, 2400, () => S.selectFloat(i)); } },
  { t: 'Why it matters', c: 'The same view feeds hazard warnings, tells fishers where the water changed, and gives rescue teams the currents they need. That is OceanScope.', dur: 6000,
    do: () => { S.flyTo({ r: 9, theta: 0.72, phi: 0.95, target: [S.lonToX(80), -S.view.H * 0.4, S.latToZ(10)] }, 4500); } }
];
let dayAnim = null;
function playDays(a, b, ms) { if (dayAnim) dayAnim.cancel(); dayAnim = U.tween(ms, (e, t) => CY().setDay(lerp(a, b, t)), () => { dayAnim = null; }, (t) => t); }
function showCaption(step, onAnswer) {
  captionEl.hidden = false;
  captionEl.innerHTML = `<b>${step.t}</b>${step.c}${step.beat ? `<div class="beat">${step.opts.map((o, i) => `<button type="button" data-i="${i}">${o}</button>`).join('')}</div>` : ''}`;
  if (step.beat) captionEl.querySelectorAll('.beat button').forEach((b) => b.addEventListener('click', () => {
    const i = +b.dataset.i; captionEl.querySelectorAll('.beat button').forEach((x) => { x.disabled = true; if (+x.dataset.i === step.right) x.classList.add('right'); });
    if (i !== step.right) b.classList.add('wrong');
    captionEl.querySelector('b').textContent = i === step.right ? 'Correct' : 'Not quite'; captionEl.childNodes[1].textContent = step.explain[i];
    onAnswer();
  }));
}
V.startStory = function () {
  V.stopStory();
  if (Store.get('currentView') !== 'learn') OS.App.go('learn');
  setTab('story');
  story = { i: -1, paused: false, timer: 0, remain: 0, started: 0 };
  S.setIdle(false); S.deselect(); S.showFloats(true);
  CY().attachExternal(); CY().setDay(1);
  Store.set({ storyPlaying: true }); storyBtn.textContent = 'Pause the story';
  if (OS.FX && OS.FX.on) OS.FX.letterbox(true);
  next();
};
function next() {
  if (!story) return;
  story.i++;
  if (story.i >= STEPS.length) { endStory(); return; }
  const step = STEPS[story.i];
  storyStatus.textContent = `Step ${story.i + 1} of ${STEPS.length}`;
  if (step.beat) { showCaption(step, () => { story.remain = 2600; schedule(); }); return; }
  showCaption(step); step.do && step.do(); story.remain = step.dur; schedule();
}
function schedule() { if (!story || story.paused) return; story.started = performance.now(); clearTimeout(story.timer); story.timer = setTimeout(next, story.remain); }
V.pauseStory = function () { if (!story || story.paused) return; story.paused = true; clearTimeout(story.timer); story.remain = Math.max(400, story.remain - (performance.now() - story.started)); if (dayAnim) { dayAnim.cancel(); dayAnim = null; } storyBtn.textContent = 'Resume the story'; storyStatus.textContent += ' · paused'; };
V.resumeStory = function () { if (!story || !story.paused) return; story.paused = false; storyBtn.textContent = 'Pause the story'; storyStatus.textContent = `Step ${story.i + 1} of ${STEPS.length}`; schedule(); };
function endStory() { if (OS.FX) OS.FX.letterbox(false); captionEl.innerHTML = `<b>The end</b>Explore any view from the rail on the left, or ask the copilot to take you somewhere.`; setTimeout(() => { if (!story) captionEl.hidden = true; }, 6000); story = null; Store.set({ storyPlaying: false }); storyBtn.textContent = 'Play the story again'; storyStatus.textContent = 'Finished'; }
V.stopStory = function (keepCyclone) { if (OS.FX) OS.FX.letterbox(false); if (story) { clearTimeout(story.timer); story = null; } if (dayAnim) { dayAnim.cancel(); dayAnim = null; } captionEl.hidden = true; Store.set({ storyPlaying: false }); if (!keepCyclone && Store.get('currentView') !== 'cyclone') CY().detachExternal(); if (storyBtn) { storyBtn.textContent = 'Play the story'; storyStatus.textContent = ''; } };

/* =============== 9.2 Marine life =============== */
const SPECIES = [
  { n: 'Spinner dolphin', ic: '🐬', d: 20, lon: 66, lat: 12, f: 'Hunts lanternfish at night when they rise toward the surface.' },
  { n: 'Olive ridley turtle', ic: '🐢', d: 30, lon: 85, lat: 19, f: 'Nests on the Odisha coast in one of the largest gatherings on Earth.' },
  { n: 'Whale shark', ic: '🦈', d: 50, lon: 69.5, lat: 20.5, f: 'The largest fish alive, feeding on plankton along the Gujarat coast.' },
  { n: 'Yellowfin tuna', ic: '🐟', d: 90, lon: 76, lat: 4, f: 'Follows the 26 °C water; the same warm layer that fuels cyclones.' },
  { n: 'Indian mackerel', ic: '🐠', d: 40, lon: 86, lat: 13, f: 'Schools in the fresh, river-fed lid of the Bay of Bengal.' },
  { n: 'Lanternfish', ic: '✨', d: 480, lon: 88, lat: 10, f: 'Glows in the twilight zone and migrates up 400 m every night.' },
  { n: 'Purpleback squid', ic: '🦑', d: 320, lon: 66.5, lat: 6, f: 'A fast twilight-zone hunter that rises at dusk to feed.' },
  { n: 'Hatchetfish', ic: '🔦', d: 420, lon: 89, lat: 6, f: 'Silver sides and belly lights hide its silhouette from predators below.' },
  { n: 'Sperm whale', ic: '🐋', d: 800, lon: 77, lat: 0, f: 'Dives past 1,000 m for squid, holding its breath for over an hour.' },
  { n: 'Siphonophore', ic: '🪼', d: 620, lon: 90.5, lat: 15, f: 'A drifting colony that can stretch longer than a blue whale.' },
  { n: 'Anglerfish', ic: '🎣', d: 1500, lon: 87, lat: 8, f: 'Lures prey with a glowing bait in total darkness.' },
  { n: 'Gulper eel', ic: '🐍', d: 1800, lon: 91, lat: 11, f: 'Its huge mouth swallows prey larger than itself.' },
  { n: 'Dumbo octopus', ic: '🐙', d: 2600, lon: 70, lat: 2, f: 'Flaps ear-like fins to hover just above the seafloor.' },
  { n: 'Sea cucumber', ic: '🥒', d: 3500, lon: 80, lat: -8, f: 'Cleans the abyssal mud, recycling what sinks from above.' }
];
const OMZ = { lon0: 62.5, lon1: 73, lat0: 8, lat1: 21.5, d0: 150, d1: 1000 };
let lifeGroup = null, lifeOn = false, lifeSprites = [];
function buildLife() {
  lifeGroup = new THREE.Group();
  const mkTex = (emoji) => { const c = document.createElement('canvas'); c.width = c.height = 96; const g = c.getContext('2d'); g.font = '64px serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(emoji, 48, 54); return new THREE.CanvasTexture(c); };
  SPECIES.forEach((sp) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: mkTex(sp.ic), transparent: true, depthTest: false }));
    s.scale.set(0.3, 0.3, 1); s.position.set(S.lonToX(sp.lon), S.depthToY(sp.d), S.latToZ(sp.lat));
    s.userData.onClick = () => V.showSpecies(sp); s.userData.sp = sp; lifeGroup.add(s); lifeSprites.push(s);
  });
  /* depth band planes */
  const band = (d, color, op) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(OS.Ocean.W * 0.64, OS.Ocean.DZ), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, side: THREE.DoubleSide, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.set(S.lonToX(81), S.depthToY(d), 0); return m; };
  lifeGroup.add(band(200, 0x3E8FC4, 0.16)); lifeGroup.add(band(1000, 0x2E4A7A, 0.18));
  /* low-oxygen zone */
  const w = S.lonToX(OMZ.lon1) - S.lonToX(OMZ.lon0), dpt = S.latToZ(OMZ.lat0) - S.latToZ(OMZ.lat1), h = S.depthToY(OMZ.d0) - S.depthToY(OMZ.d1);
  const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, dpt), new THREE.MeshBasicMaterial({ color: 0x5E3A7A, transparent: true, opacity: 0.28, depthWrite: false }));
  box.position.set((S.lonToX(OMZ.lon0) + S.lonToX(OMZ.lon1)) / 2, (S.depthToY(OMZ.d0) + S.depthToY(OMZ.d1)) / 2, (S.latToZ(OMZ.lat0) + S.latToZ(OMZ.lat1)) / 2);
  box.userData.onClick = () => V.showOMZ(); lifeGroup.add(box);
  const eg = new THREE.EdgesGeometry(box.geometry); const edges = new THREE.LineSegments(eg, new THREE.LineDashedMaterial({ color: 0x5E3A7A, dashSize: 0.04, gapSize: 0.03 })); edges.computeLineDistances(); edges.position.copy(box.position); lifeGroup.add(edges);
  lifeGroup.userData.box = box;
}
V.setLife = function (on) {
  if (!lifeGroup) buildLife();
  lifeOn = on; const cb = document.getElementById('lifeToggle'); if (cb) cb.checked = on;
  if (on) {
    if (S.state.var !== 'T') S.setVar('T');
    S.add(lifeGroup); S.pickables = [...lifeSprites, lifeGroup.userData.box]; S.showFloats(false); S.showFlow(false);
    S.animateKnife([62, 27, 4000], 1400); S.setIdle(false);
    S.flyTo({ r: 8.5, theta: 1.05, phi: 1.1, target: [S.lonToX(80), -S.view.H * 0.45, S.latToZ(8)] }, 1600);
    S.hud('band-sun', 'Sunlit · 0–200 m', () => new THREE.Vector3(S.lonToX(97), S.depthToY(100), S.latToZ(-13)), 'life', 0);
    S.hud('band-twi', 'Twilight · 200–1,000 m', () => new THREE.Vector3(S.lonToX(97), S.depthToY(550), S.latToZ(-13)), 'life', 0);
    S.hud('band-mid', 'Midnight · below 1,000 m', () => new THREE.Vector3(S.lonToX(97), S.depthToY(2200), S.latToZ(-13)), 'life', 0);
    S.hud('omz', '<b>Low-oxygen zone</b>Tap to learn why it is so empty', () => new THREE.Vector3(S.lonToX(OMZ.lon1), S.depthToY(OMZ.d0), S.latToZ(OMZ.lat1)), 'omz', 4).el.onclick = () => V.showOMZ();
  } else {
    S.remove(lifeGroup); S.pickables = []; S.showFloats(true); S.showFlow(true);
    ['band-sun', 'band-twi', 'band-mid', 'omz', 'sp'].forEach((id) => S.hudRemove(id)); if (!story) captionEl.hidden = true;
    S.animateKnife([100, -15, 0], 1000);
  }
};
V.showSpecies = function (sp) {
  S.hud('sp', `<b>${sp.ic} ${sp.n}</b>${sp.f}<br><span style="color:var(--ink-2)">${fmtDepth(sp.d)} down</span>`, () => new THREE.Vector3(S.lonToX(sp.lon), S.depthToY(sp.d), S.latToZ(sp.lat)), 'life', 16);
  S.flyTo({ r: Math.min(S.cam.r, 6), target: [S.lonToX(sp.lon), S.depthToY(sp.d), S.latToZ(sp.lat)] }, 900);
};
V.showOMZ = function () {
  captionEl.hidden = false;
  captionEl.innerHTML = `<b>The Arabian Sea's low-oxygen zone</b>Between about 150 and 1,000 m the water holds almost no oxygen. Dead plankton sinks from the rich surface and rots, using the oxygen up faster than currents can bring it back. Most fish avoid it, so the twilight zone here is strangely empty. <div class="beat"><button type="button">Got it</button></div>`;
  captionEl.querySelector('button').addEventListener('click', () => { captionEl.hidden = true; });
  S.flyTo({ r: 6, theta: 0.9, phi: 1.15, target: [S.lonToX(68), S.depthToY(500), S.latToZ(14)] }, 1200);
};

/* =============== 9.3 Quiz =============== */
const QUIZ = [
  { q: 'On the temperature colour scale, the white line marks 26 °C. What does water warmer than that line do?', o: ['Feeds cyclones', 'Blocks sound', 'Sinks to the seafloor'], a: 0, e: 'Water above 26 °C is the fuel a cyclone burns; the deeper that warm layer, the more fuel.' },
  { q: 'In the Truth Meter, a bright red patch means…', o: ['The water is hot', 'The model disagrees most with the floats', 'There are no floats'], a: 1, e: 'The Truth Meter shows model error, not temperature. Red means the model is furthest from what was measured.' },
  { q: 'The Cyclone Lab fuel gauge reads 91 kJ/cm². What is it measuring?', o: ['Wind speed', 'Rainfall', 'Heat stored in the upper ocean under the eye'], a: 2, e: 'Ocean heat content: how much warm water sits above the 26 °C line. More heat, more fuel.' },
  { q: 'Behind a cyclone, the sea surface usually…', o: ['Warms up', 'Cools down', 'Stays the same'], a: 1, e: 'The wind mixes cooler water up from below, leaving a cold wake that recovers over days.' },
  { q: 'In the Sonar view, the blue shaded area is where…', o: ['Sound never arrives', 'Water is coldest', 'Salinity is highest'], a: 0, e: 'Sound bends toward slower water and leaves gaps: the quiet zone, where a submarine can hide.' }
];
let quiz = { i: 0, score: 0, done: false };
function renderQuiz(host) {
  host.innerHTML = '';
  if (quiz.done) {
    const pct = quiz.score / QUIZ.length;
    host.appendChild(el(`<div class="qcard"><div class="score"><div class="big">${quiz.score}/${QUIZ.length}</div><p>${pct === 1 ? 'Perfect. You read the ocean like a forecaster.' : pct >= 0.6 ? 'Good reading. Try the Cyclone Lab replay to lock it in.' : 'A start. Story Mode walks through each of these.'}</p></div></div>`));
    host.appendChild(UI.btn('Try again', () => { quiz = { i: 0, score: 0, done: false }; renderQuiz(host); }, 'ghost'));
    return;
  }
  const q = QUIZ[quiz.i];
  host.appendChild(el(`<div class="progress"><i style="width:${quiz.i / QUIZ.length * 100}%"></i></div>`));
  const card = el(`<div class="qcard"><p class="qn">Question ${quiz.i + 1} of ${QUIZ.length}</p><p class="q">${q.q}</p></div>`);
  let answered = false;
  q.o.forEach((o, i) => {
    const b = el(`<button type="button" class="opt">${o}</button>`);
    b.addEventListener('click', () => {
      if (answered) return; answered = true;
      card.querySelectorAll('.opt').forEach((x, j) => { x.disabled = true; if (j === q.a) x.classList.add('right'); });
      const ok = i === q.a; if (!ok) b.classList.add('wrong'); else quiz.score++;
      card.appendChild(el(`<p class="expl ${ok ? '' : 'bad'}">${ok ? 'Correct. ' : ''}${q.e}</p>`));
      const nextBtn = UI.btn(quiz.i === QUIZ.length - 1 ? 'See my score' : 'Next question', () => { quiz.i++; if (quiz.i >= QUIZ.length) quiz.done = true; renderQuiz(host); }); nextBtn.style.marginTop = '12px'; card.appendChild(nextBtn);
    });
    card.appendChild(b);
  });
  host.appendChild(card);
}

/* =============== Panel =============== */
function setTab(id) {
  tab = id; tabs.set(id); body.innerHTML = '';
  if (id !== 'life' && lifeOn) V.setLife(false);
  if (id !== 'story' && !story) captionEl.hidden = true;
  if (id === 'story') {
    body.appendChild(el(`<p class="note">A guided replay of Cyclone Amphan with two quick predictions along the way. Hands off: the camera drives itself.</p>`));
    storyBtn = UI.btn(story ? (story.paused ? 'Resume the story' : 'Pause the story') : 'Play the story', () => { if (!story) V.startStory(); else if (story.paused) V.resumeStory(); else V.pauseStory(); }, 'storm');
    body.appendChild(storyBtn);
    storyStatus = el(`<p class="note">${story ? `Step ${story.i + 1} of ${STEPS.length}` : ''}</p>`); body.appendChild(storyStatus);
    const stop = UI.btn('Stop', () => V.stopStory(), 'ghost'); body.appendChild(stop);
    body.appendChild(el(`<div class="group"><h2>What you will see</h2><ol class="note" style="padding-left:18px;margin:0"><li>The warm Bay of Bengal, calm</li><li>The 26 °C fuel line</li><li>Six days of the storm, with the wake forming</li><li>An Argo float that caught the churn</li><li>Why it matters for warnings, fishing and rescue</li></ol></div>`));
  } else if (id === 'life') {
    body.appendChild(el(`<p class="note">Who lives at each depth. The cake is cut open at 62 °E so you can see them hang in the water column.</p>`));
    body.appendChild(UI.check('lifeToggle', 'Show marine life on the cake', lifeOn, (on) => V.setLife(on)));
    const bands = [{ id: 'sun', t: 'Sunlit', r: '0–200 m', f: (s) => s.d <= 200 }, { id: 'twi', t: 'Twilight', r: '200–1,000 m', f: (s) => s.d > 200 && s.d <= 1000 }, { id: 'mid', t: 'Midnight', r: 'below 1,000 m', f: (s) => s.d > 1000 }];
    bands.forEach((b) => {
      const box = el(`<div class="band ${b.id}"><h3>${b.t}<small>${b.r}</small></h3><ul></ul></div>`);
      SPECIES.filter(b.f).forEach((sp) => { const li = el(`<li><span class="ic">${sp.ic}</span><span>${sp.n}<small>${sp.f}</small></span><span class="d">${sp.d} m</span></li>`); li.addEventListener('click', () => { if (!lifeOn) { body.querySelector('#lifeToggle').checked = true; V.setLife(true); } setTimeout(() => V.showSpecies(sp), lifeOn ? 0 : 900); }); box.querySelector('ul').appendChild(li); });
      body.appendChild(box);
      if (b.id === 'twi') { const o = el(`<div class="omz"><b>Low-oxygen zone · Arabian Sea, 150–1,000 m</b><br>Almost nothing lives here. Tap to see why.</div>`); o.addEventListener('click', () => { if (!lifeOn) { body.querySelector('#lifeToggle').checked = true; V.setLife(true); } setTimeout(V.showOMZ, lifeOn ? 0 : 900); }); body.appendChild(o); }
    });
    if (lifeOn) V.setLife(true);
  } else {
    body.appendChild(el(`<p class="note">Five questions about what you have seen across OceanScope.</p>`));
    const host = el(`<div></div>`); body.appendChild(host); renderQuiz(host);
  }
}
V.mount = function (r) {
  root = r; captionEl = U.$('caption');
  root.appendChild(el(`<p class="eyebrow">View 6 of 6</p>`));
  root.appendChild(el(`<h1>Learn</h1>`));
  root.appendChild(el(`<p class="lede">The public side of OceanScope: a guided story, the creatures of each depth, and a short quiz.</p>`));
  tabs = UI.tabs([{ id: 'story', label: 'Story Mode' }, { id: 'life', label: 'Marine life' }, { id: 'quiz', label: 'Quiz' }], tab, setTab); root.appendChild(tabs);
  body = el(`<div></div>`); root.appendChild(body); setTab(tab);
};
V.openTab = (id) => { if (root) setTab(id); else tab = id; };
V.enter = function () { S.setClickMode('float'); if (tab === 'life' && lifeOn) V.setLife(true); if (story) CY().attachExternal(); };
V.leave = function () { unsub.forEach((f) => f()); unsub = []; if (lifeOn) V.setLife(false); if (story) V.stopStory(); captionEl.hidden = true; };
V.SPECIES = SPECIES;
OS.Views.learn = V;
})(window.OS);
