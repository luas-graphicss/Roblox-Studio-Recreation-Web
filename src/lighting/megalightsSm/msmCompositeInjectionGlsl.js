import { toGlslFloatLiteral } from "./msmNormalFromDepthGlsl.js";
import {
	MSM_INJECTION_CLIP_W_EPSILON,
	MSM_INJECTION_OWNER_PHASE,
	MSM_INJECTION_TEXTURE_UNIT_COST,
} from "./msmCompositeInjectionCore.js";

export const MSM_INJECTION_UNIFORM_ON = "uMsmInjectionOn";
export const MSM_INJECTION_UNIFORM_HISTORY = "uMsmIrradianceHistory";
export const MSM_INJECTION_UNIFORM_PREVIOUS_VIEW_PROJECTION = "uMsmInjectionPreviousViewProjection";
export const MSM_INJECTION_UNIFORM_GAIN = "uMsmInjectionGain";

export const MSM_INJECTION_VARYING_WORLD_POSITION = "vMsmInjectionWorldPosition";

export const MSM_INJECTION_UNIFORMS = Object.freeze([
	Object.freeze({
		name: MSM_INJECTION_UNIFORM_ON,
		glslType: "float",
		carries: "gate 0/1 da injecao; troca sem recompilar",
	}),
	Object.freeze({
		name: MSM_INJECTION_UNIFORM_HISTORY,
		glslType: "sampler2D",
		carries: "historia de irradiancia do quadro anterior (unica unidade de textura)",
	}),
	Object.freeze({
		name: MSM_INJECTION_UNIFORM_PREVIOUS_VIEW_PROJECTION,
		glslType: "mat4",
		carries: "viewProjection do quadro anterior (ADR-1)",
	}),
	Object.freeze({
		name: MSM_INJECTION_UNIFORM_GAIN,
		glslType: "float",
		carries: "ganho de energia da injecao",
	}),
]);

export const MSM_INJECTION_TEXTURE_UNITS = Object.freeze([MSM_INJECTION_UNIFORM_HISTORY]);

export const MSM_INJECTION_FUNCTIONS = Object.freeze([
	"msmInjectionHistoryUv",
	"msmInjectionIrradiance",
]);


export const MSM_INJECTION_FRAGMENT_DECLARATION_ANCHOR = "#include <lights_pars_begin>";
export const MSM_INJECTION_FRAGMENT_APPLY_ANCHOR = "#include <lights_fragment_end>";
export const MSM_INJECTION_VERTEX_WRITE_ANCHOR = "#include <worldpos_vertex>";

export const MSM_INJECTION_FRAGMENT_ANCHORS = Object.freeze([
	MSM_INJECTION_FRAGMENT_DECLARATION_ANCHOR,
	MSM_INJECTION_FRAGMENT_APPLY_ANCHOR,
]);

export const MSM_INJECTION_VERTEX_ANCHORS = Object.freeze([MSM_INJECTION_VERTEX_WRITE_ANCHOR]);


export const MSM_INJECTION_REQUIRED_SYMBOLS = Object.freeze([
	"reflectedLight.indirectDiffuse",
	"material.diffuseColor",
	"BRDF_Lambert",
]);

export const MSM_INJECTION_REQUIRED_SHADER_CHUNKS = Object.freeze([
	"lights_pars_begin",
	"lights_fragment_end",
	"worldpos_vertex",
]);

export function buildCompositeInjectionVertexDeclarationGlsl() {
	return [
		"// " + MSM_INJECTION_OWNER_PHASE + ": world position consumed by the forward injection.",
		"varying vec3 " + MSM_INJECTION_VARYING_WORLD_POSITION + ";",
		"",
	].join("\n");
}

export function buildCompositeInjectionVertexWriteGlsl() {
	return [
		"\tvec4 msmInjectionWorldPosition = vec4( transformed, 1.0 );",
		"\t#ifdef USE_INSTANCING",
		"\t\tmsmInjectionWorldPosition = instanceMatrix * msmInjectionWorldPosition;",
		"\t#endif",
		"\t" + MSM_INJECTION_VARYING_WORLD_POSITION + " = ( modelMatrix * msmInjectionWorldPosition ).xyz;",
	].join("\n");
}

export function buildCompositeInjectionDeclarationGlsl() {
	const clipEpsilon = toGlslFloatLiteral(MSM_INJECTION_CLIP_W_EPSILON);
	return [
		"// " + MSM_INJECTION_OWNER_PHASE + ": MegaLights irradiance injected into the forward pass.",
		"// One texture sample per fragment, no light loop, no branch, no #ifdef.",
		"// Texture unit cost: " + MSM_INJECTION_TEXTURE_UNIT_COST + ".",
		"uniform float " + MSM_INJECTION_UNIFORM_ON + ";",
		"uniform sampler2D " + MSM_INJECTION_UNIFORM_HISTORY + ";",
		"uniform mat4 " + MSM_INJECTION_UNIFORM_PREVIOUS_VIEW_PROJECTION + ";",
		"uniform float " + MSM_INJECTION_UNIFORM_GAIN + ";",
		"varying vec3 " + MSM_INJECTION_VARYING_WORLD_POSITION + ";",
		"",
		"// Reprojects a world position with the previous frame view projection.",
		"// Returns uv in xy and the inside-history factor in z.",
		"vec3 msmInjectionHistoryUv( vec3 worldPosition ) {",
		"\tvec4 clipPosition = " + MSM_INJECTION_UNIFORM_PREVIOUS_VIEW_PROJECTION + " * vec4( worldPosition, 1.0 );",
		"\tfloat safeClipW = max( abs( clipPosition.w ), " + clipEpsilon + " );",
		"\tvec2 historyUv = clipPosition.xy / safeClipW * 0.5 + 0.5;",
		"\tfloat insideHistory = step( 0.0, historyUv.x ) * step( historyUv.x, 1.0 )",
		"\t\t* step( 0.0, historyUv.y ) * step( historyUv.y, 1.0 )",
		"\t\t* step( 0.0, clipPosition.w );",
		"\treturn vec3( historyUv, insideHistory );",
		"}",
		"",
		"// The whole cost of the phase: a single sample, independent of light count.",
		"vec3 msmInjectionIrradiance( vec3 worldPosition ) {",
		"\tvec3 historyUvInside = msmInjectionHistoryUv( worldPosition );",
		"\tvec3 historyIrradiance = texture2D( " + MSM_INJECTION_UNIFORM_HISTORY + ", historyUvInside.xy ).rgb;",
		"\treturn historyIrradiance * ( " + MSM_INJECTION_UNIFORM_GAIN + " * historyUvInside.z * " + MSM_INJECTION_UNIFORM_ON + " );",
		"}",
		"",
	].join("\n");
}

export function buildCompositeInjectionApplyGlsl() {
	return [
		"\t// " + MSM_INJECTION_OWNER_PHASE + ": irradiance times diffuse color (BRDF_Lambert).",
		"\treflectedLight.indirectDiffuse += msmInjectionIrradiance( " + MSM_INJECTION_VARYING_WORLD_POSITION + " )",
		"\t\t* BRDF_Lambert( material.diffuseColor );",
	].join("\n");
}

export function describeCompositeInjectionGlsl() {
	return Object.freeze({
		ownerPhase: MSM_INJECTION_OWNER_PHASE,
		uniforms: MSM_INJECTION_UNIFORMS,
		textureUnits: MSM_INJECTION_TEXTURE_UNITS,
		functions: MSM_INJECTION_FUNCTIONS,
		fragmentAnchors: MSM_INJECTION_FRAGMENT_ANCHORS,
		vertexAnchors: MSM_INJECTION_VERTEX_ANCHORS,
		requiredSymbols: MSM_INJECTION_REQUIRED_SYMBOLS,
		requiredShaderChunks: MSM_INJECTION_REQUIRED_SHADER_CHUNKS,
		textureUnitCost: MSM_INJECTION_TEXTURE_UNIT_COST,
	});
}
