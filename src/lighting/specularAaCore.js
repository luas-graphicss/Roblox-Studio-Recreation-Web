export const SPEC_AA_STR_DEFAULT = 0.25;                               
export const SPEC_AA_KERNEL_DEFAULT = 0.18;                                       


export const SPEC_MS_GGX_HEADER = "vec3 BRDF_GGX(";
export const SPEC_MS_GGX_RETURN = "return F * ( V * D );";
export const SPEC_AA_ROUGH_CLAMP = "material.roughness = min( material.roughness, 1.0 );";


export const SPEC_ANCHOR_PARS = "#include <lights_physical_pars_fragment>";
export const SPEC_ANCHOR_FRAG = "#include <lights_physical_fragment>";

function replaceOnce(hay, needle, repl) {
	const i = hay.indexOf(needle);
	return i === -1 ? hay : hay.slice(0, i) + repl + hay.slice(i + needle.length);
}

function clamp01(v) {
	const n = Number(v);
	if (!Number.isFinite(n)) return 0;
	return n < 0 ? 0 : n > 1 ? 1 : n;
}


export function buildSpecAaPars() {
	return [
		"// IL-F9: Specular AA (variância de tela) + multi-scatter GGX (uniform-driven).",
		"uniform float uRswSpecAaOn;",
		"uniform float uRswSpecAaStr;",
		"uniform float uRswSpecAaKernel;",
		"uniform float uRswSpecMsOn;",
		"vec3 rswSpecMsComp( const in vec3 rswF0, const in float rswRough ) {",
		"\tfloat rswEss = clamp( 1.0 - 0.55 * rswRough, 0.001, 1.0 );",
		"\treturn vec3( 1.0 ) + rswF0 * ( 1.0 / rswEss - 1.0 );",
		"}",
	].join("\n");
}


export function buildSpecAaFilterGlsl() {
	return [
		"{",
		"\t// IL-F9: filtro de variância em α² por cima do kernel geométrico do r161.",
		"\tvec3 rswSpecAaDx = dFdx( normal );",
		"\tvec3 rswSpecAaDy = dFdy( normal );",
		"\tfloat rswSpecAaVar = uRswSpecAaStr * ( dot( rswSpecAaDx, rswSpecAaDx ) + dot( rswSpecAaDy, rswSpecAaDy ) );",
		"\tfloat rswSpecAaKr = min( 2.0 * rswSpecAaVar, uRswSpecAaKernel );",
		"\tfloat rswSpecAaFilt = min( sqrt( material.roughness * material.roughness + rswSpecAaKr ), 1.0 );",
		"\tmaterial.roughness = mix( material.roughness, rswSpecAaFilt, uRswSpecAaOn );",
		"}",
	].join("\n");
}


export function patchSpecMsIntoGgx(text) {
	const src = String(text || "");
	const h = src.indexOf(SPEC_MS_GGX_HEADER);
	if (h === -1) return { ok: false, text: src, reason: "header ausente" };
	if (src.indexOf(SPEC_MS_GGX_HEADER, h + SPEC_MS_GGX_HEADER.length) !== -1) {
		return { ok: false, text: src, reason: "header duplicado" };
	}
	const r = src.indexOf(SPEC_MS_GGX_RETURN, h);
	if (r === -1) return { ok: false, text: src, reason: "return ausente" };
	const injected =
		"vec3 rswSpecSS = F * ( V * D );\n\t" +
		"return rswSpecSS * mix( vec3( 1.0 ), rswSpecMsComp( material.specularColor, material.roughness ), uRswSpecMsOn );";
	return {
		ok: true,
		text: src.slice(0, r) + injected + src.slice(r + SPEC_MS_GGX_RETURN.length),
	};
}


export function patchSpecAaIntoPhysical(text) {
	const src = String(text || "");
	const i = src.indexOf(SPEC_AA_ROUGH_CLAMP);
	if (i === -1) return { ok: false, text: src, reason: "clamp ausente" };
	if (src.indexOf(SPEC_AA_ROUGH_CLAMP, i + SPEC_AA_ROUGH_CLAMP.length) !== -1) {
		return { ok: false, text: src, reason: "clamp duplicado" };
	}
	const at = i + SPEC_AA_ROUGH_CLAMP.length;
	return { ok: true, text: src.slice(0, at) + "\n" + buildSpecAaFilterGlsl() + src.slice(at) };
}


export function specMsEss(rough) {
	const e = 1 - 0.55 * clamp01(rough);
	return e < 0.001 ? 0.001 : e > 1 ? 1 : e;
}


export function specMsDfgEssFull(rough, dotNV) {
	const r = clamp01(rough);
	const nv = clamp01(dotNV);
	const rx = -1 * r + 1;
	const ry = -0.0275 * r + 0.0425;
	const rz = -0.572 * r + 1.04;
	const rw = 0.022 * r + -0.04;
	const a004 = Math.min(rx * rx, Math.pow(2, -9.28 * nv)) * rx + ry;
	const fx = -1.04 * a004 + rz;
	const fy = 1.04 * a004 + rw;
	return fx + fy;
}


export function specMsCompensation(f0, rough) {
	return 1 + clamp01(f0) * (1 / specMsEss(rough) - 1);
}


export function specAaFilteredRoughness(rough, varSum, opts) {
	const o = opts && typeof opts === "object" ? opts : {};
	const r = clamp01(rough);
	const strength = Math.max(0, Number(o.strength !== undefined ? o.strength : SPEC_AA_STR_DEFAULT) || 0);
	const kernel = Math.min(1, Math.max(0, Number(o.kernel !== undefined ? o.kernel : SPEC_AA_KERNEL_DEFAULT) || 0));
	const on = o.on === undefined ? 1 : o.on ? 1 : 0;
	const v = strength * Math.max(0, Number(varSum) || 0);
	const kr = Math.min(2 * v, kernel);
	const filt = Math.min(Math.sqrt(r * r + kr), 1);
	return r + (filt - r) * on;
}


export function createSpecularAaPatcher(args) {
	const a = args && typeof args === "object" ? args : {};
	const parsPatched = patchSpecMsIntoGgx(a.parsChunk);
	const physPatched = patchSpecAaIntoPhysical(a.physicalChunk);
	const supported = parsPatched.ok && physPatched.ok;
	let generation = 0;
	let patchedCount = 0;
	let neutralCount = 0;                                                                                      
	const uniforms = {
		uRswSpecAaOn: { value: 0 },
		uRswSpecAaStr: { value: SPEC_AA_STR_DEFAULT },
		uRswSpecAaKernel: { value: SPEC_AA_KERNEL_DEFAULT },
		uRswSpecMsOn: { value: 0 },
	};

	function patchMaterial(mat) {
		if (!supported || !mat) return;
		if (!mat.userData) mat.userData = {};
		if (mat.userData.__rswSpecAA) return;                                       
		mat.userData.__rswSpecAA = true;
		patchedCount++;
		const prevCb = mat.onBeforeCompile;
		const prevKey = mat.customProgramCacheKey;
		mat.onBeforeCompile = function (shader, renderer) {
			if (typeof prevCb === "function") prevCb.call(this, shader, renderer);
			shader.uniforms.uRswSpecAaOn = uniforms.uRswSpecAaOn;
			shader.uniforms.uRswSpecAaStr = uniforms.uRswSpecAaStr;
			shader.uniforms.uRswSpecAaKernel = uniforms.uRswSpecAaKernel;
			shader.uniforms.uRswSpecMsOn = uniforms.uRswSpecMsOn;
			let frag = shader.fragmentShader;
			if (frag.indexOf("rswSpecMsComp") !== -1) return;               
			if (frag.indexOf(SPEC_ANCHOR_PARS) !== -1) {
				frag = replaceOnce(frag, SPEC_ANCHOR_PARS, parsPatched.text);
			} else {
				const res = patchSpecMsIntoGgx(frag);
				if (!res.ok) {
					neutralCount++;                                                              
					return;
				}
				frag = res.text;
			}
			if (frag.indexOf(SPEC_ANCHOR_FRAG) !== -1) {
				frag = replaceOnce(frag, SPEC_ANCHOR_FRAG, physPatched.text);
			} else {
				const res = patchSpecAaIntoPhysical(frag);
				if (!res.ok) {
					neutralCount++;                                                                 
					return;
				}
				frag = res.text;
			}
			shader.fragmentShader = buildSpecAaPars() + "\n" + frag;
		};
		mat.customProgramCacheKey = function () {
			const prev = typeof prevKey === "function" ? prevKey.call(this) : "";
			return prev + "|rswSpecAa1g" + generation;
		};
		mat.needsUpdate = true;
	}


	function configure(opts) {
		const o = opts && typeof opts === "object" ? opts : {};
		if (typeof o.on === "boolean") {
			uniforms.uRswSpecAaOn.value = o.on ? 1 : 0;
			uniforms.uRswSpecMsOn.value = o.on ? 1 : 0;
		}
		if (typeof o.aa === "boolean") uniforms.uRswSpecAaOn.value = o.aa ? 1 : 0;
		if (typeof o.ms === "boolean") uniforms.uRswSpecMsOn.value = o.ms ? 1 : 0;
		const st = Number(o.strength);
		if (Number.isFinite(st)) uniforms.uRswSpecAaStr.value = Math.min(4, Math.max(0, st));
		const k = Number(o.kernel);
		if (Number.isFinite(k)) uniforms.uRswSpecAaKernel.value = Math.min(1, Math.max(0, k));
		return getState();
	}

	function bumpGeneration() {
		generation++;
	}

	function getState() {
		return {
			supported,
			parsOk: parsPatched.ok,
			fragOk: physPatched.ok,
			aaOn: uniforms.uRswSpecAaOn.value > 0.5,
			msOn: uniforms.uRswSpecMsOn.value > 0.5,
			strength: uniforms.uRswSpecAaStr.value,
			kernel: uniforms.uRswSpecAaKernel.value,
			generation,
			patched: patchedCount,
			neutral: neutralCount,
		};
	}

	return { supported, uniforms, patchMaterial, configure, bumpGeneration, getState };
}
