import { LIGHT_PROXY_UNIFORMS } from "./llLightProxyContract.js";

export const LIGHT_PROXY_FUNCTION_NAME = "llLightProxyReflection";


export const LEGACY_IBL_RADIANCE_SIGNATURE = "radiance += getIBLRadiance(";
export const REQUIRED_SHADER_TOKENS = Object.freeze(["geometryViewDir", "geometryNormal", "material.roughness"]);

export function buildLightProxyDeclarationsGlsl() {
	return [
		"uniform float " + LIGHT_PROXY_UNIFORMS.enabled + ";",
		"uniform float " + LIGHT_PROXY_UNIFORMS.intensity + ";",
		"uniform float " + LIGHT_PROXY_UNIFORMS.roughnessCutoff + ";",
		"uniform float " + LIGHT_PROXY_UNIFORMS.roughnessSoftEdge + ";",
		"uniform samplerCube " + LIGHT_PROXY_UNIFORMS.probe + ";",
		"vec3 " + LIGHT_PROXY_FUNCTION_NAME + "( const in vec3 viewDirection, const in vec3 surfaceNormal, const in float surfaceRoughness ) {",
		"\tif ( " + LIGHT_PROXY_UNIFORMS.enabled + " <= 0.0 ) return vec3( 0.0 );",
		"\tfloat glossySoftEdge = max( " + LIGHT_PROXY_UNIFORMS.roughnessSoftEdge + ", 0.0001 );",
		"\tfloat glossyWeight = 1.0 - smoothstep( " +
			LIGHT_PROXY_UNIFORMS.roughnessCutoff +
			" - glossySoftEdge, " +
			LIGHT_PROXY_UNIFORMS.roughnessCutoff +
			", surfaceRoughness );",
		"\tif ( glossyWeight <= 0.0 ) return vec3( 0.0 );",
		"\tvec3 reflectedViewDirection = reflect( -viewDirection, surfaceNormal );",
		"\tvec3 reflectedWorldDirection = normalize( ( vec4( reflectedViewDirection, 0.0 ) * viewMatrix ).xyz );",
		"\tvec3 probeRadiance = textureCube( " + LIGHT_PROXY_UNIFORMS.probe + ", reflectedWorldDirection ).rgb;",
		"\treturn probeRadiance * ( " + LIGHT_PROXY_UNIFORMS.intensity + " * glossyWeight );",
		"}",
	].join("\n");
}

export function buildLightProxyRadianceCallGlsl() {
	return [
		"#if defined( RE_IndirectSpecular )",
		"\tradiance += " + LIGHT_PROXY_FUNCTION_NAME + "( geometryViewDir, geometryNormal, material.roughness );",
		"#endif",
	].join("\n");
}

export function missingShaderTokens(chunkSource) {
	const source = typeof chunkSource === "string" ? chunkSource : "";
	return REQUIRED_SHADER_TOKENS.filter((token) => source.indexOf(token) < 0);
}











export function appendLightProxyReflection(chunkSource) {
	const source = typeof chunkSource === "string" ? chunkSource : "";
	if (source.indexOf(LIGHT_PROXY_FUNCTION_NAME + "( geometryViewDir") >= 0) {
		return Object.freeze({ source: source, injected: false, reason: "already-injected" });
	}
	if (source.indexOf(LEGACY_IBL_RADIANCE_SIGNATURE) < 0) {
		return Object.freeze({ source: source, injected: false, reason: "radiance-signature-not-found" });
	}
	const missing = missingShaderTokens(source);
	if (missing.length > 0) {
		return Object.freeze({ source: source, injected: false, reason: "missing-tokens:" + missing.join(",") });
	}
	return Object.freeze({
		source: source + "\n" + buildLightProxyRadianceCallGlsl() + "\n",
		injected: true,
		reason: "",
	});
}
