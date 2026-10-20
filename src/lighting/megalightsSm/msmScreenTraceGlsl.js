import { toGlslFloatLiteral } from "./msmNormalFromDepthGlsl.js";
import { MSM_SCREEN_TRACE_STEP_CEILING } from "./msmScreenTraceBudgetCore.js";
import {
	MSM_SCREEN_TRACE_DISTRIBUTION_EXPONENT,
	MSM_SCREEN_TRACE_EDGE_FADE_UV,
	MSM_SCREEN_TRACE_MINIMUM_CLIP_W,
	MSM_SCREEN_TRACE_MINIMUM_DISTANCE,
	MSM_SCREEN_TRACE_THICKNESS_FAR_SCALE,
	MSM_SCREEN_TRACE_THICKNESS_NEAR_SCALE,
} from "./msmScreenTraceCore.js";


export const MSM_SCREEN_TRACE_UNIFORMS = Object.freeze([
	Object.freeze({
		name: "uMsmScreenTraceStepCount",
		glslType: "float",
		carries: "how many steps to march this frame, 3 to 8, the SAME for every pixel",
	}),
	Object.freeze({
		name: "uMsmScreenTraceThickness",
		glslType: "float",
		carries: "thickness of the occluder window, in view space units",
	}),
	Object.freeze({
		name: "uMsmProjection",
		glslType: "mat4",
		carries: "camera projection, to turn a view position into a screen position",
	}),
]);


export const MSM_SCREEN_TRACE_REQUIRED_FUNCTIONS = Object.freeze(["msmViewDepthAt", "msmIsSkyViewDepth"]);


export const MSM_SCREEN_TRACE_FUNCTIONS = Object.freeze([
	"msmScreenTraceEdgeWeight",
	"msmScreenTraceDistanceAtStep",
	"msmScreenTraceVisibility",
]);


export const MSM_SCREEN_TRACE_SAMPLER_COUNT = 0;


export function buildScreenTraceGlsl() {
	return `
                                                                      

                                                 ${(toGlslFloatLiteral(MSM_SCREEN_TRACE_EDGE_FADE_UV), "")}                   
                                                                              
                                              
float msmScreenTraceEdgeWeight(const in vec2 uv) {
  vec2 distanceToBorder = min(uv, 1.0 - uv);
  return clamp(min(distanceToBorder.x, distanceToBorder.y) / ${toGlslFloatLiteral(MSM_SCREEN_TRACE_EDGE_FADE_UV)}, 0.0, 1.0);
}

                                                                        
float msmScreenTraceDistanceAtStep(const in float stepIndex, const in float stepCount, const in float jitter, const in float maximumTraceDistance) {
  float fraction = max((stepIndex + jitter) / stepCount, 0.0);
  float traceDistance = pow(fraction, ${toGlslFloatLiteral(MSM_SCREEN_TRACE_DISTRIBUTION_EXPONENT)}) * maximumTraceDistance;
  return max(traceDistance, ${toGlslFloatLiteral(MSM_SCREEN_TRACE_MINIMUM_DISTANCE)});
}

                                                                              
float msmScreenTraceVisibility(const in vec3 originViewPosition, const in vec3 lightDirectionViewSpace, const in float maximumTraceDistance, const in float jitter) {
                                                                                
                                                                                         
  vec4 clipOrigin = uMsmProjection * vec4(originViewPosition, 1.0);
  vec4 clipStep = uMsmProjection * vec4(lightDirectionViewSpace, 0.0);
  float occlusion = 0.0;

  for (int stepIndex = 0; stepIndex < ${MSM_SCREEN_TRACE_STEP_CEILING}; stepIndex++) {
                                                                               
                                                       
    if (float(stepIndex) >= uMsmScreenTraceStepCount) break;

    float traceDistance = msmScreenTraceDistanceAtStep(float(stepIndex), uMsmScreenTraceStepCount, jitter, maximumTraceDistance);
    vec4 clipPosition = clipOrigin + clipStep * traceDistance;

                                                                              
                                                                               
                                                                                      
    float isInFrontOfCamera = clipPosition.w > 0.0 ? 1.0 : 0.0;
    float safeClipW = max(clipPosition.w, ${toGlslFloatLiteral(MSM_SCREEN_TRACE_MINIMUM_CLIP_W)});
    vec2 sampleUv = clipPosition.xy / safeClipW * 0.5 + 0.5;
    float edgeWeight = msmScreenTraceEdgeWeight(sampleUv);

    float sceneViewDepth = msmViewDepthAt(sampleUv);
    float marchedViewDepth = -(originViewPosition.z + lightDirectionViewSpace.z * traceDistance);
    float depthDifference = marchedViewDepth - sceneViewDepth;

                                                                            
                                                                            
    float isInsideThicknessWindow =
      (depthDifference > uMsmScreenTraceThickness * ${toGlslFloatLiteral(MSM_SCREEN_TRACE_THICKNESS_NEAR_SCALE)}) &&
      (uMsmScreenTraceThickness * ${toGlslFloatLiteral(MSM_SCREEN_TRACE_THICKNESS_FAR_SCALE)} > depthDifference) ? 1.0 : 0.0;
    float hasSurface = msmIsSkyViewDepth(sceneViewDepth) ? 0.0 : 1.0;

    occlusion = max(occlusion, isInsideThicknessWindow * hasSurface * edgeWeight * isInFrontOfCamera);
  }

  return 1.0 - occlusion;
}
`;
}
