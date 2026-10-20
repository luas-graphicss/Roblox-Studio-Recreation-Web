export const RSW_IESCK_CELL = 128;                     
export const RSW_IESCK_GRID = 4;               
export const RSW_IESCK_ATLAS = 512;           
export const RSW_IESCK_SLOTS = 16;                               
export const RSW_IESCK_MAX_SPOT = 8;                                    
export const RSW_IESCK_MAX_POINT = 8;


export function parseIesText(text) {
  var src = typeof text === "string" ? text : "";
  if (!src || !src.trim()) return { ok: false, error: "arquivo .ies vazio" };
  var lines = src.split(/\r\n|\r|\n/);
  var ti = -1;
  for (var i = 0; i < lines.length; i++) {
    if (/^\s*TILT\s*=/i.test(lines[i])) { ti = i; break; }
  }
  if (ti === -1) return { ok: false, error: "LM-63 sem linha TILT=" };
  var tilt = String(lines[ti].split("=")[1] || "").trim().toUpperCase();
  if (tilt !== "NONE") return { ok: false, error: "TILT=" + tilt + " não suportado (só TILT=NONE)" };
  var nums = [];
  var re = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  for (var j = ti + 1; j < lines.length; j++) {
    var mm = lines[j].match(re);
    if (mm) for (var k = 0; k < mm.length; k++) nums.push(parseFloat(mm[k]));
  }
  if (nums.length < 13) return { ok: false, error: "cabeçalho fotométrico incompleto" };
  var nV = Math.round(nums[3]);
  var nH = Math.round(nums[4]);
  var photometricType = Math.round(nums[5]);
  if (!(nV >= 2 && nV <= 999) || !(nH >= 1 && nH <= 999)) {
    return { ok: false, error: "contagem de ângulos inválida (" + nV + "×" + nH + ")" };
  }
  var base = 13;                                           
  var need = base + nV + nH + nV * nH;
  if (nums.length < need) return { ok: false, error: "faltam valores (" + nums.length + "/" + need + ")" };
  var vAngles = nums.slice(base, base + nV);
  var hAngles = nums.slice(base + nV, base + nV + nH);
  for (var s = 1; s < nV; s++) {
    if (!(vAngles[s] > vAngles[s - 1])) return { ok: false, error: "ângulos verticais fora de ordem" };
  }
  var candela = nums.slice(base + nV + nH, need);
  var maxC = 0;
  for (var c = 0; c < candela.length; c++) if (candela[c] > maxC) maxC = candela[c];
  if (!(maxC > 0)) return { ok: false, error: "todas as candelas são zero" };
  return { ok: true, nV: nV, nH: nH, vAngles: vAngles, hAngles: hAngles, candela: candela, maxCandela: maxC, photometricType: photometricType };
}


export function sampleIesProfile(profile, vDeg, hDeg) {
  var vA = profile.vAngles, hA = profile.hAngles;
  var nV = profile.nV, nH = profile.nH;
  if (vDeg < vA[0] - 1e-9 || vDeg > vA[nV - 1] + 1e-9) return 0;
  var h = hDeg;
  var hMax = hA[nH - 1] || 0;
  if (nH === 1 || hMax === 0) {
    h = hA[0] || 0;
  } else {
    h = ((h % 360) + 360) % 360;
    if (hMax === 90) { if (h > 180) h = 360 - h; if (h > 90) h = 180 - h; }
    else if (hMax === 180) { if (h > 180) h = 360 - h; }
    if (h < hA[0]) h = hA[0];
    if (h > hMax) h = hMax;
  }
  var v = Math.min(Math.max(vDeg, vA[0]), vA[nV - 1]);
  var vi = 0;
  for (var i = 1; i < nV; i++) { if (vA[i] <= v) vi = i; else break; }
  var vj = Math.min(vi + 1, nV - 1);
  var vt = vj === vi ? 0 : (v - vA[vi]) / (vA[vj] - vA[vi]);
  var hi = 0;
  for (var q = 1; q < nH; q++) { if (hA[q] <= h) hi = q; else break; }
  var hj = Math.min(hi + 1, nH - 1);
  var ht = hj === hi ? 0 : (h - hA[hi]) / (hA[hj] - hA[hi]);
  var cd = profile.candela;
  var a = cd[hi * nV + vi], b = cd[hi * nV + vj];
  var c = cd[hj * nV + vi], d = cd[hj * nV + vj];
  return (a * (1 - vt) + b * vt) * (1 - ht) + (c * (1 - vt) + d * vt) * ht;
}


export function iesProfileToCell(profile) {
  var CELL = 128;
  var cell = new Uint8Array(CELL * CELL);
  var inv = profile.maxCandela > 0 ? 1 / profile.maxCandela : 0;
  for (var y = 0; y < CELL; y++) {
    var hDeg = ((y + 0.5) / CELL) * 360;
    for (var x = 0; x < CELL; x++) {
      var vDeg = ((x + 0.5) / CELL) * 180;
      var f = sampleIesProfile(profile, vDeg, hDeg) * inv;
      if (f < 0) f = 0; else if (f > 1) f = 1;
      cell[y * CELL + x] = Math.round(f * 255);
    }
  }
  return cell;
}


export const RSW_IES_PRESETS = Object.freeze(["downlight", "spotnarrow", "street", "wallwash"]);

export function iesPresetProfile(name) {
  var n = String(name || "").trim().toLowerCase();
  var vAngles = [], hAngles = [0], candela = [];
  var i, h, v;
  if (n === "downlight") {
    for (v = 0; v <= 90; v += 5) vAngles.push(v);
    for (i = 0; i < vAngles.length; i++) {
      candela.push(1000 * Math.pow(Math.max(0, Math.cos((vAngles[i] * Math.PI) / 180)), 1.5));
    }
  } else if (n === "spotnarrow") {
    for (v = 0; v <= 40; v += 2) vAngles.push(v);
    for (i = 0; i < vAngles.length; i++) {
      candela.push(1000 * Math.exp(-Math.pow(vAngles[i] / 12, 2)));
    }
  } else if (n === "street") {

    hAngles = []; for (h = 0; h <= 360; h += 15) hAngles.push(h);
    for (v = 0; v <= 90; v += 5) vAngles.push(v);
    for (var hh = 0; hh < hAngles.length; hh++) {
      var road = 0.35 + 0.65 * Math.pow(Math.abs(Math.cos((hAngles[hh] * Math.PI) / 180)), 1.2);
      for (i = 0; i < vAngles.length; i++) {
        var vv = vAngles[i];
        var wing = Math.exp(-Math.pow((vv - 62) / 16, 2)) * road;
        var bowl = 0.25 * Math.exp(-Math.pow(vv / 30, 2));
        candela.push(1000 * Math.min(1, wing + bowl) * (vv > 78 ? Math.max(0, 1 - (vv - 78) / 10) : 1));
      }
    }
  } else if (n === "wallwash") {
    hAngles = []; for (h = 0; h <= 360; h += 30) hAngles.push(h);
    for (v = 0; v <= 90; v += 5) vAngles.push(v);
    for (var h2 = 0; h2 < hAngles.length; h2++) {
      var side = 0.25 + 0.75 * Math.max(0, Math.cos((hAngles[h2] * Math.PI) / 180));
      for (i = 0; i < vAngles.length; i++) {
        candela.push(1000 * Math.exp(-Math.pow((vAngles[i] - 40) / 22, 2)) * side);
      }
    }
  } else {
    return { ok: false, error: "preset IES desconhecido: " + n };
  }
  var maxC = 0;
  for (i = 0; i < candela.length; i++) if (candela[i] > maxC) maxC = candela[i];
  return { ok: true, nV: vAngles.length, nH: hAngles.length, vAngles: vAngles, hAngles: hAngles, candela: candela, maxCandela: maxC, photometricType: 1, preset: n };
}


export const RSW_COOKIE_PRESETS = Object.freeze(["window", "blinds", "foliage", "grid"]);

export function cookiePresetCell(name) {
  var n = String(name || "").trim().toLowerCase();
  var CELL = 128;
  var cell = new Uint8Array(CELL * CELL);
  var x, y, v;
  if (n === "window") {
    for (y = 0; y < CELL; y++) {
      for (x = 0; x < CELL; x++) {
        var inPaneX = (x >= 14 && x <= 58) || (x >= 70 && x <= 114);
        var inPaneY = (y >= 14 && y <= 58) || (y >= 70 && y <= 114);
        cell[y * CELL + x] = inPaneX && inPaneY ? 245 : 18;
      }
    }
  } else if (n === "blinds") {
    for (y = 0; y < CELL; y++) {
      var m = y % 26;
      v = m < 16 ? 240 : m < 19 ? 120 : 22;                              
      for (x = 0; x < CELL; x++) cell[y * CELL + x] = v;
    }
  } else if (n === "foliage") {
    for (y = 0; y < CELL; y++) {
      for (x = 0; x < CELL; x++) {
        var s = Math.sin(x * 0.23 + Math.sin(y * 0.171) * 2.7) * Math.cos(y * 0.19 + Math.sin(x * 0.117) * 3.1);
        var t = Math.sin((x + y) * 0.061 + 1.3) * 0.5;
        var f = s + t;
        cell[y * CELL + x] = f > 0.55 ? 235 : f > 0.15 ? 140 : 28;
      }
    }
  } else if (n === "grid") {
    for (y = 0; y < CELL; y++) {
      for (x = 0; x < CELL; x++) {
        var gx = x % 32, gy = y % 32;
        cell[y * CELL + x] = gx >= 6 && gy >= 6 ? 240 : 15;
      }
    }
  } else {
    return null;
  }
  return cell;
}

export function neutralCell() {
  var cell = new Uint8Array(RSW_IESCK_CELL * RSW_IESCK_CELL);
  cell.fill(255);
  return cell;
}


export function sanitizeIesProfileRef(v) {
  return typeof v === "string" ? v.trim().slice(0, 256) : "";
}

export function sanitizeLightFunctionRef(v) {
  return typeof v === "string" ? v.trim().slice(0, 256) : "";
}

export function sanitizeCookieRotationDeg(v) {
  var n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return ((n % 360) + 360) % 360;
}

export function flagsForIesCookie(hasIes, hasCookie) {
  return (hasIes ? 1 : 0) + (hasCookie ? 2 : 0);
}






export function predictLightOrder(lights) {
  var arr = [];
  for (var i = 0; i < lights.length; i++) {
    var L = lights[i];
    if (!L || L.visible === false) continue;
    if (L.type !== "spot" && L.type !== "point") continue;
    arr.push(L);
  }
  arr.sort(function (a, b) {
    return ((b.castShadow ? 2 : 0) - (a.castShadow ? 2 : 0)) + ((b.hasMap ? 1 : 0) - (a.hasMap ? 1 : 0));
  });
  var spotIds = [], pointIds = [];
  for (var j = 0; j < arr.length; j++) {
    (arr[j].type === "spot" ? spotIds : pointIds).push(arr[j].id);
  }
  return { spotIds: spotIds, pointIds: pointIds };
}


export function atlasCellRect(slot) {
  var s = Math.max(0, Math.min(RSW_IESCK_SLOTS - 1, slot | 0));
  return { x0: (s % RSW_IESCK_GRID) * RSW_IESCK_CELL, y0: Math.floor(s / RSW_IESCK_GRID) * RSW_IESCK_CELL };
}


export function sampleCellBilinear(cell, u, v) {
  var cu = Math.min(Math.max(u, 0), 1) * 126 + 0.5;
  var cv = Math.min(Math.max(v, 0), 1) * 126 + 0.5;
  var x0 = Math.floor(cu), y0 = Math.floor(cv);
  var fx = cu - x0, fy = cv - y0;
  var x1 = Math.min(x0 + 1, 127), y1 = Math.min(y0 + 1, 127);
  var a = cell[y0 * 128 + x0], b = cell[y0 * 128 + x1];
  var c = cell[y1 * 128 + x0], d = cell[y1 * 128 + x1];
  return ((a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy) / 255;
}

function v3(x, y, z) { return [x, y, z]; }
function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross3(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norm3(a) {
  var l = Math.sqrt(dot3(a, a)) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}



export function spotFactorJs(opts) {
  var flags = opts.flags | 0;
  if (flags <= 0) return 1;
  var axis = norm3(opts.axis);
  var L = norm3(v3(opts.fragPos[0] - opts.lightPos[0], opts.fragPos[1] - opts.lightPos[1], opts.fragPos[2] - opts.lightPos[2]));
  var ct = Math.min(1, Math.max(-1, dot3(L, axis)));
  var wantCk = flags >= 2;
  var wantIes = flags === 1 || flags === 3;
  var f = 1;


  var upAxis = opts.upAxis || v3(0, 1, 0);
  var xAxis = opts.xAxis || v3(1, 0, 0);
  var up = Math.abs(dot3(axis, upAxis)) > 0.94 ? xAxis : upAxis;
  var T = norm3(cross3(up, axis));
  var B = cross3(axis, T);
  if (wantIes) {
    var ang = Math.acos(ct) / Math.PI;
    var ph = 0.5;
    if (opts.ies2d) {
      ph = Math.atan2(dot3(L, B), dot3(L, T)) / (2 * Math.PI) + 0.5;
      ph -= Math.floor(ph);
    }
    f *= sampleCellBilinear(opts.iesCell, ang, ph);
  }
  if (wantCk) {
    var dz = Math.max(ct, 0.0001);
    var px = dot3(L, T) / (dz * Math.max(opts.tanOuter, 0.0001));
    var py = dot3(L, B) / (dz * Math.max(opts.tanOuter, 0.0001));
    var cr = Math.cos(opts.rotRad || 0), sr = Math.sin(opts.rotRad || 0);
    var rx = (px * cr - py * sr) * Math.max(opts.scale || 1, 0.0001);
    var ry = (px * sr + py * cr) * Math.max(opts.scale || 1, 0.0001);
    f *= sampleCellBilinear(opts.ckCell, rx * 0.5 + 0.5, ry * 0.5 + 0.5);
  }
  return f;
}


export function buildIesCookieGlsl() {
  return [
    "// IL-F26: perfis IES + light functions (cookies) — atlas 4x4 (1 unit).",
    "// Revisão IL-F26: uRswIesCkV* = eixos do MUNDO em view space (colunas da",
    "// rotação da viewMatrix). Sem eles o frame T/B nascia de constantes em",
    "// VIEW space e o cookie/azimute IES girava junto com a câmera (bug real).",
    "uniform float uRswIesCkOn;",
    "uniform sampler2D uRswIesCkAtlas;",
    "uniform vec3 uRswIesCkVUp;",
    "uniform vec3 uRswIesCkVX;",
    "uniform vec3 uRswIesCkVZ;",
    "uniform vec4 uRswIesCkSpotA[ 8 ];",
    "uniform vec4 uRswIesCkSpotB[ 8 ];",
    "uniform vec4 uRswIesCkPointA[ 8 ];",
    "uniform vec4 uRswIesCkPointB[ 8 ];",
    "float rswIesCkCell( float slot, vec2 uv ) {",
    "\tvec2 cellUv = clamp( uv, 0.0, 1.0 ) * 0.24609375 + 0.001953125;",
    "\tvec2 base = vec2( mod( slot, 4.0 ), floor( slot * 0.25 ) ) * 0.25;",
    "\treturn texture2D( uRswIesCkAtlas, base + cellUv ).r;",
    "}",
    "float rswIesCkSpot( vec4 a, vec4 b, vec3 lightPos, vec3 spotDir, vec3 fragPos ) {",
    "\tif ( a.w < 0.5 ) return 1.0;",
    "\tvec3 axis = normalize( -spotDir );",
    "\tvec3 L = normalize( fragPos - lightPos );",
    "\tfloat ct = clamp( dot( L, axis ), -1.0, 1.0 );",
    "\tfloat f = 1.0;",
    "\tvec3 T = vec3( 1.0, 0.0, 0.0 );",
    "\tvec3 B2 = vec3( 0.0, 0.0, 1.0 );",
    "\tbool wantCk = a.w > 1.5;",
    "\tbool wantIes = a.w < 1.5 || a.w > 2.5;",
    "\tif ( wantCk || b.w > 0.5 ) {",
    "\t\tvec3 up = abs( dot( axis, uRswIesCkVUp ) ) > 0.94 ? uRswIesCkVX : uRswIesCkVUp;",
    "\t\tT = normalize( cross( up, axis ) );",
    "\t\tB2 = cross( axis, T );",
    "\t}",
    "\tif ( wantIes ) {",
    "\t\tfloat ang = acos( ct ) * 0.31830988;",
    "\t\tfloat ph = 0.5;",
    "\t\tif ( b.w > 0.5 ) ph = fract( atan( dot( L, B2 ), dot( L, T ) ) * 0.15915494 + 0.5 );",
    "\t\tf *= rswIesCkCell( a.x, vec2( ang, ph ) );",
    "\t}",
    "\tif ( wantCk ) {",
    "\t\tfloat dz = max( ct, 0.0001 );",
    "\t\tvec2 pr = vec2( dot( L, T ), dot( L, B2 ) ) / ( dz * max( a.z, 0.0001 ) );",
    "\t\tpr = vec2( pr.x * b.x - pr.y * b.y, pr.x * b.y + pr.y * b.x ) * max( b.z, 0.0001 );",
    "\t\tf *= rswIesCkCell( a.y, pr * 0.5 + 0.5 );",
    "\t}",
    "\treturn f;",
    "}",
    "float rswIesCkPoint( vec4 a, vec4 b, vec3 lightPos, vec3 fragPos ) {",
    "\tif ( a.y < 0.5 ) return 1.0;",
    "\tvec3 axis = normalize( a.z * uRswIesCkVX + a.w * uRswIesCkVUp + b.x * uRswIesCkVZ );",
    "\tvec3 L = normalize( fragPos - lightPos );",
    "\tfloat ang = acos( clamp( dot( L, axis ), -1.0, 1.0 ) ) * 0.31830988;",
    "\treturn rswIesCkCell( a.x, vec2( ang, 0.5 ) );",
    "}",
    "",
  ].join("\n");
}


export const RSW_IESCK_ANCHOR_SPOT = "getSpotLightInfo( spotLight, geometryPosition, directLight );";
export const RSW_IESCK_ANCHOR_POINT = "getPointLightInfo( pointLight, geometryPosition, directLight );";


var IDX_SPOT = "( UNROLLED_LOOP_INDEX < 8 ? UNROLLED_LOOP_INDEX : 7 )";

var SPOT_INJECT =
  "\n\t\tif ( uRswIesCkOn > 0.5 && UNROLLED_LOOP_INDEX < 8 ) directLight.color *= rswIesCkSpot( uRswIesCkSpotA[ " + IDX_SPOT + " ], uRswIesCkSpotB[ " + IDX_SPOT + " ], spotLight.position, spotLight.direction, geometryPosition ); // IL-F26";
var POINT_INJECT =
  "\n\t\tif ( uRswIesCkOn > 0.5 && UNROLLED_LOOP_INDEX < 8 ) directLight.color *= rswIesCkPoint( uRswIesCkPointA[ " + IDX_SPOT + " ], uRswIesCkPointB[ " + IDX_SPOT + " ], pointLight.position, geometryPosition ); // IL-F26";

function countOcc(hay, needle) {
  var n = 0, i = 0;
  for (;;) {
    var f = hay.indexOf(needle, i);
    if (f === -1) break;
    n++;
    i = f + needle.length;
  }
  return n;
}




export function patchLightsFragmentForIesCookie(chunkText) {
  var src = typeof chunkText === "string" ? chunkText : "";
  var anchors = { spot: countOcc(src, RSW_IESCK_ANCHOR_SPOT), point: countOcc(src, RSW_IESCK_ANCHOR_POINT) };
  if (src.indexOf("rswIesCkSpot(") !== -1) return { ok: true, anchors: anchors, text: src, already: true };
  if (anchors.spot !== 1 || anchors.point > 1) return { ok: false, anchors: anchors, text: src };
  var out = src.replace(RSW_IESCK_ANCHOR_SPOT, RSW_IESCK_ANCHOR_SPOT + SPOT_INJECT);
  if (anchors.point === 1) out = out.replace(RSW_IESCK_ANCHOR_POINT, RSW_IESCK_ANCHOR_POINT + POINT_INJECT);
  return { ok: true, anchors: anchors, text: out };
}
