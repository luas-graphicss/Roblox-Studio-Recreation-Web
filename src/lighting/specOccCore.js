export const SPEC_OCC_STR_DEFAULT = 1;                          
export const SPEC_OCC_BENTK_DEFAULT = 0.5;                                 
export const SPEC_OCC_AO_EPS = 1e-3;                                
export const SPEC_OCC_POW_EPS = 1e-5;                                     


export const SPEC_OCC_ANCHOR_END = "#include <lights_fragment_end>";
export const SPEC_OCC_END_SIG = "#if defined( RE_IndirectSpecular )";
export const SPEC_OCC_MARKER = "rswSpecOccApply";

function clamp01(v) {
	const n = Number(v);
	if (!Number.isFinite(n)) return 0;
	return n < 0 ? 0 : n > 1 ? 1 : n;
}


export function sanitizeSpecOccSettings(raw) {
	const o = raw && typeof raw === "object" ? raw : {};
	const st = Number(o.strength);
	const bk = Number(o.bentK);
	return {
		strength: Number.isFinite(st) ? clamp01(st) : SPEC_OCC_STR_DEFAULT,
		bentK: Number.isFinite(bk) ? clamp01(bk) : SPEC_OCC_BENTK_DEFAULT,
	};
}


export function specOccGate(args) {
	const a = args && typeof args === "object" ? args : {};
	if (a.flag === false) return false;
	if (a.flag === true) return true;
	if (!a.realistic || !a.aoOn) return false;
	if (a.smLite === true) return true;                                    
	return !!a.tierGtao && !a.aoLite && !a.weak;
}


export function specOccConeJs(noV, ao, rough) {
	const nv = clamp01(noV);
	const a = clamp01(ao);
	const r = clamp01(rough);
	const e = Math.pow(2, -16 * r - 1);
	const so = Math.pow(Math.max(nv + a, 0) + SPEC_OCC_POW_EPS, e) - 1 + a;
	return so < 0 ? 0 : so > 1 ? 1 : so;
}


export function specOccFactorJs(noV, ao, bent, rough, opts) {
	const o = opts && typeof opts === "object" ? opts : {};
	const s = sanitizeSpecOccSettings(o);
	const on = o.on === undefined ? 1 : o.on ? 1 : 0;
	const a = clamp01(ao);
	const b = clamp01(bent);
	const r = clamp01(rough);
	const so = specOccConeJs(noV, a, r);
	let k = so / Math.max(a, SPEC_OCC_AO_EPS);
	k = k < 0 ? 0 : k > 1 ? 1 : k;
	k *= 1 + (b - 1) * (s.bentK * (1 - r));
	const t = on * s.strength;
	return 1 + (k - 1) * t;
}


export function buildSpecOccPars() {
	return [
		"// IL-F20: specular occlusion do IBL (cone AO+bent da máscara do GTAO).",
		"uniform float uRswSpecOccOn;",
		"uniform float uRswSpecOccPhongOn;",
		"uniform float uRswSpecOccStr;",
		"uniform float uRswSpecOccBentK;",
		"uniform sampler2D tRswSpecOccMask;",
		"uniform vec2 uRswSpecOccInvRes;",
		"float rswSpecOccCone( const in float rswNoV, const in float rswAo, const in float rswRough ) {",
		"\treturn clamp( pow( max( rswNoV + rswAo, 0.0 ) + 1e-5, exp2( -16.0 * rswRough - 1.0 ) ) - 1.0 + rswAo, 0.0, 1.0 );",
		"}",
		"float rswSpecOccApply( const in float rswRough, const in vec3 rswN, const in vec3 rswV ) {",
		"\tvec2 rswSoUv = clamp( gl_FragCoord.xy * uRswSpecOccInvRes, vec2( 0.0 ), vec2( 1.0 ) );",
		"\tvec3 rswSoMask = texture2D( tRswSpecOccMask, rswSoUv ).rgb;",
		"\tfloat rswSoAo = clamp( rswSoMask.r, 0.0, 1.0 );",
		"\tfloat rswSoBent = clamp( rswSoMask.b, 0.0, 1.0 );",
		"\tfloat rswSoNoV = clamp( dot( rswN, rswV ), 0.0, 1.0 );",
		"\tfloat rswSo = rswSpecOccCone( rswSoNoV, rswSoAo, rswRough );",
		"\tfloat rswSoK = clamp( rswSo / max( rswSoAo, 1e-3 ), 0.0, 1.0 );",
		"\trswSoK *= mix( 1.0, rswSoBent, uRswSpecOccBentK * ( 1.0 - rswRough ) );",
		"\treturn mix( 1.0, rswSoK, uRswSpecOccOn * uRswSpecOccStr );",
		"}",
		"// SM-LITE F2: mesmo cone no especular DIRETO do phong do pacote (uniform próprio).",
		"float rswSpecOccApplyPhong( const in float rswRough, const in vec3 rswN, const in vec3 rswV ) {",
		"\tvec2 rswSoUv = clamp( gl_FragCoord.xy * uRswSpecOccInvRes, vec2( 0.0 ), vec2( 1.0 ) );",
		"\tvec3 rswSoMask = texture2D( tRswSpecOccMask, rswSoUv ).rgb;",
		"\tfloat rswSoAo = clamp( rswSoMask.r, 0.0, 1.0 );",
		"\tfloat rswSoBent = clamp( rswSoMask.b, 0.0, 1.0 );",
		"\tfloat rswSoNoV = clamp( dot( rswN, rswV ), 0.0, 1.0 );",
		"\tfloat rswSo = rswSpecOccCone( rswSoNoV, rswSoAo, rswRough );",
		"\tfloat rswSoK = clamp( rswSo / max( rswSoAo, 1e-3 ), 0.0, 1.0 );",
		"\trswSoK *= mix( 1.0, rswSoBent, uRswSpecOccBentK * ( 1.0 - rswRough ) );",
		"\treturn mix( 1.0, rswSoK, uRswSpecOccPhongOn * uRswSpecOccStr );",
		"}",
	].join("\n");
}


export function buildSpecOccApplyGlsl() {
	return [
		"#if defined( STANDARD )",
		"\t// IL-F20: oclui SÓ o especular indireto (radiance) — diffuse/irradiance intactos.",
		"\tradiance *= rswSpecOccApply( material.roughness, geometryNormal, geometryViewDir );",
		"\t// IL-F45 (residual F20.5): clearcoatRadiance também é IBL especular — o",
		"\t// mesmo cone com a rugosidade/normal do VERNIZ. Guard num define que o",
		"\t// three r161 JÁ emite p/ physical com clearcoat (nenhuma variante nova",
		"\t// de programa); sem USE_CLEARCOAT o preprocessor poda o ramo e o",
		"\t// fragmento efetivo segue idêntico (Lambert/Phong/Basic ficam fora pelo",
		"\t// guard STANDARD, como antes).",
		"\t#ifdef USE_CLEARCOAT",
		"\t\tclearcoatRadiance *= rswSpecOccApply( material.clearcoatRoughness, geometryClearcoatNormal, geometryViewDir );",
		"\t#endif",
		"#endif",
		"#if defined( PHONG )",
		"\t// SM-LITE F2 (PLANO-REALISMO-SM-REALISTIC-GPU-FRACA): cone do AO no",
		"\t// especular DIRETO do Blinn-Phong do pacote — roughness aproximada da",
		"\t// shininess (Beckmann: rough ~= sqrt(2/(shininess+2))); uniform próprio",
		"\t// uRswSpecOccPhongOn=0 => mix EXATO 1.0 (Future/Classic byte a byte).",
		"\treflectedLight.directSpecular *= rswSpecOccApplyPhong( clamp( sqrt( 2.0 / ( material.specularShininess + 2.0 ) ), 0.0, 1.0 ), geometryNormal, geometryViewDir );",
		"#endif",
	].join("\n");
}


export function patchSpecOccIntoFragment(text) {
	const src = String(text || "");
	if (src.indexOf(SPEC_OCC_MARKER) !== -1) {
		return { ok: false, text: src, reason: "já aplicado" };
	}
	const block = buildSpecOccApplyGlsl();
	let i = src.indexOf(SPEC_OCC_ANCHOR_END);
	if (i !== -1) {
		if (src.indexOf(SPEC_OCC_ANCHOR_END, i + SPEC_OCC_ANCHOR_END.length) !== -1) {
			return { ok: false, text: src, reason: "include duplicado" };
		}
		return { ok: true, text: src.slice(0, i) + block + "\n" + src.slice(i) };
	}
	i = src.indexOf(SPEC_OCC_END_SIG);
	if (i === -1) return { ok: false, text: src, reason: "assinatura ausente" };
	if (src.indexOf(SPEC_OCC_END_SIG, i + SPEC_OCC_END_SIG.length) !== -1) {
		return { ok: false, text: src, reason: "assinatura duplicada" };
	}
	return { ok: true, text: src.slice(0, i) + block + "\n" + src.slice(i) };
}


export function createSpecOccPatcher(args) {
	const a = args && typeof args === "object" ? args : {};
	const endChunk = String(a.lightsEndChunk || "");


	const supported = endChunk.indexOf("RE_IndirectSpecular") !== -1;
	let generation = 0;
	let patchedCount = 0;
	let wantedOn = false;
	let wantedPhongOn = false;                                    
	let maskOk = false;
	const uniforms = {
		uRswSpecOccOn: { value: 0 },
		uRswSpecOccPhongOn: { value: 0 },
		uRswSpecOccStr: { value: SPEC_OCC_STR_DEFAULT },
		uRswSpecOccBentK: { value: SPEC_OCC_BENTK_DEFAULT },
		tRswSpecOccMask: { value: null },
		uRswSpecOccInvRes: { value: { x: 0, y: 0 } },
	};

	function syncOn() {
		uniforms.uRswSpecOccOn.value = wantedOn && maskOk ? 1 : 0;

		uniforms.uRswSpecOccPhongOn.value = wantedPhongOn && maskOk ? 1 : 0;
	}




	function setMask(m) {
		const tex = m && m.texture ? m.texture : null;
		const sw = m ? Number(m.sw) : 0;
		const sh = m ? Number(m.sh) : 0;
		const swOk = Number.isFinite(sw) && sw > 0;
		const shOk = Number.isFinite(sh) && sh > 0;
		uniforms.tRswSpecOccMask.value = tex;
		uniforms.uRswSpecOccInvRes.value.x = swOk ? 1 / sw : 0;
		uniforms.uRswSpecOccInvRes.value.y = shOk ? 1 / sh : 0;
		maskOk = !!tex && swOk && shOk;
		syncOn();
	}

	function patchMaterial(mat) {
		if (!supported || !mat) return;
		if (!mat.userData) mat.userData = {};
		if (mat.userData.__rswSpecOcc) return;                                       
		mat.userData.__rswSpecOcc = true;
		patchedCount++;
		const prevCb = mat.onBeforeCompile;
		const prevKey = mat.customProgramCacheKey;
		mat.onBeforeCompile = function (shader, renderer) {
			if (typeof prevCb === "function") prevCb.call(this, shader, renderer);
			shader.uniforms.uRswSpecOccOn = uniforms.uRswSpecOccOn;
			shader.uniforms.uRswSpecOccPhongOn = uniforms.uRswSpecOccPhongOn;
			shader.uniforms.uRswSpecOccStr = uniforms.uRswSpecOccStr;
			shader.uniforms.uRswSpecOccBentK = uniforms.uRswSpecOccBentK;
			shader.uniforms.tRswSpecOccMask = uniforms.tRswSpecOccMask;
			shader.uniforms.uRswSpecOccInvRes = uniforms.uRswSpecOccInvRes;
			const frag = shader.fragmentShader;
			if (frag.indexOf(SPEC_OCC_MARKER) !== -1) return;               
			const res = patchSpecOccIntoFragment(frag);
			if (!res.ok) return;                                            
			shader.fragmentShader = buildSpecOccPars() + "\n" + res.text;
		};
		mat.customProgramCacheKey = function () {
			const prev = typeof prevKey === "function" ? prevKey.call(this) : "";
			return prev + "|rswSpecOcc1g" + generation;
		};
		mat.needsUpdate = true;
	}


	function configure(opts) {
		const o = opts && typeof opts === "object" ? opts : {};
		if (typeof o.on === "boolean") wantedOn = o.on;
		if (typeof o.phongOn === "boolean") wantedPhongOn = o.phongOn;              
		const st = Number(o.strength);
		if (Number.isFinite(st)) uniforms.uRswSpecOccStr.value = st < 0 ? 0 : st > 1 ? 1 : st;
		const bk = Number(o.bentK);
		if (Number.isFinite(bk)) uniforms.uRswSpecOccBentK.value = bk < 0 ? 0 : bk > 1 ? 1 : bk;
		syncOn();
		return getState();
	}

	function bumpGeneration() {
		generation++;
	}

	function getState() {
		return {
			supported,
			wanted: wantedOn,
			on: uniforms.uRswSpecOccOn.value > 0.5,
			phongWanted: wantedPhongOn,              
			phongOn: uniforms.uRswSpecOccPhongOn.value > 0.5,              
			mask: maskOk,
			strength: uniforms.uRswSpecOccStr.value,
			bentK: uniforms.uRswSpecOccBentK.value,
			generation,
			patched: patchedCount,
		};
	}

	return { supported, uniforms, setMask, patchMaterial, configure, bumpGeneration, getState };
}
