import {
	SB_WATER_INDEX_OF_REFRACTION,
	SB_WATER_UNIFORM_NAME,
	waterSurfaceReflectanceAtNormalIncidence,
} from "./sbSingleLayerWaterCore.js"

const GLSL_FLOAT_DIGITS = 6

function toGlslFloat(value) {
	return Number(value).toFixed(GLSL_FLOAT_DIGITS)
}

export const SB_WATER_SURFACE_F0_GLSL_NAME = "SB_WATER_SURFACE_F0"

export const SB_SINGLE_LAYER_WATER_DECLARATIONS_GLSL = `uniform vec4 ${SB_WATER_UNIFORM_NAME};

const float ${SB_WATER_SURFACE_F0_GLSL_NAME} = ${toGlslFloat(
	waterSurfaceReflectanceAtNormalIncidence(SB_WATER_INDEX_OF_REFRACTION),
)};

struct SbSingleLayerWater {
	vec3 transmittance;
	float scatteringAlbedo;
};

SbSingleLayerWater sbReadSingleLayerWater() {
	SbSingleLayerWater water;
	water.transmittance = clamp(${SB_WATER_UNIFORM_NAME}.rgb, 0.0, 1.0);
	water.scatteringAlbedo = clamp(${SB_WATER_UNIFORM_NAME}.a, 0.0, 1.0);
	return water;
}

bool sbSingleLayerWaterIsActive(SbSingleLayerWater water) {
	return any(lessThan(water.transmittance, vec3(1.0))) || water.scatteringAlbedo > 0.0;
}

float sbSingleLayerWaterFresnel(float cosThetaView) {
	float oneMinusCosine = clamp(1.0 - cosThetaView, 0.0, 1.0);
	float squaredCosine = oneMinusCosine * oneMinusCosine;
	float grazingCurve = squaredCosine * squaredCosine * oneMinusCosine;
	return ${SB_WATER_SURFACE_F0_GLSL_NAME} + (1.0 - ${SB_WATER_SURFACE_F0_GLSL_NAME}) * grazingCurve;
}

vec3 sbComposeSingleLayerWater(
	SbSingleLayerWater water,
	vec3 reflectedRadiance,
	vec3 refractedRadiance,
	vec3 scatterSourceRadiance,
	float cosThetaView
) {
	float surfaceReflectance = sbSingleLayerWaterFresnel(cosThetaView);
	vec3 absorbedRadiance = water.transmittance * refractedRadiance;
	vec3 inScatteredRadiance = water.scatteringAlbedo * (vec3(1.0) - water.transmittance) * scatterSourceRadiance;
	return mix(absorbedRadiance + inScatteredRadiance, reflectedRadiance, surfaceReflectance);
}`

export const SB_SINGLE_LAYER_WATER_COMPOSITION_GLSL = `{
	SbSingleLayerWater sbWaterLayer = sbReadSingleLayerWater();
	if (sbSingleLayerWaterIsActive(sbWaterLayer)) {
		vec3 sbWaterReflectedRadiance = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
		vec3 sbWaterRefractedRadiance = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
		vec3 sbWaterScatterSourceRadiance = reflectedLight.indirectDiffuse;
		float sbWaterCosThetaView = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
		vec3 sbWaterOutgoingRadiance = sbComposeSingleLayerWater(
			sbWaterLayer,
			sbWaterReflectedRadiance,
			sbWaterRefractedRadiance,
			sbWaterScatterSourceRadiance,
			sbWaterCosThetaView
		);
		reflectedLight.directDiffuse = vec3(0.0);
		reflectedLight.directSpecular = vec3(0.0);
		reflectedLight.indirectSpecular = vec3(0.0);
		reflectedLight.indirectDiffuse = sbWaterOutgoingRadiance;
	}
}`


export function describeSingleLayerWaterGlsl() {
	return {
		uniformNames: [SB_WATER_UNIFORM_NAME],
		consumesReflectionStack: true,
		samplesEnvironmentMap: false,
		declarationsCharacterCount: SB_SINGLE_LAYER_WATER_DECLARATIONS_GLSL.length,
		compositionCharacterCount: SB_SINGLE_LAYER_WATER_COMPOSITION_GLSL.length,
	}
}
