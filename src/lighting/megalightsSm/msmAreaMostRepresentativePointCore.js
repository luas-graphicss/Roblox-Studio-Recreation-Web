import { AREA_CLAMPS, clampAreaNumber, faceFrame, rectLightNits, sanitizeRectSize } from "../ltcCore.js";
import { MSM_MRP_LITE_TIER, MSM_SPECULAR_MODE, MSM_SPECULAR_PHASE_ID } from "./msmSpecularTierPolicyCore.js";


export const MSM_MRP_PHASE_ID = MSM_SPECULAR_PHASE_ID;


export const MSM_MRP_TEXTURE_UNIT_COST = 0;


export const MSM_MRP_DIAGONAL_DISTANCE_FACTOR = 0.5;


export const MSM_MRP_IRRADIANCE_CEILING_IN_NITS = 2;


export const MSM_MRP_REFUSAL = Object.freeze({
	MODE_WITHOUT_MRP: "modeWithoutMrp",
	INVALID_SURFACE: "invalidSurface",
	INVALID_RECT_LIGHT: "invalidRectLight",
	SURFACE_FACING_AWAY: "surfaceFacingAway",
	SURFACE_BEHIND_EMITTER: "surfaceBehindEmitter",
	DARK_EMITTER: "darkEmitter",
});

function isFiniteNumber(value) {
	return typeof value === "number" && Number.isFinite(value);
}

function isFiniteVector(value) {
	return Boolean(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y) && isFiniteNumber(value.z);
}

function vectorFromArray(values) {
	return { x: values[0], y: values[1], z: values[2] };
}

function dotProduct(first, second) {
	return first.x * second.x + first.y * second.y + first.z * second.z;
}

function scaledVector(vector, scale) {
	return { x: vector.x * scale, y: vector.y * scale, z: vector.z * scale };
}

function addedVectors(first, second) {
	return { x: first.x + second.x, y: first.y + second.y, z: first.z + second.z };
}

function subtractedVectors(first, second) {
	return { x: first.x - second.x, y: first.y - second.y, z: first.z - second.z };
}

function vectorLength(vector) {
	return Math.sqrt(dotProduct(vector, vector));
}


export function resolveRectBasis(rectLight) {
	const basis = rectLight && typeof rectLight === "object" ? rectLight.basis : null;
	if (basis && isFiniteVector(basis.normal) && isFiniteVector(basis.right) && isFiniteVector(basis.up)) {
		return { normal: basis.normal, right: basis.right, up: basis.up, source: "basis" };
	}
	const frame = faceFrame(rectLight && typeof rectLight === "object" ? rectLight.faceName : undefined);
	return {
		normal: vectorFromArray(frame.normal),
		right: vectorFromArray(frame.right),
		up: vectorFromArray(frame.up),
		source: "faceFrame",
	};
}


export function rectAxialIntensity(rectLight) {
	const settings = rectLight && typeof rectLight === "object" ? rectLight : {};
	const size = sanitizeRectSize(settings);
	const brightness = clampAreaNumber(settings.brightness, AREA_CLAMPS.brightness[0], AREA_CLAMPS.brightness[1], 1);
	const nits = rectLightNits(brightness, size.width, size.height);
	return { nits, area: size.width * size.height, intensity: nits * size.width * size.height, size };
}


export function rectMinimumSampleDistance(rectLight) {
	const size = sanitizeRectSize(rectLight && typeof rectLight === "object" ? rectLight : {});
	const diagonal = Math.sqrt(size.width * size.width + size.height * size.height);
	return diagonal * MSM_MRP_DIAGONAL_DISTANCE_FACTOR;
}


export function mostRepresentativePointOnRect(request) {
	const settings = request && typeof request === "object" ? request : {};
	const rectLight = settings.rectLight && typeof settings.rectLight === "object" ? settings.rectLight : null;
	const surfacePosition = settings.surfacePosition;
	const reflectionDirection = settings.reflectionDirection;

	if (!rectLight || !isFiniteVector(rectLight.center)) {
		return { accepted: false, refusal: MSM_MRP_REFUSAL.INVALID_RECT_LIGHT, point: null };
	}
	if (!isFiniteVector(surfacePosition) || !isFiniteVector(reflectionDirection)) {
		return { accepted: false, refusal: MSM_MRP_REFUSAL.INVALID_SURFACE, point: null };
	}

	const basis = resolveRectBasis(rectLight);
	const size = sanitizeRectSize(rectLight);
	const halfWidth = size.width / 2;
	const halfHeight = size.height / 2;
	const centerToSurface = subtractedVectors(surfacePosition, rectLight.center);

	const planeDistance = dotProduct(centerToSurface, basis.normal);
	if (planeDistance > 0 === false) {
		return { accepted: false, refusal: MSM_MRP_REFUSAL.SURFACE_BEHIND_EMITTER, point: null };
	}

	const reflectionAlongNormal = dotProduct(reflectionDirection, basis.normal);
	const travelToPlane = reflectionAlongNormal === 0 ? -1 : -planeDistance / reflectionAlongNormal;
	const usedFallback = travelToPlane > 0 === false;

	const hitPoint = usedFallback
		? surfacePosition
		: addedVectors(surfacePosition, scaledVector(reflectionDirection, travelToPlane));
	const centerToHit = subtractedVectors(hitPoint, rectLight.center);

	const rawLocalX = dotProduct(centerToHit, basis.right);
	const rawLocalY = dotProduct(centerToHit, basis.up);
	const localX = Math.min(Math.max(rawLocalX, -halfWidth), halfWidth);
	const localY = Math.min(Math.max(rawLocalY, -halfHeight), halfHeight);
	const clampedToEdge = localX !== rawLocalX || localY !== rawLocalY;

	const point = addedVectors(
		rectLight.center,
		addedVectors(scaledVector(basis.right, localX), scaledVector(basis.up, localY)),
	);

	return {
		accepted: true,
		refusal: null,
		point,
		localX,
		localY,
		halfWidth,
		halfHeight,
		clampedToEdge,
		usedFallback,
		basisSource: basis.source,
	};
}


export function planMostRepresentativePointSample(request) {
	const settings = request && typeof request === "object" ? request : {};

	const refused = function refused(refusal) {
		return { accepted: false, refusal, mode: settings.specularMode, lightPosition: null };
	};

	if (settings.specularMode !== MSM_SPECULAR_MODE.MRP_LITE) return refused(MSM_MRP_REFUSAL.MODE_WITHOUT_MRP);

	const surfacePosition = settings.surfacePosition;
	const surfaceNormal = settings.surfaceNormal;
	const directionToView = settings.directionToView;
	if (!isFiniteVector(surfacePosition) || !isFiniteVector(surfaceNormal) || !isFiniteVector(directionToView)) {
		return refused(MSM_MRP_REFUSAL.INVALID_SURFACE);
	}

	const normalDotView = dotProduct(surfaceNormal, directionToView);
	if (normalDotView > 0 === false) return refused(MSM_MRP_REFUSAL.SURFACE_FACING_AWAY);


	const reflectionDirection = subtractedVectors(scaledVector(surfaceNormal, 2 * normalDotView), directionToView);

	const representativePoint = mostRepresentativePointOnRect({
		rectLight: settings.rectLight,
		surfacePosition,
		reflectionDirection,
	});
	if (!representativePoint.accepted) return refused(representativePoint.refusal);

	const photometry = rectAxialIntensity(settings.rectLight);
	if (photometry.intensity > 0 === false) return refused(MSM_MRP_REFUSAL.DARK_EMITTER);

	const surfaceToLight = subtractedVectors(representativePoint.point, surfacePosition);
	const rawDistance = vectorLength(surfaceToLight);
	const minimumDistance = rectMinimumSampleDistance(settings.rectLight);
	const distanceToLight = Math.max(rawDistance, minimumDistance);
	const distanceFloored = minimumDistance > rawDistance;

	const directionToLight =
		rawDistance > 0
			? scaledVector(surfaceToLight, 1 / rawDistance)
			: resolveRectBasis(settings.rectLight).normal;

	const basis = resolveRectBasis(settings.rectLight);
	const emissionCosine = Math.max(0, -dotProduct(directionToLight, basis.normal));

	return {
		accepted: true,
		refusal: null,
		mode: MSM_SPECULAR_MODE.MRP_LITE,
		tier: MSM_MRP_LITE_TIER,
		lightPosition: representativePoint.point,
		directionToLight,
		distanceToLight,
		rawDistance,
		distanceFloored,
		minimumDistance,
		intensity: photometry.intensity,
		nits: photometry.nits,
		emissionCosine,
		clampedToEdge: representativePoint.clampedToEdge,
		usedFallback: representativePoint.usedFallback,
		newTextureUnits: MSM_MRP_TEXTURE_UNIT_COST,
	};
}


export function mostRepresentativePointIrradiance(plan) {
	if (!plan || !plan.accepted) return 0;
	return (plan.intensity * plan.emissionCosine) / (plan.distanceToLight * plan.distanceToLight);
}


export function describeMostRepresentativePointContract() {
	return {
		phaseId: MSM_MRP_PHASE_ID,
		tier: MSM_MRP_LITE_TIER,
		mode: MSM_SPECULAR_MODE.MRP_LITE,
		newTextureUnits: MSM_MRP_TEXTURE_UNIT_COST,
		photometryOwner: "src/lighting/ltcCore.js (IL-F25): nits, size clamps and face frames, imported",
		energyGuard:
			"distance floored at half the emitter diagonal, capping the point model at " +
			MSM_MRP_IRRADIANCE_CEILING_IN_NITS +
			" * nits, under the PI * nits of an infinite emitter",
		declaredResidues: Object.freeze([
			"section 12 number 1: the rectangle is never integrated, only its most representative point is shaded",
			"the LTC tables are NOT used - only the arithmetic of ltcCore, so no tier gains a texture unit",
			"a reflection ray that misses the emitter falls back to the closest point, reported in usedFallback",
		]),
	};
}
