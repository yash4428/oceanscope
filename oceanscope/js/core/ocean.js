/* Synthetic North Indian Ocean: coastlines, profiles, noise, volumes.
   Ported from ocean-cake.html and extended with a model-disagreement field (D). */
(function (OS) {
'use strict';
const { clamp, smoothstep } = OS.U;

const LON0 = 40, LON1 = 100, LAT0 = -15, LAT1 = 27, DMAX = 4000;
const NX = 121, NY = 85, NZ = 48, N2 = NX * NY;
const LX = 241, LY = 169;
const W = 6.0, DZ = 4.2, HX = W / 2, HZ = DZ / 2;

function hash2(i, j) {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ 0x5bd1e995;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y) {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash2(i, j), b = hash2(i + 1, j), c = hash2(i, j + 1), d = hash2(i + 1, j + 1);
  const ab = a + (b - a) * u, cd = c + (d - c) * u;
  return ab + (cd - ab) * v;
}
function fbm(x, y, oct) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let o = 0; o < oct; o++) { s += a * (vnoise(x * f + o * 17.3, y * f - o * 9.1) * 2 - 1); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

const POLYS = [
  [[40,-15],[40.6,-15],[40.5,-13],[40.2,-10.3],[40,-9.6],[40,-3.4],[40.1,-3.2],[40.9,-2.3],[42.5,-0.4],[45.3,2.0],[48.5,5.3],[49.8,8.0],[51.4,10.4],[51.3,11.8],[49.2,11.3],[47.5,11.1],[45.0,10.4],[43.4,11.2],[43.1,11.6],[43.4,12.6],[45.0,12.8],[48.0,14.0],[49.1,14.5],[52.2,15.6],[54.1,17.0],[55.5,17.8],[57.2,18.9],[57.8,19.8],[58.8,20.6],[59.8,22.5],[58.6,23.6],[57.3,23.9],[56.4,24.8],[56.3,26.4],[56.45,26.95],[57.0,26.95],[57.3,26.0],[57.8,25.6],[59.0,25.4],[60.6,25.3],[62.3,25.1],[64.6,25.2],[66.5,25.4],[67.0,24.8],[67.5,24.0],[68.2,23.6],[68.7,23.2],[69.1,22.5],[69.6,21.6],[70.4,20.9],[71.0,20.7],[72.2,21.5],[72.7,21.1],[72.8,20.4],[72.85,19.0],[73.3,17.0],[73.8,15.4],[74.1,14.8],[74.8,12.9],[75.8,11.25],[76.25,9.95],[76.6,8.9],[77.55,8.08],[78.15,8.8],[79.1,9.25],[79.85,10.3],[79.85,10.75],[80.3,13.1],[80.2,14.5],[81.2,16.2],[82.3,16.95],[83.3,17.7],[84.1,18.3],[84.9,19.3],[85.8,19.8],[86.7,20.3],[87.0,21.0],[88.1,21.65],[89.1,21.7],[90.3,21.9],[90.9,22.3],[91.8,22.3],[92.0,21.4],[92.9,20.1],[93.7,19.0],[94.3,17.9],[94.2,16.0],[95.2,15.8],[96.3,16.5],[97.6,16.5],[97.8,15.2],[98.2,14.1],[98.6,12.4],[98.6,10.0],[98.3,8.0],[98.9,8.0],[99.5,7.5],[100.0,6.6],[100,27],[40,27]],
  [[79.95,9.8],[80.3,9.8],[81.2,8.6],[81.8,7.5],[81.9,6.8],[81.4,6.2],[80.6,5.95],[80.1,6.3],[79.85,7.0],[79.8,8.0],[79.9,8.9]],
  [[95.2,5.6],[97.1,5.2],[98.7,3.8],[99.8,2.8],[100,2.4],[100,-0.8],[99.6,0.1],[98.8,1.75],[97.6,2.9],[96.1,4.15],[95.3,5.0]],
  [[49.26,-11.95],[49.6,-12.5],[50.0,-13.4],[50.25,-14.3],[50.4,-15],[47.4,-15],[48.0,-14.0],[48.7,-12.9]],
  [[92.7,13.6],[93.05,12.5],[92.85,10.6],[92.5,11.5]],
  [[53.3,12.65],[54.5,12.7],[54.4,12.3],[53.6,12.3]]
];
const POLY_BB = POLYS.map((p) => { let a = 1e9, b = -1e9, c = 1e9, d = -1e9; for (const [x, y] of p) { a = Math.min(a, x); b = Math.max(b, x); c = Math.min(c, y); d = Math.max(d, y); } return [a, b, c, d]; });
function inPoly(px, py, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) c = !c;
  }
  return c;
}
function isLand(lon, lat) {
  for (let n = 0; n < POLYS.length; n++) {
    const bb = POLY_BB[n];
    if (lon < bb[0] || lon > bb[1] || lat < bb[2] || lat > bb[3]) continue;
    if (inPoly(lon, lat, POLYS[n])) return true;
  }
  return false;
}
const CIR = [[51,13.2],[57,12.5],[60,9],[63.5,5],[66.5,1],[67,-4],[67.8,-10],[68.5,-15]];
const CLR = [[72.2,14.5],[72.8,8],[73.3,2],[72.4,-5],[71.8,-8]];
const NER = [[89.2,10],[89.6,0],[88.8,-10],[88.4,-15]];
function distPolyline(lon, lat, pts) {
  let best = 1e9;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0], ay = pts[i][1], dx = pts[i + 1][0] - ax, dy = pts[i + 1][1] - ay;
    const t = clamp(((lon - ax) * dx + (lat - ay) * dy) / (dx * dx + dy * dy), 0, 1);
    best = Math.min(best, Math.hypot(ax + t * dx - lon, ay + t * dy - lat));
  }
  return best;
}

function tempFn(sst, mld, d20, eddy, d) {
  const top = sst - 0.002 * mld;
  if (d <= mld) return sst - 0.002 * d;
  const de = Math.max(mld, d - eddy * 45 * Math.exp(-d / 900));
  const tdeep = 1.6 + 13.8 * Math.exp(-de / 720);
  const t20 = 1.6 + 13.8 * Math.exp(-d20 / 720);
  const P20 = clamp((20 - t20) / (top - t20), 0.05, 0.95);
  const L = (d20 - mld) / Math.pow(-Math.log(P20), 0.8);
  const P = Math.exp(-Math.pow((de - mld) / L, 1.25));
  return tdeep + (top - tdeep) * P;
}
function salFn(sss, hs, rsw, pgw, d) {
  const sdeep = 34.72 + 0.26 * Math.exp(-d / 850);
  let S = sdeep + (sss - 34.98) * Math.exp(-Math.pow(d / hs, 1.6));
  S += rsw * 0.42 * Math.exp(-Math.pow((d - 720) / 230, 2));
  S += pgw * 0.38 * Math.exp(-Math.pow((d - 280) / 110, 2));
  return S;
}

const VARS = {
  T: { name: 'Temperature', plain: 'Warmth', unit: '°C', q: [0, 31], range: [2, 30], step: 2, hi: 26, dec: 1,
       note: 'The white line is 26 °C. Warmer water above it is the fuel cyclones feed on.' },
  S: { name: 'Salinity', plain: 'Saltiness', unit: 'PSU', q: [30, 37.5], range: [33, 36.6], step: 0.5, hi: null, dec: 2,
       note: 'River water sits as a fresh lid on the Bay of Bengal. Salty Red Sea and Gulf water sinks to 300–800 m in the Arabian Sea.' },
  V: { name: 'Current speed', plain: 'Flow', unit: 'm/s', q: [0, 2.2], range: [0, 1.2], step: 0.2, hi: null, dec: 2,
       note: 'In July the Somali Current races north along Africa and spins up the Great Whirl eddy.' },
  D: { name: 'Model error', plain: 'How wrong the model is', unit: '°C', q: [0, 2.6], range: [0, 1.6], step: 0.25, hi: null, dec: 2,
       note: 'How far the model sits from what floats measured. Errors pile up where the ocean is restless: eddies, upwelling and the thermocline.' }
};
const CMAPS = {
  T: ['#042333','#15325f','#403891','#6b4d8c','#955d89','#c26b79','#ea7d5a','#f9a33e','#f7d34b','#e8fa5b'],
  S: ['#2a186c','#122f9b','#1b5b8f','#2e7a86','#3b9981','#51b672','#86cd5a','#c9df5b','#fdef9a'],
  V: ['#fffdcd','#e5dc92','#bdc05c','#86a43a','#4f8a2c','#1f6c2d','#155026','#173724'],
  D: ['#F7F6F1','#F3E6C8','#F1CE8A','#EDAA52','#E17F35','#CC5227','#A63020','#6E1A16']
};
const hexRgb = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const CMAP_RGB = {}; for (const k in CMAPS) CMAP_RGB[k] = CMAPS[k].map(hexRgb);
function cmapAt(key, t) {
  const st = CMAP_RGB[key], x = clamp(t, 0, 1) * (st.length - 1), i = Math.min(st.length - 2, Math.floor(x)), f = x - i;
  return [st[i][0] + (st[i + 1][0] - st[i][0]) * f, st[i][1] + (st[i + 1][1] - st[i][1]) * f, st[i][2] + (st[i + 1][2] - st[i][2]) * f];
}

function buildOcean() {
  const landHi = new Uint8Array(LX * LY);
  const offs = [[-0.0625, -0.0625], [0.0625, -0.0625], [-0.0625, 0.0625], [0.0625, 0.0625]];
  for (let j = 0; j < LY; j++) {
    const lat = LAT1 - j * 0.25;
    for (let i = 0; i < LX; i++) {
      const lon = LON0 + i * 0.25; let c = 0;
      for (const o of offs) if (isLand(clamp(lon + o[0], LON0 + 0.01, LON1 - 0.01), clamp(lat + o[1], LAT0 + 0.01, LAT1 - 0.01))) c++;
      landHi[j * LX + i] = Math.round(c / 4 * 255);
    }
  }
  const landLo = new Uint8Array(N2);
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) landLo[j * NX + i] = landHi[(2 * j) * LX + 2 * i] >= 128 ? 1 : 0;

  const dc = new Float32Array(N2);
  for (let k = 0; k < N2; k++) dc[k] = landLo[k] ? 0 : 1e6;
  const s1 = 0.5, s2 = 0.7071;
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const k = j * NX + i; let d = dc[k];
    if (i > 0) d = Math.min(d, dc[k - 1] + s1);
    if (j > 0) { d = Math.min(d, dc[k - NX] + s1); if (i > 0) d = Math.min(d, dc[k - NX - 1] + s2); if (i < NX - 1) d = Math.min(d, dc[k - NX + 1] + s2); }
    dc[k] = d;
  }
  for (let j = NY - 1; j >= 0; j--) for (let i = NX - 1; i >= 0; i--) {
    const k = j * NX + i; let d = dc[k];
    if (i < NX - 1) d = Math.min(d, dc[k + 1] + s1);
    if (j < NY - 1) { d = Math.min(d, dc[k + NX] + s1); if (i < NX - 1) d = Math.min(d, dc[k + NX + 1] + s2); if (i > 0) d = Math.min(d, dc[k + NX - 1] + s2); }
    dc[k] = d;
  }

  const F = () => new Float32Array(N2);
  const sst = F(), mld = F(), d20 = F(), eddy = F(), sss = F(), hs = F(), rsw = F(), pgw = F(), bathy = F(), cu = F(), cv = F(), hu = F(), dis = F();
  const psi = (a, b) => fbm(a * 0.22 + 11, b * 0.22 - 5, 3);

  for (let j = 0; j < NY; j++) {
    const lat = LAT1 - j * 0.5;
    for (let i = 0; i < NX; i++) {
      const lon = LON0 + i * 0.5, k = j * NX + i, d0 = dc[k];
      const e = fbm(lon * 0.2 + 5.1, lat * 0.2 - 3.7, 4), e2 = fbm(lon * 0.6 - 2, lat * 0.6 + 8, 3);
      eddy[k] = e;
      const wA = smoothstep(77, 70, lon) * smoothstep(-1, 4, lat);
      const wUp = smoothstep(63, 58, lon) * smoothstep(1, 5, lat) * smoothstep(24, 20, lat);
      const wK = smoothstep(78, 76.5, lon) * smoothstep(6, 8, lat) * smoothstep(15, 12, lat);
      const wB = smoothstep(79, 83, lon) * smoothstep(4, 9, lat);

      let t = 28.9 - Math.max(0, -lat - 3) * 0.12;
      t -= 1.1 * wA;
      t -= 4.2 * wUp * Math.exp(-d0 / 1.4);
      t -= 1.4 * Math.exp(-(((lon - 54) / 3) ** 2 + ((lat - 10.5) / 1.5) ** 2));
      t -= 1.6 * wK * Math.exp(-d0 / 0.9);
      t += 0.5 * wB + 0.45 * e + 0.2 * e2;
      sst[k] = t;

      let m = 48 + 42 * wA * smoothstep(3, 10, lat);
      m *= 1 - 0.6 * wUp * Math.exp(-d0 / 2);
      m += (62 - m) * wB;
      m = clamp(m + 8 * e, 12, 110);
      let z20 = 112 + 28 * smoothstep(-2, -12, lat);
      z20 -= 45 * Math.exp(-(((lat + 8) / 2.5) ** 2)) * smoothstep(86, 76, lon);
      z20 -= 70 * wUp * Math.exp(-d0 / 2.2);
      z20 += 55 * Math.exp(-((lon - 54) ** 2 + (lat - 6.5) ** 2) / 6.25);
      z20 += (95 - z20) * wB;
      z20 -= 45 * wK * Math.exp(-d0 / 1.5);
      z20 += 38 * e;
      mld[k] = m; d20[k] = Math.max(z20, m + 18, 40);

      let s = 34.95 - 0.45 * smoothstep(-4, -13, lat) * smoothstep(75, 90, lon);
      s += wA * (1.05 + 0.05 * Math.max(0, lat - 8));
      const wB2 = smoothstep(78.5, 81.5, lon) * smoothstep(3, 8, lat);
      const plume = Math.exp(-(((lon - 89.5) / 3.5) ** 2 + ((lat - 21) / 3) ** 2));
      const eicc = smoothstep(84.5, 80.5, lon) * smoothstep(8, 11, lat) * Math.exp(-d0 / 1.2);
      s -= wB2 * (0.6 + 0.12 * Math.max(0, lat - 6)) + 1.6 * plume * wB2 + 0.9 * eicc;
      sss[k] = s + 0.08 * e2;
      const hA = 110 + 80 * wA;
      hs[k] = hA + (32 - hA) * wB2;
      rsw[k] = Math.exp(-Math.hypot(lon - 46, lat - 12.3) / 11) * smoothstep(-8, 0, lat);
      pgw[k] = Math.exp(-Math.hypot(lon - 57.5, lat - 23.8) / 8);

      const base = 4300 + 350 * fbm(lon * 0.25 + 3, lat * 0.25 - 7, 3);
      let dep = 40 + (base - 40) * Math.pow(smoothstep(0, 3.2, d0), 0.7);
      if (lon > 79 && lon < 95 && lat > 8) dep = Math.min(dep, 1300 + Math.max(0, 22 - lat) * 210);
      if (lon > 60 && lon < 71 && lat > 15) dep = Math.min(dep, 2500 + (24 - lat) * 200);
      const rC = distPolyline(lon, lat, CIR);
      dep -= 2100 * Math.exp(-((rC / 1.3) ** 2)); dep += 500 * Math.exp(-((rC / 0.3) ** 2));
      dep -= Math.max(0, dep - 600) * 0.8 * Math.exp(-((distPolyline(lon, lat, CLR) / 1.0) ** 2));
      dep -= 2200 * Math.exp(-((distPolyline(lon, lat, NER) / 0.9) ** 2));
      dep += 180 * fbm(lon * 0.9, lat * 0.9, 3);
      bathy[k] = landLo[k] ? 0 : clamp(dep, 25, 5200);

      let u = 0, v = 0;
      const wS = smoothstep(56, 50, lon) * smoothstep(-4, -1, lat) * smoothstep(12, 9, lat);
      const jet = 1.7 * wS * Math.exp(-d0 / 1.6) * smoothstep(0, 0.4, d0);
      u += 0.45 * jet; v += 0.9 * jet;
      { const dx = lon - 54, dy = lat - 7, mg = 1.25 * Math.exp(-(dx * dx + dy * dy) / 10.24); u += dy / 3.2 * mg; v -= dx / 3.2 * mg; }
      u += 0.3 * wA * smoothstep(0, 2, d0) * smoothstep(4, 8, lat) * smoothstep(20, 15, lat);
      u += 0.75 * Math.exp(-(((lat - 5.5) / 2.2) ** 2)) * smoothstep(56, 62, lon) * smoothstep(90, 84, lon);
      const wT = Math.exp(-(((lon - 85) / 2.2) ** 2)) * smoothstep(4, 7, lat) * smoothstep(15, 11, lat);
      v += 0.6 * wT; u += 0.1 * wT;
      u -= 0.45 * Math.exp(-(((lat + 11) / 2.6) ** 2));
      const wE = smoothstep(78.5, 81, lon) * smoothstep(10, 12, lat) * smoothstep(21, 19, lat) * Math.exp(-d0 / 1.0) * smoothstep(0, 0.3, d0);
      v += 0.45 * wE; u += 0.22 * wE;
      const wW = smoothstep(77.5, 75.5, lon) * smoothstep(8, 10, lat) * smoothstep(22, 19, lat) * Math.exp(-d0 / 1.0) * smoothstep(0, 0.3, d0);
      v -= 0.4 * wW; u += 0.08 * wW;
      const ep = 0.25;
      u += 0.45 * (psi(lon, lat + ep) - psi(lon, lat - ep)) / (2 * ep);
      v -= 0.45 * (psi(lon + ep, lat) - psi(lon - ep, lat)) / (2 * ep);
      const damp = landLo[k] ? 0 : smoothstep(0, 0.6, d0);
      cu[k] = u * damp; cv[k] = v * damp; hu[k] = 140 + 80 * wS;

      /* Model disagreement: higher in eddy-rich, upwelling and front regions, plus a noise field seeded off the eddy field */
      const n3 = fbm(lon * 0.35 + 21.7, lat * 0.35 + 4.2, 4);
      let dis0 = 0.22 + 0.55 * Math.abs(e) + 0.35 * wUp + 0.3 * wS + 0.28 * Math.exp(-(((lon - 54) / 3) ** 2 + ((lat - 8) / 2.5) ** 2));
      dis0 += 0.32 * plume * wB2 + 0.22 * wK + 0.2 * Math.max(0, n3);
      dis0 *= 0.75 + 0.25 * smoothstep(0, 1.5, d0);
      dis[k] = landLo[k] ? 0 : dis0;
    }
  }

  const volT = new Float32Array(N2 * NZ), volS = new Float32Array(N2 * NZ), volV = new Float32Array(N2 * NZ), volD = new Float32Array(N2 * NZ);
  const q = (x, r) => clamp((x - r[0]) / (r[1] - r[0]), 0, 1);
  for (let kz = 0; kz < NZ; kz++) {
    const sN = kz / (NZ - 1), d = DMAX * sN * sN, off = kz * N2;
    for (let k = 0; k < N2; k++) {
      volT[off + k] = q(tempFn(sst[k], mld[k], d20[k], eddy[k], d), VARS.T.q);
      volS[off + k] = q(salFn(sss[k], hs[k], rsw[k], pgw[k], d), VARS.S.q);
      volV[off + k] = q(Math.hypot(cu[k], cv[k]) * Math.exp(-d / hu[k]), VARS.V.q);
      /* error concentrates at the thermocline, decays at depth */
      const th = Math.exp(-Math.pow((d - d20[k] - 20) / 70, 2));
      const dz = 0.35 * Math.exp(-d / 900) + 1.25 * th + 0.08;
      volD[off + k] = q(dis[k] * dz * 1.35, VARS.D.q);
    }
  }
  const bathyS = new Uint8Array(N2);
  for (let k = 0; k < N2; k++) bathyS[k] = landLo[k] ? 0 : Math.round(Math.sqrt(Math.min(bathy[k], DMAX) / DMAX) * 255);

  return { landHi, landLo, dc, sst, mld, d20, eddy, sss, hs, rsw, pgw, bathy, bathyS, cu, cv, hu, dis, vol: { T: volT, S: volS, V: volV, D: volD } };
}

OS.Ocean = { LON0, LON1, LAT0, LAT1, DMAX, NX, NY, NZ, N2, LX, LY, W, DZ, HX, HZ,
  hash2, vnoise, fbm, mulberry32, isLand, distPolyline, tempFn, salFn, VARS, CMAPS, cmapAt, buildOcean };
})(window.OS);
