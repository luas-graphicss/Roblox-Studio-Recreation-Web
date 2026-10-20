import { PCSS_MAX_FILTER_UV, PCSS_MAX_SEARCH_UV } from "./pcssCore.js";

function num(v, fb) {
	return typeof v === "number" && Number.isFinite(v) ? v : fb;
}

function clamp(v, lo, hi) {
	return v < lo ? lo : v > hi ? hi : v;
}

export const SMRT_VERSION = "smrt-13a";


export const SMRT_STEPS_MIN = 4;
export const SMRT_STEPS_MAX = 8;


export const SMRT_MAX_RANGE_UV = PCSS_MAX_SEARCH_UV;
export const SMRT_MAX_FILTER_UV = PCSS_MAX_FILTER_UV;


export const SMRT_GOLDEN_ANGLE = 2.39996323;


export const SMRT_ZSPAN_MIN = 0.02;
export const SMRT_ZSPAN_MAX = 0.3;


export const SMRT_TIERS = Object.freeze(["high", "ultra"]);

export function smrtStepsForTier(tier) {
	if (tier === "ultra") return SMRT_STEPS_MAX;
	if (tier === "high") return SMRT_STEPS_MIN;
	return 0;
}


export function smrtEligible(args) {
	const a = args && typeof args === "object" ? args : {};
	if (SMRT_TIERS.indexOf(a.tier) === -1) return false;
	if (a.samplerType !== undefined && a.samplerType !== "sampler2D") return false;
	return true;
}


export function smrtRangeUv(tan, scale, zReceiver, capK, texelUv) {
	const t = Math.max(0, num(tan, 0));
	const s = Math.max(0, num(scale, 0));
	const z = clamp(num(zReceiver, 0), 0, 1);
	const k = Math.max(0, num(capK, 1));
	const tx = Math.max(1e-6, num(texelUv, 1 / 2048));
	return clamp(t * s * z, tx, SMRT_MAX_RANGE_UV * k);
}


export function smrtZSpan(rangeUv, tan, scale) {
	const r = Math.max(0, num(rangeUv, 0));
	const d = Math.max(1e-6, num(tan, 0) * num(scale, 0));
	return clamp(r / d, SMRT_ZSPAN_MIN, SMRT_ZSPAN_MAX);
}


export function smrtStepT(i, steps) {
	const n = clamp(Math.round(num(steps, SMRT_STEPS_MIN)), SMRT_STEPS_MIN, SMRT_STEPS_MAX);
	const idx = clamp(Math.floor(num(i, 0)), 0, n - 1);
	const t = (idx + 1) / n;
	return t * t;
}


export function smrtOccluderSearchJs(args) {
	const a = args && typeof args === "object" ? args : {};
	const depthAt = typeof a.depthAt === "function" ? a.depthAt : () => 1;
	const uv = Array.isArray(a.uv) ? a.uv : [0.5, 0.5];
	const z = clamp(num(a.zReceiver, 0.5), 0, 1);
	const steps = clamp(Math.round(num(a.steps, SMRT_STEPS_MIN)), SMRT_STEPS_MIN, SMRT_STEPS_MAX);
	const range = smrtRangeUv(a.tan, a.scale, z, a.capK, a.texelUv);
	const span = smrtZSpan(range, a.tan, a.scale);
	const ang = num(a.angle, 0);
	const bias = typeof a.planeBias === "function" ? a.planeBias : () => 0;
	let occDepth = -1;
	let firstHitT = -1;
	for (let i = 0; i < steps; i++) {
		const t = smrtStepT(i, steps);
		const az = ang + i * SMRT_GOLDEN_ANGLE;
		const off = [Math.cos(az) * t * range, Math.sin(az) * t * range];
		const zRay = z - t * span + bias(off);
		const d = num(depthAt(uv[0] + off[0], uv[1] + off[1]), 1);
		if (d < zRay) {
			if (firstHitT < 0) firstHitT = t;
			if (d > occDepth) occDepth = d;
		}
	}
	return { occDepth, firstHitT, range, span, hit: occDepth >= 0 };
}


export function smrtFilterRadiusUv(tan, scale, zReceiver, occDepth, capK, texelUv) {
	const t = Math.max(0, num(tan, 0));
	const s = Math.max(0, num(scale, 0));
	const z = clamp(num(zReceiver, 0), 0, 1);
	const o = clamp(num(occDepth, 0), 0, 1);
	const k = Math.max(0, num(capK, 1));
	const tx = Math.max(1e-6, num(texelUv, 1 / 2048));
	return clamp(t * s * Math.max(0, z - o), tx, SMRT_MAX_FILTER_UV * k);
}


export function buildSmrtGlsl() {
	return (
		"// Fase 13 (fatia A): SMRT-lite — ray march no mapa, history-free.\n" +
		"// Sem uniform de frame do PCSS em NENHUM caminho: rotação IGN espacial pura —\n" +
		"// penumbra idêntica com câmera parada ou em órbita (aceite da fase).\n" +
		"uniform float uRswSmrtOn;\n" +
		"uniform float uRswSmrtSteps;\n" +
		"#define RSW_SMRT_MAX " + SMRT_STEPS_MAX + "\n" +
		"void rswSmrtInitDisk(const in vec2 seed) {\n" +
		"  float rswN = rswPcssTapCount();\n" +
		"  float angleStep = PI2 * float(RSW_PCSS_RINGS) / rswN;\n" +
		"  float invSamples = 1.0 / rswN;\n" +
		"  float angle = rswIgn(gl_FragCoord.xy) * PI2;\n" +
		"  float radius = invSamples;\n" +
		"  float radiusStep = radius;\n" +
		"  for (int i = 0; i < RSW_PCSS_SAMPLES; i++) {\n" +
		"    if (float(i) >= uRswPcssTaps) { rswPcssDisk[i] = vec2(0.0); continue; }\n" +
		"    rswPcssDisk[i] = vec2(cos(angle), sin(angle)) * pow(radius, 0.75);\n" +
		"    radius += radiusStep;\n" +
		"    angle += angleStep;\n" +
		"  }\n" +
		"}\n" +
		"float rswSmrtVis(sampler2D shadowMap, const in vec2 uv, const in float zReceiver, const in float rswScale, const in float rswCapK, const in vec2 rswDzDuv) {\n" +
		"  float rswTexelUv = 1.0 / max(float(textureSize(shadowMap, 0).x), 1.0);\n" +
		"  float rswRange = clamp(uRswPcssTan * rswScale * zReceiver, rswTexelUv, " + SMRT_MAX_RANGE_UV + " * rswCapK);\n" +
		"  float rswZSpan = clamp(rswRange / max(uRswPcssTan * rswScale, 1e-6), " + SMRT_ZSPAN_MIN + ", " + SMRT_ZSPAN_MAX + ");\n" +
		"  float rswAng = rswIgn(gl_FragCoord.xy) * PI2;\n" +
		"  float rswN = clamp(uRswSmrtSteps, " + SMRT_STEPS_MIN + ".0, float(RSW_SMRT_MAX));\n" +
		"  float rswOccD = -1.0;\n" +
		"  for (int i = 0; i < RSW_SMRT_MAX; i++) {\n" +
		"    if (float(i) >= rswN) break;\n" +
		"    float rswT = (float(i) + 1.0) / rswN;\n" +
		"    rswT *= rswT;\n" +
		"    float rswAzim = rswAng + float(i) * " + SMRT_GOLDEN_ANGLE + ";\n" +
		"    vec2 rswOff = vec2(cos(rswAzim), sin(rswAzim)) * (rswT * rswRange);\n" +
		"    float rswZRay = zReceiver - rswT * rswZSpan + rswPlaneBias(rswDzDuv, rswOff);\n" +
		"    float rswD = rswUnpackDepth(texture2D(shadowMap, uv + rswOff));\n" +
		"    if (rswD < rswZRay) rswOccD = max(rswOccD, rswD);\n" +
		"  }\n" +
		"  if (rswOccD < 0.0) return 1.0;\n" +
		"  float rswFilterR = clamp(uRswPcssTan * rswScale * max(zReceiver - rswOccD, 0.0), rswTexelUv, " + SMRT_MAX_FILTER_UV + " * rswCapK);\n" +
		"  rswSmrtInitDisk(uv);\n" +
		"  return rswPcssFilter(shadowMap, uv, zReceiver, rswFilterR, rswDzDuv, rswTexelUv);\n" +
		"}\n"
	);
}


export const SMRT_ANCHOR_FN =
	"float rswPcssScaled(sampler2D shadowMap, float shadowBias, vec4 sc, const in float rswScale, const in float rswCapK) {";
export const SMRT_ANCHOR_CALL = "  rswPcssInitDisk(uv);";
export const SMRT_BRANCH =
	"  if (uRswSmrtOn > 0.5) return rswSmrtVis(shadowMap, uv, zReceiver, rswScale, rswCapK, rswDzDuv);\n";


export function injectSmrtIntoPcss(pcssGlsl) {
	if (typeof pcssGlsl !== "string" || pcssGlsl.length === 0) {
		return { ok: false, glsl: pcssGlsl };
	}
	if (pcssGlsl.indexOf("rswSmrtVis") !== -1) return { ok: true, glsl: pcssGlsl };
	const fnIdx = pcssGlsl.indexOf(SMRT_ANCHOR_FN);
	const callIdx = pcssGlsl.indexOf(SMRT_ANCHOR_CALL);
	if (fnIdx === -1 || callIdx === -1 || callIdx < fnIdx) {
		return { ok: false, glsl: pcssGlsl };
	}
	if (pcssGlsl.indexOf(SMRT_ANCHOR_CALL, callIdx + SMRT_ANCHOR_CALL.length) !== -1) {
		return { ok: false, glsl: pcssGlsl };
	}
	let out = pcssGlsl.slice(0, fnIdx) + buildSmrtGlsl() + pcssGlsl.slice(fnIdx);
	const callIdx2 = out.indexOf(SMRT_ANCHOR_CALL);
	out = out.slice(0, callIdx2) + SMRT_BRANCH + out.slice(callIdx2);
	return { ok: true, glsl: out };
}
