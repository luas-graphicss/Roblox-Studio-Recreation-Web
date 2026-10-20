export const MSM_NORMAL_TAP_COUNT = 3;


export const MSM_SKY_DEPTH_RATIO = 0.98;


export const MSM_MINIMUM_NORMAL_LENGTH = 1e-8;


export const MSM_MIRROR_ARGUMENT_ORDER = Object.freeze({
	viewPositionFromViewDepth: Object.freeze({
		arguments: Object.freeze(["uvX", "uvY", "viewDepth", "inverseProjectionX", "inverseProjectionY"]),
		glslCounterpart: "msmViewPositionAt",
	}),
	normalFromViewPositionTaps: Object.freeze({
		arguments: Object.freeze([
			"centerViewPosition",
			"horizontalViewPosition",
			"verticalViewPosition",
			"horizontalStepSign",
			"verticalStepSign",
		]),
		glslCounterpart: "msmViewNormalFromDepth",
	}),
	stepSignForUvComponent: Object.freeze({
		arguments: Object.freeze(["uvComponent", "texelSize"]),
		glslCounterpart: "msmStepSign",
	}),
});


export function viewPositionFromViewDepth(uvX, uvY, viewDepth, inverseProjectionX, inverseProjectionY) {
	const normalizedDeviceX = uvX * 2 - 1;
	const normalizedDeviceY = uvY * 2 - 1;
	return [normalizedDeviceX * inverseProjectionX * viewDepth, normalizedDeviceY * inverseProjectionY * viewDepth, -viewDepth];
}


export function stepSignForUvComponent(uvComponent, texelSize) {
	return uvComponent + texelSize <= 1 ? 1 : -1;
}

function scaledDifference(fromPosition, toPosition, scale) {
	return [
		(fromPosition[0] - toPosition[0]) * scale,
		(fromPosition[1] - toPosition[1]) * scale,
		(fromPosition[2] - toPosition[2]) * scale,
	];
}


export function normalFromViewPositionTaps(
	centerViewPosition,
	horizontalViewPosition,
	verticalViewPosition,
	horizontalStepSign,
	verticalStepSign,
) {
	const horizontalDelta = scaledDifference(horizontalViewPosition, centerViewPosition, horizontalStepSign);
	const verticalDelta = scaledDifference(verticalViewPosition, centerViewPosition, verticalStepSign);

	let normalX = verticalDelta[1] * horizontalDelta[2] - verticalDelta[2] * horizontalDelta[1];
	let normalY = verticalDelta[2] * horizontalDelta[0] - verticalDelta[0] * horizontalDelta[2];
	let normalZ = verticalDelta[0] * horizontalDelta[1] - verticalDelta[1] * horizontalDelta[0];

	const length = Math.sqrt(normalX * normalX + normalY * normalY + normalZ * normalZ);
	if (!(length > MSM_MINIMUM_NORMAL_LENGTH)) return [0, 0, 1];

	normalX /= length;
	normalY /= length;
	normalZ /= length;
	if (normalZ < 0) return [-normalX, -normalY, -normalZ];
	return [normalX, normalY, normalZ];
}


export function isSkyViewDepth(viewDepth, cameraFar) {
	if (!Number.isFinite(viewDepth) || !Number.isFinite(cameraFar) || cameraFar <= 0) return true;
	return viewDepth >= cameraFar * MSM_SKY_DEPTH_RATIO;
}


export function reconstructViewNormalFromDepth(request) {
	const { uvX, uvY, texelWidth, texelHeight, inverseProjectionX, inverseProjectionY, sampleViewDepth } = request;

	const horizontalStepSign = stepSignForUvComponent(uvX, texelWidth);
	const verticalStepSign = stepSignForUvComponent(uvY, texelHeight);
	const horizontalUvX = uvX + texelWidth * horizontalStepSign;
	const verticalUvY = uvY + texelHeight * verticalStepSign;

	const viewDepth = sampleViewDepth(uvX, uvY);
	const centerViewPosition = viewPositionFromViewDepth(uvX, uvY, viewDepth, inverseProjectionX, inverseProjectionY);
	const horizontalViewPosition = viewPositionFromViewDepth(
		horizontalUvX,
		uvY,
		sampleViewDepth(horizontalUvX, uvY),
		inverseProjectionX,
		inverseProjectionY,
	);
	const verticalViewPosition = viewPositionFromViewDepth(
		uvX,
		verticalUvY,
		sampleViewDepth(uvX, verticalUvY),
		inverseProjectionX,
		inverseProjectionY,
	);

	return {
		viewNormal: normalFromViewPositionTaps(
			centerViewPosition,
			horizontalViewPosition,
			verticalViewPosition,
			horizontalStepSign,
			verticalStepSign,
		),
		centerViewPosition,
		viewDepth,
		tapCount: MSM_NORMAL_TAP_COUNT,
		horizontalStepSign,
		verticalStepSign,
	};
}


export function angleBetweenUnitVectorsInDegrees(first, second) {
	const a = Array.isArray(first) ? first : [0, 0, 0];
	const b = Array.isArray(second) ? second : [0, 0, 0];
	const dotProduct = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
	return (Math.acos(dotProduct) * 180) / Math.PI;
}
