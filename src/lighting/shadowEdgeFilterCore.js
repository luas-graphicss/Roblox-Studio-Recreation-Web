import { DEFAULT_SHADOW_SOFTNESS, sunEdgeTexels } from "./shadowEdgeSharpness.js";
import {
	SHADOW_EDGE_AXIS_TAP_SPAN,
	buildShadowEdgeBasisGlsl,
} from "./shadowEdgeBasisCore.js";
import { buildShadowEdgeSilhouetteGlsl } from "./shadowEdgeSilhouetteCore.js";
import { buildShadowEdgeCornerGlsl } from "./shadowEdgeCornerCore.js";
import { buildShadowEdgeRevectorizationGlsl } from "./shadowEdgeRevectorizationCore.js";
import { buildShadowEdgeRunLengthGlsl } from "./shadowEdgeRunLengthCore.js";
import { buildShadowEdgeTreadPeriodGlsl } from "./shadowEdgeTreadPeriodCore.js";
import { buildShadowEdgeWalkFrameGlsl } from "./shadowEdgeWalkFrameCore.js";
import { buildShadowEdgeMapBoundsGlsl } from "./shadowEdgeMapBoundsCore.js";
import { buildShadowEdgePerpendicularDistanceGlsl } from "./shadowEdgePerpendicularDistanceCore.js";
import { buildShadowEdgeLineFitGlsl } from "./shadowEdgeLineFitCore.js";
import { buildShadowEdgeContourBlendGlsl } from "./shadowEdgeContourBlendCore.js";
import { buildShadowEdgeFrameBlendGlsl } from "./shadowEdgeFrameBlendCore.js";
import {
	STRAIGHT_KERNEL_MAX_TAP_COUNT,
	STRAIGHT_KERNEL_ORIENTED_TAP_COUNT,
	buildShadowEdgeStraightKernelGlsl,
} from "./shadowEdgeStraightKernelCore.js";


export const SHADOW_EDGE_FALLBACK_RADIUS_TEXELS = 1;


export const SHADOW_EDGE_RADIUS_MARKER = -SHADOW_EDGE_FALLBACK_RADIUS_TEXELS;


export const SHADOW_EDGE_TAP_SPAN = SHADOW_EDGE_AXIS_TAP_SPAN;
export const SHADOW_EDGE_TAP_COUNT = SHADOW_EDGE_TAP_SPAN * SHADOW_EDGE_TAP_SPAN;


export const SHADOW_EDGE_SILHOUETTE_TAP_COUNT = STRAIGHT_KERNEL_ORIENTED_TAP_COUNT;


export const SHADOW_EDGE_MAX_TAP_COUNT = STRAIGHT_KERNEL_MAX_TAP_COUNT;


export const SHADOW_EDGE_MIN_WIDTH_TEXELS = 1;
export const SHADOW_EDGE_MAX_WIDTH_TEXELS = 4;


export function shadowEdgeWidthTexels(softness) {
	return Math.min(
		SHADOW_EDGE_MAX_WIDTH_TEXELS,
		Math.max(SHADOW_EDGE_MIN_WIDTH_TEXELS, sunEdgeTexels(softness, "ShadowMap")),
	);
}


export const SHADOW_EDGE_DEFAULT_WIDTH_TEXELS = shadowEdgeWidthTexels(DEFAULT_SHADOW_SOFTNESS);


export function shadowEdgeFilterPlan(rawOptions) {
	const options = rawOptions && typeof rawOptions === "object" ? rawOptions : {};
	const technologyWantsFilter = options.tech === "ShadowMap";
	const supported = options.supported === true;
	const shadowsOn = options.shadowsOn !== false;
	const forced = options.forced;
	const wanted = forced === true ? true : forced === false ? false : technologyWantsFilter;
	const on = wanted && supported && shadowsOn;
	const reason = on
		? "on"
		: !wanted
			? "technology-off"
			: !supported
				? "unsupported-chunk"
				: "shadows-off";
	return Object.freeze({
		on,
		radius: on ? SHADOW_EDGE_RADIUS_MARKER : null,
		taps: SHADOW_EDGE_TAP_COUNT,
		silhouetteTaps: SHADOW_EDGE_SILHOUETTE_TAP_COUNT,
		maxTaps: SHADOW_EDGE_MAX_TAP_COUNT,
		reason,
	});
}


export function buildShadowEdgeUniformGlsl() {
	return `
                                                                            
                                                                            
                                                                              
                                                                             
         
uniform float uRswShadowEdgeOn;
uniform float uRswShadowEdgeWidth;
`;
}


export function buildShadowEdgeFilterGlsl() {
	return (
		buildShadowEdgeMapBoundsGlsl() +
		buildShadowEdgeBasisGlsl() +
		buildShadowEdgeUniformGlsl() +
		buildShadowEdgeSilhouetteGlsl() +
		buildShadowEdgeLineFitGlsl() +


		buildShadowEdgeRunLengthGlsl() +


		buildShadowEdgeTreadPeriodGlsl() +
		buildShadowEdgePerpendicularDistanceGlsl() +


		buildShadowEdgeContourBlendGlsl() +


		buildShadowEdgeFrameBlendGlsl() +
		buildShadowEdgeStraightKernelGlsl() +
		buildShadowEdgeCornerGlsl() +


		buildShadowEdgeWalkFrameGlsl() +
		buildShadowEdgeRevectorizationGlsl() +
		`
                                                                             
                                                                                
                                                                     
float rswShadowEdge(sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, vec4 shadowCoordIn) {
  vec3 rswCoord = shadowCoordIn.xyz / shadowCoordIn.w;
  rswCoord.z += shadowBias;
  bvec4 rswInFrustum = bvec4(rswCoord.x >= 0.0, 1.0 >= rswCoord.x, rswCoord.y >= 0.0, 1.0 >= rswCoord.y);
  if (!all(rswInFrustum) || rswCoord.z > 1.0 || 0.0 > rswCoord.z) return 1.0;
                                                                               
                                                                             
                                                                                
                                                                                 
                                                                   
  float rswRevectorized = rswShadowEdgeRevectorized(shadowMap, shadowMapSize, rswCoord.xy, rswCoord.z, uRswShadowEdgeWidth);
  if (rswRevectorized >= 0.0) return rswRevectorized;
                                                                                
                                                                                
                                                                               
                                                                               
                                                                              
                                                                        
  return rswShadowEdgeStraightened(shadowMap, shadowMapSize, shadowBias, shadowCoordIn, uRswShadowEdgeWidth);
}
`
	);
}


export function buildShadowEdgeFilterReturn() {


	const bandLow = (SHADOW_EDGE_RADIUS_MARKER - 0.5).toFixed(1);
	const bandHigh = (SHADOW_EDGE_RADIUS_MARKER + 0.5).toFixed(1);
	return `
                                          ${(SHADOW_EDGE_RADIUS_MARKER, "")}                         
                                                                         
                                                                           
                                                                       
  if (uRswShadowEdgeOn > 0.5 && shadowRadius > ${bandLow} && ${bandHigh} > shadowRadius) {
    return rswShadowEdge(shadowMap, shadowMapSize, shadowBias, shadowCoord);
  }
`;
}
