/* AI Copilot: a keyword/pattern command router over the shared app state. No LLM. */
(function (OS) {
'use strict';
const U = OS.U, { $, el, clamp, fmtLon, fmtLat, fmtDepth } = U, S = OS.Scene, Store = OS.Store, VARS = OS.Ocean.VARS;
const C = {};
let log, input, panel, pill, history = [];

const VARWORDS = [['temperature', 'T'], ['temp', 'T'], ['warm', 'T'], ['heat', 'T'], ['salinity', 'S'], ['salt', 'S'], ['fresh', 'S'], ['current', 'V'], ['flow', 'V'], ['speed', 'V'], ['error', 'D'], ['disagree', 'D'], ['wrong', 'D'], ['truth', 'D']];
function parseDepth(q) { const m = q.match(/(\d{1,4})\s*(m\b|metre|meter|km)/i); if (!m) return null; let d = +m[1]; if (/km/i.test(m[2])) d *= 1000; return clamp(d, 0, 4000); }
function parseDay(q) { const m = q.match(/day\s*(\d)/i); if (m) return clamp(+m[1], 1, 6); const d = q.match(/(1[6-9]|2[01])\s*may/i); if (d) return +d[1] - 15; if (/peak/.test(q)) return 4; if (/landfall|weaken/.test(q)) return 5; if (/form|start|begin/.test(q)) return 1; if (/intensif/.test(q)) return 3; return null; }

/* Each rule: test(q) -> falsy, or {act(), reply} */
const RULES = [
  { name: 'deploy', test: (q) => /deploy|recommend|next float|where should|coverage gap/.test(q), run: () => {
    const recs = OS.Views.truth.recommend();
    const why = ['high model disagreement at the thermocline, no float within 300 km', 'restless eddy field, model error above the basin average', 'fresh-water lid poorly captured by the model'];
    OS.App.go('truth');
    return { reply: `<b>Three places a new float would earn its keep</b><ol>${recs.map((r, i) => `<li>${fmtLat(Math.round(r.f.lat * 10) / 10)}, ${fmtLon(Math.round(r.f.lon * 10) / 10)} · error ${r.score.toFixed(2)} °C: ${why[i]}</li>`).join('')}</ol>`, act: 'Opened Truth Meter' };
  } },
  { name: 'sar', test: (q) => /search|rescue|drift|raft|overboard|missing|lost at sea|drop a pin|\bpin\b/.test(q), run: (q) => {
    const nav = OS.App.go('sar');
    const hm = q.match(/(\d{1,2})\s*h/); const hrs = hm ? [2, 6, 12, 24].reduce((a, b) => Math.abs(b - +hm[1]) < Math.abs(a - +hm[1]) ? b : a) : null;
    const ll = q.match(/(-?\d{1,2}(?:\.\d+)?)\s*°?\s*[ns]?\s*[, ]\s*(\d{2,3}(?:\.\d+)?)\s*°?\s*e?/i);
    nav.then(() => { if (hrs) OS.Views.sar.setHours(hrs); if (ll) OS.Views.sar.drop(+ll[2], +ll[1]); });
    return { reply: ll ? `Dropped the pin at ${fmtLat(+ll[1])}, ${fmtLon(+ll[2])}${hrs ? ` and drifted it ${hrs} h` : ''}. Search boxes are ranking now.` : `Search &amp; Rescue is open${hrs ? ` with a ${hrs} h window` : ''}. Click the water at the last-known position and I will run the currents forward.`, act: 'Opened Search & Rescue' };
  } },
  { name: 'sonar', test: (q) => /sonar|quiet zone|shadow zone|acoustic|submarine|ping/.test(q), run: (q) => {
    const nav = OS.App.go('sonar');
    const preset = /storm|cyclone|after/.test(q) ? 'storm' : /sub/.test(q) ? 'sub' : null;
    const site = /arab/.test(q) ? { lon: 64, lat: 15, label: 'Arabian Sea' } : /bay|bengal/.test(q) ? { lon: 88, lat: 15, label: 'Bay of Bengal' } : null;
    nav.then(() => setTimeout(() => { if (site) OS.Views.sonar.setSite(site); if (preset) OS.Views.sonar.setPreset(preset); const st = OS.Views.sonar.stats(); if (st) C.say(`Quiet zone starts ${st.start < 0 ? 'nowhere in range' : `${st.start.toFixed(1)} km out`} at ${Math.round(st.tDepth)} m; ${Math.round(st.quietFrac * 100)}% of the water column is in shadow.`); }, 450));
    return { reply: `Tracing rays${site ? ` in the ${site.label}` : ''}${preset ? ` for the “${preset === 'storm' ? 'after a cyclone' : 'submarine below the layer'}” scenario` : ''}.`, act: 'Opened Sonar' };
  } },
  { name: 'cyclone', test: (q) => /amphan|cyclone|storm|hurricane|typhoon/.test(q), run: (q) => {
    const day = parseDay(q) || (/wake|cool|scar|after/.test(q) ? 6 : 4);
    OS.App.go('cyclone').then(() => { const cy = OS.Views.cyclone; if (/play|replay|run|watch/.test(q)) { cy.setDay(1); cy.play(); } else cy.setDay(day); });
    const cy = OS.Views.cyclone, d = /play|replay|run|watch/.test(q) ? null : day;
    return { reply: d ? `Cyclone Lab, ${cy.DATES[d - 1]} 2020: <b>${cy.STAGE[d - 1]}</b>. Fuel ${cy.FUEL[d - 1]} kJ/cm², ${cy.RI[d - 1]}% chance of rapid intensification in the next 24 h.` : `Replaying Amphan from 16 May. Watch the 26 °C line glow as the fuel rises, then the cold wake spread behind the eye.`, act: 'Opened Cyclone Lab' };
  } },
  { name: 'float', test: (q) => /float|argo|profile/.test(q), run: (q) => {
    const m = q.match(/(\d{5,7})/); let i = -1;
    if (m) { const id = +m[1]; let bd = 1e9; S.floats.forEach((f, k) => { const d = Math.abs(f.id - id); if (d < bd) { bd = d; i = k; } }); }
    else if (/bay|bengal/.test(q)) i = S.nearestFloat(88, 14); else if (/arab/.test(q)) i = S.nearestFloat(64, 14); else if (/equator/.test(q)) i = S.nearestFloat(75, 0);
    else if (/worst|wrong|error/.test(q)) i = OS.Views.truth.recommend()[0].i; else i = Store.get('selectedFloat') >= 0 ? Store.get('selectedFloat') : S.nearestFloat(80, 10);
    const cur = Store.get('currentView'); const nav = (cur === 'sonar' || cur === 'learn') ? OS.App.go('slicer') : Promise.resolve();
    const f = S.floats[i]; nav.then(() => { S.setIdle(false); S.flyToLL(f.lon, f.lat, 4.2, 1300, () => S.selectFloat(i)); });
    return { reply: `Flying to <b>Argo float ${f.id}</b> at ${fmtLat(Math.round(f.lat * 10) / 10)}, ${fmtLon(Math.round(f.lon * 10) / 10)}. Its last dive was ${f.day} July; the model is off by ${f.errT.toFixed(2)} °C there on average, most at ${fmtDepth(Math.round(f.worstD / 5) * 5)}.`, act: 'Selected float' };
  } },
  { name: 'variable', test: (q) => VARWORDS.some(([w]) => q.includes(w)) || parseDepth(q) !== null, run: (q) => {
    const hit = VARWORDS.find(([w]) => q.includes(w)), key = hit ? hit[1] : null, depth = parseDepth(q);
    const cur = Store.get('currentView');
    const nav = key === 'D' ? OS.App.go('truth') : (cur !== 'slicer' && cur !== 'cyclone' && cur !== 'truth') ? OS.App.go('slicer') : Promise.resolve();
    const parts = [];
    nav.then(() => {
      if (key && key !== 'D' && S.state.var !== key) S.setVar(key);
      if (depth !== null) { const lon = S.knife.lon >= 99 ? 75 : S.knife.lon, lat = S.knife.lat <= -14 ? 12 : S.knife.lat; S.animateKnife([lon, lat, depth], 1100); }
      else if (S.knife.depth <= 1) S.animateKnife([75, 12, 1200], 1100);
    });
    if (key) parts.push(`showing <b>${VARS[key].name.toLowerCase()}</b>`);
    if (depth !== null) parts.push(`cut down to <b>${fmtDepth(depth)}</b>`);
    const note = key ? ' ' + VARS[key].note : '';
    return { reply: `Done: ${parts.join(', ')}.${note}`, act: 'Changed the cake' };
  } },
  { name: 'film', test: (q) => /\bfilm\b|movie|trailer|cinematic tour|showreel/.test(q), run: () => {
    setTimeout(() => { C.open(false); OS.Film.play(); }, 700);
    return { reply: 'Rolling the film: nine shots across the monsoon swell, the Great Whirl, the Maldives, Amphan and the deep. Press Esc to stop.', act: 'Started film mode' };
  } },
  { name: 'cinema', test: (q) => /cinema|realistic|light mode|dark mode|plain look|classic look/.test(q), run: (q) => {
    const on = !/off|light mode|plain|classic/.test(q); document.getElementById('cine').checked = on; OS.FX.setCine(on);
    return { reply: on ? 'Cinema on: moving waves, sunlight, weather and bloom.' : 'Classic look: flat colours for reading the data.', act: 'Switched look' };
  } },
  { name: 'learn', test: (q) => /story|tour|learn|quiz|marine|species|fish|whale|oxygen/.test(q), run: (q) => {
    const tab = /quiz|question/.test(q) ? 'quiz' : /marine|species|fish|whale|oxygen|life/.test(q) ? 'life' : 'story';
    OS.App.go('learn').then(() => { OS.Views.learn.openTab(tab); if (tab === 'story' && /play|start|run/.test(q)) OS.Views.learn.startStory(); if (tab === 'life') OS.Views.learn.setLife(true); });
    return { reply: tab === 'quiz' ? 'Five questions, one at a time. Score shows at the end.' : tab === 'life' ? 'Cut the cake open at 62 °E and hung fourteen species at their depths. The purple box is the Arabian Sea low-oxygen zone.' : 'Story Mode is ready. Press play and keep your hands off the mouse; the camera drives.', act: 'Opened Learn' };
  } },
  { name: 'slicer', test: (q) => /slice|cake|cut|whole ocean|reset|home|overview/.test(q), run: (q) => {
    OS.App.go('slicer').then(() => { if (/whole|reset|close/.test(q)) { S.animateKnife([100, -15, 0], 900); S.resetCamera(); } else if (/corner/.test(q)) S.animateKnife([75, 12, 1200], 900); else if (/dive/.test(q)) { S.setKnife(40, 27, 0); S.animateKnife([40, 27, 2000], 7000); } });
    return { reply: /whole|reset|close/.test(q) ? 'Closed the cake and reset the camera.' : 'Ocean Slicer is open. Drag the knife sliders or pick a preset cut.', act: 'Opened Ocean Slicer' };
  } },
  { name: 'explore', test: (q) => /explore mode|simple|plain (words|language)|expert/.test(q), run: (q) => { const on = !/off|expert/.test(q); OS.App.setExplore(on); return { reply: on ? 'Explore mode on: plainer words, fewer dials.' : 'Explore mode off: full controls are back.', act: 'Toggled Explore mode' }; } },
  { name: 'help', test: (q) => /help|what can|how do/.test(q), run: () => ({ reply: 'Try: “salinity at 300 m”, “replay Amphan”, “worst float”, “sonar after a cyclone”, “search and rescue 12 h”, “recommend a float”, “marine life”.', act: 'Help' }) }
];
const FALLBACK = [
  'I can drive every view here. Try naming a variable and a depth, a cyclone day, a float, or say “sonar” or “rescue”.',
  'Not sure what to change for that. I understand things like “currents at the surface”, “Amphan at peak”, or “drop a pin at 12 N, 70 E”.',
  'That one is outside my chart. Ask about temperature, salinity, currents, model error, floats, Amphan, sonar, or search and rescue.'
];
let fb = 0;
C.route = function (text) {
  const q = text.toLowerCase().trim();
  for (const r of RULES) { if (r.test(q)) { const res = r.run(q); Store.set({ copilotLastAction: { rule: r.name, text, at: Date.now() } }); return res; } }
  return { reply: FALLBACK[fb++ % FALLBACK.length], act: null };
};

/* ---------- UI ---------- */
function addMsg(html, me, act) {
  const m = el(`<div class="msg ${me ? 'me' : 'ai'}">${html}${act ? `<span class="act">${act}</span>` : ''}</div>`);
  log.appendChild(m); log.scrollTop = log.scrollHeight; history.push(m); while (history.length > 24) history.shift().remove();
  return m;
}
C.say = (html) => addMsg(html, false, null);
C.ask = function (text) {
  addMsg(text.replace(/</g, '&lt;'), true);
  const typing = el(`<div class="msg ai typing"><i></i><i></i><i></i></div>`); log.appendChild(typing); log.scrollTop = log.scrollHeight;
  const res = C.route(text);
  setTimeout(() => { typing.remove(); addMsg(res.reply, false, res.act); }, 420 + Math.random() * 260);
};
C.open = (on) => { panel.hidden = !on; pill.setAttribute('aria-expanded', String(on)); pill.hidden = on; if (on) setTimeout(() => input.focus(), 50); };
C.init = function () {
  log = $('cp-log'); input = $('cp-in'); panel = $('cp-panel'); pill = $('cp-pill');
  pill.addEventListener('click', () => C.open(true)); $('cp-close').addEventListener('click', () => C.open(false));
  $('cp-form').addEventListener('submit', (e) => { e.preventDefault(); const t = input.value.trim(); if (!t) return; input.value = ''; C.ask(t); });
  const sugg = $('cp-sugg');
  ['Play the film', 'Salinity at 300 m', 'Replay Amphan', 'Worst float', 'Sonar after a cyclone', 'Rescue, 12 h', 'Recommend a float', 'Marine life'].forEach((t) => { const b = el(`<button type="button" class="chip">${t}</button>`); b.addEventListener('click', () => C.ask(t)); sugg.appendChild(b); });
  addMsg('Tell me what to show and I will drive the app. <b>Try one of the chips below.</b>', false);
  document.addEventListener('keydown', (e) => { if (e.key === '/' && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); C.open(true); } if (e.key === 'Escape' && !panel.hidden) C.open(false); });
};
OS.Copilot = C;
})(window.OS);
