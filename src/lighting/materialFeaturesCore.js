export const MATFEAT_KEY_TAG = "|rswMF";


export function cacheKeySuffix(generation) {
	return MATFEAT_KEY_TAG + (generation | 0);
}


export function resolveMatFeatFlag(value, ctx) {
	if (value === true) return true;
	if (value === false) return false;
	const c = ctx || {};
	return c.realistic === true && c.weak !== true;
}


export const MATFEAT_PARS_GLSL = [
	"// IL-F11 (rsw): lobos físicos de material — uniforms compartilhados + por material",
	"uniform float uRswMFOn;",
	"uniform vec3 uRswMFSunDirW;",
	"uniform vec3 uRswMFSunColor;",
	"uniform float uRswMFAmb;",
	"uniform vec4 uRswMFA;",                                      
	"uniform vec4 uRswMFB;",                                   
	"uniform vec3 uRswMFTint;",                
].join("\n");


export function buildMatFeatCodeGlsl() {
	return [
		"// IL-F11 (rsw): coat/aniso/sheen/SSS por uniform (1 programa por base)",
		"if (uRswMFOn > 0.5 && (uRswMFA.x + uRswMFA.z + uRswMFB.x + uRswMFB.z) > 0.001) {",
		"\tvec3 rswMfN = geometryNormal;",
		"\tvec3 rswMfV = geometryViewDir;",
		"\tvec3 rswMfL = normalize((viewMatrix * vec4(uRswMFSunDirW, 0.0)).xyz + vec3(1e-6));",
		"\tfloat rswMfRawNdL = dot(rswMfN, rswMfL);",
		"\tfloat rswMfNdL = saturate(rswMfRawNdL);",
		"\tfloat rswMfNdV = saturate(dot(rswMfN, rswMfV));",
		"\tvec3 rswMfH = normalize(rswMfL + rswMfV + vec3(1e-5));",
		"\tfloat rswMfNdH = saturate(dot(rswMfN, rswMfH));",
		"\tfloat rswMfVdH = saturate(dot(rswMfV, rswMfH));",
		"\tfloat rswMfSunLum = dot(uRswMFSunColor, vec3(0.2126, 0.7152, 0.0722));",
		"\tfloat rswMfDifLum = dot(reflectedLight.directDiffuse, vec3(0.2126, 0.7152, 0.0722));",
		"\tfloat rswMfAlbLum = max(dot(material.diffuseColor, vec3(0.2126, 0.7152, 0.0722)), 1e-3);",
		"\tfloat rswMfShadow = clamp(rswMfDifLum / max(rswMfAlbLum * rswMfSunLum * rswMfNdL * 0.3183098, 1e-4), 0.0, 1.0);",
		"\tvec3 rswMfSun = uRswMFSunColor * rswMfShadow;",
		"\t// Revisao IL-F11: boost do IBL fora do gate NdL (indireta nao depende",
		"\t// do sol; o gate antigo criava emenda visivel no terminador: lado claro",
		"\t// com verniz ambiente, lado em sombra sem nada).",
		"\tif (uRswMFA.x > 0.001) {",
		"\t\tfloat rswMfCoatFv = 0.04 + 0.96 * pow(1.0 - rswMfNdV, 5.0);",
		"\t\treflectedLight.indirectSpecular *= (1.0 + uRswMFA.x * rswMfCoatFv * 0.8);",
		"\t\tif (rswMfNdL > 0.0) {",
		"\t\t\tfloat rswMfCa = max(uRswMFA.y * uRswMFA.y, 1e-3);",
		"\t\t\tfloat rswMfCa2 = rswMfCa * rswMfCa;",
		"\t\t\tfloat rswMfCd = rswMfNdH * rswMfNdH * (rswMfCa2 - 1.0) + 1.0;",
		"\t\t\tfloat rswMfCoatD = rswMfCa2 / (3.14159265 * rswMfCd * rswMfCd + 1e-5);",
		"\t\t\tfloat rswMfCoatF = 0.04 + 0.96 * pow(1.0 - rswMfVdH, 5.0);",
		"\t\t\treflectedLight.directSpecular += rswMfSun * (rswMfNdL * rswMfCoatD * rswMfCoatF * 0.25 * uRswMFA.x);",
		"\t\t}",
		"\t}",
		"\tif (uRswMFA.z > 0.001 && rswMfNdL > 0.0) {",
		"\t\t// Revisao IL-F11: up do MUNDO em espaco de view (w=0 => so rotacao).",
		"\t\t// Up fixo de view ancorava o frame tangente na CAMERA e o brilho do",
		"\t\t// metal escovado girava com a orbita/roll da camera.",
		"\t\tvec3 rswMfUpW = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz + vec3(1e-6));",
		"\t\tvec3 rswMfSideW = normalize((viewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz + vec3(1e-6));",
		"\t\tvec3 rswMfUp = abs(dot(rswMfN, rswMfUpW)) < 0.92 ? rswMfUpW : rswMfSideW;",
		"\t\tvec3 rswMfT = normalize(cross(rswMfUp, rswMfN) + vec3(1e-6));",
		"\t\tvec3 rswMfBt = cross(rswMfN, rswMfT);",
		"\t\tfloat rswMfAr = max(uRswMFA.w * uRswMFA.w, 4e-3);",
		"\t\tfloat rswMfAx = max(rswMfAr * (1.0 + uRswMFA.z * 3.0), 1e-3);",
		"\t\tfloat rswMfAy = max(rswMfAr * (1.0 - uRswMFA.z * 0.75), 1e-3);",
		"\t\tfloat rswMfTh = dot(rswMfT, rswMfH) / rswMfAx;",
		"\t\tfloat rswMfBh = dot(rswMfBt, rswMfH) / rswMfAy;",
		"\t\tfloat rswMfAd = rswMfTh * rswMfTh + rswMfBh * rswMfBh + rswMfNdH * rswMfNdH;",
		"\t\tfloat rswMfAnisoD = 1.0 / (3.14159265 * rswMfAx * rswMfAy * rswMfAd * rswMfAd + 1e-4);",
		"\t\tfloat rswMfAnisoF = 0.08 + 0.92 * pow(1.0 - rswMfVdH, 5.0);",
		"\t\treflectedLight.directSpecular += rswMfSun * material.specularColor * (rswMfNdL * rswMfAnisoD * rswMfAnisoF * 0.25);",
		"\t}",
		"\tif (uRswMFB.x > 0.001) {",
		"\t\tfloat rswMfSr = max(uRswMFB.y, 0.07);",
		"\t\tfloat rswMfSin2 = max(1.0 - rswMfNdH * rswMfNdH, 1e-4);",
		"\t\tfloat rswMfSheenD = (2.0 + 1.0 / rswMfSr) * pow(rswMfSin2, 0.5 / rswMfSr) / 6.2831853;",
		"\t\tvec3 rswMfSheenCol = mix(vec3(1.0), material.diffuseColor, 0.6);",
		"\t\treflectedLight.directSpecular += rswMfSun * rswMfSheenCol * (rswMfNdL * rswMfSheenD * 0.12 * uRswMFB.x);",
		"\t\tfloat rswMfRim = pow(1.0 - rswMfNdV, 3.0);",
		"\t\treflectedLight.indirectDiffuse += material.diffuseColor * (rswMfRim * uRswMFB.x * uRswMFAmb * 0.5);",
		"\t}",
		"\tif (uRswMFB.z > 0.001) {",
		"\t\tfloat rswMfW = uRswMFB.z * 0.6;",
		"\t\tfloat rswMfWrap = saturate((rswMfRawNdL + rswMfW) / (1.0 + rswMfW));",
		"\t\tfloat rswMfExtra = max(rswMfWrap - rswMfNdL, 0.0);",
		"\t\tfloat rswMfSssShadow = mix(1.0, rswMfShadow, smoothstep(0.05, 0.25, rswMfNdL));",
		"\t\treflectedLight.directDiffuse += uRswMFSunColor * rswMfSssShadow * uRswMFTint * material.diffuseColor * (rswMfExtra * 0.3183098);",
		"\t\tfloat rswMfBack = pow(saturate(dot(rswMfV, -normalize(rswMfL + rswMfN * 0.35))), 3.0) * uRswMFB.w;",
		"\t\treflectedLight.directDiffuse += uRswMFSunColor * rswMfSssShadow * uRswMFTint * (rswMfBack * 0.15 * 0.3183098);",
		"\t}",
		"}",
	].join("\n");
}




export function patchMatFeatFragment(fragmentShader) {
	const text = String(fragmentShader == null ? "" : fragmentShader);
	const PARS_ANCHOR = "#include <lights_pars_begin>";
	const CODE_ANCHOR = "#include <lights_fragment_end>";
	if (text.indexOf("uRswMFOn") !== -1) return { ok: false, text };
	if (text.indexOf(PARS_ANCHOR) === -1 || text.indexOf(CODE_ANCHOR) === -1) {
		return { ok: false, text };
	}
	const out = text
		.replace(PARS_ANCHOR, MATFEAT_PARS_GLSL + "\n" + PARS_ANCHOR)
		.replace(CODE_ANCHOR, CODE_ANCHOR + "\n" + buildMatFeatCodeGlsl());
	return { ok: true, text: out };
}


export function uniformValuesFor(features) {
	const f = features || {};
	const n = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
	const clamp01 = (v) => Math.min(1, Math.max(0, v));
	const rough = (v, d) => Math.min(1, Math.max(0.03, n(v, d)));
	const tint = Array.isArray(f.sssTint) && f.sssTint.length === 3 ? f.sssTint : [1, 1, 1];
	return {
		a: [clamp01(n(f.coat, 0)), rough(f.coatRough, 0.15), clamp01(n(f.aniso, 0)), rough(f.anisoRough, 0.4)],
		b: [clamp01(n(f.sheen, 0)), rough(f.sheenRough, 0.4), clamp01(n(f.sss, 0)), clamp01(n(f.sssBack, 0))],
		tint: [n(tint[0], 1), n(tint[1], 1), n(tint[2], 1)],
	};
}





const PI = 3.14159265;
const sat = (v) => Math.min(1, Math.max(0, v));

export function coatDJs(ndh, coatRough) {
	const a = Math.max(coatRough * coatRough, 1e-3);
	const a2 = a * a;
	const d = sat(ndh) * sat(ndh) * (a2 - 1) + 1;
	return a2 / (PI * d * d + 1e-5);
}

export function anisoAxAyJs(aniso, anisoRough) {
	const ar = Math.max(anisoRough * anisoRough, 4e-3);
	return {
		ax: Math.max(ar * (1 + sat(aniso) * 3), 1e-3),
		ay: Math.max(ar * (1 - sat(aniso) * 0.75), 1e-3),
	};
}

export function anisoDJs(th, bh, ndh, ax, ay) {
	const x = th / Math.max(ax, 1e-6);
	const y = bh / Math.max(ay, 1e-6);
	const d = x * x + y * y + sat(ndh) * sat(ndh);
	return 1 / (PI * ax * ay * d * d + 1e-4);
}

export function sheenDJs(ndh, sheenRough) {
	const r = Math.max(sheenRough, 0.07);
	const sin2 = Math.max(1 - sat(ndh) * sat(ndh), 1e-4);
	return ((2 + 1 / r) * Math.pow(sin2, 0.5 / r)) / (2 * PI);
}

export function sssWrapExtraJs(rawNdl, sss) {
	const w = sat(sss) * 0.6;
	const wrapped = sat((rawNdl + w) / (1 + w));
	return Math.max(wrapped - sat(rawNdl), 0);
}

export function shadowProxyJs(difLum, albLum, sunLum, ndl) {
	const expected = Math.max(Math.max(albLum, 1e-3) * sunLum * sat(ndl) * 0.3183098, 1e-4);
	return Math.min(1, Math.max(0, difLum / expected));
}
