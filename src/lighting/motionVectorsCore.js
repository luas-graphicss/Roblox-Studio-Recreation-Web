function num(v, fb) {
	return typeof v === "number" && Number.isFinite(v) ? v : fb;
}

function clamp(v, lo, hi) {
	return v < lo ? lo : v > hi ? hi : v;
}

export const MV_VERSION = "mv-13a";


export const MV_MAX_UV = 0.25;


export const DISOCC_BUY_MIN = 4;
export const DISOCC_BUY_MAX = 6;


export function mvDimsFor(w, h) {
	const w0 = Math.max(1, Math.round(num(w, 1)));
	const h0 = Math.max(1, Math.round(num(h, 1)));
	return { w: Math.max(1, Math.round(w0 / 2)), h: Math.max(1, Math.round(h0 / 2)) };
}


export function velEncode(vx, vy) {
	const ex = clamp(num(vx, 0), -MV_MAX_UV, MV_MAX_UV) / (2 * MV_MAX_UV) + 0.5;
	const ey = clamp(num(vy, 0), -MV_MAX_UV, MV_MAX_UV) / (2 * MV_MAX_UV) + 0.5;
	return [ex, ey];
}


export const MV_DEAD_ZONE_ENC = 0.6 / 255;

export function velDecode(r, g) {
	let ex = clamp(num(r, 0.5), 0, 1) - 0.5;
	let ey = clamp(num(g, 0.5), 0, 1) - 0.5;
	if (Math.abs(ex) <= MV_DEAD_ZONE_ENC) ex = 0;
	if (Math.abs(ey) <= MV_DEAD_ZONE_ENC) ey = 0;
	return [ex * (2 * MV_MAX_UV), ey * (2 * MV_MAX_UV)];
}


export function prevUvWithVelocity(uv, vel) {
	const u = Array.isArray(uv) ? uv : [0.5, 0.5];
	const v = Array.isArray(vel) ? vel : [0, 0];
	return [num(u[0], 0.5) - num(v[0], 0), num(u[1], 0.5) - num(v[1], 0)];
}


export function disoccBuyTaps(baseTaps, rej, buyTaps) {
	const base = Math.max(0, num(baseTaps, 0));
	const r = clamp(num(rej, 0), 0, 1);
	const buy = clamp(Math.round(num(buyTaps, 5)), DISOCC_BUY_MIN, DISOCC_BUY_MAX);
	return base + Math.round(r * buy);
}


export function buildDisoccBuyGlsl() {
	return [
		"// Fase 13: disocclusion buying — taps extras só onde a história foi",
		"// rejeitada (pendência formal da Fase 8).",
		"uniform float uRswDisoccBuy;",
		"float rswDisoccBuy(const in float baseTaps, const in float rej) {",
		"  return baseTaps + clamp(rej, 0.0, 1.0) * clamp(uRswDisoccBuy, " + DISOCC_BUY_MIN + ".0, " + DISOCC_BUY_MAX + ".0);",
		"}",
	].join("\n");
}


export function buildVelocityVertexGlsl() {
	return [
		"uniform mat4 uMvPrevViewProj;",
		"uniform mat4 uMvPrevModel;",
		"varying vec4 vMvCur;",
		"varying vec4 vMvPrev;",
		"void main() {",
		"  vec4 rswWp = modelMatrix * vec4(position, 1.0);",
		"  vMvCur = projectionMatrix * viewMatrix * rswWp;",
		"  vMvPrev = uMvPrevViewProj * (uMvPrevModel * vec4(position, 1.0));",
		"  gl_Position = vMvCur;",
		"}",
	].join("\n");
}


export function buildVelocityFragmentGlsl() {
	return [
		"varying vec4 vMvCur;",
		"varying vec4 vMvPrev;",
		"void main() {",
		"  // w atual degenerado OU w anterior NÃO-POSITIVO: atrás da câmera no",
		"  // frame passado projeta INVERTIDO (abs() antigo aceitava e virava",
		"  // velocidade lixo 'válida' => rastro ao cruzar o near plane).",
		"  if (vMvCur.w <= 1e-6 || vMvPrev.w <= 1e-6) {",
		"    gl_FragColor = vec4(0.5, 0.5, 0.0, 0.0);",
		"    return;",
		"  }",
		"  vec2 rswA = (vMvCur.xy / vMvCur.w) * 0.5 + 0.5;",
		"  vec2 rswB = (vMvPrev.xy / vMvPrev.w) * 0.5 + 0.5;",
		"  vec2 rswV = clamp(rswA - rswB, vec2(-" + MV_MAX_UV + "), vec2(" + MV_MAX_UV + "));",
		"  gl_FragColor = vec4(rswV / (2.0 * " + MV_MAX_UV + ") + 0.5, 0.0, 1.0);",
		"}",
	].join("\n");
}


export function buildTemporalVelocityGlsl() {
	return [
		"uniform sampler2D tCurrent;",
		"uniform sampler2D tHistory;",
		"uniform sampler2D tDepth;",
		"uniform sampler2D tVelocity;",
		"uniform mat4 uInvViewProj;",
		"uniform mat4 uPrevViewProj;",
		"uniform vec2 uTexel;",
		"uniform float uAlpha;",
		"uniform float uHistoryValid;",
		"uniform float uMvOn;",
		"uniform float uByteEnc;",
		"uniform float uByteRange;",
		"// F15-r2 (paridade com a casa — rev F13-r2): 0 = alpha do frame atual",
		"// CRU (legado byte a byte); 1 = alpha ACUMULADO com o MESMO rswA do rgb.",
		"uniform float uTemporalAlpha;",
		"varying vec2 vUv;",
		"float rswMvUnpackDepth(const in vec4 v) {",
		"  const vec4 f = vec4(255.0 / (256.0 * 16777216.0), 255.0 / (256.0 * 65536.0), 255.0 / (256.0 * 256.0), 255.0 / 256.0);",
		"  return dot(v, f);",
		"}",
		"vec3 rswMvDecodeHist(const in vec3 h) {",
		"  return mix(h, h * h * uByteRange, uByteEnc);",
		"}",
		"vec4 rswMvOut(const in vec4 c) {",
		"  vec3 e = sqrt(clamp(c.rgb, vec3(0.0), vec3(uByteRange)) / uByteRange);",
		"  return vec4(mix(c.rgb, e, uByteEnc), c.a);",
		"}",
		"// Zona morta de quantização (espelho 1:1 de velDecode/MV_DEAD_ZONE_ENC):",
		"// 0.5 não existe em UNORM8 — parado grava 127|128 e sem isto a cena",
		"// estática ganharia ~1,9 px/frame de deriva falsa com validade 1.",
		"vec2 rswMvVel(const in vec4 mv) {",
		"  vec2 rswE = mv.rg - 0.5;",


		"  if (abs(rswE.x) <= " + MV_DEAD_ZONE_ENC + ") rswE.x = 0.0;",
		"  if (abs(rswE.y) <= " + MV_DEAD_ZONE_ENC + ") rswE.y = 0.0;",
		"  return rswE * (2.0 * " + MV_MAX_UV + ");",
		"}",
		"void main() {",
		"  vec4 cur = texture2D(tCurrent, vUv);",
		"  if (uHistoryValid < 0.5 || uAlpha >= 0.999) {",
		"    gl_FragColor = rswMvOut(cur);",
		"    return;",
		"  }",
		"  vec2 prevUv = vUv;",
		"  float rswUsedMv = 0.0;",
		"  if (uMvOn > 0.5) {",
		"    vec4 rswMv = texture2D(tVelocity, vUv);",
		"    if (rswMv.a > 0.5) {",
		"      prevUv = vUv - rswMvVel(rswMv);",
		"      rswUsedMv = 1.0;",
		"    }",
		"  }",
		"  if (rswUsedMv < 0.5) {",
		"    float d = rswMvUnpackDepth(texture2D(tDepth, vUv));",
		"    vec4 ndc = vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);",
		"    vec4 wp = uInvViewProj * ndc;",
		"    if (abs(wp.w) < 1e-8) {",
		"      gl_FragColor = rswMvOut(cur);",
		"      return;",
		"    }",
		"    vec4 pc = uPrevViewProj * vec4(wp.xyz / wp.w, 1.0);",
		"    if (pc.w <= 1e-6) {",
		"      gl_FragColor = rswMvOut(cur);",
		"      return;",
		"    }",
		"    prevUv = (pc.xy / pc.w) * 0.5 + 0.5;",
		"  }",
		"  if (prevUv.x < 0.0 || prevUv.x > 1.0 || prevUv.y < 0.0 || prevUv.y > 1.0) {",
		"    gl_FragColor = rswMvOut(cur);",
		"    return;",
		"  }",
		"  float rswVel = length((prevUv - vUv) / uTexel);",
		"  float rswA = max(uAlpha, min(0.6, rswVel * 0.3));",
		"  if (rswUsedMv > 0.5) rswA = uAlpha;",
		"  vec3 nMin = cur.rgb;",
		"  vec3 nMax = cur.rgb;",
		"  float aMin = cur.a;",
		"  float aMax = cur.a;",
		"  for (int dy = -1; dy <= 1; dy++) {",
		"    for (int dx = -1; dx <= 1; dx++) {",
		"      if (dx == 0 && dy == 0) continue;",
		"      vec4 s4 = texture2D(tCurrent, vUv + vec2(float(dx), float(dy)) * uTexel);",
		"      vec3 s = s4.rgb;",
		"      nMin = min(nMin, s);",
		"      nMax = max(nMax, s);",
		"      aMin = min(aMin, s4.a);",
		"      aMax = max(aMax, s4.a);",
		"    }",
		"  }",
		"  vec3 hist = clamp(rswMvDecodeHist(texture2D(tHistory, prevUv).rgb), nMin, nMax);",
		"  float histA = clamp(texture2D(tHistory, prevUv).a, aMin, aMax);",
		"  float outA = mix(cur.a, mix(histA, cur.a, rswA), uTemporalAlpha);",
		"  gl_FragColor = rswMvOut(vec4(mix(hist, cur.rgb, rswA), outA));",
		"}",
	].join("\n");
}
