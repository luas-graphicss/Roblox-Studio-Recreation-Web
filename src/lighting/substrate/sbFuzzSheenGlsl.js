import { SB_SHEEN_FORWARD_EXPONENT, SB_SHEEN_MAXIMUM_FORWARD_MIX } from "./sbFuzzSheenCore.js"

export const SB_FUZZ_UNIFORM_NAME = "uSbFuzz"
export const SB_SHEEN_LTC_UNIFORM_NAME = "uSbSheenLtc"


export const SB_FUZZ_SHEEN_ANCHORS = Object.freeze({
	declarations: "bsdfs",
	application: "lightsFragmentEnd",
})

const INCLUDE_GUARD_NAME = "SB_FUZZ_SHEEN"

function toGlslFloat(value) {
	const numeric = Number(value)
	const text = Number.isFinite(numeric) ? String(numeric) : "0"
	return text.includes(".") || text.includes("e") ? text : text + ".0"
}


export function buildFuzzSheenGlsl(options) {
	const tableWidth = toGlslFloat(options?.viewCosineSteps ?? 16)
	const tableHeight = toGlslFloat(options?.roughnessSteps ?? 16)
	const maximumForwardMix = toGlslFloat(SB_SHEEN_MAXIMUM_FORWARD_MIX)
	const forwardExponent = toGlslFloat(SB_SHEEN_FORWARD_EXPONENT)

	const uniforms = [
		"uniform vec4 " + SB_FUZZ_UNIFORM_NAME + ";",
		"uniform sampler2D " + SB_SHEEN_LTC_UNIFORM_NAME + ";",
	].join("\n")

	const sharedHelpers = [
		"// Cor do fuzz em 24 bits dentro de um float: o uniform congelado e um vec4 e",
		"// a fase precisa de cinco numeros.",
		"vec3 sbUnpackFuzzColor(const in float packedFuzzColor) {",
		"\tfloat blueChannel = mod(packedFuzzColor, 256.0);",
		"\tfloat greenChannel = mod(floor(packedFuzzColor / 256.0), 256.0);",
		"\tfloat redChannel = floor(packedFuzzColor / 65536.0);",
		"\treturn vec3(redChannel, greenChannel, blueChannel) / 255.0;",
		"}",
		"",
		"// Tabela LTC: x = albedo do sheen, y = escala do lobo, z = torcao do lobo.",
		"vec3 sbReadSheenLtcEntry(const in float viewCosine, const in float sheenRoughness) {",
		"\tvec2 tableSize = vec2(" + tableWidth + ", " + tableHeight + ");",
		"\tvec2 tableCoordinate = (clamp(vec2(viewCosine, sheenRoughness), 0.0, 1.0) * (tableSize - 1.0) + 0.5) / tableSize;",
		"\treturn texture2D(" + SB_SHEEN_LTC_UNIFORM_NAME + ", tableCoordinate).rgb;",
		"}",
	].join("\n")

	const lowQuality = [
		"// Qualidade baixa: energia certa, forma media. Nenhuma leitura extra de ambiente.",
		"vec3 sbFuzzSheenLowQuality(const in vec3 sheenLtcEntry, const in vec3 fuzzColor, const in float fuzzAmount, const in vec3 ambientRadiance) {",
		"\treturn fuzzColor * (fuzzAmount * sheenLtcEntry.x) * ambientRadiance;",
		"}",
	].join("\n")

	const highQuality = [
		"// Direcao de pico do lobo LTC, reconstruida no plano (normal, vista).",
		"vec3 sbSheenLtcDominantDirection(const in float ltcScale, const in float ltcSkew, const in vec3 surfaceNormal, const in vec3 inPlaneViewDirection) {",
		"\tvec3 localDominant = normalize(vec3(-ltcSkew, 0.0, ltcScale));",
		"\treturn normalize(surfaceNormal * localDominant.z + inPlaneViewDirection * localDominant.x);",
		"}",
		"",
		"// Peso com que o lobo troca a irradiancia media pelo ambiente direcional.",
		"// E uma combinacao convexa: qualquer peso preserva a energia do lobo.",
		"float sbSheenForwardMix(const in float sheenRoughness, const in float dominantAlignment) {",
		"\tfloat sheenSmoothness = 1.0 - clamp(sheenRoughness, 0.0, 1.0);",
		"\treturn " + maximumForwardMix + " * sheenSmoothness * pow(clamp(dominantAlignment, 0.0, 1.0), " + forwardExponent + ");",
		"}",
		"",
		"// Qualidade alta: mesma energia, forma do LTC olhando para o ambiente.",
		"vec3 sbFuzzSheenHighQuality(const in vec3 sheenLtcEntry, const in vec3 fuzzColor, const in float fuzzAmount, const in vec3 ambientRadiance, const in vec3 environmentRadiance, const in float sheenRoughness, const in vec3 surfaceNormal, const in vec3 viewDirection) {",
		"\tvec3 inPlaneViewDirection = normalize(viewDirection - surfaceNormal * dot(surfaceNormal, viewDirection) + vec3(1e-6));",
		"\tvec3 dominantDirection = sbSheenLtcDominantDirection(sheenLtcEntry.y, sheenLtcEntry.z, surfaceNormal, inPlaneViewDirection);",
		"\tvec3 mirrorDirection = reflect(-viewDirection, surfaceNormal);",
		"\tfloat forwardMix = sbSheenForwardMix(sheenRoughness, dot(dominantDirection, mirrorDirection));",
		"\tvec3 shapedRadiance = mix(ambientRadiance, environmentRadiance, forwardMix);",
		"\treturn fuzzColor * (fuzzAmount * sheenLtcEntry.x) * shapedRadiance;",
		"}",
	].join("\n")

	const callSite = [
		"// SB-F13: lobo aditivo de fuzz/sheen. A energia vem da tabela LTC; o nivel de",
		"// qualidade (" + SB_FUZZ_UNIFORM_NAME + ".w) decide apenas a forma angular.",
		"if (" + SB_FUZZ_UNIFORM_NAME + ".x > 0.0) {",
		"\tfloat sbFuzzAmount = clamp(" + SB_FUZZ_UNIFORM_NAME + ".x, 0.0, 1.0);",
		"\tfloat sbFuzzRoughness = clamp(" + SB_FUZZ_UNIFORM_NAME + ".y, 0.0, 1.0);",
		"\tvec3 sbFuzzColor = sbUnpackFuzzColor(" + SB_FUZZ_UNIFORM_NAME + ".z);",
		"\tfloat sbFuzzViewCosine = clamp(dot(geometryNormal, geometryViewDir), 0.0, 1.0);",
		"\tvec3 sbSheenLtcEntry = sbReadSheenLtcEntry(sbFuzzViewCosine, sbFuzzRoughness);",
		"\tvec3 sbSheenAmbientRadiance = (irradiance + iblIrradiance) * RECIPROCAL_PI;",
		"\tvec3 sbFuzzSheenRadiance = sbFuzzSheenLowQuality(sbSheenLtcEntry, sbFuzzColor, sbFuzzAmount, sbSheenAmbientRadiance);",
		"\tif (" + SB_FUZZ_UNIFORM_NAME + ".w > 0.5) {",
		"\t\tsbFuzzSheenRadiance = sbFuzzSheenHighQuality(sbSheenLtcEntry, sbFuzzColor, sbFuzzAmount, sbSheenAmbientRadiance, radiance, sbFuzzRoughness, geometryNormal, geometryViewDir);",
		"\t}",
		"\treflectedLight.indirectSpecular += max(sbFuzzSheenRadiance, vec3(0.0));",
		"}",
	].join("\n")

	const declarationsCode = [
		"#ifndef " + INCLUDE_GUARD_NAME,
		"#define " + INCLUDE_GUARD_NAME,
		uniforms,
		sharedHelpers,
		lowQuality,
		highQuality,
		"#endif",
	].join("\n\n")

	return {
		declarationsCode,
		applicationCode: callSite,
		sources: { uniforms, sharedHelpers, lowQuality, highQuality, callSite },
	}
}
