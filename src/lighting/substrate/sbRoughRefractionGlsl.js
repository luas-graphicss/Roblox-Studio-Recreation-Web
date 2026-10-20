import { roughRefractionGlslConstants } from "./sbRoughRefractionCore.js"

export const SB_ROUGH_REFRACTION_UNIFORM_NAME = "uSbRoughRefractionStrength"


export const SB_ROUGH_REFRACTION_DECLARATIONS_ANCHOR = "common"


export const SB_ROUGH_REFRACTION_APPLICATION_ANCHOR = "roughnessMapFragment"

export const SB_ROUGH_REFRACTION_DECLARATIONS_GLSL = `
                                                                
uniform float uSbRoughRefractionStrength;

                                                                             
                                                                               
float sbBroadenRoughnessByRoughRefraction(float bottomRoughness, float refractionStrength) {
	if (0.0 >= refractionStrength) return bottomRoughness;
	return min(1.0, sqrt(bottomRoughness * bottomRoughness + refractionStrength * refractionStrength));
}
`

export const SB_ROUGH_REFRACTION_APPLICATION_GLSL = `
                                                                
roughnessFactor = sbBroadenRoughnessByRoughRefraction(roughnessFactor, uSbRoughRefractionStrength);
`

function glslFloat(value) {
	return Number.isInteger(value) ? value.toFixed(1) : String(value)
}

const runtimeConstants = roughRefractionGlslConstants()

export const SB_ROUGH_REFRACTION_RUNTIME_FUNCTION_NAMES = Object.freeze([
	"sbRoughRefractionIorFromF0",
	"sbRoughRefractionSpread",
	"sbRoughRefractionPathTerm",
	"sbRoughRefractionStrength",
	"sbRoughRefractionBroaden",
	"sbRoughRefractionBlurNormal",
])

export const SB_ROUGH_REFRACTION_RUNTIME_GLSL = `
${Object.entries(runtimeConstants)
	.map(([name, value]) => "const float " + name + " = " + glslFloat(value) + ";")
	.join("\n")}
float sbRoughRefractionIorFromF0(const in vec3 coatF0) {
	float root = sqrt(clamp(dot(coatF0, vec3(1.0 / 3.0)), 0.0, 0.99));
	return clamp((1.0 + root) / max(1.0 - root, 1.0e-4), SB_ROUGH_REFRACTION_MINIMUM_IOR, SB_ROUGH_REFRACTION_MAXIMUM_IOR);
}
float sbRoughRefractionSpread(const in float topRoughness, const in float ior) {
	float roughness = clamp(topRoughness, 0.0, 1.0);
	if (0.0 >= roughness) return 0.0;
	float amplification = 1.0 + SB_ROUGH_REFRACTION_SPREAD_PER_IOR_UNIT * (ior - 1.0);
	return roughness * amplification / (1.0 + roughness * (amplification - 1.0));
}
float sbRoughRefractionPathTerm(const in float thickness, const in float cosThetaView, const in float ior) {
	float cosine = clamp(cosThetaView, 0.0, 1.0);
	float sineSquared = 1.0 - cosine * cosine;
	float refractedCosine = sqrt(max(0.0, 1.0 - sineSquared / (ior * ior)));
	float pathLength = max(thickness, 0.0) * 2.0 / max(SB_ROUGH_REFRACTION_MINIMUM_REFRACTED_COSINE, refractedCosine);
	float mediumTerm = 1.0 - exp(-pathLength / SB_ROUGH_REFRACTION_PATH_REFERENCE);
	return SB_ROUGH_REFRACTION_INTERFACE_SHARE + SB_ROUGH_REFRACTION_MEDIUM_SHARE * mediumTerm;
}
float sbRoughRefractionStrength(const in float topRoughness, const in float ior, const in float coverage, const in float thickness, const in float cosThetaView) {
	float spread = sbRoughRefractionSpread(topRoughness, ior);
	if (0.0 >= spread) return 0.0;
	float coverageAmount = clamp(coverage, 0.0, 1.0);
	if (0.0 >= coverageAmount) return 0.0;
	return clamp(spread * coverageAmount * sbRoughRefractionPathTerm(thickness, cosThetaView, ior), 0.0, 1.0);
}
float sbRoughRefractionBroaden(const in float bottomRoughness, const in float strength) {
	if (0.0 >= strength) return bottomRoughness;
	return min(1.0, sqrt(bottomRoughness * bottomRoughness + strength * strength));
}
vec3 sbRoughRefractionBlurNormal(const in vec3 detailNormal, const in vec3 geometricNormal, const in float strength) {
	if (0.0 >= strength) return detailNormal;
	return normalize(mix(detailNormal, geometricNormal, strength * SB_ROUGH_REFRACTION_NORMAL_BLUR_SHARE));
}
`
