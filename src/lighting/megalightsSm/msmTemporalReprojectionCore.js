import { isSkyViewDepth } from "./msmNormalFromDepthCore.js";
import {
	MSM_SCREEN_TRACE_MINIMUM_CLIP_W,
	clipPositionToScreenUv,
	transformViewPositionToClip,
} from "./msmScreenTraceCore.js";

export const MSM_REPROJECTION_OWNER = "MSM-F26";


export const MSM_REPROJECTION_MATRIX_UNIFORM_NAME = "uMsmPreviousClipFromCurrentView";
export const MSM_REPROJECTION_MATRIX_ELEMENT_COUNT = 16;


export const MSM_REPROJECTION_MINIMUM_CLIP_W = MSM_SCREEN_TRACE_MINIMUM_CLIP_W;


export const MSM_REPROJECTION_REFUSED_SOURCES = Object.freeze([
	"motionVectorTexture",
	"previousDepthTexture",
	"objectVelocityAttribute",
]);


export const MSM_REPROJECTION_REASON = Object.freeze({
	reprojected: "reprojected",
	matrixMissing: "matrixMissing",
	sky: "sky",
	behindCamera: "behindCamera",
	offScreen: "offScreen",
});

export const MSM_REPROJECTION_VALID_WEIGHT = 1;
export const MSM_REPROJECTION_INVALID_WEIGHT = 0;


export const MSM_REPROJECTION_MIRROR_ARGUMENT_ORDER = Object.freeze({
	reprojectViewPositionToPreviousUv: Object.freeze({
		arguments: Object.freeze(["viewPosition", "previousClipFromCurrentViewElements", "cameraFar"]),
		glslCounterpart: "msmReprojectToPreviousUv",
		note: "the GLSL takes the view position only; the matrix and the far plane are uniforms",
		jsArgumentCount: 1,
	}),
});

function hasMatrixElements(value) {
	const isIndexable = Array.isArray(value) || ArrayBuffer.isView(value);
	return isIndexable && value.length >= MSM_REPROJECTION_MATRIX_ELEMENT_COUNT;
}

function hasViewPosition(value) {
	const isIndexable = Array.isArray(value) || ArrayBuffer.isView(value);
	return isIndexable && value.length >= 3;
}

function refuseReprojection(reason) {
	return Object.freeze({
		uvX: 0,
		uvY: 0,
		validity: MSM_REPROJECTION_INVALID_WEIGHT,
		reason,
		isInFrontOfCamera: false,
		isOnScreen: false,
		isSky: false,
		parallaxUvLength: null,
	});
}


export function measureParallaxUvLength(currentUvX, currentUvY, previousUvX, previousUvY) {
	const deltaX = previousUvX - currentUvX;
	const deltaY = previousUvY - currentUvY;
	return Math.sqrt(deltaX * deltaX + deltaY * deltaY);
}









export function reprojectViewPositionToPreviousUv(request) {
	const source = request && typeof request === "object" ? request : {};
	if (!hasMatrixElements(source.previousClipFromCurrentViewElements)) {
		return refuseReprojection(MSM_REPROJECTION_REASON.matrixMissing);
	}
	if (!hasViewPosition(source.viewPosition)) {
		return refuseReprojection(MSM_REPROJECTION_REASON.matrixMissing);
	}

	const viewPosition = source.viewPosition;
	const previousClipPosition = transformViewPositionToClip(
		source.previousClipFromCurrentViewElements,
		Number(viewPosition[0]),
		Number(viewPosition[1]),
		Number(viewPosition[2]),
		1,
	);
	const screenPosition = clipPositionToScreenUv(previousClipPosition);

	const isOnScreen =
		screenPosition.uvX >= 0 && screenPosition.uvX <= 1 && screenPosition.uvY >= 0 && screenPosition.uvY <= 1;
	const isSky = isSkyViewDepth(-Number(viewPosition[2]), Number(source.cameraFar));
	const isValid = !isSky && screenPosition.isInFrontOfCamera && isOnScreen;

	let reason = MSM_REPROJECTION_REASON.reprojected;
	if (isSky) reason = MSM_REPROJECTION_REASON.sky;
	else if (!screenPosition.isInFrontOfCamera) reason = MSM_REPROJECTION_REASON.behindCamera;
	else if (!isOnScreen) reason = MSM_REPROJECTION_REASON.offScreen;

	const hasCurrentUv = Number.isFinite(source.currentUvX) && Number.isFinite(source.currentUvY);

	return Object.freeze({
		uvX: screenPosition.uvX,
		uvY: screenPosition.uvY,
		validity: isValid ? MSM_REPROJECTION_VALID_WEIGHT : MSM_REPROJECTION_INVALID_WEIGHT,
		reason,
		isInFrontOfCamera: screenPosition.isInFrontOfCamera,
		isOnScreen,
		isSky,
		parallaxUvLength: hasCurrentUv
			? measureParallaxUvLength(source.currentUvX, source.currentUvY, screenPosition.uvX, screenPosition.uvY)
			: null,
	});
}
