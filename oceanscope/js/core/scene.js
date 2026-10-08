/* One shared Three.js scene. Views reconfigure it; nothing is torn down between views. */
(function (OS) {
'use strict';
const U = OS.U, { $, clamp, lerp, fmtLon, fmtLat, fmtDepth, reduceMotion } = U;
const Oc = OS.Ocean, { LON0, LON1, LAT0, LAT1, DMAX, NX, NY, NZ, N2, LX, LY, W, DZ, HX, HZ, VARS, cmapAt, tempFn, salFn } = Oc;

const Scene = {};
const view = { H: 1.6, gamma: 0.5 };
const lonToX = (lon) => (lon - LON0) / (LON1 - LON0) * W - HX;
const latToZ = (lat) => (LAT1 - lat) / (LAT1 - LAT0) * DZ - HZ;
const xToLon = (x) => LON0 + (x + HX) / W * (LON1 - LON0);
const zToLat = (z) => LAT1 - (z + HZ) / DZ * (LAT1 - LAT0);
const depthToY = (d) => -view.H * Math.pow(clamp(d, 0, DMAX) / DMAX, view.gamma);
const yToDepth = (y) => { const t = clamp(-y / view.H, 0, 1), s = Math.pow(t, 0.5 / view.gamma); return DMAX * s * s; };
Object.assign(Scene, { view, lonToX, latToZ, xToLon, zToLat, depthToY, yToDepth });

let renderer, scene, camera, O, stage, canvas, uniforms, faces, faceList, edges, edgeGeo, shadow;
let TEX, CTEX, wakeTex, wakeData;
const knife = { lon: 100, lat: -15, depth: 0 };
let cut = null;
const state = { var: 'T', range: VARS.T.range.slice() };
const frameCbs = new Set();
const layers = new THREE.Group();
let clickMode = 'float';       // float | pin | sonar | omz
const surfaceHandlers = [];
let userInteracted = false;

Scene.init = function (stageEl, onReady) {
  stage = stageEl; canvas = $('c');
  const loading = $('loading');
  const fatal = (msg) => { loading.innerHTML = `<p>${msg}</p>`; loading.classList.add('fatal'); };
  if (!window.THREE) { fatal('Three.js did not load. Check your internet connection and reload the page.'); return; }
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); }
  catch (err) { fatal('WebGL is turned off or unavailable in this browser.'); return; }
  if (!renderer.capabilities.isWebGL2) { fatal('OceanScope needs WebGL 2. Try a recent Chrome, Edge, Firefox or Safari.'); return; }
  setTimeout(() => { build(); onReady(); }, 80);
};

function build() {
  O = Oc.buildOcean(); Scene.O = O;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  scene = new THREE.Scene(); scene.background = new THREE.Color('#E6EBE8');
  camera = new THREE.PerspectiveCamera(32, 1, 0.05, 100);
  scene.add(layers);
  Scene.scene = scene; Scene.camera = camera; Scene.renderer = renderer;

  /* ---- textures ---- */
  const f32b = new Float32Array(1), i32b = new Int32Array(f32b.buffer);
  function toHalf(val) {
    f32b[0] = val; const x = i32b[0];
    let bits = (x >> 16) & 0x8000, m = (x >> 12) & 0x07ff; const e = (x >> 23) & 0xff;
    if (e < 103) return bits;
    if (e > 142) { bits |= 0x7c00; return bits; }
    if (e < 113) { m |= 0x0800; bits |= (m >> (114 - e)) + ((m >> (113 - e)) & 1); return bits; }
    bits |= ((e - 112) << 10) | (m >> 1); bits += m & 1; return bits;
  }
  function tex3D(src) {
    const data = new Uint16Array(src.length);
    for (let i = 0; i < src.length; i++) data[i] = toHalf(src[i]);
    const t = new THREE.DataTexture3D(data, NX, NY, NZ);
    t.format = THREE.RedFormat; t.type = THREE.HalfFloatType;
    t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.unpackAlignment = 1; t.needsUpdate = true;
    return t;
  }
  function tex2D(data, w, h) {
    const t = new THREE.DataTexture(data, w, h, THREE.RedFormat, THREE.UnsignedByteType);
    t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.unpackAlignment = 1; t.needsUpdate = true;
    return t;
  }
  function cmapTex(key) {
    const d = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) { const c = cmapAt(key, i / 255); d[i * 4] = c[0] * 255; d[i * 4 + 1] = c[1] * 255; d[i * 4 + 2] = c[2] * 255; d[i * 4 + 3] = 255; }
    const t = new THREE.DataTexture(d, 256, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.needsUpdate = true;
    return t;
  }
  TEX = {}; CTEX = {};
  for (const k in O.vol) { TEX[k] = tex3D(O.vol[k]); CTEX[k] = cmapTex(k); }
  wakeData = new Uint8Array(N2); wakeTex = tex2D(wakeData, NX, NY);
  const flowData = new Uint8Array(N2 * 4);
  for (let k = 0; k < N2; k++) { flowData[k * 4] = Math.round(clamp(O.cu[k] / 1.6 * 0.5 + 0.5, 0, 1) * 255); flowData[k * 4 + 1] = Math.round(clamp(O.cv[k] / 1.6 * 0.5 + 0.5, 0, 1) * 255); flowData[k * 4 + 2] = 0; flowData[k * 4 + 3] = 255; }
  const flowTex = new THREE.DataTexture(flowData, NX, NY, THREE.RGBAFormat, THREE.UnsignedByteType); flowTex.minFilter = THREE.LinearFilter; flowTex.magFilter = THREE.LinearFilter; flowTex.needsUpdate = true;

  uniforms = {
    uVol: { value: TEX.T }, uLand: { value: tex2D(O.landHi, LX, LY) }, uBathy: { value: tex2D(O.bathyS, NX, NY) },
    uCmap: { value: CTEX.T }, uCut: { value: new THREE.Vector3(1e3, 1e3, 1e3) }, uHalf: { value: new THREE.Vector2(HX, HZ) },
    uH: { value: view.H }, uGamma: { value: view.gamma }, uQ: { value: new THREE.Vector2(0, 31) }, uRange: { value: new THREE.Vector2(2, 30) },
    uStep: { value: 2 }, uContours: { value: 1 }, uHi: { value: 26 }, uHiGlow: { value: 0 },
    uWake: { value: wakeTex }, uWakeAmt: { value: 0 }, uTime: { value: 0 }, uFlowTex: { value: flowTex }, uFlow: { value: 1 },
    uGrid: { value: new THREE.Vector3(NX, NY, NZ) }, uLandGrid: { value: new THREE.Vector2(LX, LY) }, uCine: { value: 0 }
  };
  Scene.uniforms = uniforms;
  if (OS.FX) OS.FX.preUniforms(uniforms, O);
  const G = OS.GLSL || { waves: 'float waveH(vec2 p){ return 0.0; }', caustic: 'float caustic(vec2 u, float t){ return 0.0; }' };

  const faceMat = new THREE.ShaderMaterial({
    uniforms, extensions: { derivatives: true }, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    vertexShader: `
      varying vec3 vW; varying vec3 vN;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      precision highp float; precision highp sampler3D;
      uniform sampler3D uVol; uniform sampler2D uLand; uniform sampler2D uBathy; uniform sampler2D uCmap; uniform sampler2D uWake;
      uniform vec3 uCut; uniform vec2 uHalf; uniform float uH; uniform float uGamma;
      uniform vec2 uQ; uniform vec2 uRange; uniform float uStep; uniform float uContours; uniform float uHi; uniform float uHiGlow;
      uniform float uWakeAmt; uniform float uTime; uniform sampler2D uFlowTex; uniform float uFlow;
      uniform vec3 uGrid; uniform vec2 uLandGrid; uniform float uCine;
      varying vec3 vW; varying vec3 vN;
      ${G.waves}
      ${G.caustic}
      float tc(float f, float n){ return (f * (n - 1.0) + 0.5) / n; }
      float isoLine(float v, float stepv, float width){ float f = v / stepv; float g = abs(fract(f - 0.5) - 0.5) / max(fwidth(f), 1e-3); return 1.0 - smoothstep(0.0, width, g); }
      float nearLine(float v, float target, float width){ return 1.0 - smoothstep(0.0, width, abs(v - target) / max(fwidth(v), 1e-5)); }
      float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); float a = hash21(i), b = hash21(i + vec2(1.0, 0.0)), c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0)); return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
      vec3 landColor(float lon, float lat, float land){
        vec2 q = vec2(lon, lat);
        float n = vnoise2(q * 1.3) * 0.55 + vnoise2(q * 4.1 + 7.0) * 0.3 + vnoise2(q * 11.0 + 3.0) * 0.15;
        float nx = vnoise2((q + vec2(0.08, 0.0)) * 1.3) * 0.55 + vnoise2((q + vec2(0.08, 0.0)) * 4.1 + 7.0) * 0.3;
        float nz = vnoise2((q + vec2(0.0, 0.08)) * 1.3) * 0.55 + vnoise2((q + vec2(0.0, 0.08)) * 4.1 + 7.0) * 0.3;
        float relief = clamp(0.75 + (n - nx) * 5.0 + (nz - n) * 3.5, 0.45, 1.25);
        vec3 lush = vec3(0.24, 0.47, 0.22), jungle = vec3(0.13, 0.36, 0.19), dry = vec3(0.60, 0.52, 0.33), desert = vec3(0.84, 0.66, 0.43), sand = vec3(0.93, 0.85, 0.64), rock = vec3(0.52, 0.47, 0.42);
        float arid = smoothstep(66.0, 60.0, lon) * smoothstep(9.0, 15.0, lat) + smoothstep(52.5, 47.0, lon) * smoothstep(-3.0, 5.0, lat);
        float thar = exp(-pow((lon - 71.0) / 3.2, 2.0) - pow((lat - 25.8) / 2.6, 2.0));
        float deccan = exp(-pow((lon - 77.0) / 3.0, 2.0) - pow((lat - 17.0) / 3.5, 2.0));
        vec3 c = mix(lush, jungle, clamp(smoothstep(89.0, 95.0, lon) + smoothstep(11.0, 7.0, lat) * 0.6, 0.0, 1.0));
        c = mix(c, dry, deccan * 0.55);
        c = mix(c, desert, clamp(arid + thar, 0.0, 1.0));
        c = mix(c, rock, smoothstep(0.62, 0.8, n) * 0.35);
        c *= relief;
        c = mix(c, sand, smoothstep(0.78, 0.53, land) * 0.9);
        return c;
      }
      void main(){
        vec3 p = vW;
        if (p.x > uCut.x && p.y > uCut.y && p.z > uCut.z) discard;
        vec3 n = normalize(vN);
        float fu = clamp((p.x + uHalf.x) / (2.0 * uHalf.x), 0.0, 1.0);
        float fv = clamp((p.z + uHalf.y) / (2.0 * uHalf.y), 0.0, 1.0);
        float t = clamp(-p.y / uH, 0.0, 1.0);
        float s = pow(t, 0.5 / uGamma);
        float depth = 4000.0 * s * s;
        vec2 g2 = vec2(tc(fu, uGrid.x), tc(fv, uGrid.y));
        float land = texture(uLand, vec2(tc(fu, uLandGrid.x), tc(fv, uLandGrid.y))).r;
        if (uCine > 0.5 && land < 0.5) {
          if (n.y > 0.5 && p.y > -0.001) discard;                 /* the water mesh draws the ocean surface */
          if (abs(n.y) < 0.5 && p.y > waveH(p.xz)) discard;        /* air above the moving waterline */
        }
        float bed = texture(uBathy, g2).r;
        float q = texture(uVol, vec3(g2, tc(s, uGrid.z))).r;
        float val = mix(uQ.x, uQ.y, q);
        float wake = texture(uWake, g2).r * uWakeAmt;
        val -= wake * 5.5 * exp(-depth / 95.0);
        float iso = isoLine(val, uStep, 1.0);
        float hi = uHi > -900.0 ? nearLine(val, uHi, 1.4 + 2.2 * uHiGlow) : 0.0;
        float coast = nearLine(land, 0.5, 1.2);
        float bedLine = nearLine(s - bed, 0.0, 1.1);
        float lonD = 40.0 + fu * 60.0, latD = 27.0 - fv * 42.0;
        float grat = max(isoLine(lonD, 10.0, 0.8), isoLine(latD, 10.0, 0.8));
        float equator = nearLine(latD, 0.0, 0.9);
        float dl = max(max(nearLine(depth, 500.0, 0.8), nearLine(depth, 1000.0, 0.8)), max(nearLine(depth, 2000.0, 0.8), nearLine(depth, 3000.0, 0.8)));
        bool isSurface = n.y > 0.5 && p.y > -0.001;
        bool isVert = abs(n.y) < 0.5;
        vec3 ink = vec3(0.110, 0.165, 0.208);
        vec3 col;
        if (land > 0.5) {
          float relief = 0.5 + 0.5 * sin(fu * 140.0 + fv * 90.0) * sin(fv * 160.0 - fu * 40.0);
          col = isSurface ? mix(vec3(0.847, 0.796, 0.659), vec3(0.80, 0.74, 0.60), relief * 0.35) : vec3(0.760, 0.700, 0.575) * (0.95 + 0.05 * sin(depth * 0.012));
          if (uCine > 0.5) col = isSurface ? landColor(40.0 + fu * 60.0, 27.0 - fv * 42.0, land) : mix(vec3(0.46, 0.34, 0.24), vec3(0.62, 0.50, 0.36), 0.5 + 0.5 * sin(depth * 0.02 + vnoise2(vec2(p.x + p.z, p.y) * 30.0) * 3.0)) * (0.9 + 0.1 * vnoise2(vec2(p.x + p.z, p.y) * 90.0));
        } else if (s > bed) {
          vec2 cell = floor(vec2((p.x + p.z) * 70.0, p.y * 120.0));
          float h = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
          float strata = 0.5 + 0.5 * sin(p.y * 90.0 + h);
          col = vec3(0.455, 0.430, 0.385) * (0.90 + 0.08 * h + 0.05 * strata);
        } else {
          float c = clamp((val - uRange.x) / (uRange.y - uRange.x), 0.0, 1.0);
          col = texture(uCmap, vec2(0.002 + c * 0.996, 0.5)).rgb;
          if (uContours > 0.5) {
            col = mix(col, col * 0.6, iso * 0.5);
            vec3 hiCol = mix(vec3(1.0), vec3(1.0, 0.86, 0.55), uHiGlow);
            col = mix(col, hiCol, hi * (0.9 + 0.1 * uHiGlow));
          }
          col = mix(col, vec3(0.30, 0.42, 0.58), wake * 0.55 * exp(-depth / 95.0));
          col = mix(col, ink, bedLine * 0.6);
          if (uCine > 0.5) {
            float below = waveH(p.xz) - p.y;
            if (isVert) {
              col = mix(col, vec3(0.88, 0.98, 1.0), (1.0 - smoothstep(0.0, 0.0045, below)) * 0.9);   /* foam line on the glass */
              col += vec3(0.20, 0.42, 0.48) * exp(-below * 55.0) * 0.30;                            /* sunlit band just below the surface */
            }
            vec2 cuv = isVert ? vec2(p.x + p.z, p.y * 1.7) : p.xz;
            col += vec3(0.55, 0.88, 1.0) * caustic(cuv * 1.25, uTime * 0.55) * exp(-depth / 55.0) * 0.5;
            col *= 0.84 + 0.16 * exp(-depth / 1100.0);
          }
          if (isSurface && uFlow > 0.5) {
            /* flowing water: two-phase flow map advecting value noise with the surface current */
            vec2 vel = (texture(uFlowTex, g2).rg * 2.0 - 1.0) * 1.6;
            float spd = length(vel);
            vec2 uv = vec2(fu * 60.0, fv * 42.0);
            float t1 = fract(uTime * 0.12), t2 = fract(uTime * 0.12 + 0.5), w = abs(t1 * 2.0 - 1.0);
            vec2 o1 = vel * vec2(1.0, -1.0) * t1 * 2.2, o2 = vel * vec2(1.0, -1.0) * t2 * 2.2;
            float n1 = vnoise2((uv - o1) * 1.1) * 0.6 + vnoise2((uv - o1) * 3.2 + 3.1) * 0.4;
            float n2 = vnoise2((uv - o2) * 1.1 + 11.0) * 0.6 + vnoise2((uv - o2) * 3.2 + 5.7) * 0.4;
            float rip = mix(n1, n2, w);
            float streak = mix(vnoise2((uv - o1 * 2.5) * vec2(1.6, 9.0)), vnoise2((uv - o2 * 2.5) * vec2(1.6, 9.0) + 2.0), w);
            col *= 0.93 + 0.13 * rip;
            col += vec3(0.14, 0.15, 0.16) * smoothstep(0.70, 0.92, rip) * (0.3 + spd * 0.7);
            col = mix(col, vec3(0.93, 0.96, 0.98), smoothstep(0.74, 0.96, streak) * smoothstep(0.25, 0.9, spd) * 0.3);
          } else if (isSurface) { float shimmer = 0.5 + 0.5 * sin(p.x * 38.0 + uTime * 0.7) * sin(p.z * 44.0 - uTime * 0.5); col *= 0.985 + 0.03 * shimmer; }
        }
        vec3 lineC = uCine > 0.5 ? vec3(0.95, 0.98, 1.0) : ink;
        col = mix(col, uCine > 0.5 ? vec3(0.96, 0.92, 0.78) : ink, coast * (uCine > 0.5 ? 0.45 : 0.75));
        if (isSurface) { col = mix(col, lineC, grat * (uCine > 0.5 ? 0.07 : 0.2)); col = mix(col, lineC, equator * (uCine > 0.5 ? 0.1 : 0.22)); }
        if (isVert) col = mix(col, lineC, dl * (uCine > 0.5 ? 0.12 : 0.16));
        /* soft occlusion along the concave cut edges */
        float dx = abs(p.x - uCut.x), dy = abs(p.y - uCut.y), dz = abs(p.z - uCut.z);
        float dEdge = min(min(length(vec2(dx, dy)), length(vec2(dy, dz))), length(vec2(dx, dz)));
        float ao = 1.0 - 0.17 * exp(-dEdge * 9.0);
        float rim = 1.0 - 0.08 * exp(-min(min(uHalf.x - abs(p.x), uHalf.y - abs(p.z)), min(-p.y, uH + p.y)) * 10.0);
        float shade = 0.84 + 0.16 * max(dot(n, normalize(vec3(0.45, 1.0, 0.7))), 0.0);
        gl_FragColor = vec4(col * shade * ao * rim, 1.0);
      }`
  });

  const planeGeo = new THREE.PlaneGeometry(1, 1);
  faces = {};
  ['top', 'bottom', 'east', 'west', 'south', 'north', 'kx', 'kz', 'ky'].forEach((n) => { const m = new THREE.Mesh(planeGeo, faceMat); faces[n] = m; scene.add(m); });
  faceList = Object.values(faces);
  edgeGeo = new THREE.BufferGeometry();
  edges = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: 0x1C2A35, transparent: true, opacity: 0.55 }));
  scene.add(edges);
  const shadowCanvas = document.createElement('canvas'); shadowCanvas.width = shadowCanvas.height = 256;
  { const g = shadowCanvas.getContext('2d'); const gr = g.createRadialGradient(128, 128, 30, 128, 128, 128);
    gr.addColorStop(0, 'rgba(28,42,53,0.30)'); gr.addColorStop(0.55, 'rgba(28,42,53,0.12)'); gr.addColorStop(1, 'rgba(28,42,53,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256); }
  shadow = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.55, DZ * 1.7), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; scene.add(shadow);

  buildFloats(); buildParticles(); buildLabels(); bindCamera(); bindPicking(); buildProfile(); buildSheets(); buildProbe();
  cut = computeCut(); rebuildDepthLabels(); Scene.setVar('T'); onViewChange(); resize();
  window.addEventListener('resize', resize);
  cam.r = fitRadius(); applyCamera(); syncGoal();
  if (OS.FX) OS.FX.build();
  Scene.ready = true;
  requestAnimationFrame(frame);
}

Scene.internals = () => ({ faces, edges, shadow, cut, particles, knife, stage, canvas });
/* ---------------- Knife ---------------- */
function computeCut() {
  const empty = knife.lon >= LON1 - 0.01 || knife.lat <= LAT0 + 0.01 || knife.depth <= 1;
  const allX = knife.lon <= LON0 + 0.01, allZ = knife.lat >= LAT1 - 0.01, allY = knife.depth >= DMAX - 1;
  const cx = lonToX(knife.lon), cz = latToZ(knife.lat), cy = depthToY(knife.depth);
  const tx = empty ? 1e3 : (allX ? -1e3 : cx + 1e-4), ty = empty ? 1e3 : (allY ? -1e3 : cy + 1e-4), tz = empty ? 1e3 : (allZ ? -1e3 : cz + 1e-4);
  return { empty, allX, allY, allZ, cx, cy, cz, tx, ty, tz };
}
const inRemoved = (x, y, z) => x > cut.tx && y > cut.ty && z > cut.tz;
function placeFaces() {
  const H = view.H, f = faces;
  f.top.rotation.set(-Math.PI / 2, 0, 0); f.top.scale.set(W, DZ, 1); f.top.position.set(0, 0, 0);
  f.bottom.rotation.set(Math.PI / 2, 0, 0); f.bottom.scale.set(W, DZ, 1); f.bottom.position.set(0, -H, 0);
  f.east.rotation.set(0, Math.PI / 2, 0); f.east.scale.set(DZ, H, 1); f.east.position.set(HX, -H / 2, 0);
  f.west.rotation.set(0, -Math.PI / 2, 0); f.west.scale.set(DZ, H, 1); f.west.position.set(-HX, -H / 2, 0);
  f.south.rotation.set(0, 0, 0); f.south.scale.set(W, H, 1); f.south.position.set(0, -H / 2, HZ);
  f.north.rotation.set(0, Math.PI, 0); f.north.scale.set(W, H, 1); f.north.position.set(0, -H / 2, -HZ);
  const c = cut, lx = HX - c.cx, lz = HZ - c.cz, ly = -c.cy;
  f.kx.visible = !c.empty && !c.allX && lz > 1e-4 && ly > 1e-4;
  f.kx.rotation.set(0, Math.PI / 2, 0); f.kx.scale.set(Math.max(lz, 1e-4), Math.max(ly, 1e-4), 1); f.kx.position.set(c.cx, c.cy / 2, (c.cz + HZ) / 2);
  f.kz.visible = !c.empty && !c.allZ && lx > 1e-4 && ly > 1e-4;
  f.kz.rotation.set(0, 0, 0); f.kz.scale.set(Math.max(lx, 1e-4), Math.max(ly, 1e-4), 1); f.kz.position.set((c.cx + HX) / 2, c.cy / 2, c.cz);
  f.ky.visible = !c.empty && !c.allY && lx > 1e-4 && lz > 1e-4;
  f.ky.rotation.set(-Math.PI / 2, 0, 0); f.ky.scale.set(Math.max(lx, 1e-4), Math.max(lz, 1e-4), 1); f.ky.position.set((c.cx + HX) / 2, c.cy, (c.cz + HZ) / 2);
  shadow.position.y = -H - 0.01;
  uniforms.uCut.value.set(c.tx, c.ty, c.tz); uniforms.uH.value = view.H; uniforms.uGamma.value = view.gamma;
}
function buildEdges() {
  const H = view.H, c = cut, pts = [];
  const seg = (a, b) => { pts.push(a[0], a[1], a[2], b[0], b[1], b[2]); };
  function clipped(a, b, axis) {
    if (c.empty) { seg(a, b); return; }
    const thr = [c.tx, c.ty, c.tz], others = [0, 1, 2].filter((q) => q !== axis);
    if (!others.every((q) => a[q] >= thr[q] - 1e-6)) { seg(a, b); return; }
    const lo = Math.min(a[axis], b[axis]), hi = Math.max(a[axis], b[axis]), t = thr[axis];
    if (t <= lo) return;
    const end = Math.min(hi, t), p = a.slice(), q2 = a.slice(); p[axis] = lo; q2[axis] = end; seg(p, q2);
  }
  const X = [-HX, HX], Y = [-H, 0], Z = [-HZ, HZ];
  for (const y of Y) for (const z of Z) clipped([-HX, y, z], [HX, y, z], 0);
  for (const x of X) for (const z of Z) clipped([x, -H, z], [x, 0, z], 1);
  for (const x of X) for (const y of Y) clipped([x, y, -HZ], [x, y, HZ], 2);
  if (!c.empty) {
    const cx = c.cx, cy = c.cy, cz = c.cz, rect = (p0, p1, p2, p3) => { seg(p0, p1); seg(p1, p2); seg(p2, p3); seg(p3, p0); };
    if (faces.kx.visible) rect([cx, cy, cz], [cx, 0, cz], [cx, 0, HZ], [cx, cy, HZ]);
    if (faces.kz.visible) rect([cx, cy, cz], [cx, 0, cz], [HX, 0, cz], [HX, cy, cz]);
    if (faces.ky.visible) rect([cx, cy, cz], [HX, cy, cz], [HX, cy, HZ], [cx, cy, HZ]);
  }
  edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); edgeGeo.computeBoundingSphere();
}
Scene.knife = knife;
Scene.applyKnife = function () { cut = computeCut(); placeFaces(); buildEdges(); OS.Store.set({ cutPlanes: { lon: knife.lon, lat: knife.lat, depth: knife.depth }, depth: knife.depth }); };
const depthFromSlider = (v) => DMAX * Math.pow(v / 1000, 2), sliderFromDepth = (d) => Math.sqrt(d / DMAX) * 1000;
Scene.depthFromSlider = depthFromSlider; Scene.sliderFromDepth = sliderFromDepth;
Scene.roundDepth = (d) => d < 200 ? Math.round(d / 5) * 5 : d < 1000 ? Math.round(d / 10) * 10 : Math.round(d / 50) * 50;
let knifeAnim = null;
Scene.stopKnife = () => { if (knifeAnim) { knifeAnim.cancel(); knifeAnim = null; Scene.onKnifeAnimEnd && Scene.onKnifeAnimEnd(); } };
Scene.animateKnife = function (to, ms, onDone) {
  Scene.stopKnife();
  const from = [knife.lon, knife.lat, sliderFromDepth(knife.depth)], goal = [to[0], to[1], sliderFromDepth(to[2])];
  knifeAnim = U.tween(ms, (e) => { knife.lon = lerp(from[0], goal[0], e); knife.lat = lerp(from[1], goal[1], e); knife.depth = depthFromSlider(lerp(from[2], goal[2], e)); Scene.applyKnife(); },
    () => { knifeAnim = null; Scene.onKnifeAnimEnd && Scene.onKnifeAnimEnd(); if (onDone) onDone(); });
};
Scene.knifeAnimating = () => !!knifeAnim;
Scene.setKnife = (lon, lat, depth) => { Scene.stopKnife(); knife.lon = lon; knife.lat = lat; knife.depth = depth; Scene.applyKnife(); };

/* ---------------- Sampling ---------------- */
function sampleGrid2(arr, fu, fv, nx, ny) {
  const gx = clamp(fu, 0, 1) * (nx - 1), gy = clamp(fv, 0, 1) * (ny - 1);
  const i = Math.min(nx - 2, Math.floor(gx)), j = Math.min(ny - 2, Math.floor(gy)), fx = gx - i, fy = gy - j;
  const a = arr[j * nx + i], b = arr[j * nx + i + 1], c2 = arr[(j + 1) * nx + i], d = arr[(j + 1) * nx + i + 1];
  return (a + (b - a) * fx) + ((c2 + (d - c2) * fx) - (a + (b - a) * fx)) * fy;
}
function sampleVol(key, fu, fv, s) {
  const vol = O.vol[key], r = VARS[key].q;
  const gx = clamp(fu, 0, 1) * (NX - 1), gy = clamp(fv, 0, 1) * (NY - 1), gz = clamp(s, 0, 1) * (NZ - 1);
  const i = Math.min(NX - 2, Math.floor(gx)), j = Math.min(NY - 2, Math.floor(gy)), k = Math.min(NZ - 2, Math.floor(gz));
  const fx = gx - i, fy = gy - j, fz = gz - k, at = (ii, jj, kk) => vol[kk * N2 + jj * NX + ii];
  const c00 = lerp(at(i, j, k), at(i + 1, j, k), fx), c10 = lerp(at(i, j + 1, k), at(i + 1, j + 1, k), fx);
  const c01 = lerp(at(i, j, k + 1), at(i + 1, j, k + 1), fx), c11 = lerp(at(i, j + 1, k + 1), at(i + 1, j + 1, k + 1), fx);
  return r[0] + (r[1] - r[0]) * lerp(lerp(c00, c10, fy), lerp(c01, c11, fy), fz);
}
const fuOf = (lon) => (lon - LON0) / (LON1 - LON0), fvOf = (lat) => (LAT1 - lat) / (LAT1 - LAT0);
function surfaceVel(lon, lat, d) {
  const fu = fuOf(lon), fv = fvOf(lat), dec = Math.exp(-(d || 0) / sampleGrid2(O.hu, fu, fv, NX, NY));
  return [sampleGrid2(O.cu, fu, fv, NX, NY) * dec, sampleGrid2(O.cv, fu, fv, NX, NY) * dec];
}
const landAt = (lon, lat) => sampleGrid2(O.landHi, fuOf(lon), fvOf(lat), LX, LY) > 127;
const seafloorAt = (lon, lat) => sampleGrid2(O.bathy, fuOf(lon), fvOf(lat), NX, NY);
Scene.sampleVol = sampleVol; Scene.surfaceVel = surfaceVel; Scene.landAt = landAt; Scene.seafloorAt = seafloorAt; Scene.sampleGrid2 = sampleGrid2;
Scene.valueAt = (key, lon, lat, d) => sampleVol(key, fuOf(lon), fvOf(lat), Math.sqrt(clamp(d, 0, DMAX) / DMAX));
/* Full T/S profile at a point using the procedural functions (for sonar) */
Scene.profileAt = (lon, lat, depths) => {
  const fu = fuOf(lon), fv = fvOf(lat), g = (a) => sampleGrid2(a, fu, fv, NX, NY);
  const sst = g(O.sst), mld = g(O.mld), d20 = g(O.d20), eddy = g(O.eddy), sss = g(O.sss), hs = g(O.hs), rsw = g(O.rsw), pgw = g(O.pgw);
  return { T: depths.map((d) => tempFn(sst, mld, d20, eddy, d)), S: depths.map((d) => salFn(sss, hs, rsw, pgw, d)), mld, sst, sss };
};

/* ---------------- Floats ---------------- */
const FLOAT_DEPTHS = []; { const NS = 44; for (let i = 0; i < NS; i++) { const s = i / (NS - 1) * Math.SQRT1_2; FLOAT_DEPTHS.push(DMAX * s * s); } }
const floats = [], floatGroup = new THREE.Group(), hitTargets = [];
let ring;
Scene.floats = floats; Scene.FLOAT_DEPTHS = FLOAT_DEPTHS; Scene.floatGroup = floatGroup;
function buildFloats() {
  scene.add(floatGroup);
  const rand = Oc.mulberry32(26067);
  let tries = 0;
  while (floats.length < 34 && tries++ < 6000) {
    const lon = LON0 + 1 + rand() * (LON1 - LON0 - 2), lat = LAT0 + 1 + rand() * (LAT1 - LAT0 - 2);
    const i = Math.round((lon - LON0) / 0.5), j = Math.round((LAT1 - lat) / 0.5), k = j * NX + i;
    if (O.landLo[k] || O.bathy[k] < 2300 || O.dc[k] < 1.2) continue;
    if (floats.some((f) => Math.hypot(f.lon - lon, f.lat - lat) < 3.6)) continue;
    const inBay = lon > 80 && lat > 6;
    /* bias floats so the disagreement field and per-float error agree */
    const dis = O.dis[k];
    const bD = (rand() - 0.5) * 30 * (0.6 + dis) + (inBay ? 12 : 0), bT = (rand() - 0.5) * 0.35 * (0.6 + dis) + (inBay ? 0.3 : 0) + 0.25 * dis, bM = (rand() - 0.5) * 12;
    const bS = (rand() - 0.5) * 0.12 - (inBay ? 0.35 : 0);
    const model = { T: [], S: [] }, obs = { T: [], S: [] };
    for (const d of FLOAT_DEPTHS) {
      model.T.push(tempFn(O.sst[k], O.mld[k], O.d20[k], O.eddy[k], d));
      model.S.push(salFn(O.sss[k], O.hs[k], O.rsw[k], O.pgw[k], d));
      obs.T.push(tempFn(O.sst[k] + bT, clamp(O.mld[k] + bM, 10, 120), Math.max(O.d20[k] + bD, O.mld[k] + 20), O.eddy[k], d) + (rand() - 0.5) * 0.16);
      obs.S.push(salFn(O.sss[k] + bS, O.hs[k], O.rsw[k], O.pgw[k], d) + (rand() - 0.5) * 0.02);
    }
    let sum = 0, worst = 0, worstD = 0;
    FLOAT_DEPTHS.forEach((d, q) => { const e = Math.abs(obs.T[q] - model.T[q]); sum += e; if (e > worst) { worst = e; worstD = d; } });
    const day = 1 + Math.floor(rand() * 10);
    floats.push({ lon, lat, k, id: 2902100 + floats.length * 37 + Math.floor(rand() * 9), cycle: 40 + Math.floor(rand() * 180), day, model, obs, errT: sum / FLOAT_DEPTHS.length, worstT: worst, worstD });
  }
  const headMat = new THREE.MeshBasicMaterial({ color: 0xE0A21B }), inkMat = new THREE.MeshBasicMaterial({ color: 0x1C2A35 });
  const ribbonMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }), hitMat = new THREE.MeshBasicMaterial({ visible: false });
  ring = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.006, 8, 40), inkMat); ring.rotation.x = Math.PI / 2; ring.visible = false; scene.add(ring);
  floats.forEach((f, idx) => {
    const g = new THREE.Group(); g.position.set(lonToX(f.lon), 0, latToZ(f.lat));
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.07, 14), headMat); body.position.y = 0.035; g.add(body);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.012, 14), inkMat); cap.position.y = 0.076; g.add(cap);
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.07, 6), inkMat); ant.position.y = 0.115; g.add(ant);
    const hit = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), hitMat); hit.position.y = 0.05; hit.userData.floatIndex = idx; g.add(hit); hitTargets.push(hit);
    const NS = FLOAT_DEPTHS.length, pos = new Float32Array(NS * 4 * 3), col = new Float32Array(NS * 4 * 3), index = [];
    for (let i = 0; i < NS - 1; i++) for (let q = 0; q < 2; q++) { const a0 = i * 4 + q * 2, a1 = a0 + 1, b0 = a0 + 4, b1 = a1 + 4; index.push(a0, b0, a1, a1, b0, b1); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.setIndex(index);
    const rib = new THREE.Mesh(geo, ribbonMat); g.add(rib); f.group = g; f.ribbon = rib; f.body = body; floatGroup.add(g);
  });
}
function layoutFloats() {
  const w = 0.012;
  floats.forEach((f) => {
    const pos = f.ribbon.geometry.attributes.position.array;
    FLOAT_DEPTHS.forEach((d, i) => { const y = depthToY(d), o = i * 12; pos.set([-w, y, 0, w, y, 0, 0, y, -w, 0, y, w], o); });
    f.ribbon.geometry.attributes.position.needsUpdate = true; f.ribbon.geometry.computeBoundingSphere();
  });
}
function colorFloats() {
  const key = state.var === 'S' ? 'S' : (state.var === 'V' ? null : 'T');
  floats.forEach((f) => {
    const colA = f.ribbon.geometry.attributes.color.array;
    FLOAT_DEPTHS.forEach((d, i) => {
      let c = [0.11, 0.165, 0.21];
      if (state.var === 'D') { const e = Math.abs(f.obs.T[i] - f.model.T[i]); c = cmapAt('D', (e - state.range[0]) / (state.range[1] - state.range[0])); }
      else if (key) { const v = f.obs[key][i]; c = cmapAt(key, (v - state.range[0]) / (state.range[1] - state.range[0])); }
      for (let q = 0; q < 4; q++) colA.set(c, (i * 4 + q) * 3);
    });
    f.ribbon.geometry.attributes.color.needsUpdate = true;
  });
}
Scene.nearestFloat = (lon, lat) => { let best = -1, bd = 1e9; floats.forEach((f, i) => { const d = Math.hypot(f.lon - lon, f.lat - lat); if (d < bd) { bd = d; best = i; } }); return best; };

/* ---------------- Particles ---------------- */
const NP = 800, P = { lon: new Float32Array(NP), lat: new Float32Array(NP), age: new Float32Array(NP), life: new Float32Array(NP) };
const pPos = new Float32Array(NP * 6), pCol = new Float32Array(NP * 6);
let particles, pGeo;
function buildParticles() {
  for (let i = 0; i < NP; i++) pCol.set([0.08, 0.12, 0.16, 0.80, 0.83, 0.82], i * 6);
  pGeo = new THREE.BufferGeometry(); pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3)); pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  particles = new THREE.LineSegments(pGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false }));
  particles.frustumCulled = false; scene.add(particles); Scene.particles = particles;
  for (let i = 0; i < NP; i++) { respawn(i); P.age[i] = Math.random() * P.life[i]; }
}
function respawn(i) {
  for (let t = 0; t < 30; t++) { const lon = LON0 + Math.random() * (LON1 - LON0), lat = LAT0 + Math.random() * (LAT1 - LAT0); if (!landAt(lon, lat)) { P.lon[i] = lon; P.lat[i] = lat; break; } }
  P.age[i] = 0; P.life[i] = 2 + Math.random() * 4;
}
function stepParticles(dt) {
  const K = 2.0, TL = 2.6;
  for (let i = 0; i < NP; i++) {
    P.age[i] += dt;
    let lon = P.lon[i], lat = P.lat[i];
    const x = lonToX(lon), z = latToZ(lat);
    let d = 0, hidden = false;
    if (!cut.empty && x > cut.tx && z > cut.tz) { d = knife.depth; if (d >= DMAX - 1 || seafloorAt(lon, lat) <= d) hidden = true; }
    const v = surfaceVel(lon, lat, d), sp = Math.hypot(v[0], v[1]);
    lon += v[0] * K * dt; lat += v[1] * K * dt;
    if (P.age[i] > P.life[i] || lon < LON0 || lon > LON1 || lat < LAT0 || lat > LAT1 || landAt(lon, lat)) { respawn(i); hidden = true; }
    else { P.lon[i] = lon; P.lat[i] = lat; }
    const o = i * 6;
    if (hidden || sp < 0.08) { pPos[o] = pPos[o + 3] = 0; pPos[o + 1] = pPos[o + 4] = 50; pPos[o + 2] = pPos[o + 5] = 0; continue; }
    const y = depthToY(d) + 0.004 + (d < 1 && OS.FX ? OS.FX.waveAt(x, z) : 0);
    pPos[o] = lonToX(P.lon[i]); pPos[o + 1] = y; pPos[o + 2] = latToZ(P.lat[i]);
    pPos[o + 3] = lonToX(P.lon[i] - v[0] * TL); pPos[o + 4] = y; pPos[o + 5] = latToZ(P.lat[i] - v[1] * TL);
  }
  pGeo.attributes.position.needsUpdate = true;
}

/* ---------------- Labels + HUD ---------------- */
const labels = []; let labelsEl, hudEl, depthLabelSet = [];
const huds = new Map();
function addLabel(text, cls, getPos, surfaceLL) {
  const e = document.createElement('div'); e.className = 'lab' + (cls ? ' ' + cls : ''); e.textContent = text; labelsEl.appendChild(e);
  labels.push({ el: e, getPos, surfaceLL, align: cls === 'lab-left' ? 'left' : 'center' });
}
function buildLabels() {
  labelsEl = $('labels'); hudEl = $('hud');
  [50, 60, 70, 80, 90].forEach((lon) => addLabel(fmtLon(lon), '', () => new THREE.Vector3(lonToX(lon), -view.H - 0.02, HZ + 0.12)));
  [-10, 0, 10, 20].forEach((lat) => addLabel(fmtLat(lat), '', () => new THREE.Vector3(HX + 0.22, -view.H - 0.02, latToZ(lat))));
  addLabel('Arabian Sea', 'geo', () => new THREE.Vector3(lonToX(64), 0.02, latToZ(14.5)), [64, 14.5]);
  addLabel('Bay of Bengal', 'geo', () => new THREE.Vector3(lonToX(88.5), 0.02, latToZ(14.5)), [88.5, 14.5]);
  addLabel('India', 'geo', () => new THREE.Vector3(lonToX(78), 0.02, latToZ(19.5)), [78, 19.5]);
}
function rebuildDepthLabels() {
  depthLabelSet.forEach((l) => { l.el.remove(); labels.splice(labels.indexOf(l), 1); });
  const ds = view.gamma < 1 ? [0, 100, 250, 500, 1000, 2000, 4000] : [0, 1000, 2000, 3000, 4000], start = labels.length;
  ds.forEach((d) => addLabel(fmtDepth(d), 'lab-left', () => new THREE.Vector3(-HX - 0.05, depthToY(d), HZ)));
  depthLabelSet = labels.slice(start);
}
const tmpV = new THREE.Vector3();
function updateLabels(wpx, hpx) {
  const placed = [];
  for (const L of labels) {
    const p = L.getPos(); let hide = false;
    if (L.surfaceLL && inRemoved(lonToX(L.surfaceLL[0]), 0.001, latToZ(L.surfaceLL[1]))) hide = true;
    tmpV.copy(p).project(camera);
    if (tmpV.z > 1 || hide) { L.el.style.display = 'none'; continue; }
    const sx = (tmpV.x * 0.5 + 0.5) * wpx, sy = (-tmpV.y * 0.5 + 0.5) * hpx;
    /* skip axis labels that would collide with an already placed one */
    if (L.align === 'left' && placed.some((q) => Math.abs(q[0] - sx) < 40 && Math.abs(q[1] - sy) < 13)) { L.el.style.display = 'none'; continue; }
    placed.push([sx, sy]);
    L.el.style.display = '';
    L.el.style.transform = L.align === 'left' ? `translate(${sx}px, ${sy}px) translate(-100%, -50%)` : `translate(${sx}px, ${sy}px) translate(-50%, -50%)`;
  }
  huds.forEach((h) => {
    if (!h.visible) { h.el.style.display = 'none'; return; }
    tmpV.copy(h.getPos()).project(camera);
    if (tmpV.z > 1) { h.el.style.display = 'none'; return; }
    h.el.style.display = '';
    h.el.style.transform = `translate(${(tmpV.x * 0.5 + 0.5) * wpx}px, ${(-tmpV.y * 0.5 + 0.5) * hpx - (h.dy || 10)}px) translate(-50%, -100%)`;
  });
}
/* HUD: DOM label pinned to a 3D point. */
Scene.hud = (id, html, getPos, cls, dy) => {
  let h = huds.get(id);
  if (!h) { h = { el: document.createElement('div'), visible: true }; hudEl.appendChild(h.el); huds.set(id, h); }
  h.el.className = 'hud ' + (cls || ''); h.el.innerHTML = html; h.getPos = getPos; h.dy = dy; h.visible = true;
  return h;
};
Scene.hudHide = (id) => { const h = huds.get(id); if (h) h.visible = false; };
Scene.hudRemove = (id) => { const h = huds.get(id); if (h) { h.el.remove(); huds.delete(id); } };

/* ---------------- Camera ---------------- */
const cam = { r: 11.2, theta: 0.72, phi: 0.98, target: new THREE.Vector3(0.15, -0.75, 0.2) };
const goal = { r: 11.2, theta: 0.72, phi: 0.98, target: new THREE.Vector3(0.15, -0.75, 0.2) };
Scene.cam = cam; Scene.goal = goal;
function syncGoal() { goal.r = cam.r; goal.theta = cam.theta; goal.phi = cam.phi; goal.target.copy(cam.target); }
Scene.syncGoal = syncGoal;
function applyCamera() {
  cam.phi = clamp(cam.phi, 0.12, 1.5); cam.r = clamp(cam.r, 0.45, 28);
  const sp = Math.sin(cam.phi);
  camera.position.set(cam.target.x + cam.r * sp * Math.sin(cam.theta), cam.target.y + cam.r * Math.cos(cam.phi), cam.target.z + cam.r * sp * Math.cos(cam.theta));
  camera.lookAt(cam.target);
}
Scene.applyCamera = applyCamera;
const fitRadius = () => 11.2 * Math.max(1, 1.35 / Math.max(camera.aspect, 0.3));
Scene.fitRadius = fitRadius;
let camAnim = null, idleDrift = true;
Scene.flyTo = function (spec, ms, onDone) {
  if (camAnim) camAnim.cancel();
  const from = { r: cam.r, theta: cam.theta, phi: cam.phi, t: cam.target.clone() };
  const to = { r: spec.r === undefined ? cam.r : spec.r, theta: spec.theta === undefined ? cam.theta : spec.theta, phi: spec.phi === undefined ? cam.phi : spec.phi, t: spec.target ? new THREE.Vector3(...spec.target) : cam.target.clone() };
  /* shortest angular path */
  let dth = to.theta - from.theta; dth = Math.atan2(Math.sin(dth), Math.cos(dth)); to.theta = from.theta + dth;
  const arc = spec.arc || 0, fov0 = camera.fov, fov1 = spec.fov === undefined ? camera.fov : spec.fov;
  camAnim = U.tween(ms || 1200, (e, t) => {
    const lift = Math.sin(Math.PI * e) * arc;
    cam.r = lerp(from.r, to.r, e) * (1 + lift); cam.theta = lerp(from.theta, to.theta, e); cam.phi = lerp(from.phi, to.phi, e) - lift * 0.35;
    cam.target.lerpVectors(from.t, to.t, e);
    if (fov1 !== fov0) { camera.fov = lerp(fov0, fov1, e); camera.updateProjectionMatrix(); }
    applyCamera(); syncGoal();
  }, () => { camAnim = null; if (onDone) onDone(); }, spec.ease);
  camAnim.userCancellable = spec.lock ? false : true;
};
Scene.camBusy = () => !!camAnim;
Scene.stopCamera = () => { if (camAnim) { camAnim.cancel(); camAnim = null; syncGoal(); } };
Scene.resetCamera = (ms) => Scene.flyTo({ r: fitRadius(), theta: 0.72, phi: 0.98, target: [0.15, -view.H * 0.47, 0.2] }, ms || 1000);
Scene.flyToLL = (lon, lat, r, ms, onDone) => Scene.flyTo({ r: r || 5, phi: 0.95, target: [lonToX(lon), -view.H * 0.25, latToZ(lat)] }, ms || 1300, onDone);
Scene.establish = () => {
  cam.r = fitRadius() * 1.6; cam.theta = 0.72 - 0.9; cam.phi = 0.55; cam.target.set(0.15, -view.H * 0.47, 0.2); applyCamera(); syncGoal();
  Scene.flyTo({ r: fitRadius(), theta: 0.72, phi: 0.98 }, 3600, null);
};
const pointers = new Map();
let dragMode = null, downAt = null, moved = false, pinchDist = 0, hoverPos = null;
function bindCamera() {
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    downAt = { x: e.clientX, y: e.clientY }; moved = false; dragMode = (e.button === 2 || e.shiftKey) ? 'pan' : 'rotate';
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinchDist = Math.hypot(a.x - b.x, a.y - b.y); }
    canvas.style.cursor = 'grabbing'; hideTip();
  });
  canvas.addEventListener('pointermove', (e) => {
    const rect = canvas.getBoundingClientRect();
    if (!pointers.has(e.pointerId)) { hoverPos = { x: e.clientX - rect.left, y: e.clientY - rect.top }; return; }
    const prev = pointers.get(e.pointerId), dx = e.clientX - prev.x, dy = e.clientY - prev.y;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4) { moved = true; interacted(); }
    if (Scene.lockInput) return;
    if (pointers.size === 2) { const [a, b] = [...pointers.values()], dist = Math.hypot(a.x - b.x, a.y - b.y); if (pinchDist > 0) goal.r = clamp(goal.r * pinchDist / dist, 0.45, 28); pinchDist = dist; }
    else if (dragMode === 'rotate') { goal.theta -= dx * 0.0062; goal.phi = clamp(goal.phi - dy * 0.0062, 0.12, 1.5); }
    else { const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0), up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1); const k = goal.r * 0.0014; goal.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k); }
  });
  const endPointer = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId); if (pointers.size < 2) pinchDist = 0;
    if (pointers.size === 0) { canvas.style.cursor = ''; if (!moved && e.type === 'pointerup') { const rect = canvas.getBoundingClientRect(); pick(e.clientX - rect.left, e.clientY - rect.top); } }
  };
  canvas.addEventListener('pointerup', endPointer); canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', () => { hoverPos = null; hideTip(); if (OS.FX) OS.FX.hover(null); });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); if (Scene.lockInput) return; interacted(); goal.r = clamp(goal.r * Math.exp(clamp(e.deltaY, -120, 120) * 0.0016), 0.45, 28); }, { passive: false });
}
function interacted() { if (!userInteracted) { userInteracted = true; $('hint').classList.add('fade'); } idleDrift = false; if (camAnim && camAnim.userCancellable !== false) { camAnim.cancel(); camAnim = null; syncGoal(); } }
Scene.setIdle = (on) => { idleDrift = on; };

/* ---------------- Picking ---------------- */
const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
let tip;
function hideTip() { tip.style.display = 'none'; }
const isOnKnife = (o) => o === faces.kx || o === faces.ky || o === faces.kz;
function castAt(px, py) {
  ndc.set(px / canvas.clientWidth * 2 - 1, -(py / canvas.clientHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  let floatHit = null;
  if (floatGroup.visible && clickMode === 'float') { const fh = raycaster.intersectObjects(hitTargets, false); if (fh.length) floatHit = fh[0]; }
  let layerHit = null;
  if (Scene.pickables && Scene.pickables.length) { const lh = raycaster.intersectObjects(Scene.pickables, true); if (lh.length) layerHit = lh[0]; }
  const hits = raycaster.intersectObjects(faceList.filter((m) => m.visible), false);
  let faceHit = null;
  for (const h of hits) { if (isOnKnife(h.object) || !inRemoved(h.point.x, h.point.y, h.point.z)) { faceHit = h; break; } }
  if (layerHit && (!faceHit || layerHit.distance < faceHit.distance + 0.05)) return { type: 'layer', object: layerHit.object, point: layerHit.point };
  if (floatHit && (!faceHit || floatHit.distance < faceHit.distance + 0.05)) return { type: 'float', index: floatHit.object.userData.floatIndex };
  if (faceHit) return { type: 'face', point: faceHit.point, object: faceHit.object };
  return null;
}
Scene.pickables = [];
function pick(px, py) {
  if (Scene.lockInput) return;
  const r = castAt(px, py); if (!r) return;
  if (r.type === 'layer') { const o = r.object; let t = o; while (t && !t.userData.onClick) t = t.parent; if (t) t.userData.onClick(r); return; }
  if (r.type === 'float') { Scene.selectFloat(r.index); return; }
  if (r.type === 'face') {
    const p = r.point, lon = xToLon(p.x), lat = zToLat(p.z), depth = yToDepth(p.y);
    if (OS.FX && p.y > -0.002 && !landAt(lon, lat)) OS.FX.ripple(p.x, p.z);
    const info = { lon, lat, depth, land: landAt(lon, lat), seafloor: seafloorAt(lon, lat), mode: clickMode };
    surfaceHandlers.forEach((h) => h(info));
  }
}
function hover(px, py) {
  if (Scene.lockInput) { hideTip(); if (OS.FX) OS.FX.hover(null); return; }
  const r = castAt(px, py);
  if (OS.FX) OS.FX.hover(r && r.type === 'face' && r.point.y > -0.002 && !landAt(xToLon(r.point.x), zToLat(r.point.z)) ? r.point : null);
  if (!r || r.type === 'layer') { hideTip(); if (r) canvas.style.cursor = 'pointer'; else canvas.style.cursor = ''; return; }
  let html;
  if (r.type === 'float') { const f = floats[r.index]; canvas.style.cursor = 'pointer'; html = `<b>Argo float ${f.id}</b>Click to compare it with the model`; }
  else {
    canvas.style.cursor = '';
    const p = r.point, lon = xToLon(p.x), lat = zToLat(p.z), d = yToDepth(p.y);
    const where = U.fmtLL(Math.round(lon * 10) / 10, Math.round(lat * 10) / 10);
    if (landAt(lon, lat)) html = `<b>Land</b>${where}`;
    else if (d > seafloorAt(lon, lat) + 1) html = `<b>Seafloor</b>Ocean is ${fmtDepth(Math.round(seafloorAt(lon, lat) / 10) * 10)} deep here<br>${where}`;
    else {
      const key = state.var, cfg = VARS[key], s = Math.sqrt(d / DMAX);
      let v = sampleVol(key, fuOf(lon), fvOf(lat), s);
      if (key === 'T' && uniforms.uWakeAmt.value > 0) v -= sampleGrid2(wakeData, fuOf(lon), fvOf(lat), NX, NY) / 255 * uniforms.uWakeAmt.value * 5.5 * Math.exp(-d / 95);
      const lead = clickMode === 'pin' ? 'Click to drop the last-known position' : clickMode === 'sonar' ? 'Click to place the sonar here' : (d < 1 ? 'At the surface' : fmtDepth(d < 100 ? Math.round(d) : Math.round(d / 10) * 10) + ' deep');
      html = `<b>${v.toFixed(cfg.dec)} ${cfg.unit}</b>${lead}<br>${where}`;
    }
  }
  tip.innerHTML = html; tip.style.display = 'block';
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  const x = px + 16 + tw > canvas.clientWidth ? px - tw - 12 : px + 16, y = py + 16 + th > canvas.clientHeight ? py - th - 12 : py + 16;
  tip.style.transform = `translate(${x}px, ${y}px)`;
}
function bindPicking() { tip = $('tip'); }
Scene.onSurfaceClick = (fn) => { surfaceHandlers.push(fn); return () => surfaceHandlers.splice(surfaceHandlers.indexOf(fn), 1); };
Scene.setClickMode = (m) => { clickMode = m; stage.classList.toggle('pin-mode', m === 'pin'); stage.classList.toggle('sonar-mode', m === 'sonar'); };

/* ---------------- Profile panel ---------------- */
let selected = -1, profile, pChart;
function buildProfile() {
  profile = $('profile'); pChart = $('p-chart');
  $('p-close').addEventListener('click', () => Scene.deselect());
}
Scene.deselect = () => { selected = -1; profile.hidden = true; ring.visible = false; OS.Store.set({ selectedFloat: -1 }); };
Scene.selectFloat = function (i, quiet) {
  selected = i; const f = floats[i];
  profile.hidden = false;
  $('p-title').textContent = `Argo float ${f.id}`;
  $('p-sub').textContent = `Dive ${f.cycle}, ${f.day} July 2026, ${fmtLat(Math.round(f.lat * 10) / 10)} ${fmtLon(Math.round(f.lon * 10) / 10)}`;
  ring.position.set(lonToX(f.lon), 0.05, latToZ(f.lat)); ring.visible = true;
  drawProfile();
  if (!quiet) OS.Store.set({ selectedFloat: i });
};
Scene.selectedFloat = () => selected;
function niceStep(span) { const raw = span / 4, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p; return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p; }
function drawProfile() {
  if (selected < 0) return;
  const f = floats[selected], key = state.var === 'S' ? 'S' : 'T', cfg = VARS[key];
  const dpr = Math.min(window.devicePixelRatio || 1, 2), cw = pChart.clientWidth, ch = pChart.clientHeight;
  pChart.width = cw * dpr; pChart.height = ch * dpr;
  const g = pChart.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, cw, ch);
  const L = 50, R = 10, T = 8, B = 34, w = cw - L - R, h = ch - T - B, mv = f.model[key], ov = f.obs[key];
  let lo = Math.min(...mv, ...ov), hi = Math.max(...mv, ...ov); const pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
  const X = (v) => L + (v - lo) / (hi - lo) * w, Y = (d) => T + Math.sqrt(d / 2000) * h;
  const PL = U.pal();
  g.font = '500 12px "Barlow Semi Condensed", Arial Narrow, sans-serif'; g.fillStyle = PL.text; g.strokeStyle = PL.grid; g.lineWidth = 1; g.textAlign = 'right'; g.textBaseline = 'middle';
  [0, 50, 100, 200, 500, 1000, 2000].forEach((d) => { const y = Math.round(Y(d)) + 0.5; g.beginPath(); g.moveTo(L, y); g.lineTo(L + w, y); g.stroke(); g.fillText(`${d} m`, L - 6, y); });
  const st = niceStep(hi - lo); g.textAlign = 'center'; g.textBaseline = 'top';
  for (let v = Math.ceil(lo / st) * st; v <= hi; v += st) { const x = Math.round(X(v)) + 0.5; g.beginPath(); g.moveTo(x, T); g.lineTo(x, T + h); g.stroke(); g.fillText(v.toFixed(st < 0.1 ? 2 : st < 1 ? 1 : 0), x, T + h + 5); }
  g.fillText(`${cfg.name} (${cfg.unit})`, L + w / 2, T + h + 19);
  /* shade the gap between model and observation */
  g.fillStyle = 'rgba(196,71,47,0.14)'; g.beginPath();
  FLOAT_DEPTHS.forEach((d, i) => { const x = X(mv[i]), y = Y(d); i ? g.lineTo(x, y) : g.moveTo(x, y); });
  for (let i = FLOAT_DEPTHS.length - 1; i >= 0; i--) g.lineTo(X(ov[i]), Y(FLOAT_DEPTHS[i]));
  g.closePath(); g.fill();
  g.strokeStyle = PL.ink; g.lineWidth = 2; g.beginPath();
  FLOAT_DEPTHS.forEach((d, i) => { const x = X(mv[i]), y = Y(d); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
  g.fillStyle = '#E0A21B'; g.strokeStyle = PL.ink; g.lineWidth = 0.8;
  FLOAT_DEPTHS.forEach((d, i) => { g.beginPath(); g.arc(X(ov[i]), Y(d), 3, 0, Math.PI * 2); g.fill(); g.stroke(); });
  let sum = 0, worst = 0, worstD = 0;
  FLOAT_DEPTHS.forEach((d, i) => { const e = Math.abs(ov[i] - mv[i]); sum += e; if (e > worst) { worst = e; worstD = d; } });
  const avg = sum / FLOAT_DEPTHS.length;
  $('p-stat').textContent = `${state.var === 'V' ? 'Floats measure temperature and salinity, so this shows temperature. ' : ''}The model is off by ${avg.toFixed(cfg.dec)} ${cfg.unit} on average, most at ${fmtDepth(Math.round(worstD / 5) * 5)} (${worst.toFixed(cfg.dec)} ${cfg.unit}).`;
}
Scene.drawProfile = drawProfile;

/* ---------------- Variable / range ---------------- */
Scene.state = state;
Scene.setVar = function (key) {
  state.var = key; const cfg = VARS[key];
  uniforms.uVol.value = TEX[key]; uniforms.uCmap.value = CTEX[key];
  uniforms.uQ.value.set(cfg.q[0], cfg.q[1]); uniforms.uStep.value = cfg.step; uniforms.uHi.value = cfg.hi === null ? -999 : cfg.hi;
  Scene.setRange(cfg.range[0], cfg.range[1]);
  OS.Store.set({ variable: key });
};
Scene.setRange = function (a, b) { state.range = [a, b]; uniforms.uRange.value.set(a, b); colorFloats(); drawProfile(); Scene.onRange && Scene.onRange(a, b); };
Scene.setView = (H, gamma) => { if (H !== undefined) view.H = H; if (gamma !== undefined) { view.gamma = gamma; rebuildDepthLabels(); } onViewChange(); };
function onViewChange() { Scene.applyKnife(); layoutFloats(); layoutSheets(); }
Scene.showFloats = (on) => { floatGroup.visible = on; if (!on) Scene.deselect(); };
Scene.showFlow = (on) => { particles.visible = on; };
Scene.showContours = (on) => { uniforms.uContours.value = on ? 1 : 0; };


/* ---------------- Cut-revealed layer sheets ---------------- */
const sheets = {};
let sheetMat;
function buildSheets() {
  const vert = `attribute float mask; varying vec3 vW; varying float vM;
    void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vM = mask; gl_Position = projectionMatrix * viewMatrix * w; }`;
  const frag = `precision highp float; uniform vec3 uCut; uniform vec3 uColor; uniform float uOpacity; uniform float uH; uniform float uGamma; uniform float uIso; uniform float uSolid;
    varying vec3 vW; varying float vM;
    float isoLine(float v, float stepv, float width){ float f = v / stepv; float g = abs(fract(f - 0.5) - 0.5) / max(fwidth(f), 1e-3); return 1.0 - smoothstep(0.0, width, g); }
    void main(){
      if (vM < 0.5) discard;
      if (!(vW.x > uCut.x && vW.y > uCut.y && vW.z > uCut.z)) discard;
      float t = clamp(-vW.y / uH, 0.0, 1.0); float s = pow(t, 0.5 / uGamma); float depth = 4000.0 * s * s;
      vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
      float shade = 0.72 + 0.28 * abs(dot(n, normalize(vec3(0.45, 1.0, 0.7))));
      vec3 col = uColor * shade;
      float iso = isoLine(depth, uIso, 1.0);
      col = mix(col, col * 0.55, iso * 0.6);
      float a = uOpacity + 0.25 * iso;
      if (uSolid > 0.5) { vec2 cell = floor(vec2((vW.x + vW.z) * 90.0, (vW.x - vW.z) * 90.0)); float h = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453); col *= 0.92 + 0.1 * h; a = 1.0; }
      gl_FragColor = vec4(col, a);
    }`;
  const mk = (name, color, opacity, iso, solid) => {
    const mat = new THREE.ShaderMaterial({ uniforms: { uCut: uniforms.uCut, uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity }, uH: uniforms.uH, uGamma: uniforms.uGamma, uIso: { value: iso }, uSolid: { value: solid ? 1 : 0 } },
      vertexShader: vert, fragmentShader: frag, transparent: !solid, depthWrite: !!solid, side: THREE.DoubleSide, extensions: { derivatives: true }, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const pos = new Float32Array(N2 * 3), mask = new Float32Array(N2);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('mask', new THREE.BufferAttribute(mask, 1));
    const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.visible = false; m.renderOrder = solid ? 0 : 2; scene.add(m);
    sheets[name] = { mesh: m, field: new Float32Array(N2), mask };
    return sheets[name];
  };
  /* fields per column */
  const d26 = new Float32Array(N2);
  for (let k = 0; k < N2; k++) {
    if (O.landLo[k]) { d26[k] = -1; continue; }
    let found = -1;
    if (O.sst[k] > 26) { for (let d = 0; d <= 500; d += 3) { if (tempFn(O.sst[k], O.mld[k], O.d20[k], O.eddy[k], d) < 26) { found = d; break; } } if (found < 0) found = 500; }
    d26[k] = found;
  }
  O.d26 = d26;
  const setField = (sh, src, minD) => {
    for (let k = 0; k < N2; k++) { const v = src[k]; const ok = !O.landLo[k] && v >= (minD || 0) && v < O.bathy[k]; sh.mask[k] = ok ? 1 : 0; sh.field[k] = ok ? v : 0; }
    /* only keep quads whose four corners are all ocean, so no triangle bridges down to a masked vertex */
    const idx = [];
    for (let j = 0; j < NY - 1; j++) for (let i = 0; i < NX - 1; i++) { const a = j * NX + i, b = a + 1, c = a + NX, d = c + 1; if (sh.mask[a] && sh.mask[b] && sh.mask[c] && sh.mask[d]) idx.push(a, c, b, b, c, d); }
    sh.mesh.geometry.setIndex(idx);
  };
  setField(mk('d26', '#F2A65A', 0.55, 25), d26, 1);
  setField(mk('mld', '#8FCBE8', 0.45, 20), O.mld, 1);
  setField(mk('d20', '#8C6BB1', 0.45, 25), O.d20, 1);
  setField(mk('bathy', '#74716A', 1, 250, true), O.bathy, 1);
  Object.values(sheets).forEach((sh) => { sh.mesh.geometry.attributes.mask.needsUpdate = true; });
  layoutSheets();
}
function layoutSheets() {
  Object.values(sheets).forEach((sh) => {
    const pos = sh.mesh.geometry.attributes.position.array;
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) { const k = j * NX + i, o = k * 3; pos[o] = lonToX(LON0 + i * 0.5); pos[o + 1] = sh.mask[k] ? depthToY(sh.field[k]) : -view.H; pos[o + 2] = latToZ(LAT1 - j * 0.5); }
    sh.mesh.geometry.attributes.position.needsUpdate = true;
  });
}
Scene.showSheet = (name, on) => { if (sheets[name]) sheets[name].mesh.visible = on; };
Scene.sheetVisible = (name) => !!(sheets[name] && sheets[name].mesh.visible);
Scene.showFlowWater = (on) => { uniforms.uFlow.value = on ? 1 : 0; };
Scene.d26At = (lon, lat) => sampleGrid2(O.d26, fuOf(lon), fvOf(lat), NX, NY);

/* ---------------- Probe beam (dive point) ---------------- */
let probe;
function buildProbe() {
  probe = new THREE.Group(); probe.visible = false;
  const beam = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.02, 0), new THREE.Vector3(0, -1, 0)]), new THREE.LineDashedMaterial({ color: 0x1F6FA8, dashSize: 0.03, gapSize: 0.02, transparent: true, opacity: 0.9 }));
  probe.add(beam); probe.userData.beam = beam;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.007, 8, 40), new THREE.MeshBasicMaterial({ color: 0x1F6FA8 })); ring.rotation.x = Math.PI / 2; probe.add(ring); probe.userData.ring = ring;
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.05, 40), new THREE.MeshBasicMaterial({ color: 0x1F6FA8, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false })); disc.rotation.x = -Math.PI / 2; probe.add(disc); probe.userData.disc = disc;
  const top = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.005, 8, 32), new THREE.MeshBasicMaterial({ color: 0x1C2A35 })); top.rotation.x = Math.PI / 2; top.position.y = 0.012; probe.add(top);
  scene.add(probe);
}
Scene.setProbe = (lon, lat, depth) => {
  probe.visible = true; probe.position.set(lonToX(lon), 0, latToZ(lat));
  const floor = seafloorAt(lon, lat), yb = depthToY(Math.min(floor, DMAX));
  const beam = probe.userData.beam; beam.geometry.setFromPoints([new THREE.Vector3(0, 0.02, 0), new THREE.Vector3(0, yb, 0)]); beam.computeLineDistances();
  const y = depthToY(clamp(depth, 0, floor)); probe.userData.ring.position.y = y; probe.userData.disc.position.y = y;
};
Scene.hideProbe = () => { probe.visible = false; };

/* ---------------- Wake texture (Cyclone Lab) ---------------- */
Scene.setWake = (fn) => {
  /* fn(lon, lat) -> 0..1 cooling; null to clear */
  if (!fn) { uniforms.uWakeAmt.value = 0; return; }
  for (let j = 0; j < NY; j++) { const lat = LAT1 - j * 0.5; for (let i = 0; i < NX; i++) { wakeData[j * NX + i] = Math.round(clamp(fn(LON0 + i * 0.5, lat), 0, 1) * 255); } }
  wakeTex.needsUpdate = true; uniforms.uWakeAmt.value = 1;
};
Scene.setWakeAmt = (v) => { uniforms.uWakeAmt.value = v; };
Scene.setHiGlow = (v) => { uniforms.uHiGlow.value = v; };

/* ---------------- Layers ---------------- */
Scene.add = (obj) => layers.add(obj);
Scene.remove = (obj) => layers.remove(obj);
Scene.onFrame = (fn) => { frameCbs.add(fn); return () => frameCbs.delete(fn); };
Scene.screenPos = (v3) => { tmpV.copy(v3).project(camera); return { x: (tmpV.x * 0.5 + 0.5) * stage.clientWidth, y: (-tmpV.y * 0.5 + 0.5) * stage.clientHeight, behind: tmpV.z > 1 }; };
Scene.dim = (on) => stage.classList.toggle('dim', on);

/* ---------------- Loop ---------------- */
function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false); camera.aspect = w / Math.max(h, 1); camera.updateProjectionMatrix(); drawProfile();
  if (OS.FX && OS.FX.resize) OS.FX.resize(w, h);
  Scene.onResize && Scene.onResize();
}
Scene.resize = resize;
let last = performance.now(), t0 = last;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  uniforms.uTime.value = (now - t0) / 1000;
  if (particles.visible && !reduceMotion) stepParticles(dt);
  else if (particles.visible && reduceMotion && !frame.once) { stepParticles(0.001); frame.once = true; }
  if (!camAnim) {
    if (idleDrift && !reduceMotion) goal.theta += dt * 0.025;
    const k = reduceMotion ? 1 : 1 - Math.exp(-dt * 7.5);
    cam.r += (goal.r - cam.r) * k; cam.theta += (goal.theta - cam.theta) * k; cam.phi += (goal.phi - cam.phi) * k; cam.target.lerp(goal.target, k);
    applyCamera();
  }
  if (hoverPos && pointers.size === 0) hover(hoverPos.x, hoverPos.y);
  frameCbs.forEach((fn) => fn(dt, now));
  if (Scene.renderHook) Scene.renderHook(dt); else renderer.render(scene, camera);
  updateLabels(stage.clientWidth, stage.clientHeight);
  requestAnimationFrame(frame);
}

OS.Scene = Scene;
})(window.OS);
