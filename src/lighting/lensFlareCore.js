export const LF_GHOST_SLOTS = 6;                                           
export const LF_OCC_TAPS = 8;                                           
export const LF_INTENSITY_DEFAULT = 0.35;                                    
export const LF_DISPERSAL = 0.38;                                             
export const LF_HALO_RADIUS = 0.24;                                            
export const LF_HALO_WIDTH = 0.07;                                  
export const LF_HALO_GAIN = 0.5;                                      
export const LF_STAR_POINTS = 6.0;                                                              
export const LF_STAR_ROT = 0.4;                                                              
export const LF_STAR_GAIN = 0.6;                                            


export const LF_SRC_R0 = 0.08;
export const LF_SRC_R1 = 0.3;
export const LF_OCC_RADIUS_UV = 0.018;                                 
export const LF_OCC_FAR = 0.9995;                                             
export const LF_BRIGHT_THRESHOLD = 0.85;                                      
export const LF_BRIGHT_KNEE = 0.7;                                  


export const LF_GHOSTS = Object.freeze([
  Object.freeze({ offset: -0.42, weight: 0.22, tint: Object.freeze([1.0, 0.92, 0.86]) }),
  Object.freeze({ offset: 0.3, weight: 0.24, tint: Object.freeze([0.95, 1.0, 0.98]) }),
  Object.freeze({ offset: 0.62, weight: 0.18, tint: Object.freeze([0.88, 0.97, 1.0]) }),
  Object.freeze({ offset: 0.95, weight: 0.14, tint: Object.freeze([0.82, 0.92, 1.0]) }),
  Object.freeze({ offset: 1.35, weight: 0.12, tint: Object.freeze([1.0, 0.88, 0.8]) }),
  Object.freeze({ offset: 1.8, weight: 0.1, tint: Object.freeze([0.9, 0.85, 1.0]) }),
]);


export const LF_GHOSTS_LITE = Object.freeze([
  Object.freeze({ offset: -0.42, weight: 0.4, tint: Object.freeze([1.0, 0.92, 0.86]) }),
  Object.freeze({ offset: 0.3, weight: 0.35, tint: Object.freeze([0.95, 1.0, 0.98]) }),
  Object.freeze({ offset: 0.95, weight: 0.25, tint: Object.freeze([0.82, 0.92, 1.0]) }),
]);

function hardAssert(cond, msg) {
  if (!cond) throw new Error("lensFlareCore: " + msg);
}


export function sanitizeLensFlareIntensity(raw) {
  if (raw === null || raw === undefined) return LF_INTENSITY_DEFAULT;
  const n = Number(raw);
  if (!Number.isFinite(n)) return LF_INTENSITY_DEFAULT;
  return Math.min(1, Math.max(0, n));
}


export function resolveLensFlareFlag({ flag = null, renderStyle = null, weakGpu = false, smLite = false } = {}) {
  if (flag === false) return { on: false, reason: "off-explicito" };
  if (weakGpu && smLite !== true) return { on: false, reason: "veto-gpu-fraca" };
  if (flag === true) return { on: true, reason: weakGpu ? "sm-lite-on-explicito" : "on-explicito" };
  if (!weakGpu) return { on: true, reason: "auto-strong" };
  if (renderStyle === "Realistic") return { on: true, reason: "sm-lite-auto" };
  return { on: false, reason: "auto-classic-off" };
}


export function lensFlarePlan({ flag = null, renderStyle = null, weakGpu = false, intensity, smLite = false, photoFull = false } = {}) {
  const res = resolveLensFlareFlag({ flag, renderStyle, weakGpu, smLite });
  const inten = sanitizeLensFlareIntensity(intensity);
  const zeroed = res.on && inten <= 0;
  const lite = res.on && weakGpu === true && smLite === true && photoFull !== true;
  return Object.freeze({
    active: res.on && inten > 0,
    lite,
    intensity: inten,
    reason: zeroed ? "intensidade-zero" : res.reason,
    ghosts: lite ? LF_GHOSTS_LITE : LF_GHOSTS,
    dispersal: LF_DISPERSAL,
    haloRadius: LF_HALO_RADIUS,
    haloWidth: LF_HALO_WIDTH,
    haloGain: LF_HALO_GAIN,
    starPoints: LF_STAR_POINTS,
    starRot: LF_STAR_ROT,
    starGain: LF_STAR_GAIN,
    occRadius: LF_OCC_RADIUS_UV,
    occFar: LF_OCC_FAR,
    brightThreshold: LF_BRIGHT_THRESHOLD,
    brightKnee: LF_BRIGHT_KNEE,
  });
}


export function lfGhostUv(fu, fv, offset, dispersal = LF_DISPERSAL) {
  const gx = (0.5 - fu) * dispersal;
  const gy = (0.5 - fv) * dispersal;
  return [fu + gx * offset, fv + gy * offset];
}


export function lfCenterWeight(u, v) {
  const d = Math.hypot(u - 0.5, v - 0.5);
  const w = Math.min(1, Math.max(0, 1 - d / 0.75));
  return w * w;
}


export function lfHaloWeight(u, v, aspect, radius = LF_HALO_RADIUS, width = LF_HALO_WIDTH) {
  const hd = Math.hypot((u - 0.5) * aspect, v - 0.5);
  const w = Math.min(1, Math.max(0, 1 - Math.abs(hd - radius) / Math.max(width, 1e-6)));
  return w * w * (3 - 2 * w);
}


export function lfStarburst(du, dv, _points = LF_STAR_POINTS, _rot = LF_STAR_ROT) {
  const sdist = Math.hypot(du, dv);
  return 1.5 * Math.exp(-sdist * 18);
}


export function lfSourceWindow(u, v, sunU, sunV, aspect, r0 = LF_SRC_R0, r1 = LF_SRC_R1) {
  const d = Math.hypot((u - sunU) * aspect, v - sunV);
  const t = Math.min(1, Math.max(0, (d - r0) / Math.max(r1 - r0, 1e-6)));
  return 1 - t * t * (3 - 2 * t);
}


export function lfBrightWeight(br, threshold = LF_BRIGHT_THRESHOLD, knee = LF_BRIGHT_KNEE) {
  const t = Math.min(1, Math.max(0, (br - threshold) / Math.max(knee, 1e-6)));
  return t * t * (3 - 2 * t);
}


export function lfUnpackDepth(r, g, b, a) {
  const scale = 255 / 256;
  return (r / (256 * 256 * 256) + g / (256 * 256) + b / 256 + a) * scale;
}


export function lfOcclusionTaps(count = LF_OCC_TAPS) {
  const n = Math.max(1, count | 0);
  const golden = 2.399963229728653;
  const taps = [];
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt((i + 0.5) / n);
    const a = i * golden;
    taps.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return taps;
}


function glslFloat(x) {
  const s = String(x);
  return s.includes(".") || s.includes("e") || s.includes("E") ? s : s + ".0";
}


export function buildLfPrefilterGlsl() {
  return `
uniform sampler2D tDiffuse;
uniform float uThreshold;
uniform float uKnee;
uniform vec2 uSunPos;
uniform float uAspect;
uniform float uSrcR0;
uniform float uSrcR1;
varying vec2 vUv;
void main() {
  vec4 t = texture2D(tDiffuse, vUv);
  float br = max(t.r, max(t.g, t.b));
  float w = smoothstep(uThreshold, uThreshold + uKnee, br);
  float sd = length((vUv - uSunPos) * vec2(uAspect, 1.0));
  float win = 1.0 - smoothstep(uSrcR0, uSrcR1, sd);
  gl_FragColor = vec4(t.rgb * (w * win), 1.0);
}
`;
}


export function buildLfCompositeGlsl() {
  const occ = lfOcclusionTaps(LF_OCC_TAPS)
    .map((t) => `  vis += step(uOccFar, lfUnpackDepth(texture2D(tDepth, clamp(uSunPos + vec2(${glslFloat(t[0])}, ${glslFloat(t[1])}) * uOccRadius * vec2(1.0, uAspect), 0.0, 1.0))));`)
    .join("\n");
  return `
uniform sampler2D tDiffuse;
uniform sampler2D tBright;
uniform sampler2D tDepth;
uniform vec2 uSunPos;
uniform float uAspect;
uniform float uIntensity;
uniform float uSunVis;
uniform float uDispersal;
uniform float uHaloRadius;
uniform float uHaloWidth;
uniform float uHaloGain;
uniform float uStarPoints;
uniform float uStarRot;
uniform float uStarGain;
uniform float uOccRadius;
uniform float uOccFar;
uniform float uGhostOff[${LF_GHOST_SLOTS}];
uniform float uGhostW[${LF_GHOST_SLOTS}];
uniform vec3 uGhostTint[${LF_GHOST_SLOTS}];
varying vec2 vUv;

float lfUnpackDepth(vec4 v) {
  const vec4 unpackFactors = vec4(255.0 / (256.0 * 256.0 * 256.0 * 256.0), 255.0 / (256.0 * 256.0 * 256.0), 255.0 / (256.0 * 256.0), 255.0 / 256.0);
  return dot(v, unpackFactors);
}

void main() {
  vec4 base = texture2D(tDiffuse, vUv);
  float vis = 0.0;
${occ}
  vis *= ${glslFloat(1 / LF_OCC_TAPS)};
  float energy = uIntensity * uSunVis * vis;
  if (energy <= 0.0005) {
    gl_FragColor = base;
    return;
  }
  vec2 fuv = vec2(1.0) - vUv;
  vec2 gvec = (vec2(0.5) - fuv) * uDispersal;
  vec3 flare = vec3(0.0);
  for (int i = 0; i < ${LF_GHOST_SLOTS}; i++) {
    vec2 suv = fuv + gvec * uGhostOff[i];
    float w = pow(clamp(1.0 - length(suv - vec2(0.5)) / 0.75, 0.0, 1.0), 2.0);
    flare += texture2D(tBright, suv).rgb * uGhostTint[i] * (uGhostW[i] * w);
  }
  float glen = max(length(gvec), 1e-5);
  vec2 hdir = gvec / glen;
  float hd = length((vUv - vec2(0.5)) * vec2(uAspect, 1.0));
  float hw = clamp(1.0 - abs(hd - uHaloRadius) / uHaloWidth, 0.0, 1.0);
  hw = hw * hw * (3.0 - 2.0 * hw);
  flare += texture2D(tBright, fuv + hdir * uHaloRadius).rgb * (hw * uHaloGain);
  vec2 sd = (vUv - uSunPos) * vec2(uAspect, 1.0);
  float sdist = length(sd);
  float star = 1.5 * exp(-sdist * 18.0);
  flare += vec3(1.0, 0.95, 0.85) * (star * uStarGain);
  gl_FragColor = vec4(base.rgb + flare * energy, base.a);
}
`;
}


hardAssert(LF_GHOSTS.length === LF_GHOST_SLOTS, "tabela de ghosts difere dos slots compilados");
hardAssert(Math.abs(LF_GHOSTS.reduce((s, g) => s + g.weight, 0) - 1) < 1e-9, "pesos dos ghosts não somam 1 (energia)");
hardAssert(LF_GHOSTS.every((g) => Number.isFinite(g.offset) && g.tint.length === 3 && g.tint.every((c) => c >= 0 && c <= 1)), "ghost com offset/tinte inválido");
hardAssert(lfOcclusionTaps(LF_OCC_TAPS).every(([x, y]) => Math.hypot(x, y) <= 1 + 1e-9), "tap de oclusão fora do disco unitário");


hardAssert(LF_GHOSTS_LITE.length === 3 && LF_GHOSTS_LITE.length <= LF_GHOST_SLOTS, "tabela lite deve ter 3 ghosts (≤ slots compilados)");
hardAssert(Math.abs(LF_GHOSTS_LITE.reduce((s, g) => s + g.weight, 0) - 1) < 1e-9, "pesos do flare-lite não somam 1 (energia conservada)");
hardAssert(LF_GHOSTS_LITE.every((g) => g.weight > 0 && Number.isFinite(g.offset) && g.tint.length === 3 && g.tint.every((c) => c >= 0 && c <= 1)), "ghost-lite com offset/peso/tinte inválido");
