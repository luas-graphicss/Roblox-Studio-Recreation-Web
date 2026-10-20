import { slabFieldEncodings } from "./sbMaterialBufferCore.js"
import { SB_SPECIALIZED_CLOSURE_KINDS, specializedFieldEncodings, specializedKindCode } from "./sbSpecializedClosureCore.js"
import {
	SB_HAIR_EUMELANIN_ABSORPTION,
	SB_HAIR_LONGITUDINAL_SHIFT_FACTORS,
	SB_HAIR_LONGITUDINAL_WIDTH_FACTORS,
	SB_HAIR_MAXIMUM_LONGITUDINAL_WIDTH,
	SB_HAIR_MINIMUM_PATH_COSINE,
	SB_HAIR_MINIMUM_ROUGHNESS,
	SB_HAIR_PATH_LENGTH_PER_PASS,
} from "./sbHairBsdfCore.js"
import { SB_EYE_LIMBUS_START, SB_EYE_MINIMUM_CORNEA_ROUGHNESS, SB_EYE_PUPIL_SOFTNESS } from "./sbEyeBsdfCore.js"

const STRUCT_NAMES = Object.freeze({
	hair: "SbHairClosure",
	eye: "SbEyeClosure",
	singleLayerWater: "SbWaterClosure",
	volume: "SbVolumeClosure",
	unlit: "SbUnlitClosure",
})

const READER_NAMES = Object.freeze({
	hair: "sbReadHairClosure",
	eye: "sbReadEyeClosure",
	singleLayerWater: "sbReadWaterClosure",
	volume: "sbReadVolumeClosure",
	unlit: "sbReadUnlitClosure",
})

const SLAB_FIELDS = new Set(slabFieldEncodings().map((field) => field.name))

function f(value) {
	const number = Number(value)
	if (!Number.isFinite(number)) return "0.0"
	const text = number.toFixed(6)
	return text
}

function kindConstantName(kind) {
	return "SB_CLOSURE_KIND_" + kind.replace(/([A-Z])/g, "_$1").toUpperCase()
}

function channelExpression(encoding, channelIndex) {
	const byteIndex = encoding.byteOffset + channelIndex * encoding.bytesPerChannel
	const decoder = encoding.bytesPerChannel === 2 ? "sbMaterialBufferUnorm2" : "sbMaterialBufferUnorm1"
	return `sbMaterialBufferRange(${decoder}(closureRow, ${byteIndex}), ${f(encoding.minimum)}, ${f(encoding.maximum)})`
}

function structAndReader(kind) {
	const encodings = specializedFieldEncodings(kind)
	const struct = [`struct ${STRUCT_NAMES[kind]} {`]
	for (const encoding of encodings) struct.push(`\t${encoding.glslType} ${encoding.name};`)
	struct.push("};")
	const reader = [`${STRUCT_NAMES[kind]} ${READER_NAMES[kind]}(float closureRow) {`, `\t${STRUCT_NAMES[kind]} closure;`]
	for (const encoding of encodings) {
		const channels = []
		for (let index = 0; index < encoding.channelCount; index += 1) channels.push(channelExpression(encoding, index))
		reader.push(
			encoding.channelCount === 1
				? `\tclosure.${encoding.name} = ${channels[0]};`
				: `\tclosure.${encoding.name} = ${encoding.glslType}(${channels.join(", ")});`,
		)
	}
	reader.push("\treturn closure;", "}")
	return [...struct, "", ...reader].join("\n")
}

function slabAssignment(name, expression) {
	return SLAB_FIELDS.has(name) ? `\t\tslab.${name} = ${expression};` : ""
}

function neutralSlabAssignments() {
	return [
		slabAssignment("anisotropy", "0.0"),
		slabAssignment("anisotropyRotation", "0.0"),
		slabAssignment("secondRoughnessWeight", "0.0"),
		slabAssignment("fuzzAmount", "0.0"),
		slabAssignment("subsurfaceMeanFreePath", "vec3(0.0)"),
		slabAssignment("thinFilmThicknessNanometers", "0.0"),
		slabAssignment("glintDensity", "0.0"),
		slabAssignment("specularProfileIndex", "0.0"),
		slabAssignment("coverage", "1.0"),
		slabAssignment("thickness", "0.0"),
		slabAssignment("transmittanceColor", "vec3(1.0)"),
	]
		.filter(Boolean)
		.join("\n")
}

function asSlabFunction() {
	return `
float sbIorToF0(float ior) {
	float ratio = (ior - 1.0) / max(ior + 1.0, 1e-4);
	return ratio * ratio;
}
float sbClosureKind(float closureRow) {
	return sbReadClosureHeader(closureRow).kind;
}
SbSlabClosure sbReadClosureAsSlab(float closureRow, float kind) {
	SbSlabClosure slab = sbReadSlabClosure(closureRow);
	if (kind == ${kindConstantName("hair")}) {
		${STRUCT_NAMES.hair} hair = ${READER_NAMES.hair}(closureRow);
${neutralSlabAssignments()}
${slabAssignment("albedo", "hair.baseColor")}
${slabAssignment("f0", "vec3(sbIorToF0(hair.ior))")}
${slabAssignment("f90", "1.0")}
${slabAssignment("roughness", "max(hair.roughness, " + f(SB_HAIR_MINIMUM_ROUGHNESS) + ")")}
${slabAssignment("emissive", "vec3(0.0)")}
${slabAssignment("opacity", "1.0")}
	} else if (kind == ${kindConstantName("eye")}) {
		${STRUCT_NAMES.eye} eye = ${READER_NAMES.eye}(closureRow);
${neutralSlabAssignments()}
${slabAssignment("albedo", "eye.irisColor")}
${slabAssignment("f0", "vec3(sbIorToF0(eye.corneaIor))")}
${slabAssignment("f90", "1.0")}
${slabAssignment("roughness", "max(eye.corneaRoughness, " + f(SB_EYE_MINIMUM_CORNEA_ROUGHNESS) + ")")}
${slabAssignment("emissive", "vec3(0.0)")}
${slabAssignment("opacity", "1.0")}
	} else if (kind == ${kindConstantName("singleLayerWater")}) {
		${STRUCT_NAMES.singleLayerWater} water = ${READER_NAMES.singleLayerWater}(closureRow);
${neutralSlabAssignments()}
${slabAssignment("albedo", "water.scattering")}
${slabAssignment("f0", "vec3(sbIorToF0(water.ior))")}
${slabAssignment("f90", "1.0")}
${slabAssignment("roughness", "water.roughness")}
${slabAssignment("emissive", "vec3(0.0)")}
${slabAssignment("opacity", "1.0")}
	} else if (kind == ${kindConstantName("volume")}) {
		${STRUCT_NAMES.volume} volume = ${READER_NAMES.volume}(closureRow);
${neutralSlabAssignments()}
${slabAssignment("albedo", "volume.albedo")}
${slabAssignment("f0", "vec3(0.0)")}
${slabAssignment("f90", "0.0")}
${slabAssignment("roughness", "1.0")}
${slabAssignment("emissive", "volume.emissive")}
${slabAssignment("opacity", "1.0")}
	} else if (kind == ${kindConstantName("unlit")}) {
		${STRUCT_NAMES.unlit} unlit = ${READER_NAMES.unlit}(closureRow);
${neutralSlabAssignments()}
${slabAssignment("albedo", "vec3(0.0)")}
${slabAssignment("f0", "vec3(0.0)")}
${slabAssignment("f90", "0.0")}
${slabAssignment("roughness", "1.0")}
${slabAssignment("emissive", "unlit.emissive")}
${slabAssignment("opacity", "unlit.opacity")}
	}
	return slab;
}`
}

export function sbSpecializedClosureDeclarations() {
	const constants = ["const float SB_CLOSURE_KIND_SLAB = 0.0;"]
	for (const kind of SB_SPECIALIZED_CLOSURE_KINDS) constants.push(`const float ${kindConstantName(kind)} = ${f(specializedKindCode(kind))};`)
	const hairConstants = [
		`const vec3 SB_RT_HAIR_ABSORPTION = vec3(${SB_HAIR_EUMELANIN_ABSORPTION.map(f).join(", ")});`,
		`const float SB_RT_HAIR_PATH_LENGTH = ${f(SB_HAIR_PATH_LENGTH_PER_PASS)};`,
		`const float SB_RT_HAIR_MIN_PATH_COSINE = ${f(SB_HAIR_MINIMUM_PATH_COSINE)};`,
		`const float SB_RT_HAIR_MIN_ROUGHNESS = ${f(SB_HAIR_MINIMUM_ROUGHNESS)};`,
		`const float SB_RT_HAIR_MAX_WIDTH = ${f(SB_HAIR_MAXIMUM_LONGITUDINAL_WIDTH)};`,
		`const float SB_RT_HAIR_R_SHIFT = ${f(SB_HAIR_LONGITUDINAL_SHIFT_FACTORS.R)};`,
		`const float SB_RT_HAIR_TRT_SHIFT = ${f(SB_HAIR_LONGITUDINAL_SHIFT_FACTORS.TRT)};`,
		`const float SB_RT_HAIR_R_WIDTH = ${f(SB_HAIR_LONGITUDINAL_WIDTH_FACTORS.R)};`,
		`const float SB_RT_HAIR_TT_WIDTH = ${f(SB_HAIR_LONGITUDINAL_WIDTH_FACTORS.TT)};`,
		`const float SB_RT_HAIR_TRT_WIDTH = ${f(SB_HAIR_LONGITUDINAL_WIDTH_FACTORS.TRT)};`,
		`const float SB_RT_EYE_LIMBUS_START = ${f(SB_EYE_LIMBUS_START)};`,
		`const float SB_RT_EYE_PUPIL_SOFTNESS = ${f(SB_EYE_PUPIL_SOFTNESS)};`,
	]
	const helpers = `
vec3 sbRuntimeHairTangent(const in vec3 shadingNormal, const in vec2 authoredTangent) {
	vec3 referenceAxis = dot(authoredTangent, authoredTangent) > 1e-6 ? normalize(vec3(authoredTangent, 0.0)) : vec3(0.0, 1.0, 0.0);
	vec3 fiber = referenceAxis - shadingNormal * dot(referenceAxis, shadingNormal);
	float fiberLength = length(fiber);
	if (fiberLength > 1e-6) return fiber / fiberLength;
	return normalize(cross(shadingNormal, vec3(0.0, 0.0, 1.0)));
}
vec3 sbRuntimeHairShiftedNormal(const in vec3 shadingNormal, const in vec3 fiber, const in float shiftRadians) {
	float sineAlong = clamp(dot(fiber, shadingNormal), -1.0, 1.0);
	vec3 across = shadingNormal - fiber * sineAlong;
	float acrossLength = length(across);
	if (acrossLength < 1e-6) return shadingNormal;
	float shifted = asin(sineAlong) + shiftRadians;
	return normalize((across / acrossLength) * cos(shifted) + fiber * sin(shifted));
}
vec3 sbRuntimeHairTransmittance(const in float melanin, const in float cosineDifference) {
	float pathLength = SB_RT_HAIR_PATH_LENGTH / max(abs(cosineDifference), SB_RT_HAIR_MIN_PATH_COSINE);
	return exp(-SB_RT_HAIR_ABSORPTION * (melanin * pathLength));
}
float sbRuntimeHairLobeWidth(const in float widthFactor, const in float roughness) {
	return clamp(widthFactor * max(roughness, SB_RT_HAIR_MIN_ROUGHNESS), SB_RT_HAIR_MIN_ROUGHNESS, SB_RT_HAIR_MAX_WIDTH);
}
float sbRuntimeSchlick(const in float f0, const in float cosine) {
	return f0 + (1.0 - f0) * pow(1.0 - clamp(cosine, 0.0, 1.0), 5.0);
}
vec3 sbRuntimeTiltNormal(const in vec3 shadingNormal, const in vec2 tilt) {
	if (dot(tilt, tilt) < 1e-6) return shadingNormal;
	vec3 reference = abs(shadingNormal.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
	vec3 tangent = normalize(cross(reference, shadingNormal));
	vec3 bitangent = cross(shadingNormal, tangent);
	return normalize(shadingNormal + tangent * tilt.x + bitangent * tilt.y);
}`
	return [
		"",
		...constants,
		...hairConstants,
		...SB_SPECIALIZED_CLOSURE_KINDS.map(structAndReader),
		asSlabFunction(),
		helpers,
		"",
	].join("\n")
}

export function sbSpecializedPreLightingGlsl({ hair = true } = {}) {
	return `
 vec3 sbRuntimeViewDir = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vViewPosition);
 ${hair ? `sbRuntimeHairActive = 0.0;
 if (sbRuntimeKind == ${kindConstantName("hair")}) {
  ${STRUCT_NAMES.hair} sbRuntimeHairPre = ${READER_NAMES.hair}(float(sbRuntimeSlot));
  sbRuntimeHairFiber = sbRuntimeHairTangent(normal, sbRuntimeHairPre.tangent);
  float sbHairPreShift = 0.5 * sbRuntimeHairPre.cuticleAngle;
  sbRuntimeHairPrimaryNormal = sbRuntimeHairShiftedNormal(normal, sbRuntimeHairFiber, SB_RT_HAIR_R_SHIFT * sbHairPreShift);
  sbRuntimeHairInnerNormal = sbRuntimeHairShiftedNormal(normal, sbRuntimeHairFiber, SB_RT_HAIR_TRT_SHIFT * sbHairPreShift);
  sbRuntimeHairPrimaryWidth = sbRuntimeHairLobeWidth(SB_RT_HAIR_R_WIDTH, sbRuntimeHairPre.roughness);
  sbRuntimeHairInnerWidth = sbRuntimeHairLobeWidth(SB_RT_HAIR_TRT_WIDTH, sbRuntimeHairPre.radialRoughness);
  float sbHairPreCosine = clamp(dot(normal, sbRuntimeViewDir), 0.0, 1.0);
  float sbHairPreFresnel = sbRuntimeSchlick(sbIorToF0(sbRuntimeHairPre.ior), sbHairPreCosine);
  vec3 sbHairPrePass = sbRuntimeHairTransmittance(sbRuntimeHairPre.melanin, sbHairPreCosine);
  float sbHairPreEntryExit = (1.0 - sbHairPreFresnel) * (1.0 - sbHairPreFresnel);
  vec3 sbHairPreColor = sbRuntimeHairPre.baseColor * sbRuntimeColorModulation;
  sbRuntimeHairTT = sbHairPreEntryExit * sbHairPrePass * sbHairPreColor;
  sbRuntimeHairTRT = sbHairPreEntryExit * sbHairPreFresnel * sbHairPrePass * sbHairPrePass * sbHairPreColor;
  sbRuntimeHairScatter = sbRuntimeHairPre.scatter;
  sbRuntimeHairActive = 1.0;
 }` : ""}
 if (sbRuntimeKind == ${kindConstantName("singleLayerWater")}) {
  ${STRUCT_NAMES.singleLayerWater} sbRuntimeWaterPre = ${READER_NAMES.singleLayerWater}(float(sbRuntimeSlot));
  normal = sbRuntimeTiltNormal(normal, sbRuntimeWaterPre.normal);
 }
 if (sbRuntimeKind == ${kindConstantName("eye")}) {
  ${STRUCT_NAMES.eye} sbRuntimeEye = ${READER_NAMES.eye}(float(sbRuntimeSlot));
  normal = sbRuntimeTiltNormal(normal, sbRuntimeEye.normal);
  float sbEyeCosineView = clamp(dot(normal, sbRuntimeViewDir), 0.0, 1.0);
  float sbEyeRadius = sqrt(max(0.0, 1.0 - sbEyeCosineView * sbEyeCosineView));
  float sbEyeSineRefracted = sbEyeRadius / max(sbRuntimeEye.corneaIor, 1.0);
  float sbEyeCosineRefracted = sqrt(max(1.0e-6, 1.0 - sbEyeSineRefracted * sbEyeSineRefracted));
  float sbEyeShifted = clamp(sbEyeRadius - sbRuntimeEye.irisDepth * (sbEyeSineRefracted / sbEyeCosineRefracted), 0.0, 1.0);
  float sbEyePupil = smoothstep(sbRuntimeEye.pupilRadius, sbRuntimeEye.pupilRadius + SB_RT_EYE_PUPIL_SOFTNESS, sbEyeShifted);
  float sbEyeLimbus = smoothstep(SB_RT_EYE_LIMBUS_START, 1.0, sbEyeRadius);
  float sbEyeLimbusRing = sbEyeLimbus * (1.0 - sbEyeLimbus) * 4.0;
  float sbEyeIrisWeight = sbEyePupil * (1.0 - sbRuntimeEye.limbusDarkening * sbEyeLimbusRing);
  float sbEyeFresnel = sbRuntimeSchlick(sbIorToF0(sbRuntimeEye.corneaIor), sbEyeCosineView);
  vec3 sbEyeIris = material.diffuseColor * sbEyeIrisWeight;
  vec3 sbEyeSclera = sbRuntimeBaseMaterial.diffuseColor * (1.0 - sbRuntimeEye.limbusDarkening * sbEyeLimbusRing);
  material.diffuseColor = mix(sbEyeIris, sbEyeSclera, sbEyeLimbus) * (1.0 - sbEyeFresnel);
 }
 if (sbRuntimeKind == ${kindConstantName("unlit")} || sbRuntimeKind == ${kindConstantName("volume")}) {
  material.diffuseColor = vec3(0.0);
  material.specularColor = vec3(0.0);
  material.specularF90 = 0.0;
 }`
}

export function sbSpecializedPostLightingGlsl({ water = false } = {}) {
	return `
 if (sbRuntimeKind == ${kindConstantName("hair")}) {
  ${STRUCT_NAMES.hair} sbRuntimeHair = ${READER_NAMES.hair}(float(sbRuntimeSlot));
  vec3 sbHairFiber = sbRuntimeHairTangent(normal, sbRuntimeHair.tangent);
  float sbHairCosineView = clamp(dot(normal, sbRuntimeViewDir), 0.0, 1.0);
  float sbHairFresnel = sbRuntimeSchlick(sbIorToF0(sbRuntimeHair.ior), sbHairCosineView);
  vec3 sbHairPass = sbRuntimeHairTransmittance(sbRuntimeHair.melanin, sbHairCosineView);
  float sbHairEntryExit = (1.0 - sbHairFresnel) * (1.0 - sbHairFresnel);
  vec3 sbHairTT = sbHairEntryExit * sbHairPass;
  vec3 sbHairTRT = (sbHairEntryExit * sbHairFresnel) * sbHairPass * sbHairPass;
  vec3 sbHairAmbient = reflectedLight.indirectDiffuse;
  vec3 sbHairPrimary = sbHairAmbient;
  vec3 sbHairInner = sbHairAmbient;
  #if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
   float sbHairShift = 0.5 * sbRuntimeHair.cuticleAngle;
   vec3 sbHairPrimaryNormal = sbRuntimeHairShiftedNormal(normal, sbHairFiber, SB_RT_HAIR_R_SHIFT * sbHairShift);
   vec3 sbHairInnerNormal = sbRuntimeHairShiftedNormal(normal, sbHairFiber, SB_RT_HAIR_TRT_SHIFT * sbHairShift);
   sbHairPrimary = getIBLRadiance(sbRuntimeViewDir, sbHairPrimaryNormal, sbRuntimeHairLobeWidth(SB_RT_HAIR_R_WIDTH, sbRuntimeHair.roughness));
   sbHairInner = getIBLRadiance(sbRuntimeViewDir, sbHairInnerNormal, sbRuntimeHairLobeWidth(SB_RT_HAIR_TRT_WIDTH, sbRuntimeHair.roughness));
  #endif
  vec3 sbHairColor = sbRuntimeHair.baseColor * sbRuntimeColorModulation;
  vec3 sbHairDirectScatter = reflectedLight.directDiffuse * mix(vec3(1.0), sbHairTT, sbRuntimeHair.scatter);
  reflectedLight.directDiffuse = sbHairDirectScatter;
  reflectedLight.indirectSpecular = max(sbHairPrimary * sbHairFresnel + sbHairAmbient * sbHairTT * sbHairColor + sbHairInner * sbHairTRT * sbHairColor, vec3(0.0));
 } else if (sbRuntimeKind == ${kindConstantName("singleLayerWater")}) {
  ${STRUCT_NAMES.singleLayerWater} sbRuntimeWater = ${READER_NAMES.singleLayerWater}(float(sbRuntimeSlot));
  float sbWaterCosineView = clamp(dot(normal, sbRuntimeViewDir), 0.0, 1.0);
  float sbWaterDepth = 1.0 / max(sbWaterCosineView, 0.1);
  vec3 sbWaterIncoming = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
  ${water ? `
  if (uSbSceneParams.w > 0.5) {
   vec2 sbWaterUv = gl_FragCoord.xy / max(uSbSceneSize, vec2(1.0));
   float sbWaterSceneDepth = sbRuntimeSceneViewDepth(sbWaterUv);
   float sbWaterColumn = max(sbWaterSceneDepth - vViewPosition.z, 0.0);
   float sbWaterSine = sqrt(max(0.0, 1.0 - sbWaterCosineView * sbWaterCosineView));
   float sbWaterSineRefracted = sbWaterSine / max(sbRuntimeWater.ior, 1.0);
   float sbWaterCosineRefracted = sqrt(max(1.0e-4, 1.0 - sbWaterSineRefracted * sbWaterSineRefracted));
   sbWaterDepth = sbWaterColumn / sbWaterCosineRefracted;
   vec2 sbWaterOffset = normal.xy * (sbRuntimeWater.ior - 1.0) * 0.08 * clamp(sbWaterColumn, 0.0, 1.0);
   vec2 sbWaterRefractUv = clamp(sbWaterUv + sbWaterOffset, vec2(0.001), vec2(0.999));
   if (sbRuntimeSceneViewDepth(sbWaterRefractUv) < vViewPosition.z) sbWaterRefractUv = sbWaterUv;
   sbWaterIncoming = texture2D(uSbSceneColor, sbWaterRefractUv).rgb;
   sbRuntimeSlab.opacity = 1.0;
  }` : ""}
  vec3 sbWaterTransmittance = exp(-sbRuntimeWater.absorption * sbWaterDepth);
  vec3 sbWaterReflected = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
  vec3 sbWaterRefracted = sbWaterIncoming * sbWaterTransmittance;
  float sbWaterForward = clamp(dot(-sbRuntimeViewDir, normal), 0.0, 1.0);
  float sbWaterPhase = (1.0 - sbRuntimeWater.phaseG * sbRuntimeWater.phaseG) / pow(max(1.0 + sbRuntimeWater.phaseG * sbRuntimeWater.phaseG - 2.0 * sbRuntimeWater.phaseG * sbWaterForward, 1e-3), 1.5);
  vec3 sbWaterScattered = sbRuntimeWater.scattering * (vec3(1.0) - sbWaterTransmittance) * reflectedLight.indirectDiffuse * mix(1.0, sbWaterPhase, 0.25);
  float sbWaterFresnel = sbRuntimeSchlick(sbIorToF0(sbRuntimeWater.ior), sbWaterCosineView);
  reflectedLight.directDiffuse = vec3(0.0);
  reflectedLight.directSpecular = vec3(0.0);
  reflectedLight.indirectSpecular = sbWaterReflected * sbWaterFresnel;
  reflectedLight.indirectDiffuse = (sbWaterRefracted + sbWaterScattered) * (1.0 - sbWaterFresnel);
 } else if (sbRuntimeKind == ${kindConstantName("volume")}) {
  ${STRUCT_NAMES.volume} sbRuntimeVolume = ${READER_NAMES.volume}(float(sbRuntimeSlot));
  float sbVolumeDistance = 1.0 / max(gl_FragCoord.w, 1e-4);
  vec3 sbVolumeTransmittance = exp(-sbRuntimeVolume.extinction * sbVolumeDistance);
  vec3 sbVolumeAmbient = reflectedLight.indirectDiffuse + reflectedLight.directDiffuse;
  reflectedLight.directDiffuse = vec3(0.0);
  reflectedLight.directSpecular = vec3(0.0);
  reflectedLight.indirectSpecular = vec3(0.0);
  reflectedLight.indirectDiffuse = sbRuntimeVolume.albedo * (vec3(1.0) - sbVolumeTransmittance) * max(sbVolumeAmbient, vec3(0.0));
  sbRuntimeSlab.opacity = 1.0 - dot(sbVolumeTransmittance, vec3(1.0 / 3.0));
 } else if (sbRuntimeKind == ${kindConstantName("unlit")}) {
  reflectedLight = ReflectedLight(vec3(0.0), vec3(0.0), vec3(0.0), vec3(0.0));
 }`
}

export function describeSpecializedClosureGlsl() {
	return {
		kinds: [...SB_SPECIALIZED_CLOSURE_KINDS],
		structs: { ...STRUCT_NAMES },
		readers: { ...READER_NAMES },
		declarationCharacterCount: sbSpecializedClosureDeclarations().length,
	}
}
