/* OceanScope shared helpers */
window.OS = window.OS || {};
(function (OS) {
'use strict';
const U = {};
U.$ = (id) => document.getElementById(id);
U.el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
U.clamp = (x, a, b) => Math.min(b, Math.max(a, x));
U.lerp = (a, b, t) => a + (b - a) * t;
U.smoothstep = (e0, e1, x) => { const t = U.clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
U.easeInOut = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
U.easeOut = (t) => 1 - Math.pow(1 - t, 3);
U.reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
U.fmtLon = (v) => `${Math.round(v * 10) / 10}°E`;
U.fmtLat = (v) => Math.abs(v) < 0.05 ? '0°' : `${Math.abs(Math.round(v * 10) / 10)}°${v > 0 ? 'N' : 'S'}`;
U.fmtDepth = (d) => `${Math.round(d).toLocaleString('en-US')} m`;
U.fmtLL = (lon, lat) => `${U.fmtLat(lat)}, ${U.fmtLon(lon)}`;
U.km = (lon0, lat0, lon1, lat1) => { const dy = (lat1 - lat0) * 111, dx = (lon1 - lon0) * 111 * Math.cos((lat0 + lat1) / 2 * Math.PI / 180); return Math.hypot(dx, dy); };
U.bearing = (lon0, lat0, lon1, lat1) => { const dx = (lon1 - lon0) * Math.cos((lat0 + lat1) / 2 * Math.PI / 180), dy = lat1 - lat0; return (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360; };
U.compass = (b) => ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(b / 22.5) % 16];

/* Generic tween runner: returns a handle with cancel() */
U.tween = (ms, onStep, onDone, ease) => {
  ease = ease || U.easeInOut;
  if (U.reduceMotion) { onStep(1); if (onDone) onDone(); return { cancel() {} }; }
  const t0 = performance.now(); let raf = 0, dead = false;
  const tick = (now) => {
    if (dead) return;
    const t = U.clamp((now - t0) / ms, 0, 1);
    onStep(ease(t), t);
    if (t < 1) raf = requestAnimationFrame(tick); else { dead = true; if (onDone) onDone(); }
  };
  raf = requestAnimationFrame(tick);
  return { cancel() { dead = true; cancelAnimationFrame(raf); }, get done() { return dead; } };
};

/* Animate a number shown in an element */
U.countTo = (el, to, dec, ms, suffix) => {
  const from = parseFloat(el.dataset.v || '0') || 0; el.dataset.v = to;
  U.tween(ms || 500, (e) => { el.textContent = (from + (to - from) * e).toFixed(dec) + (suffix || ''); }, null, U.easeOut);
};

let toastT = 0;
U.toast = (msg, ms) => { const t = U.$('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms || 2200); };

/* Canvas palette that follows the active theme */
U.pal = () => document.body.classList.contains('cine')
  ? { text: '#8FA9B7', grid: 'rgba(143,169,183,0.18)', ink: '#E4EEF2', frame: 'rgba(228,238,242,0.35)', water0: '#0F2A3D', water1: '#06121E', floor: '#3B3A38' }
  : { text: '#556570', grid: '#C6CFCC', ink: '#1C2A35', frame: '#1C2A35', water0: '#E9F1F6', water1: '#C9D8E2', floor: '#74716A' };
OS.U = U;
})(window.OS);
