/* Procedural score for the OceanScope film. Pure JS DSP, 48 kHz stereo, timed to the director's event log. */
const fs = require('fs');
const SR = 48000;

function rng(seed) { let a = seed | 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

function writeWav(file, L, R) {
  const n = L.length, b = Buffer.alloc(44 + n * 4);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 4, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(L[i] * 32767))), 44 + i * 4); b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(R[i] * 32767))), 46 + i * 4); }
  fs.writeFileSync(file, b);
}

/* Freeverb-style stereo reverb */
function reverb(inL, inR, room = 0.86, damp = 0.3) {
  const s = SR / 44100, combs = [1557, 1617, 1491, 1422, 1277, 1356, 1188, 1116].map((x) => Math.round(x * s)), aps = [556, 441, 341, 225].map((x) => Math.round(x * s));
  const run = (inp, spread) => {
    const out = new Float32Array(inp.length);
    const cb = combs.map((l) => ({ buf: new Float32Array(l + spread), i: 0, f: 0 })), ab = aps.map((l) => ({ buf: new Float32Array(l + spread), i: 0 }));
    for (let n = 0; n < inp.length; n++) {
      const x = inp[n] * 0.015; let y = 0;
      for (const c of cb) { const o = c.buf[c.i]; c.f = o * (1 - damp) + c.f * damp; c.buf[c.i] = x + c.f * room; if (++c.i >= c.buf.length) c.i = 0; y += o; }
      for (const a of ab) { const o = a.buf[a.i]; const v = -y + o; a.buf[a.i] = y + o * 0.5; if (++a.i >= a.buf.length) a.i = 0; y = v; }
      out[n] = y;
    }
    return out;
  };
  return [run(inL, 0), run(inR, 23)];
}

function renderMusic({ duration, events, vo, duckFile, plainFile }) {
  const N = Math.ceil((duration + 0.2) * SR), T = N / SR;
  const L = new Float32Array(N), R = new Float32Array(N), sL = new Float32Array(N), sR = new Float32Array(N);
  const rand = rng(26067);
  const secs = events.filter((e) => e.type === 'section').map((e) => ({ name: e.name, t: e.t / 1000 }));
  const sectionAt = (t) => { let s = 'open'; for (const x of secs) if (t >= x.t) s = x.name; return s; };
  const demoStart = (secs.find((x) => x.name === 'demo') || { t: T }).t, outroStart = (secs.find((x) => x.name === 'outro') || { t: T }).t;

  /* soft-saw wavetable */
  const TL = 4096, tab = new Float32Array(TL);
  for (let i = 0; i < TL; i++) { let v = 0; for (let h = 1; h <= 7; h++) v += Math.sin(2 * Math.PI * h * i / TL) / Math.pow(h, 1.25); tab[i] = v * 0.62; }

  /* ---- pad: 8 s chords with raised-cosine crossfades ---- */
  const CH = [[38, 45, 54, 61, 64], [35, 42, 50, 57, 64], [31, 43, 50, 54, 61], [33, 45, 52, 57, 62]];
  const LEN = 8, FADE = 2.6, nCh = Math.ceil(T / LEN) + 1;
  const bright = (t) => { const s = sectionAt(t); return s === 'open' ? 700 + 900 * Math.min(1, t / 20) : s === 'demo' ? 1500 : 2100 + 900 * Math.min(1, (t - outroStart) / 10); };
  let f1L = 0, f2L = 0, f1R = 0, f2R = 0;
  const padL = new Float32Array(N), padR = new Float32Array(N);
  for (let c = 0; c < nCh; c++) {
    const notes = CH[c % 4], t0 = c * LEN - FADE / 2, t1 = (c + 1) * LEN + FADE / 2;
    const i0 = Math.max(0, Math.floor(t0 * SR)), i1 = Math.min(N, Math.ceil(t1 * SR));
    notes.forEach((m, ni) => {
      const f = mtof(m), det = [-8, 0, 7].map((cents) => f * Math.pow(2, cents / 1200)), ph = det.map(() => rand() * TL);
      const lvl = ni === 0 ? 0.16 : 0.11;
      for (let i = i0; i < i1; i++) {
        const t = i / SR; let env = 1;
        if (t < t0 + FADE) env = 0.5 - 0.5 * Math.cos(Math.PI * (t - t0) / FADE);
        else if (t > t1 - FADE) env = 0.5 + 0.5 * Math.cos(Math.PI * (t - (t1 - FADE)) / FADE);
        const a = tab[(ph[0] = (ph[0] + det[0] * TL / SR) % TL) | 0], b = tab[(ph[1] = (ph[1] + det[1] * TL / SR) % TL) | 0], d = tab[(ph[2] = (ph[2] + det[2] * TL / SR) % TL) | 0];
        padL[i] += (a * 0.8 + b * 0.5) * env * lvl; padR[i] += (d * 0.8 + b * 0.5) * env * lvl;
      }
    });
    /* sub bass on the root */
    const fr = mtof(notes[0]);
    for (let i = i0; i < i1; i++) { const t = i / SR; let env = 1; if (t < t0 + FADE) env = 0.5 - 0.5 * Math.cos(Math.PI * (t - t0) / FADE); else if (t > t1 - FADE) env = 0.5 + 0.5 * Math.cos(Math.PI * (t - (t1 - FADE)) / FADE); const v = Math.sin(2 * Math.PI * fr * t) * 0.2 * env; L[i] += v; R[i] += v; }
  }
  /* beat for the demo section: gentle thump + pad pump */
  const BEAT = 0.6;
  const pump = (t) => { if (t < demoStart || t > outroStart) return 1; const ph = ((t - demoStart) % BEAT) / BEAT; return 1 - 0.22 * Math.exp(-ph * 9); };
  for (let i = 0; i < N; i++) {
    const t = i / SR, fc = bright(t) * (1 + 0.15 * Math.sin(2 * Math.PI * t / 11)), a = 1 - Math.exp(-2 * Math.PI * fc / SR), g = pump(t);
    f1L += a * (padL[i] - f1L); f2L += a * (f1L - f2L); f1R += a * (padR[i] - f1R); f2R += a * (f1R - f2R);
    L[i] += f2L * g; R[i] += f2R * g; sL[i] += f2L * 0.35; sR[i] += f2R * 0.35;
  }
  for (let t = demoStart; t < outroStart; t += BEAT) {
    const i0 = Math.floor(t * SR), len = Math.floor(0.22 * SR); let ph = 0;
    for (let j = 0; j < len && i0 + j < N; j++) { const tt = j / SR, f = 45 + 25 * Math.exp(-tt * 30); ph += 2 * Math.PI * f / SR; const v = Math.sin(ph) * Math.exp(-tt * 16) * 0.16; L[i0 + j] += v; R[i0 + j] += v; }
  }
  /* ---- arpeggio plucks in the demo section (with delay) ---- */
  const dL = new Float32Array(N), dR = new Float32Array(N);
  const PAT = [0, 2, 4, 1, 3, 2, 4, 3];
  let step = 0;
  for (let t = demoStart + 0.3; t < outroStart - 0.5; t += BEAT / 2, step++) {
    const c = CH[Math.floor(t / LEN) % 4], m = c[1 + (PAT[step % 8] % 4)] + 24, f = mtof(m), i0 = Math.floor(t * SR), len = Math.floor(0.9 * SR);
    const pan = step % 2 ? 0.35 : -0.35, amp = 0.045 * (0.8 + 0.2 * Math.sin(step * 0.7));
    for (let j = 0; j < len && i0 + j < N; j++) { const tt = j / SR, e = Math.exp(-tt * 7) * Math.min(1, tt * 400); const v = (Math.sin(2 * Math.PI * f * tt) + 0.28 * Math.sin(4 * Math.PI * f * tt)) * e * amp; dL[i0 + j] += v * (1 - pan); dR[i0 + j] += v * (1 + pan); }
  }
  { const D = Math.floor(0.45 * SR); for (let i = 0; i < N; i++) { const eL = i >= D ? dL[i - D] * 0.38 : 0, eR = i >= D ? dR[i - D] * 0.38 : 0; dL[i] += eR; dR[i] += eL; L[i] += dL[i]; R[i] += dR[i]; sL[i] += dL[i] * 0.5; sR[i] += dR[i] * 0.5; } }
  /* ---- bells in the cinematic sections ---- */
  for (let t = 1.5; t < T - 2; t += 2.2 + rand() * 1.6) {
    const s = sectionAt(t); if (s === 'demo') continue;
    const c = CH[Math.floor(t / LEN) % 4], m = c[2 + Math.floor(rand() * 3)] + (rand() < 0.5 ? 24 : 12), f = mtof(m), i0 = Math.floor(t * SR), len = Math.floor(3.6 * SR), pan = rand() * 1.2 - 0.6;
    for (let j = 0; j < len && i0 + j < N; j++) { const tt = j / SR, e = Math.exp(-tt * 1.3) * Math.min(1, tt * 200); const v = (Math.sin(2 * Math.PI * f * tt) + 0.35 * Math.sin(2 * Math.PI * f * 2.76 * tt) * Math.exp(-tt * 3) + 0.15 * Math.sin(2 * Math.PI * f * 5.4 * tt) * Math.exp(-tt * 6)) * e * 0.038; L[i0 + j] += v * (1 - pan); R[i0 + j] += v * (1 + pan); sL[i0 + j] += v * 1.4; sR[i0 + j] += v * 1.4; }
  }
  /* ---- ocean wash ---- */
  { let b0 = 0, b1 = 0, b2 = 0, c0 = 0, c1 = 0, c2 = 0, lpL = 0, lpR = 0;
    for (let i = 0; i < N; i++) {
      const t = i / SR, wL = rand() * 2 - 1, wR = rand() * 2 - 1;
      b0 = 0.99765 * b0 + wL * 0.099; b1 = 0.963 * b1 + wL * 0.2965; b2 = 0.57 * b2 + wL * 1.0527; const pL = (b0 + b1 + b2 + wL * 0.1848) * 0.12;
      c0 = 0.99765 * c0 + wR * 0.099; c1 = 0.963 * c1 + wR * 0.2965; c2 = 0.57 * c2 + wR * 1.0527; const pR = (c0 + c1 + c2 + wR * 0.1848) * 0.12;
      const sw = Math.pow(0.5 + 0.5 * Math.sin(2 * Math.PI * t / 6.5 + Math.sin(2 * Math.PI * t / 17)), 2), s = sectionAt(t);
      const amp = (s === 'open' ? 0.07 : s === 'demo' ? 0.032 : 0.06) * (0.3 + 0.7 * sw), fc = 500 + 500 * sw, a = 1 - Math.exp(-2 * Math.PI * fc / SR);
      lpL += a * (pL - lpL); lpR += a * (pR - lpR); L[i] += lpL * amp * 3; R[i] += lpR * amp * 3;
    } }
  /* ---- whooshes, impacts, clicks ---- */
  const addWhoosh = (t) => {
    const i0 = Math.floor((t - 1.05) * SR), len = Math.floor(1.7 * SR); let lo = 0, bp = 0;
    for (let j = 0; j < len; j++) {
      const i = i0 + j; if (i < 0 || i >= N) continue;
      const tt = j / SR - 1.05, x = rand() * 2 - 1;
      const fc = 250 + 3300 * Math.pow(Math.min(1, Math.max(0, (tt + 1.05) / 1.2)), 1.6), f = 2 * Math.sin(Math.PI * fc / SR), q = 0.35;
      lo += f * bp; const hi = x - lo - q * bp; bp += f * hi;
      const env = tt < 0 ? Math.pow((tt + 1.05) / 1.05, 2.4) : Math.exp(-tt * 7), pan = Math.max(-0.8, Math.min(0.8, tt * 1.3));
      const v = bp * env * 0.2; L[i] += v * (1 - pan); R[i] += v * (1 + pan); sL[i] += v; sR[i] += v;
    }
  };
  const addImpact = (t) => {
    const i0 = Math.floor(t * SR), len = Math.floor(3 * SR); let ph = 0, lp = 0;
    for (let j = 0; j < len && i0 + j < N; j++) { const tt = j / SR, f = 38 + 55 * Math.exp(-tt * 9); ph += 2 * Math.PI * f / SR; lp += 0.05 * ((rand() * 2 - 1) - lp); const v = Math.sin(ph) * Math.exp(-tt * 1.6) * 0.45 + lp * Math.exp(-tt * 5) * 0.5; L[i0 + j] += v; R[i0 + j] += v; sL[i0 + j] += v * 0.6; sR[i0 + j] += v * 0.6; }
  };
  const addClick = (t) => { const i0 = Math.floor(t * SR), len = Math.floor(0.05 * SR); for (let j = 0; j < len && i0 + j < N; j++) { const tt = j / SR, v = (Math.sin(2 * Math.PI * 1900 * tt) * 0.6 + Math.sin(2 * Math.PI * 3800 * tt) * 0.25) * Math.exp(-tt * 110) * 0.05; L[i0 + j] += v; R[i0 + j] += v; sL[i0 + j] += v * 0.5; sR[i0 + j] += v * 0.5; } };
  events.forEach((e) => { const t = e.t / 1000; if (e.type === 'whoosh') addWhoosh(t); else if (e.type === 'impact') addImpact(t + 0.05); else if (e.type === 'click') addClick(t); });

  /* ---- reverb + master ---- */
  const [rL, rR] = reverb(sL, sR);
  let hpL = 0, hpR = 0, xL = 0, xR = 0, peak = 0;
  const outL = new Float32Array(N), outR = new Float32Array(N), fadeOutStart = T - 3.2;
  for (let i = 0; i < N; i++) {
    const t = i / SR; let l = L[i] + rL[i] * 0.9, r = R[i] + rR[i] * 0.9;
    const yl = l - xL + 0.9985 * hpL; xL = l; hpL = yl; const yr = r - xR + 0.9985 * hpR; xR = r; hpR = yr;
    let g = Math.min(1, t / 1.4); if (t > fadeOutStart) g *= Math.max(0, 1 - (t - fadeOutStart) / 3);
    outL[i] = Math.tanh(yl * 1.3 * g) / 1.3; outR[i] = Math.tanh(yr * 1.3 * g) / 1.3;
    peak = Math.max(peak, Math.abs(outL[i]), Math.abs(outR[i]));
  }
  const norm = 0.89 / (peak || 1);
  for (let i = 0; i < N; i++) { outL[i] *= norm; outR[i] *= norm; }
  writeWav(plainFile, outL, outR);
  /* ducked copy under the narration */
  const dk = new Float32Array(N).fill(1);
  (vo || []).forEach((e) => { const a = Math.floor((e.t / 1000 - 0.15) * SR), b = Math.floor((e.t + e.dur) / 1000 * SR + 0.45 * SR); for (let i = Math.max(0, a); i < Math.min(N, b); i++) dk[i] = 0.4; });
  let gg = 1; const dL2 = new Float32Array(N), dR2 = new Float32Array(N);
  for (let i = 0; i < N; i++) { gg += (dk[i] - gg) * (dk[i] < gg ? 0.0009 : 0.00012); dL2[i] = outL[i] * gg; dR2[i] = outR[i] * gg; }
  writeWav(duckFile, dL2, dR2);
}
module.exports = { renderMusic };
