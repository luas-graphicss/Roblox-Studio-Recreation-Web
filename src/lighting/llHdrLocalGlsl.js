import { LOCAL_HDR_UNIFORMS } from "./llHdrLocalContract.js";

const POINT_LIGHT_SECTION_PATTERN = /#if\s*\(\s*NUM_POINT_LIGHTS\s*>\s*0\s*\)\s*&&\s*defined\(\s*RE_Direct\s*\)/;
const DIRECTIONAL_LIGHT_SECTION_PATTERN = /#if\s*\(\s*NUM_DIR_LIGHTS\s*>\s*0\s*\)\s*&&\s*defined\(\s*RE_Direct\s*\)/;
const DIRECT_LIGHT_CALL_PATTERN = /RE_Direct\(\s*directLight,/g;


export const INJECTION_MARK = "llF9ClampLocalRadiance";


export const SAVED_ROUGHNESS_SYMBOL = "llF9SavedPerceptualRoughness";


export function buildLocalHdrHelpersGlsl() {
	return [
		"// ---- LL-F9 HDR local (uLlF9Enabled: 0 = legado, 1 = fase ligada) ----",
		"uniform float " + LOCAL_HDR_UNIFORMS.enabled + ";",
		"uniform float " + LOCAL_HDR_UNIFORMS.clampKnee + ";",
		"uniform float " + LOCAL_HDR_UNIFORMS.clampCeiling + ";",
		"uniform float " + LOCAL_HDR_UNIFORMS.specularAaVariance + ";",
		"uniform float " + LOCAL_HDR_UNIFORMS.specularAaThreshold + ";",
		"",
		"float llF9RelativeLuminance( const in vec3 radiance ) {",
		"	return dot( radiance, vec3( 0.2126, 0.7152, 0.0722 ) );",
		"}",
		"",
		"// Soft knee: identidade ate o joelho, assintota no teto. Sem degrau.",
		"float llF9SoftClampLuminance( const in float luminance, const in float knee, const in float ceiling ) {",
		"	float range = ceiling - knee;",
		"	if ( range <= 0.0 ) return min( luminance, knee );",
		"	float excess = luminance - knee;",
		"	return knee + range * excess / ( excess + range );",
		"}",
		"",
		"// Anti firefly: escala UNIFORME, entao o matiz da luz nao muda.",
		"void " + INJECTION_MARK + "( inout IncidentLight incidentLight ) {",
		"	if ( " + LOCAL_HDR_UNIFORMS.enabled + " <= 0.0 ) return;",
		"	float luminance = llF9RelativeLuminance( incidentLight.color );",
		"	if ( luminance <= " + LOCAL_HDR_UNIFORMS.clampKnee + " ) return;",
		"	float clamped = llF9SoftClampLuminance( luminance, " + LOCAL_HDR_UNIFORMS.clampKnee + ", " + LOCAL_HDR_UNIFORMS.clampCeiling + " );",
		"	incidentLight.color *= clamped / max( luminance, EPSILON );",
		"}",
		"",
		"#if defined( STANDARD ) || defined( PHYSICAL )",
		"// Filtragem de normal por variancia (Kaplanyan/Tokuyoshi).",
		"float llF9FilterPerceptualRoughness( const in float perceptualRoughness, const in vec3 shadingNormal ) {",
		"	if ( " + LOCAL_HDR_UNIFORMS.enabled + " <= 0.0 ) return perceptualRoughness;",
		"	vec3 normalDx = dFdx( shadingNormal );",
		"	vec3 normalDy = dFdy( shadingNormal );",
		"	float derivativeSquaredSum = dot( normalDx, normalDx ) + dot( normalDy, normalDy );",
		"	if ( derivativeSquaredSum <= 0.0 ) return perceptualRoughness;",
		"	float alpha = perceptualRoughness * perceptualRoughness;",
		"	float kernelRoughness = min( 2.0 * " + LOCAL_HDR_UNIFORMS.specularAaVariance + " * derivativeSquaredSum, " + LOCAL_HDR_UNIFORMS.specularAaThreshold + " );",
		"	float filteredSquareAlpha = saturate( alpha * alpha + kernelRoughness );",
		"	return max( sqrt( sqrt( filteredSquareAlpha ) ), perceptualRoughness );",
		"}",
		"#endif",
		"// ---- fim LL-F9 ----",
	].join("\n");
}


function buildRoughnessFilterOpenGlsl() {
	return [
		"#if defined( STANDARD ) || defined( PHYSICAL )",
		"	float " + SAVED_ROUGHNESS_SYMBOL + " = material.roughness;",
		"	material.roughness = llF9FilterPerceptualRoughness( material.roughness, geometryNormal );",
		"#endif",
		"",
	].join("\n");
}


function buildRoughnessFilterCloseGlsl() {
	return [
		"#if defined( STANDARD ) || defined( PHYSICAL )",
		"	material.roughness = " + SAVED_ROUGHNESS_SYMBOL + ";",
		"#endif",
		"",
	].join("\n");
}







export function injectLocalHdr(chunkSource) {
	const source = typeof chunkSource === "string" ? chunkSource : "";
	if (source === "") return { injected: false, source, reason: "empty-source", clampedCallCount: 0 };
	if (source.indexOf(INJECTION_MARK + "(") >= 0) {
		return { injected: false, source, reason: "already-injected", clampedCallCount: 0 };
	}
	const pointSection = source.match(POINT_LIGHT_SECTION_PATTERN);
	const directionalSection = source.match(DIRECTIONAL_LIGHT_SECTION_PATTERN);
	if (!pointSection || !directionalSection) {
		return { injected: false, source, reason: "local-light-sections-not-found", clampedCallCount: 0 };
	}
	const localStart = pointSection.index;
	const localEnd = directionalSection.index;
	if (!(localEnd > localStart)) {
		return { injected: false, source, reason: "unexpected-section-order", clampedCallCount: 0 };
	}
	const head = source.slice(0, localStart);
	const localSection = source.slice(localStart, localEnd);
	const tail = source.slice(localEnd);
	let clampedCallCount = 0;
	const guardedSection = localSection.replace(new RegExp(DIRECT_LIGHT_CALL_PATTERN.source, "g"), (call) => {
		clampedCallCount++;
		return INJECTION_MARK + "( directLight );\n\t\t" + call;
	});
	if (clampedCallCount === 0) {
		return { injected: false, source, reason: "direct-light-call-not-found", clampedCallCount: 0 };
	}
	return {
		injected: true,
		source: head + buildRoughnessFilterOpenGlsl() + guardedSection + buildRoughnessFilterCloseGlsl() + tail,
		reason: "injected",
		clampedCallCount,
	};
}
