/* Shared GLSL chunks for the cinematic look, plus a JS twin of the wave height so CPU objects
   (floats, pins, beacons) ride the exact same waves the GPU draws. */
(function (OS) {
'use strict';
const GLSL = {};

/* Needs uTime, uHalf, uLandGrid declared by the host shader. */
GLSL.waves = `
  uniform float uWaveAmp; uniform vec4 uStorm; uniform vec4 uRipple; uniform sampler2D uSea;
  float wtc(float f, float n){ return (f * (n - 1.0) + 0.5) / n; }
  vec4 seaAt(vec2 xz){
    vec2 f = clamp(vec2((xz.x + uHalf.x) / (2.0 * uHalf.x), (xz.y + uHalf.y) / (2.0 * uHalf.y)), 0.0, 1.0);
    return texture(uSea, vec2(wtc(f.x, uLandGrid.x), wtc(f.y, uLandGrid.y)));
  }
  float ew(vec2 p, vec2 d, float k, float sp, float ph){ return exp(sin(dot(p, d) * k + uTime * sp + ph) - 1.0); }
  float waveN(vec2 p){
    vec2 q = p + 0.03 * vec2(sin(p.y * 7.0 + uTime * 0.4), cos(p.x * 6.0 - uTime * 0.3));
    float h = 0.50 * ew(q, vec2(0.80, -0.60), 13.0, 1.6, 0.0)
            + 0.32 * ew(q, vec2(0.53, -0.85), 21.0, 2.1, 1.7)
            + 0.22 * ew(q, vec2(0.98, -0.20), 31.0, 2.6, 4.1)
            + 0.14 * ew(q, vec2(-0.29, -0.96), 47.0, 3.3, 2.3)
            + 0.09 * ew(q, vec2(0.70, 0.71), 69.0, 4.2, 5.2);
    return h / 1.27;
  }
  float waveH(vec2 xz){
    vec4 sea = seaAt(xz);
    float coastFade = smoothstep(0.02, 0.3, sea.b);
    float amp = uWaveAmp * sea.r * coastFade;
    float h = -amp * (1.0 - waveN(xz));
    vec2 sd = xz - uStorm.xy; float sr = length(sd);
    float sm = uStorm.w * exp(-sr * sr / (uStorm.z * uStorm.z)) * coastFade;
    if (sm > 0.002) {
      float ang = atan(sd.y, sd.x);
      float sw = 0.5 + 0.5 * sin(-ang * 3.0 + log(sr + 0.03) * 8.4 - uTime * 2.6);
      h -= sm * uWaveAmp * 1.9 * (1.0 - sw * sw * sw);
    }
    float age = uTime - uRipple.z;
    if (uRipple.w > 0.0 && age > 0.0 && age < 4.0) {
      float rr = length(xz - uRipple.xy), front = age * 0.55;
      float env = exp(-pow((rr - front) / 0.07, 2.0)) * exp(-age * 0.9);
      h += uRipple.w * coastFade * uWaveAmp * 1.8 * env * (sin((rr - front) * 70.0) - 1.0) * 0.5;
    }
    return min(h, 0.0);
  }
`;

GLSL.sky = `
  uniform vec3 uSunDir;
  vec3 skyCol(vec3 d){
    float y = d.y;
    vec3 zen = vec3(0.035, 0.085, 0.20), mid = vec3(0.13, 0.33, 0.50), hor = vec3(1.0, 0.68, 0.46);
    vec3 low = vec3(0.012, 0.045, 0.085), abyss = vec3(0.02, 0.10, 0.16);
    vec3 c;
    if (y > 0.0) { c = mix(hor, mid, smoothstep(0.0, 0.16, y)); c = mix(c, zen, smoothstep(0.16, 0.85, y)); }
    else { c = mix(mix(hor, abyss, 0.55), abyss, smoothstep(0.0, 0.12, -y)); c = mix(c, low, smoothstep(0.12, 0.75, -y)); }
    float sd = max(dot(d, uSunDir), 0.0);
    c += vec3(1.0, 0.70, 0.42) * (pow(sd, 5.0) * 0.30 + pow(sd, 48.0) * 0.55);
    c += vec3(1.0, 0.92, 0.78) * pow(sd, 1200.0) * 7.0;
    return c;
  }
`;

GLSL.noise = `
  float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); float a = hash21(i), b = hash21(i + vec2(1.0, 0.0)), c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0)); return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
  float fbm2(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vnoise2(p); p = p * 2.03 + 11.7; a *= 0.5; } return s / 0.9375; }
`;

/* Tileable water caustic (after joltz0r / Dave Hoskins). Returns roughly 0..1. */
GLSL.caustic = `
  float caustic(vec2 uv, float t){
    vec2 p = mod(uv * 6.28318, 6.28318) - 250.0;
    vec2 i = p; float c = 1.0; float inten = 0.005;
    for (int n = 0; n < 4; n++) {
      float tt = t * (1.0 - (3.5 / float(n + 1)));
      i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
      c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
    }
    c /= 4.0; c = 1.17 - pow(c, 1.4);
    return clamp(pow(abs(c), 8.0), 0.0, 1.5);
  }
`;
OS.GLSL = GLSL;

/* ---------- JS twin of waveH ---------- */
const W = { sea: null, lx: 0, ly: 0, halfX: 3, halfZ: 2.1 };
const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
function seaSample(x, z) {
  const fx = Math.min(1, Math.max(0, (x + W.halfX) / (2 * W.halfX))), fz = Math.min(1, Math.max(0, (z + W.halfZ) / (2 * W.halfZ)));
  const gx = fx * (W.lx - 1), gy = fz * (W.ly - 1), i = Math.min(W.lx - 2, Math.floor(gx)), j = Math.min(W.ly - 2, Math.floor(gy)), tx = gx - i, ty = gy - j;
  const at = (ii, jj, c) => W.sea[(jj * W.lx + ii) * 4 + c] / 255;
  const bl = (c) => { const a = at(i, j, c), b = at(i + 1, j, c), d = at(i, j + 1, c), e = at(i + 1, j + 1, c); return (a + (b - a) * tx) * (1 - ty) + (d + (e - d) * tx) * ty; };
  return [bl(0), bl(2)];
}
const ew = (qx, qz, dx, dz, k, sp, ph, t) => Math.exp(Math.sin((qx * dx + qz * dz) * k + t * sp + ph) - 1);
function waveN(x, z, t) {
  const qx = x + 0.03 * Math.sin(z * 7 + t * 0.4), qz = z + 0.03 * Math.cos(x * 6 - t * 0.3);
  return (0.50 * ew(qx, qz, 0.80, -0.60, 13, 1.6, 0.0, t) + 0.32 * ew(qx, qz, 0.53, -0.85, 21, 2.1, 1.7, t) + 0.22 * ew(qx, qz, 0.98, -0.20, 31, 2.6, 4.1, t)
    + 0.14 * ew(qx, qz, -0.29, -0.96, 47, 3.3, 2.3, t) + 0.09 * ew(qx, qz, 0.70, 0.71, 69, 4.2, 5.2, t)) / 1.27;
}
/* u = { amp, t, storm:[x,z,r,s], ripple:[x,z,t0,s] } */
W.height = function (x, z, u) {
  if (!W.sea) return 0;
  const [r, b] = seaSample(x, z), coastFade = ss(0.02, 0.3, b), t = u.t;
  let h = -u.amp * r * coastFade * (1 - waveN(x, z, t));
  const st = u.storm, sdx = x - st[0], sdz = z - st[1], sr = Math.hypot(sdx, sdz);
  const sm = st[3] * Math.exp(-sr * sr / (st[2] * st[2])) * coastFade;
  if (sm > 0.002) { const sw = 0.5 + 0.5 * Math.sin(-Math.atan2(sdz, sdx) * 3 + Math.log(sr + 0.03) * 8.4 - t * 2.6); h -= sm * u.amp * 1.9 * (1 - sw * sw * sw); }
  const rp = u.ripple, age = t - rp[2];
  if (rp[3] > 0 && age > 0 && age < 4) { const rr = Math.hypot(x - rp[0], z - rp[1]), fr = age * 0.55; const env = Math.exp(-Math.pow((rr - fr) / 0.07, 2)) * Math.exp(-age * 0.9); h += rp[3] * coastFade * u.amp * 1.8 * env * (Math.sin((rr - fr) * 70) - 1) * 0.5; }
  return Math.min(h, 0);
};
OS.Waves = W;
})(window.OS);
