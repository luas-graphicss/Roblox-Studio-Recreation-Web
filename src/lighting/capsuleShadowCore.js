export const RSW_CAP_MAX = 64;                                              
export const RSW_CAP_MAX_RADIUS = 2;                                  
export const RSW_CAP_MAX_HALFLEN = 6;                                         
export const RSW_CAP_FADE = 15;                                           

const DEG = Math.PI / 180;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstepJs(edge0, edge1, x) {
  const t = clamp((x - edge0) / Math.max(edge1 - edge0, 1e-9), 0, 1);
  return t * t * (3 - 2 * t);
}


const LIMB_NAMES = Object.freeze([
  "Head",
  "Torso",
  "Left Arm",
  "Right Arm",
  "Left Leg",
  "Right Leg",
  "UpperTorso",
  "LowerTorso",
  "LeftUpperArm",
  "LeftLowerArm",
  "RightUpperArm",
  "RightLowerArm",
  "LeftUpperLeg",
  "LeftLowerLeg",
  "RightUpperLeg",
  "RightLowerLeg",
]);
const LIMB_SET = new Set(LIMB_NAMES);

export function isCapsuleLimbName(name) {
  return LIMB_SET.has(String(name));
}


export function quatFromXYZDeg(xDeg, yDeg, zDeg) {
  const hx = (num(xDeg) * DEG) / 2;
  const hy = (num(yDeg) * DEG) / 2;
  const hz = (num(zDeg) * DEG) / 2;
  if (!Number.isFinite(hx) || !Number.isFinite(hy) || !Number.isFinite(hz)) return null;
  const cx = Math.cos(hx);
  const sx = Math.sin(hx);
  const cy = Math.cos(hy);
  const sy = Math.sin(hy);
  const cz = Math.cos(hz);
  const sz = Math.sin(hz);
  return {
    x: sx * cy * cz + cx * sy * sz,
    y: cx * sy * cz - sx * cy * sz,
    z: cx * cy * sz + sx * sy * cz,
    w: cx * cy * cz - sx * sy * sz,
  };
}


export function rotateUnitY(q) {
  return {
    x: 2 * (q.x * q.y - q.w * q.z),
    y: 1 - 2 * (q.z * q.z + q.x * q.x),
    z: 2 * (q.y * q.z + q.w * q.x),
  };
}


export function capsuleFromPart(part) {
  if (!part || typeof part !== "object") return null;
  const pos = part.pos || {};
  const size = part.size || {};
  const rot = part.rotDeg || { x: 0, y: 0, z: 0 };
  const px = num(pos.x);
  const py = num(pos.y);
  const pz = num(pos.z);
  const sx = num(size.x);
  const sy = num(size.y);
  const sz = num(size.z);
  if (![px, py, pz, sx, sy, sz].every(Number.isFinite)) return null;
  const q = quatFromXYZDeg(rot.x || 0, rot.y || 0, rot.z || 0);
  if (!q) return null;
  const r = clamp(Math.min(Math.abs(sx), Math.abs(sz)) * 0.5, 0.05, RSW_CAP_MAX_RADIUS);
  const halfLen = clamp(Math.abs(sy) * 0.5 - r, 0, RSW_CAP_MAX_HALFLEN);
  const axis = rotateUnitY(q);
  return {
    ax: px - axis.x * halfLen,
    ay: py - axis.y * halfLen,
    az: pz - axis.z * halfLen,
    bx: px + axis.x * halfLen,
    by: py + axis.y * halfLen,
    bz: pz + axis.z * halfLen,
    r,
    w: 1,
  };
}


export function selectCapsules(caps, camPos, max) {
  if (!Array.isArray(caps)) return [];
  const m = clamp(Math.round(num(max)) || RSW_CAP_MAX, 1, RSW_CAP_MAX);
  const cx = num(camPos && camPos.x) || 0;
  const cy = num(camPos && camPos.y) || 0;
  const cz = num(camPos && camPos.z) || 0;
  const scored = [];
  for (const c of caps) {
    if (!c) continue;
    const mx = (c.ax + c.bx) * 0.5 - cx;
    const my = (c.ay + c.by) * 0.5 - cy;
    const mz = (c.az + c.bz) * 0.5 - cz;
    scored.push({ c, d2: mx * mx + my * my + mz * mz });
  }
  scored.sort((a, b) => a.d2 - b.d2);
  return scored.slice(0, m).map((s) => s.c);
}


export function segClosestToRayJs(ro, rd, a, b) {
  const oax = a.x - ro.x;
  const oay = a.y - ro.y;
  const oaz = a.z - ro.z;
  const bax = b.x - a.x;
  const bay = b.y - a.y;
  const baz = b.z - a.z;
  const oad = oax * rd.x + oay * rd.y + oaz * rd.z;
  const bad = bax * rd.x + bay * rd.y + baz * rd.z;
  const oPx = oax - oad * rd.x;
  const oPy = oay - oad * rd.y;
  const oPz = oaz - oad * rd.z;
  const bPx = bax - bad * rd.x;
  const bPy = bay - bad * rd.y;
  const bPz = baz - bad * rd.z;
  const denom = Math.max(bPx * bPx + bPy * bPy + bPz * bPz, 1e-6);
  const s = clamp(-(oPx * bPx + oPy * bPy + oPz * bPz) / denom, 0, 1);
  return { x: a.x + bax * s, y: a.y + bay * s, z: a.z + baz * s };
}




export function sphereShadowJs(ro, rd, ce, r, tanT, tMax, fade) {
  const ocx = ce.x - ro.x;
  const ocy = ce.y - ro.y;
  const ocz = ce.z - ro.z;
  const t = ocx * rd.x + ocy * rd.y + ocz * rd.z;
  if (t < 0.02 || t > tMax) return 1;
  const dx = ocx - t * rd.x;
  const dy = ocy - t * rd.y;
  const dz = ocz - t * rd.z;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const pen = r + t * tanT + 0.02;
  const x = clamp((d - r + pen) / (2 * pen), 0, 1);
  let occ = 1 - x * x * (3 - 2 * x);
  occ *= 1 - smoothstepJs(fade * 0.6, fade, t);
  return 1 - occ;
}


export function capsuleSunOccJs(p, sunDir, caps, tanT, fade) {
  let s = 1;
  const f = Number.isFinite(fade) ? fade : RSW_CAP_FADE;
  for (const c of caps) {
    if (!c) continue;
    const mx = (c.ax + c.bx) * 0.5;
    const my = (c.ay + c.by) * 0.5;
    const mz = (c.az + c.bz) * 0.5;
    const lx = c.bx - c.ax;
    const ly = c.by - c.ay;
    const lz = c.bz - c.az;
    const reach = f + c.r + 0.5 * Math.sqrt(lx * lx + ly * ly + lz * lz);
    const rx = p.x - mx;
    const ry = p.y - my;
    const rz = p.z - mz;
    if (rx * rx + ry * ry + rz * rz > reach * reach) continue;
    const ce = segClosestToRayJs(p, sunDir, { x: c.ax, y: c.ay, z: c.az }, { x: c.bx, y: c.by, z: c.bz });
    const sh = sphereShadowJs(p, sunDir, ce, c.r, tanT, f, f);
    s = Math.min(s, 1 + (sh - 1) * c.w);
  }
  return s;
}


export function capsuleAmbOccJs(p, n, caps, ambK, fade) {
  let k = 1;
  const f = Number.isFinite(fade) ? fade : RSW_CAP_FADE;
  const kk = Number.isFinite(ambK) ? ambK : 0.35;
  for (const c of caps) {
    if (!c) continue;
    const bax = c.bx - c.ax;
    const bay = c.by - c.ay;
    const baz = c.bz - c.az;
    const pax = p.x - c.ax;
    const pay = p.y - c.ay;
    const paz = p.z - c.az;
    const h = clamp((pax * bax + pay * bay + paz * baz) / Math.max(bax * bax + bay * bay + baz * baz, 1e-6), 0, 1);
    const dx = c.ax + bax * h - p.x;
    const dy = c.ay + bay * h - p.y;
    const dz = c.az + baz * h - p.z;
    const l2 = Math.max(dx * dx + dy * dy + dz * dz, 1e-4);
    const l = Math.sqrt(l2);
    if (l > c.r + f * 0.5) continue;
    const nd = Math.max((n.x * dx + n.y * dy + n.z * dz) / l, 0) * 0.75 + 0.25;
    const occ = nd * clamp((c.r * c.r) / l2, 0, 1) * c.w;
    k *= 1 - occ * kk;
  }
  return Math.max(k, 0.35);
}


export function buildCapsuleGlsl(opts) {
  const o = opts || {};
  let m = Number(o.maxCapsules);
  if (!Number.isFinite(m)) m = RSW_CAP_MAX;
  m = Math.max(1, Math.min(RSW_CAP_MAX, Math.round(m)));
  return [
    "",
    "// Parte 152: sombras de cápsula por membro (oclusão analítica).",
    "#define RSW_CAP_MAX " + m,
    "uniform float uRswCapOn;",
    "uniform int uRswCapCount;",
    "uniform vec4 uRswCapA[ RSW_CAP_MAX ];",
    "uniform vec4 uRswCapB[ RSW_CAP_MAX ];",
    "uniform vec3 uRswCapSunDir;",
    "uniform float uRswCapSunTan;",
    "uniform float uRswCapAmbK;",
    "uniform float uRswCapFade;",
    "vec3 rswCapSegToRay( const in vec3 ro, const in vec3 rd, const in vec3 a, const in vec3 b ) {",
    "  vec3 oa = a - ro;",
    "  vec3 ba = b - a;",
    "  vec3 oaP = oa - dot( oa, rd ) * rd;",
    "  vec3 baP = ba - dot( ba, rd ) * rd;",
    "  float s = clamp( -dot( oaP, baP ) / max( dot( baP, baP ), 1e-6 ), 0.0, 1.0 );",
    "  return a + ba * s;",
    "}",
    "float rswCapSphShadow( const in vec3 ro, const in vec3 rd, const in vec3 ce, const in float r, const in float tanT, const in float tMax ) {",
    "  vec3 oc = ce - ro;",
    "  float t = dot( oc, rd );",
    "  if ( t < 0.02 || t > tMax ) return 1.0;",
    "  float d = length( oc - t * rd );",
    "  float pen = r + t * tanT + 0.02;",
    "  float x = clamp( ( d - r + pen ) / ( 2.0 * pen ), 0.0, 1.0 );",
    "  float occ = 1.0 - x * x * ( 3.0 - 2.0 * x );",
    "  occ *= 1.0 - smoothstep( uRswCapFade * 0.6, uRswCapFade, t );",
    "  return 1.0 - occ;",
    "}",
    "float rswCapSunOcc( const in vec3 p ) {",
    "  float s = 1.0;",
    "  for ( int i = 0; i < RSW_CAP_MAX; i ++ ) {",
    "    if ( i >= uRswCapCount ) break;",
    "    vec4 capA = uRswCapA[ i ];",
    "    vec4 capB = uRswCapB[ i ];",
    "    vec3 mid = ( capA.xyz + capB.xyz ) * 0.5;",
    "    vec3 rel = p - mid;",
    "    float reach = uRswCapFade + capA.w + 0.5 * length( capB.xyz - capA.xyz );",
    "    if ( dot( rel, rel ) > reach * reach ) continue;",
    "    vec3 ce = rswCapSegToRay( p, uRswCapSunDir, capA.xyz, capB.xyz );",
    "    s = min( s, mix( 1.0, rswCapSphShadow( p, uRswCapSunDir, ce, capA.w, uRswCapSunTan, uRswCapFade ), capB.w ) );",
    "  }",
    "  return s;",
    "}",
    "float rswCapLocalOcc( const in vec3 p, const in vec3 lightPos ) {",
    "  vec3 toL = lightPos - p;",
    "  float dL = length( toL );",
    "  if ( dL < 1e-3 ) return 1.0;",
    "  vec3 rd = toL / dL;",
    "  float s = 1.0;",
    "  for ( int i = 0; i < RSW_CAP_MAX; i ++ ) {",
    "    if ( i >= uRswCapCount ) break;",
    "    vec4 capA = uRswCapA[ i ];",
    "    vec4 capB = uRswCapB[ i ];",
    "    vec3 mid = ( capA.xyz + capB.xyz ) * 0.5;",
    "    vec3 rel = p - mid;",
    "    float reach = uRswCapFade + capA.w + 0.5 * length( capB.xyz - capA.xyz );",
    "    if ( dot( rel, rel ) > reach * reach ) continue;",
    "    vec3 ce = rswCapSegToRay( p, rd, capA.xyz, capB.xyz );",
    "    s = min( s, mix( 1.0, rswCapSphShadow( p, rd, ce, capA.w, 0.08, min( dL - capA.w, uRswCapFade ) ), capB.w ) );",
    "  }",
    "  return s;",
    "}",
    "float rswCapAmbOcc( const in vec3 p, const in vec3 n ) {",
    "  float k = 1.0;",
    "  for ( int i = 0; i < RSW_CAP_MAX; i ++ ) {",
    "    if ( i >= uRswCapCount ) break;",
    "    vec4 capA = uRswCapA[ i ];",
    "    vec4 capB = uRswCapB[ i ];",
    "    vec3 ba = capB.xyz - capA.xyz;",
    "    vec3 pa = p - capA.xyz;",
    "    float h = clamp( dot( pa, ba ) / max( dot( ba, ba ), 1e-6 ), 0.0, 1.0 );",
    "    vec3 d = capA.xyz + ba * h - p;",
    "    float l2 = max( dot( d, d ), 1e-4 );",
    "    float l = sqrt( l2 );",
    "    if ( l > capA.w + uRswCapFade * 0.5 ) continue;",
    "    float nd = max( dot( n, d / l ), 0.0 ) * 0.75 + 0.25;",
    "    float occ = nd * clamp( capA.w * capA.w / l2, 0.0, 1.0 ) * capB.w;",
    "    k *= 1.0 - occ * uRswCapAmbK;",
    "  }",
    "  return max( k, 0.35 );",
    "}",
    "",
  ].join("\n");
}





export function patchLightsFragmentChunk(chunk) {
  const anchors = { geom: false, dir: false, point: false, spot: false, amb: false, hemi: false };
  if (typeof chunk !== "string" || chunk.length === 0) return { ok: false, text: "", anchors };
  const A_GEOM = "vec3 geometryNormal = normal;";
  const A_DIR = "getDirectionalLightInfo( directionalLight, directLight );";
  const A_POINT = "getPointLightInfo( pointLight, geometryPosition, directLight );";
  const A_SPOT = "getSpotLightInfo( spotLight, geometryPosition, directLight );";
  const A_AMB = "vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );";
  const A_HEMI = "irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );";
  anchors.geom = chunk.indexOf(A_GEOM) !== -1 && chunk.indexOf("geometryPosition") !== -1;
  anchors.dir = chunk.indexOf(A_DIR) !== -1;
  anchors.point = chunk.indexOf(A_POINT) !== -1;
  anchors.spot = chunk.indexOf(A_SPOT) !== -1;
  anchors.amb = chunk.indexOf(A_AMB) !== -1;
  anchors.hemi = chunk.indexOf(A_HEMI) !== -1;
  if (!anchors.geom || !anchors.dir) return { ok: false, text: chunk, anchors };
  let out = chunk.replace(
    A_GEOM,
    A_GEOM +
      "\n\tfloat rswCapSun = ( uRswCapOn > 0.5 ) ? rswCapSunOcc( geometryPosition ) : 1.0;" +
      "\n\tfloat rswCapAmb = ( uRswCapOn > 0.5 ) ? rswCapAmbOcc( geometryPosition, geometryNormal ) : 1.0;",
  );
  out = out.replace(A_DIR, A_DIR + "\n\t\tdirectLight.color *= rswCapSun;");
  if (anchors.point) {
    out = out.replace(
      A_POINT,
      A_POINT + "\n\t\tif ( uRswCapOn > 0.5 ) directLight.color *= rswCapLocalOcc( geometryPosition, pointLight.position );",
    );
  }
  if (anchors.spot) {
    out = out.replace(
      A_SPOT,
      A_SPOT + "\n\t\tif ( uRswCapOn > 0.5 ) directLight.color *= rswCapLocalOcc( geometryPosition, spotLight.position );",
    );
  }
  if (anchors.amb) {
    out = out.replace(A_AMB, "vec3 irradiance = getAmbientLightIrradiance( ambientLightColor ) * rswCapAmb;");
  }
  if (anchors.hemi) {
    out = out.replace(
      A_HEMI,
      "irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal ) * rswCapAmb;",
    );
  }
  return { ok: true, text: out, anchors };
}





export function blobForCapsules(caps) {
  if (!Array.isArray(caps) || caps.length === 0) return null;
  let sx = 0;
  let sz = 0;
  let n = 0;
  let feet = Infinity;
  for (const c of caps) {
    if (!c) continue;
    sx += (c.ax + c.bx) * 0.5;
    sz += (c.az + c.bz) * 0.5;
    feet = Math.min(feet, c.ay - c.r, c.by - c.r);
    n++;
  }
  if (n === 0 || !Number.isFinite(feet)) return null;
  const cx = sx / n;
  const cz = sz / n;
  let rad = 0;
  for (const c of caps) {
    if (!c) continue;
    rad = Math.max(
      rad,
      Math.hypot(c.ax - cx, c.az - cz) + c.r,
      Math.hypot(c.bx - cx, c.bz - cz) + c.r,
    );
  }
  return { cx, cz, feetY: feet, radius: clamp(rad * 0.9, 0.75, 4) };
}



export function blobFollowY(prevY, feetY, dtMs) {
  if (!Number.isFinite(prevY)) return feetY;
  if (feetY <= prevY) return feetY;
  const rate = 0.009 * clamp(Number(dtMs) || 0, 1, 200);
  return Math.min(prevY + rate, feetY);
}


export function blobOpacity(feetY, blobY, base) {
  const b = Number.isFinite(base) ? base : 0.45;
  const gap = clamp((num(feetY) - num(blobY)) / 6, 0, 1);
  return b * (1 - (Number.isFinite(gap) ? gap : 1));
}


export function areaShadowRadius(faceHalf) {
  const f = Number.isFinite(Number(faceHalf)) ? clamp(Number(faceHalf), 0, 8) : 0;
  return 1 + f * 0.9;
}
