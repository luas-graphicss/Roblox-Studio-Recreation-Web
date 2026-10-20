export const TRANS_MIN_TRANSPARENCY = 0.05;
export const TRANS_MAX_TRANSPARENCY = 0.95;
export const TRANS_RT_SIZE = 1024;
export const TRANS_MAX_PROXIES = 128;


export const TRANS_DEPTH_EPS = 0.006;


const GLASS_OPACITY = Object.freeze({ Glass: 0.45, Ice: 0.85, Glacier: 0.95 });

export function isGlassMaterialName(name) {
  return Object.prototype.hasOwnProperty.call(GLASS_OPACITY, String(name || ""));
}

export function glassBaseOpacity(name) {
  return isGlassMaterialName(name) ? GLASS_OPACITY[String(name)] : 1;
}


export function transparencyFromPoolAlpha(alpha, materialName) {
  const base = glassBaseOpacity(materialName);
  if (!(base > 0)) return 1;
  const a = Math.min(base, Math.max(0, Number(alpha) || 0));
  return 1 - a / base;
}

export function isTransmitterTransparency(t) {
  return t >= TRANS_MIN_TRANSPARENCY && t <= TRANS_MAX_TRANSPARENCY;
}


export function transmitterTint(color, transparency) {
  const t = Math.min(1, Math.max(0, Number(transparency) || 0));
  const a = 1 - t;
  const c = color || {};
  const cr = Number(c.r !== undefined ? c.r : c[0]) || 0;
  const cg = Number(c.g !== undefined ? c.g : c[1]) || 0;
  const cb = Number(c.b !== undefined ? c.b : c[2]) || 0;
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  return [
    1 - a * (1 - clamp01(cr)),
    1 - a * (1 - clamp01(cg)),
    1 - a * (1 - clamp01(cb)),
  ];
}


export function ditherKeep(x, y, shift, alpha) {
  const sx = Array.isArray(shift) ? Number(shift[0]) || 0 : Number(shift) || 0;
  const sy = Array.isArray(shift) ? Number(shift[1]) || 0 : Number(shift) || 0;
  const a = Math.min(1, Math.max(0, Number(alpha) || 0));
  return ignAt((Number(x) || 0) + sx, (Number(y) || 0) + sy) < a;
}


export function ignAt(x, y) {
  const f = (v) => v - Math.floor(v);
  return f(52.9829189 * f(x * 0.06711056 + y * 0.00583715));
}


export function ditherShiftForFrame(frame) {
  const f = Math.max(0, (Number(frame) || 0) % 64);
  return [f * 5.588238, f * 5.588238];
}


export function buildTransmitterVert() {
  return [
    "void main() {",
    "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
    "}",
  ].join("\n");
}

export function buildTransmitterFrag() {
  return [
    "precision highp float;",
    "uniform vec3 uRswTint;",
    "void main() {",
    "  gl_FragColor = vec4(uRswTint, gl_FragCoord.z);",
    "}",
  ].join("\n");
}


export function buildTransmissionPars() {
  return [
    "uniform sampler2D uRswTransMap;",
    "uniform mat4 uRswTransMatrix;",
    "uniform float uRswTransOn;",
    "varying vec3 vRswTransPos;",
    "vec3 rswTransTint(const in vec3 wp) {",
    "  if (uRswTransOn < 0.5) return vec3(1.0);",
    "  vec4 q = uRswTransMatrix * vec4(wp, 1.0);",
    "  if (q.x <= 0.001 || q.x >= 0.999 || q.y <= 0.001 || q.y >= 0.999) return vec3(1.0);",
    "  vec4 smp = texture2D(uRswTransMap, q.xy);",
    "  if (smp.a >= 0.999) return vec3(1.0);",
    "  if (q.z <= smp.a + " + TRANS_DEPTH_EPS.toFixed(4) + ") return vec3(1.0);",
    "  return smp.rgb;",
    "}",
  ].join("\n");
}


export function buildTransmissionVertex() {
  return [
    "#include <worldpos_vertex>",
    "#ifdef USE_INSTANCING",
    "\tvRswTransPos = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;",
    "#else",
    "\tvRswTransPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;",
    "#endif",
  ].join("\n");
}

export const TRANS_DIR_ANCHOR = "( directionalShadowMap";


export function patchTransIntoLightsBegin(text) {
  const src = String(text || "");
  const first = src.indexOf(TRANS_DIR_ANCHOR);
  if (first === -1) return { ok: false, reason: "ancora ausente", patched: src, text: src };
  if (src.indexOf(TRANS_DIR_ANCHOR, first + 1) !== -1)
    return { ok: false, reason: "ancora duplicada", patched: src, text: src };
  const end = src.indexOf(";", first);
  if (end === -1) return { ok: false, reason: "statement sem ponto-e-virgula", patched: src, text: src };
  const insert =
    "\n\t\tdirectLight.color *= ( directLight.visible && receiveShadow ) ? rswTransTint( vRswTransPos ) : vec3( 1.0 );";
  const out = src.slice(0, end + 1) + insert + src.slice(end + 1);


  return { ok: true, patched: out, text: out };
}


export function buildDitherGlsl() {
  return [
    "varying float vRswDA;",
    "uniform vec2 uRswDitherShift;",
    "float rswDitherIgn(const in vec2 px) {",
    "  return fract(52.9829189 * fract(px.x * 0.06711056 + px.y * 0.00583715));",
    "}",
  ].join("\n");
}

export const DITHER_FRAG_ANCHOR = "#include <clipping_planes_fragment>";
export const DITHER_DISCARD =
  "\n\tif (rswDitherIgn(gl_FragCoord.xy + uRswDitherShift) >= vRswDA) discard;";
