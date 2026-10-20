import { isSkyViewDepth } from "./msmNormalFromDepthCore.js";
import { clampScreenTraceStepCount } from "./msmScreenTraceBudgetCore.js";


export const MSM_SCREEN_TRACE_DISTRIBUTION_EXPONENT = 1.35;


export const MSM_SCREEN_TRACE_MINIMUM_DISTANCE = 0.02;


export const MSM_SCREEN_TRACE_EDGE_FADE_UV = 0.08;


export const MSM_SCREEN_TRACE_THICKNESS_NEAR_SCALE = 0.08;
export const MSM_SCREEN_TRACE_THICKNESS_FAR_SCALE = 4.0;


export const MSM_SCREEN_TRACE_MINIMUM_CLIP_W = 1e-6;


export const MSM_SCREEN_TRACE_MIRROR_ARGUMENT_ORDER = Object.freeze({
	traceDistanceAtStep: Object.freeze({
		arguments: Object.freeze(["stepIndex", "stepCount", "jitter", "maximumTraceDistance"]),
		glslCounterpart: "msmScreenTraceDistanceAtStep",
	}),
	screenEdgeWeight: Object.freeze({
		arguments: Object.freeze(["uv"]),
		glslCounterpart: "msmScreenTraceEdgeWeight",
		note: "the GLSL takes one vec2; the JS takes its two components, so the JS arity is two",
		jsArgumentCount: 2,
	}),
	traceScreenSpaceVisibility: Object.freeze({
		arguments: Object.freeze(["originViewPosition", "lightDirectionViewSpace", "maximumTraceDistance", "jitter"]),
		glslCounterpart: "msmScreenTraceVisibility",
		note: "the JS takes one request object; these are the fields it reads, in the order the GLSL declares them",
		jsArgumentCount: 1,
	}),
});


export function traceDistanceAtStep(stepIndex, stepCount, jitter, maximumTraceDistance) {
	const fraction = Math.max((stepIndex + jitter) / stepCount, 0);
	const distance = Math.pow(fraction, MSM_SCREEN_TRACE_DISTRIBUTION_EXPONENT) * maximumTraceDistance;
	return Math.max(distance, MSM_SCREEN_TRACE_MINIMUM_DISTANCE);
}


export function screenEdgeWeight(uvX, uvY) {
	const horizontalDistanceToBorder = Math.min(uvX, 1 - uvX);
	const verticalDistanceToBorder = Math.min(uvY, 1 - uvY);
	const distanceToBorder = Math.min(horizontalDistanceToBorder, verticalDistanceToBorder);
	return Math.min(Math.max(distanceToBorder / MSM_SCREEN_TRACE_EDGE_FADE_UV, 0), 1);
}


export function isInsideThicknessWindow(depthDifference, thickness) {
	const nearBound = thickness * MSM_SCREEN_TRACE_THICKNESS_NEAR_SCALE;
	const farBound = thickness * MSM_SCREEN_TRACE_THICKNESS_FAR_SCALE;
	return depthDifference > nearBound && farBound > depthDifference;
}


export function transformViewPositionToClip(projectionElements, x, y, z, w) {
	const element = projectionElements;
	return [
		element[0] * x + element[4] * y + element[8] * z + element[12] * w,
		element[1] * x + element[5] * y + element[9] * z + element[13] * w,
		element[2] * x + element[6] * y + element[10] * z + element[14] * w,
		element[3] * x + element[7] * y + element[11] * z + element[15] * w,
	];
}











export function buildHoistedClipRay(projectionElements, originViewPosition, lightDirectionViewSpace) {
	return {
		clipOrigin: transformViewPositionToClip(
			projectionElements,
			originViewPosition[0],
			originViewPosition[1],
			originViewPosition[2],
			1,
		),
		clipStep: transformViewPositionToClip(
			projectionElements,
			lightDirectionViewSpace[0],
			lightDirectionViewSpace[1],
			lightDirectionViewSpace[2],
			0,
		),
	};
}


export function clipPositionToScreenUv(clipPosition) {
	const clipW = clipPosition[3];
	const isInFrontOfCamera = clipW > 0;
	const safeClipW = Math.max(clipW, MSM_SCREEN_TRACE_MINIMUM_CLIP_W);
	return {
		uvX: (clipPosition[0] / safeClipW) * 0.5 + 0.5,
		uvY: (clipPosition[1] / safeClipW) * 0.5 + 0.5,
		isInFrontOfCamera,
	};
}


export function traceScreenSpaceVisibility(request) {
	const {
		originViewPosition,
		lightDirectionViewSpace,
		maximumTraceDistance,
		jitter,
		thickness,
		cameraFar,
		projectionElements,
		sampleSceneViewDepth,
	} = request;


	const stepCount = clampScreenTraceStepCount(request.stepCount);
	const { clipOrigin, clipStep } = buildHoistedClipRay(projectionElements, originViewPosition, lightDirectionViewSpace);

	const steps = [];
	let occlusion = 0;
	let depthTapCount = 0;

	for (let stepIndex = 0; stepCount > stepIndex; stepIndex += 1) {
		const traceDistance = traceDistanceAtStep(stepIndex, stepCount, jitter, maximumTraceDistance);
		const clipPosition = [
			clipOrigin[0] + clipStep[0] * traceDistance,
			clipOrigin[1] + clipStep[1] * traceDistance,
			clipOrigin[2] + clipStep[2] * traceDistance,
			clipOrigin[3] + clipStep[3] * traceDistance,
		];
		const screenPosition = clipPositionToScreenUv(clipPosition);
		const edgeWeight = screenEdgeWeight(screenPosition.uvX, screenPosition.uvY);



		const sceneViewDepth = sampleSceneViewDepth(screenPosition.uvX, screenPosition.uvY);
		depthTapCount += 1;

		const marchedViewDepth = -(originViewPosition[2] + lightDirectionViewSpace[2] * traceDistance);
		const depthDifference = marchedViewDepth - sceneViewDepth;
		const hasSurface = !isSkyViewDepth(sceneViewDepth, cameraFar);
		const blocks = hasSurface && screenPosition.isInFrontOfCamera && isInsideThicknessWindow(depthDifference, thickness);
		const stepOcclusion = blocks ? edgeWeight : 0;

		if (stepOcclusion > occlusion) occlusion = stepOcclusion;
		steps.push({
			stepIndex,
			traceDistance,
			uvX: screenPosition.uvX,
			uvY: screenPosition.uvY,
			edgeWeight,
			sceneViewDepth,
			marchedViewDepth,
			depthDifference,
			blocks,
			stepOcclusion,
		});
	}

	return { visibility: 1 - occlusion, occlusion, stepCount, depthTapCount, steps };
}
