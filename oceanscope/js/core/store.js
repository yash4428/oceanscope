/* Central app state + tiny pub-sub. Every view reads from this; the copilot writes to it. */
(function (OS) {
'use strict';
const state = {
  currentView: 'slicer',
  variable: 'T',           // T | S | V | D
  depth: 0,                // knife depth (m)
  day: 1,                  // Cyclone Lab timeline 1..6 (continuous while animating)
  cutPlanes: { lon: 100, lat: -15, depth: 0 },
  selectedFloat: -1,
  exploreMode: false,
  copilotLastAction: null,
  sonarSite: null,         // { lon, lat, label }
  sarPin: null,            // { lon, lat, hours }
  cyclonePlaying: false,
  storyPlaying: false
};
const subs = {};
const Store = {
  get: (k) => (k === undefined ? state : state[k]),
  set(patch, silent) {
    const changed = [];
    for (const k in patch) { if (state[k] !== patch[k]) { state[k] = patch[k]; changed.push(k); } }
    if (silent) return;
    for (const k of changed) (subs[k] || []).forEach((fn) => fn(state[k], k));
    if (changed.length) (subs['*'] || []).forEach((fn) => fn(changed));
  },
  on(k, fn) { (subs[k] = subs[k] || []).push(fn); return () => { subs[k] = subs[k].filter((f) => f !== fn); }; }
};
OS.Store = Store;
})(window.OS);
