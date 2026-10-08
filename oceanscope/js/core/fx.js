/* Cinematic layer: displaced ocean with foam and glints, sky, abyss floor, marine snow, cut bubbles,
   clouds with shadows, cyclone cloud system, float beacons, bloom + colour grade. */
(function (OS) {
'use strict';
const U = OS.U, { clamp, lerp, smoothstep } = U, Oc = OS.Ocean, G = OS.GLSL;
const { LON0, LON1, LAT0, LAT1, NX, NY, N2, LX, LY, HX, HZ, W: WW, DZ: DD } = Oc;
const FX = { on: false, ready: false };
let S, uniforms, O;
let water, sky, floor, snow, bubbles, cloudGroup, clouds = [], stormMesh, beacons = [], composer = null, bloom = null, grade = null;
let seaData, surfData;
let dataMixTarget = 0, weatherTarget = 1, weather = 0, hoverTarget = 0, stormVis = 0, stormTarget = 0, flash = 0;
const storm = { x: 0, z: 0, inten: 0 };
const waveU = { amp: 0, t: 0, storm: [0, 0, 0.5, 0], ripple: [0, 0, -10, 0] };
const CLR = [[72.2, 14.5], [72.8, 8], [73.3, 2], [72.4, -5], [71.8, -8]];
const SUN = new THREE.Vector3(-0.62, 0.22, -0.75).normalize();
const KEY = new THREE.Vector3(-0.42, 0.80, -0.43).normalize();

/* ---------------- data textures + uniforms (called from inside Scene.build, before materials) ---------------- */
FX.preUniforms = function (u, ocean) {
  uniforms = u; O = ocean; S = OS.Scene;
  seaData = new Uint8Array(LX * LY * 4);
  for (let j = 0; j < LY; j++) {
    const lat = LAT1 - j * 0.25;
    for (let i = 0; i < LX; i++) {
      const lon = LON0 + i * 0.25, k = j * LX + i, fu = (lon - LON0) / (LON1 - LON0), fv = (LAT1 - lat) / (LAT1 - LAT0);
      const dc = S.sampleGrid2(O.dc, fu, fv, NX, NY), bath = S.sampleGrid2(O.bathy, fu, fv, NX, NY), isL = O.landHi[k] >= 128;
      const jet = Math.exp(-(((lon - 60) / 9) ** 2) - (((lat - 12) / 6) ** 2));
      const trades = smoothstep(-4, -12, lat) * 0.55, bay = smoothstep(80, 84, lon) * smoothstep(5, 10, lat) * 0.45, calm = Math.exp(-(((lat - 1) / 3) ** 2)) * 0.25;
      const rough = clamp(0.45 + 0.95 * jet + trades + bay - calm + 0.18 * Oc.fbm(lon * 0.3 + 3, lat * 0.3 - 1, 3), 0.2, 1.5);
      const dR = Oc.distPolyline(lon, lat, CLR);
      const atoll = Math.exp(-((dR / 0.55) ** 2)) * smoothstep(0.52, 0.72, Oc.vnoise(lon * 2.4 + 3.1, lat * 2.4 - 1.7));
      const shelf = smoothstep(240, 30, bath);
      seaData[k * 4] = Math.round(rough / 1.5 * 255);
      seaData[k * 4 + 1] = isL ? 0 : Math.round(clamp(Math.max(atoll, shelf * 0.55), 0, 1) * 255);
      seaData[k * 4 + 2] = isL ? 0 : Math.round(clamp(dc / 2, 0, 1) * 255);
      seaData[k * 4 + 3] = 255;
    }
  }
  surfData = new Uint8Array(N2 * 4);
  for (let k = 0; k < N2; k++) {
    const sst = O.sst[k], dc = O.dc[k];
    surfData[k * 4] = Math.round(clamp((sst - 24) / 6.5, 0, 1) * 255);
    surfData[k * 4 + 1] = Math.round(clamp((O.sss[k] - 31) / 6, 0, 1) * 255);
    surfData[k * 4 + 2] = Math.round(clamp((27.8 - sst) / 3, 0, 1) * (0.4 + 0.6 * Math.exp(-dc / 2)) * 255);
    surfData[k * 4 + 3] = O.landLo[k] ? 0 : Math.round(smoothstep(260, 30, O.bathy[k]) * 255);
  }
  const tex = (d, w, h) => { const t = new THREE.DataTexture(d, w, h, THREE.RGBAFormat, THREE.UnsignedByteType); t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.needsUpdate = true; return t; };
  const cl = []; for (let i = 0; i < 12; i++) cl.push(new THREE.Vector4(0, 0, 1, 0));
  Object.assign(u, {
    uWaveAmp: { value: 0.034 }, uStorm: { value: new THREE.Vector4(0, 0, 0.5, 0) }, uRipple: { value: new THREE.Vector4(0, 0, -10, 0) },
    uSea: { value: tex(seaData, LX, LY) }, uSurf: { value: tex(surfData, NX, NY) }, uSunDir: { value: SUN.clone() }, uLightDir: { value: KEY.clone() },
    uClouds: { value: cl }, uDataMix: { value: 0 }, uHover: { value: new THREE.Vector4(0, 0, 0, 0) }
  });
  Object.assign(OS.Waves, { sea: seaData, lx: LX, ly: LY, halfX: HX, halfZ: HZ });
};

/* ---------------- shaders ---------------- */
const WATER_VS = `
  uniform float uTime; uniform vec2 uHalf; uniform vec2 uLandGrid;
  ${G.waves}
  varying vec3 vW;
  void main(){ vec4 w = modelMatrix * vec4(position, 1.0); w.y = waveH(w.xz); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const WATER_FS = `
  precision highp float; precision highp sampler3D;
  uniform float uTime; uniform vec2 uHalf; uniform vec2 uLandGrid; uniform vec3 uGrid;
  uniform sampler3D uVol; uniform sampler2D uLand; uniform sampler2D uCmap; uniform sampler2D uWake; uniform sampler2D uFlowTex; uniform sampler2D uSurf;
  uniform vec3 uCut; uniform vec2 uQ; uniform vec2 uRange; uniform float uWakeAmt; uniform float uDataMix; uniform vec3 uLightDir;
  uniform vec4 uClouds[12]; uniform vec4 uHover;
  ${G.waves}
  ${G.sky}
  ${G.noise}
  varying vec3 vW;
  void main(){
    vec3 p = vW;
    if (p.x > uCut.x && p.z > uCut.z) discard;
    vec2 f = clamp(vec2((p.x + uHalf.x) / (2.0 * uHalf.x), (p.z + uHalf.y) / (2.0 * uHalf.y)), 0.0, 1.0);
    float land = texture(uLand, vec2(wtc(f.x, uLandGrid.x), wtc(f.y, uLandGrid.y))).r;
    if (land > 0.5) discard;
    vec2 g2 = vec2(wtc(f.x, uGrid.x), wtc(f.y, uGrid.y));
    vec4 sea = seaAt(p.xz);
    vec4 sf = texture(uSurf, g2);
    float amp = max(uWaveAmp * sea.r * smoothstep(0.02, 0.3, sea.b), 1e-4);
    float e = 0.0032;
    float h0 = waveH(p.xz), hx = waveH(p.xz + vec2(e, 0.0)), hz = waveH(p.xz + vec2(0.0, e));
    vec3 Nt = normalize(vec3(h0 - hx, e, h0 - hz));
    vec3 N = normalize(vec3((h0 - hx) * 2.6, e, (h0 - hz) * 2.6));
    float crest = clamp(1.0 + h0 / amp, 0.0, 1.0);
    float fw = fwidth(p.x);
    float near = 1.0 - smoothstep(0.0018, 0.0075, fw);

    /* current-advected detail (two-phase flow map) */
    vec2 vel = (texture(uFlowTex, g2).rg * 2.0 - 1.0) * 1.6; float spd = length(vel);
    vec2 uv = vec2(f.x * 60.0, f.y * 42.0);
    float t1 = fract(uTime * 0.1), t2 = fract(uTime * 0.1 + 0.5), wb = abs(t1 * 2.0 - 1.0);
    vec2 fl = vel * vec2(1.0, -1.0);
    vec2 o1 = fl * t1 * 2.4, o2 = fl * t2 * 2.4;
    vec2 dA = vec2(vnoise2((uv - o1) * 9.0), vnoise2((uv - o1) * 9.0 + 17.3));
    vec2 dB = vec2(vnoise2((uv - o2) * 9.0 + 5.1), vnoise2((uv - o2) * 9.0 + 29.7));
    vec2 dn = mix(dA, dB, wb) - 0.5;
    vec2 sp = vec2(vnoise2(p.xz * 150.0 + uTime * vec2(0.9, -0.6)), vnoise2(p.xz * 150.0 - uTime * vec2(0.5, 0.8) + 9.0)) - 0.5;
    vec3 dN = vec3(dn.x, 0.0, dn.y) * 0.24 * near + vec3(sp.x, 0.0, sp.y) * 0.16 * (1.0 - smoothstep(0.0008, 0.0032, fw));
    N = normalize(N + dN);
    vec3 Nr = normalize(Nt + dN * 0.6);   /* gentler normal for reflections: no muddy horizon blotches */

    /* foam */
    /* foam streaks stretched along the monsoon wind (toward the north-east) */
    vec2 wd = vec2(0.8, -0.6);
    mat2 wr = mat2(wd.x, -wd.y, wd.y, wd.x);
    vec2 fa = wr * (uv - o1), fb = wr * (uv - o2);
    float fA = vnoise2(fa * vec2(2.6, 8.0)) * 0.6 + vnoise2(fa * vec2(7.0, 20.0)) * 0.4;
    float fB = vnoise2(fb * vec2(2.6, 8.0) + 3.3) * 0.6 + vnoise2(fb * vec2(7.0, 20.0) + 8.1) * 0.4;
    float fn = mix(fA, fB, wb);
    float whitecap = smoothstep(0.84, 0.99, crest) * smoothstep(0.35, 0.85, sea.r) * smoothstep(0.5, 0.8, fn) * (0.3 + 0.7 * near);
    vec2 sd = p.xz - uStorm.xy; float sm = uStorm.w * exp(-dot(sd, sd) / (uStorm.z * uStorm.z));
    whitecap = max(whitecap, sm * smoothstep(0.3, 0.7, fn) * (0.35 + 0.65 * crest));
    float shore = 1.0 - smoothstep(0.0, 0.16, sea.b);
    float bands = 0.5 + 0.5 * sin(sea.b * 90.0 + uTime * 2.2 + fn * 3.0);
    float shoreFoam = shore * smoothstep(0.55, 0.92, bands * (0.6 + 0.6 * fn));
    shoreFoam = max(shoreFoam, (1.0 - smoothstep(0.0, 0.035, sea.b)) * 0.85 * smoothstep(0.2, 0.6, fn));
    vec2 dir = spd > 0.02 ? fl / spd : vec2(1.0, 0.0);
    vec2 pr = vec2(dot(uv, dir), dot(uv, vec2(-dir.y, dir.x)));
    float stA = vnoise2(vec2((pr.x - t1 * spd * 5.3) * 1.2, pr.y * 7.0));
    float stB = vnoise2(vec2((pr.x - t2 * spd * 5.3 + 7.0) * 1.2, pr.y * 7.0 + 3.0));
    float streak = smoothstep(0.70, 0.95, mix(stA, stB, wb)) * smoothstep(0.25, 0.9, spd) * 0.6;
    float wake = texture(uWake, g2).r * uWakeAmt;
    float foam = clamp(whitecap + shoreFoam + streak + wake * smoothstep(0.35, 0.7, fn) * 0.6, 0.0, 1.0);

    /* water colour from the ocean itself: warmth, upwelling, river plume, shelves and reefs */
    vec3 deep = mix(vec3(0.015, 0.13, 0.18), vec3(0.01, 0.16, 0.35), smoothstep(0.25, 0.75, sf.r));
    deep = mix(deep, vec3(0.02, 0.27, 0.50), smoothstep(0.72, 1.0, sf.r) * 0.75);
    deep = mix(deep, vec3(0.02, 0.22, 0.17), sf.b * 0.75);
    deep = mix(deep, vec3(0.17, 0.25, 0.15), smoothstep(0.45, 0.05, sf.g) * 0.85);
    deep = mix(deep, vec3(0.08, 0.18, 0.27), wake * 0.7);
    float shallow = max(sf.a * 0.75, sea.g);
    vec3 shal = mix(vec3(0.04, 0.40, 0.46), vec3(0.26, 0.82, 0.77), sea.g);
    vec3 base = mix(deep, shal, shallow);

    /* lighting */
    vec3 V = normalize(cameraPosition - p);
    float NdV = max(dot(Nr, V), 0.0);
    float fres = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
    vec3 R = reflect(-V, Nr); R.y = max(abs(R.y), 0.07);
    vec3 refl = skyCol(normalize(R));
    float diff = max(dot(N, uLightDir), 0.0);
    float shadow = 0.0;
    for (int i = 0; i < 12; i++) { vec4 c = uClouds[i]; if (c.w <= 0.0) continue; vec2 d = (p.xz - c.xy) / c.z; shadow += c.w * exp(-dot(d, d) * 2.0); }
    shadow = clamp(shadow, 0.0, 0.7);
    vec3 water = base * (0.55 + 0.6 * diff) * (0.78 + 0.34 * crest);
    float scatter = pow(max(dot(V, -uSunDir) * 0.5 + 0.5, 0.0), 2.0) * crest;
    water += vec3(0.03, 0.30, 0.30) * (scatter * 0.7 + crest * 0.12) * (0.3 + sea.r);
    water *= 1.0 - shadow * 0.55;
    vec3 col = mix(water, refl, clamp(fres, 0.0, 1.0) * 0.9);
    vec3 Hs = normalize(uSunDir + V); float nh = max(dot(N, Hs), 0.0);
    float spec = pow(nh, 900.0) * mix(3.5, 8.0, near) + pow(nh, 90.0) * 0.35;
    vec3 Hk = normalize(uLightDir + V); spec += pow(max(dot(N, Hk), 0.0), 220.0) * 0.4;
    col += vec3(1.0, 0.86, 0.64) * spec * (1.0 - shadow) * (1.0 - foam);
    vec3 foamCol = vec3(0.90, 0.96, 1.0) * (0.72 + 0.4 * diff) * (1.0 - shadow * 0.4);
    col = mix(col, foamCol, foam * 0.95);

    /* optional data tint */
    if (uDataMix > 0.001) {
      float q = texture(uVol, vec3(g2, wtc(0.0, uGrid.z))).r;
      float val = mix(uQ.x, uQ.y, q) - wake * 5.5;
      float cc = clamp((val - uRange.x) / (uRange.y - uRange.x), 0.0, 1.0);
      vec3 dcol = texture(uCmap, vec2(0.002 + cc * 0.996, 0.5)).rgb;
      vec3 dl = dcol * (0.8 + 0.3 * diff) + refl * fres * 0.25 + vec3(1.0, 0.9, 0.7) * spec * 0.35;
      dl = mix(dl, foamCol, foam * 0.45);
      col = mix(col, dl, uDataMix);
    }
    /* faint graticule so geography stays readable */
    float lonD = (40.0 + f.x * 60.0) / 10.0, latD = (27.0 - f.y * 42.0) / 10.0;
    float gr = max(1.0 - smoothstep(0.0, 1.0, abs(fract(lonD - 0.5) - 0.5) / max(fwidth(lonD), 1e-4)), 1.0 - smoothstep(0.0, 1.0, abs(fract(latD - 0.5) - 0.5) / max(fwidth(latD), 1e-4)));
    col = mix(col, vec3(1.0), gr * 0.06);
    /* hover reticle */
    if (uHover.w > 0.001) {
      float hr = length(p.xz - uHover.xy), pu = 0.5 + 0.5 * sin(uTime * 5.0);
      float ring = exp(-pow((hr - 0.06 - 0.012 * pu) / 0.0045, 2.0)) + 0.5 * exp(-pow((hr - 0.11 - 0.02 * pu) / 0.003, 2.0)) * (1.0 - pu) + exp(-pow(hr / 0.01, 2.0)) * 0.8;
      col += vec3(0.45, 0.95, 1.0) * ring * uHover.w * 1.6;
    }
    gl_FragColor = vec4(col, 1.0);
  }`;

const GRADE = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVig: { value: 0.5 }, uGrain: { value: 0.03 }, uTilt: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uVig; uniform float uGrain; uniform float uTilt; uniform vec2 uRes; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      if (uTilt > 0.001) {
        float b = uTilt * smoothstep(0.2, 0.5, abs(vUv.y - 0.5));
        if (b > 0.001) {
          vec2 px = b * 3.2 / uRes; vec3 acc = c;
          acc += texture2D(tDiffuse, vUv + vec2(px.x, 0.0)).rgb + texture2D(tDiffuse, vUv - vec2(px.x, 0.0)).rgb;
          acc += texture2D(tDiffuse, vUv + vec2(0.0, px.y)).rgb + texture2D(tDiffuse, vUv - vec2(0.0, px.y)).rgb;
          acc += texture2D(tDiffuse, vUv + px).rgb + texture2D(tDiffuse, vUv - px).rgb;
          acc += texture2D(tDiffuse, vUv + vec2(px.x, -px.y)).rgb + texture2D(tDiffuse, vUv + vec2(-px.x, px.y)).rgb;
          c = acc / 9.0;
        }
      }
      vec3 over = max(c - 0.8, 0.0); c = min(c, vec3(0.8)) + 0.2 * (1.0 - exp(-over * 3.0));
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(l), c, 1.12);
      c *= mix(vec3(0.95, 1.01, 1.06), vec3(1.04, 1.0, 0.95), smoothstep(0.1, 0.8, l));
      float v = smoothstep(1.05, 0.25, length((vUv - 0.5) * vec2(1.1, 1.0)));
      c *= mix(1.0, v, uVig);
      c += (h(vUv * uRes + fract(uTime) * 91.7) - 0.5) * uGrain;
      gl_FragColor = vec4(c, 1.0);
    }`
};

function glowTex(inner, outer) {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, inner); gr.addColorStop(0.25, inner.replace(/[\d.]+\)$/, '0.55)')); gr.addColorStop(1, outer);
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
}
function puffTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  for (let i = 0; i < 26; i++) {
    const x = 64 + (Math.random() - 0.5) * 60, y = 64 + (Math.random() - 0.5) * 36, r = 18 + Math.random() * 26;
    const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  }
  return new THREE.CanvasTexture(c);
}

/* ---------------- build (called once, at the end of Scene.build) ---------------- */
FX.build = function () {
  const scene = S.scene, H = () => S.view.H;
  /* ocean surface */
  const wGeo = new THREE.PlaneGeometry(WW, DD, 320, 224); wGeo.rotateX(-Math.PI / 2);
  water = new THREE.Mesh(wGeo, new THREE.ShaderMaterial({ uniforms: Object.assign({}, uniforms), vertexShader: WATER_VS, fragmentShader: WATER_FS, extensions: { derivatives: true } }));
  water.frustumCulled = false; water.renderOrder = 1; scene.add(water);

  /* sky dome */
  sky = new THREE.Mesh(new THREE.SphereGeometry(45, 48, 24), new THREE.ShaderMaterial({
    uniforms: { uSunDir: uniforms.uSunDir, uTime: uniforms.uTime }, side: THREE.BackSide, depthWrite: false, depthTest: false,
    vertexShader: `varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uTime; ${G.sky} ${G.noise} varying vec3 vD;
      void main(){ vec3 d = normalize(vD); vec3 c = skyCol(d);
        vec2 sc = vec2(atan(d.z, d.x), asin(clamp(d.y, -1.0, 1.0))) * 160.0; float hs = hash21(floor(sc));
        float star = step(0.9965, hs) * smoothstep(0.25, 0.7, d.y) * (0.55 + 0.45 * sin(uTime * 1.7 + hs * 60.0));
        c += vec3(0.8, 0.9, 1.0) * star * 0.9;
        gl_FragColor = vec4(c, 1.0); }`
  }));
  sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky);

  /* abyss floor: teal glow, caustics, soft contact shadow */
  floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShaderMaterial({
    uniforms: { uTime: uniforms.uTime, uHalf: uniforms.uHalf }, transparent: true, depthWrite: false,
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uTime; uniform vec2 uHalf; ${G.caustic} varying vec3 vW;
      void main(){ vec2 q = vW.xz; float r = length(q / vec2(4.6, 3.6));
        vec3 glow = vec3(0.04, 0.30, 0.38) * exp(-r * r * 0.9) * 0.9;
        glow += vec3(0.35, 0.8, 0.9) * caustic(q * 0.32, uTime * 0.35) * exp(-r * r * 0.7) * 0.32;
        vec2 b = abs(q) - uHalf; float box = length(max(b, 0.0)) + min(max(b.x, b.y), 0.0);
        float sh = (1.0 - smoothstep(-0.8, 0.9, box)) * 0.75;
        glow *= 1.0 - sh;
        float a = clamp(max(max(glow.r, glow.g), glow.b) * 2.6 + sh * 0.6, 0.0, 1.0) * (1.0 - smoothstep(0.9, 2.2, r));
        gl_FragColor = vec4(glow, a); }`
  }));
  floor.rotation.x = -Math.PI / 2; floor.renderOrder = -5; scene.add(floor);

  /* marine snow / motes */
  {
    const n = 1700, seed = new Float32Array(n * 3), sz = new Float32Array(n);
    for (let i = 0; i < n; i++) { seed[i * 3] = Math.random(); seed[i * 3 + 1] = Math.random(); seed[i * 3 + 2] = Math.random(); sz[i] = 0.6 + Math.random() * 1.8; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(seed, 3)); g.setAttribute('sz', new THREE.BufferAttribute(sz, 1));
    snow = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: { uTime: uniforms.uTime, uPR: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute float sz; uniform float uTime; uniform float uPR; varying float vA;
        void main(){ vec3 s = position; vec3 b0 = vec3(-7.0, -3.4, -5.5), b1 = vec3(7.0, 0.9, 5.5);
          vec3 p = mix(b0, b1, s);
          p.y = b0.y + mod(s.y * (b1.y - b0.y) - uTime * (0.012 + s.x * 0.022), b1.y - b0.y);
          p.x += sin(uTime * 0.21 + s.z * 21.0) * 0.09; p.z += cos(uTime * 0.17 + s.x * 19.0) * 0.09;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = sz * uPR * (4.0 / -mv.z);
          vA = (0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * (0.8 + s.z * 2.0) + s.y * 40.0))) * smoothstep(0.9, 0.3, p.y) * 0.55;
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(vec3(0.55, 0.85, 1.0) * vA * (1.0 - d * 2.0), 1.0); }`
    }));
    snow.frustumCulled = false; scene.add(snow);
  }

  /* bubbles rising along the knife faces */
  {
    const n = 320, seed = new Float32Array(n * 4);
    for (let i = 0; i < n * 4; i++) seed[i] = Math.random();
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); g.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
    bubbles = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: { uTime: uniforms.uTime, uCut: uniforms.uCut, uHalf: uniforms.uHalf, uH: uniforms.uH, uPR: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute vec4 seed; uniform float uTime; uniform vec3 uCut; uniform vec2 uHalf; uniform float uH; uniform float uPR; varying float vA;
        void main(){
          if (uCut.x > 100.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vA = 0.0; return; }
          float cx = max(uCut.x, -uHalf.x), cz = max(uCut.z, -uHalf.y), cy = max(uCut.y, -uH);
          float off = 0.008 + seed.x * seed.x * 0.16;
          vec3 p = seed.w < 0.5 ? vec3(cx + off, 0.0, mix(cz, uHalf.y, seed.z)) : vec3(mix(cx, uHalf.x, seed.z), 0.0, cz + off);
          float rise = fract(seed.y + uTime * (0.035 + seed.x * 0.07));
          p.y = mix(cy, -0.01, rise);
          p.x += sin(uTime * 2.3 + seed.y * 30.0) * 0.006; p.z += cos(uTime * 2.1 + seed.z * 30.0) * 0.006;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (1.5 + seed.x * 4.0) * uPR * (3.0 / -mv.z) * 2.0;
          vA = smoothstep(0.0, 0.08, rise) * smoothstep(1.0, 0.9, rise);
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA; void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c); if (d > 0.5) discard;
          float rim = smoothstep(0.32, 0.46, d) * (1.0 - smoothstep(0.46, 0.5, d)); float hl = exp(-dot(c - vec2(-0.15, -0.15), c - vec2(-0.15, -0.15)) * 90.0);
          gl_FragColor = vec4(vec3(0.7, 0.93, 1.0) * (rim * 0.9 + hl) * vA, 1.0); }`
    }));
    bubbles.frustumCulled = false; bubbles.renderOrder = 3; scene.add(bubbles);
  }

  /* clouds */
  cloudGroup = new THREE.Group(); scene.add(cloudGroup);
  const puff = puffTex();
  for (let c = 0; c < 8; c++) {
    const grp = new THREE.Group(), sprites = [];
    const nP = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < nP; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, color: new THREE.Color(0.92, 0.9, 0.88), transparent: true, depthWrite: false, opacity: 0 }));
      const s = 0.26 + Math.random() * 0.26; sp.scale.set(s * 1.7, s * 0.8, 1); sp.position.set((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.32);
      grp.add(sp); sprites.push(sp);
    }
    grp.position.set(-HX + 0.3 + Math.random() * (WW - 0.6), 0.36 + Math.random() * 0.16, -HZ + 0.3 + Math.random() * (DD - 0.6));
    cloudGroup.add(grp); clouds.push({ grp, sprites, base: 0.32 + Math.random() * 0.26 });
  }

  /* cyclone cloud system */
  stormMesh = new THREE.Mesh(new THREE.CircleGeometry(1, 96), new THREE.ShaderMaterial({
    uniforms: { uTime: uniforms.uTime, uInten: { value: 0 }, uVis: { value: 0 }, uFlash: { value: 0 } }, transparent: true, depthWrite: false,
    vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uTime; uniform float uInten; uniform float uVis; uniform float uFlash; ${G.noise} varying vec2 vP;
      void main(){ vec2 p = vP; float r = length(p); if (r > 1.0) discard; float a = atan(p.y, p.x);
        float spv = a - uTime * 0.35 + log(r + 0.03) * 2.8;
        float arms = 0.5 + 0.5 * sin(spv * 3.0 + fbm2(p * 3.0 + uTime * 0.05) * 2.2);
        float n = fbm2(vec2(spv * 0.9, r * 5.0 - uTime * 0.05));
        float dens = (arms * 0.55 + n * 0.7) * smoothstep(1.0, 0.25, r);
        float eyeR = 0.08 + 0.06 * (1.0 - uInten);
        dens *= smoothstep(eyeR * 0.6, eyeR * 1.7, r);
        dens += exp(-pow((r - eyeR * 1.55) / 0.05, 2.0)) * 0.6 * uInten;
        float alpha = clamp((dens - 0.26) * 1.7, 0.0, 0.95) * uVis;
        vec3 c = mix(vec3(0.40, 0.45, 0.53), vec3(0.99, 0.99, 1.0), clamp(dens, 0.0, 1.0));
        c += vec3(0.75, 0.82, 1.0) * uFlash * dens * 2.6;
        gl_FragColor = vec4(c, alpha); }`
  }));
  stormMesh.rotation.x = -Math.PI / 2; stormMesh.renderOrder = 6; stormMesh.visible = false; scene.add(stormMesh);

  /* beacons on the float antennas */
  const bt = glowTex('rgba(255,190,90,1)', 'rgba(255,140,40,0)');
  S.floats.forEach((f, i) => {
    const b = new THREE.Sprite(new THREE.SpriteMaterial({ map: bt, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    b.scale.set(0.07, 0.07, 1); b.position.y = 0.155; f.group.add(b); beacons.push({ b, ph: i * 1.37 });
  });

  buildPost();
  S.onFrame(update);
  FX.ready = true;
  FX.setCine(true);
};

function buildPost() {
  if (!(THREE.EffectComposer && THREE.RenderPass && THREE.UnrealBloomPass && THREE.ShaderPass && THREE.CopyShader)) return;
  try {
    const R = S.renderer, size = R.getSize(new THREE.Vector2());
    const MS = THREE.WebGLMultisampleRenderTarget && R.capabilities.isWebGL2;
    const RT = MS ? THREE.WebGLMultisampleRenderTarget : THREE.WebGLRenderTarget;
    const rt = new RT(Math.max(1, size.x), Math.max(1, size.y), { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, type: THREE.HalfFloatType });
    if (MS) rt.samples = 4;
    composer = new THREE.EffectComposer(R, rt);
    composer.addPass(new THREE.RenderPass(S.scene, S.camera));
    bloom = new THREE.UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.6, 0.55, 0.94); composer.addPass(bloom);
    grade = new THREE.ShaderPass(GRADE); composer.addPass(grade);
    composer.setPixelRatio(R.getPixelRatio()); composer.setSize(size.x, size.y);
  } catch (e) { composer = null; }
}

/* ---------------- per frame ---------------- */
let perf = { n: 0, acc: 0, stage: 0, raw: 0, last: 0 };
function update(dt, now) {
  if (!FX.ready) return;
  perf.raw = perf.last ? (now - perf.last) / 1000 : 1; perf.last = now;
  const t = uniforms.uTime.value, cam = S.camera;
  sky.position.copy(cam.position);
  floor.position.y = -S.view.H - 0.55;
  /* smoothed controls */
  const k = 1 - Math.exp(-dt * 3);
  uniforms.uDataMix.value += (dataMixTarget - uniforms.uDataMix.value) * k;
  weather += (weatherTarget - weather) * k;
  const hv = uniforms.uHover.value; hv.w += (hoverTarget - hv.w) * (1 - Math.exp(-dt * 10));
  /* wave uniforms for the CPU twin */
  const st = uniforms.uStorm.value, rp = uniforms.uRipple.value;
  waveU.amp = uniforms.uWaveAmp.value; waveU.t = t; waveU.storm = [st.x, st.y, st.z, st.w]; waveU.ripple = [rp.x, rp.y, rp.z, rp.w];
  /* floats ride the waves and blink */
  S.floats.forEach((f, i) => {
    const g = f.group, x = g.position.x, z = g.position.z;
    if (FX.on) { const h = OS.Waves.height(x, z, waveU), hx = OS.Waves.height(x + 0.02, z, waveU), hz = OS.Waves.height(x, z + 0.02, waveU); g.position.y = h; g.rotation.z = (hx - h) / 0.02 * 0.9; g.rotation.x = -(hz - h) / 0.02 * 0.9; }
    else { g.position.y = 0; g.rotation.set(0, 0, 0); }
    const bc = beacons[i]; if (bc) bc.b.material.opacity = FX.on ? Math.pow(Math.max(0, Math.sin(t * 2.4 + bc.ph)), 10) * 0.95 : 0;
  });
  /* clouds drift with the monsoon, cast shadows */
  const cams = S.cam.r, camFade = smoothstep(1.7, 4.2, cams), wv = weather * camFade;
  const cl = uniforms.uClouds.value;
  clouds.forEach((c, i) => {
    const g = c.grp; g.position.x += dt * 0.032; g.position.z -= dt * 0.017;
    if (g.position.x > HX - 0.1) { g.position.x = -HX + 0.1; g.position.z = -HZ + 0.3 + Math.random() * (DD - 0.6); }
    if (g.position.z < -HZ + 0.1) g.position.z = HZ - 0.1;
    const edge = smoothstep(HX - 0.1, HX - 0.7, Math.abs(g.position.x)) * smoothstep(HZ - 0.1, HZ - 0.55, Math.abs(g.position.z));
    const op = c.base * edge * wv;
    c.sprites.forEach((sp) => { sp.material.opacity = op; });
    const y = g.position.y;
    cl[i].set(g.position.x - KEY.x / KEY.y * y, g.position.z - KEY.z / KEY.y * y, 0.36, FX.on ? 0.45 * c.base * edge * weather : 0);
  });
  cloudGroup.visible = FX.on && wv > 0.01;
  if (FX.on) { const pm = S.internals().particles.material; pm.opacity = 0.32 * smoothstep(1.6, 4.5, cams); }
  /* storm */
  stormVis += (stormTarget - stormVis) * k;
  const sm = stormMesh.material.uniforms;
  if (Math.random() < dt * 1.6 * storm.inten * storm.inten && stormVis > 0.5) flash = 1;
  flash = Math.max(0, flash - dt * 5);
  sm.uFlash.value = flash * (0.6 + 0.4 * Math.sin(t * 60));
  sm.uVis.value = stormVis; sm.uInten.value = storm.inten;
  stormMesh.visible = FX.on && stormVis > 0.01;
  const rad = 0.3 + 0.45 * storm.inten;
  stormMesh.position.set(storm.x, 0.16, storm.z); stormMesh.scale.setScalar(rad);
  st.set(storm.x, storm.z, rad * 0.85, storm.inten * stormVis);
  cl[11].set(storm.x - KEY.x / KEY.y * 0.16, storm.z - KEY.z / KEY.y * 0.16, rad * 0.8, FX.on ? 0.6 * stormVis : 0);
  /* post */
  if (grade) grade.uniforms.uTime.value = t;
  /* adaptive quality */
  if (FX.on && perf.stage === 0 && !U.reduceMotion && document.visibilityState === 'visible' && perf.raw < 0.2) {
    perf.n++; if (perf.n > 60) perf.acc += perf.raw;
    if (perf.n >= 240) { const avg = perf.acc / (perf.n - 60); perf.stage = avg > 0.024 ? 1 : 2; if (perf.stage === 1) setPR(1); }
  }
}
function setPR(pr) {
  const R = S.renderer; R.setPixelRatio(pr);
  if (composer) composer.setPixelRatio(pr);
  [snow, bubbles].forEach((m) => { m.material.uniforms.uPR.value = pr; });
  S.resize();
}

/* ---------------- public API ---------------- */
FX.resize = function (w, h) {
  if (!composer) return;
  composer.setSize(w, h);
  const pr = S.renderer.getPixelRatio();
  if (grade) grade.uniforms.uRes.value.set(w * pr, h * pr);
};
S = OS.Scene;
S.renderHook = function (dt) {
  if (FX.on && composer) { try { composer.render(dt); return; } catch (e) { composer = null; } }
  S.renderer.render(S.scene, S.camera);
};
FX.setCine = function (on) {
  if (!FX.ready) return;
  FX.on = on;
  document.body.classList.toggle('cine', on);
  uniforms.uCine.value = on ? 1 : 0;
  [water, sky, floor, snow, bubbles].forEach((m) => { m.visible = on; });
  const I = S.internals();
  S.scene.background = on ? null : new THREE.Color('#E6EBE8');
  S.renderer.setClearColor(on ? 0x04101b : 0xE6EBE8, 1);
  I.edges.material.color.set(on ? 0x8fe3f0 : 0x1C2A35); I.edges.material.opacity = on ? 0.22 : 0.55;
  I.shadow.visible = !on;
  /* current streaks become glowing trails in cinema mode */
  const pc = I.particles.geometry.attributes.color, a = pc.array;
  for (let i = 0; i < a.length; i += 6) { if (on) a.set([0.55, 0.95, 1.0, 0, 0, 0], i); else a.set([0.08, 0.12, 0.16, 0.80, 0.83, 0.82], i); }
  pc.needsUpdate = true;
  I.particles.material.blending = on ? THREE.AdditiveBlending : THREE.NormalBlending; I.particles.material.opacity = on ? 0.32 : 0.8; I.particles.material.needsUpdate = true;
  const pr = on ? Math.min(window.devicePixelRatio || 1, perf.stage >= 1 ? 1 : 1.5) : Math.min(window.devicePixelRatio || 1, 2);
  setPR(pr);
  OS.Store.set({ cine: on });
  S.drawProfile();
  if (S.onResize) S.onResize();
  if (OS.Dossier && OS.Dossier.redraw) OS.Dossier.redraw();
};
FX.setDataMix = (v) => { dataMixTarget = v; };
FX.dataMix = () => dataMixTarget;
FX.setWeather = (on) => { weatherTarget = on ? 1 : 0; };
FX.setSeaState = (k) => { uniforms.uWaveAmp.value = 0.034 * k; };
FX.seaState = () => uniforms.uWaveAmp.value / 0.034;
FX.ripple = (x, z, s) => { if (!FX.ready) return; uniforms.uRipple.value.set(x, z, uniforms.uTime.value, s || 1); };
FX.hover = (p) => { if (!FX.ready) return; if (p) { uniforms.uHover.value.x = p.x; uniforms.uHover.value.y = p.z; hoverTarget = FX.on ? 1 : 0; } else hoverTarget = 0; };
FX.waveAt = (x, z) => (FX.on && FX.ready ? OS.Waves.height(x, z, waveU) : 0);
FX.storm = {
  show(on) { stormTarget = on ? 1 : 0; if (!on) uniforms.uStorm.value.w = 0; },
  set(lon, lat, inten) { storm.x = S.lonToX(lon); storm.z = S.latToZ(lat); storm.inten = clamp(inten, 0, 1); }
};
FX.grainScale = 1;
FX.setGrain = (k) => { FX.grainScale = k; if (grade) grade.uniforms.uGrain.value = 0.03 * k; };
FX.film = (on) => { if (grade) { grade.uniforms.uTilt.value = on ? 0.9 : 0; grade.uniforms.uGrain.value = (on ? 0.045 : 0.03) * FX.grainScale; grade.uniforms.uVig.value = on ? 0.62 : 0.5; } if (bloom) bloom.strength = on ? 0.75 : 0.62; };

/* ---------------- DOM cinematics shared by the dive and film mode ---------------- */
let titleT = 0;
function stageEl(id, cls, html) { let e = document.getElementById(id); if (!e) { e = document.createElement('div'); e.id = id; if (cls) e.className = cls; if (html) e.innerHTML = html; document.getElementById('stage').appendChild(e); } return e; }
FX.letterbox = (on) => { stageEl('lb-top', 'lb'); stageEl('lb-bot', 'lb'); document.getElementById('stage').classList.toggle('letterbox', on); };
FX.title = (title, sub, ms) => {
  const e = stageEl('titlecard', '', '<span class="tc-rule"></span><b></b><small></small>');
  e.querySelector('b').textContent = title; e.querySelector('small').textContent = sub || '';
  e.classList.remove('show'); void e.offsetWidth; e.classList.add('show');
  clearTimeout(titleT); if (ms) titleT = setTimeout(() => e.classList.remove('show'), ms);
};
FX.hideTitle = () => { const e = document.getElementById('titlecard'); if (e) e.classList.remove('show'); };
FX.plunge = () => {
  const e = stageEl('plunge', '', '<i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i>');
  e.querySelectorAll('i').forEach((b) => { b.style.left = `${8 + Math.random() * 84}%`; b.style.animationDelay = `${Math.random() * 0.35}s`; b.style.width = b.style.height = `${6 + Math.random() * 16}px`; });
  e.classList.remove('go'); void e.offsetWidth; e.classList.add('go');
};

OS.FX = FX;
})(window.OS);
