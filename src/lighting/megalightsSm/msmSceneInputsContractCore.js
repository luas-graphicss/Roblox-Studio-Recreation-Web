import { angleBetweenUnitVectorsInDegrees } from "./msmNormalFromDepthCore.js";

export const MSM_SCENE_INPUTS_OWNER = "MSM-F5";


export const MSM_SCENE_INPUT_SOURCES = Object.freeze([
	Object.freeze({
		name: "sharedSceneDepth",
		provider: "src/viewport/sharedDepth.js",
		ownedByThisPhase: false,
		carries: "scene depth, RGBA-packed, at the reduced resolution of the pass",
		consumers: Object.freeze(["MSM-F5", "MSM-F11", "MSM-F16", "MSM-F18", "MSM-F26", "MSM-F28"]),
		note: "the cost is already paid by GTAO and by the shadow denoise: this phase adds a reader, never a depth prepass of its own",
	}),
	Object.freeze({
		name: "viewPosition",
		provider: MSM_SCENE_INPUTS_OWNER,
		ownedByThisPhase: true,
		carries: "view-space position rebuilt from one depth tap and the inverse projection scale",
		consumers: Object.freeze(["MSM-F11", "MSM-F16", "MSM-F18"]),
		note: "the grid lookup of MSM-F9 turns this into a world cell",
	}),
	Object.freeze({
		name: "viewNormal",
		provider: MSM_SCENE_INPUTS_OWNER,
		ownedByThisPhase: true,
		carries: "view-space normal rebuilt from three depth taps, no G-buffer and no MRT",
		consumers: Object.freeze(["MSM-F12", "MSM-F18", "MSM-F27", "MSM-F28"]),
		note: "concept 8 of the plan: a forward path cannot afford a G-buffer, so the normal is derived, not stored",
	}),
]);


export const MSM_SCENE_INPUT_TOLERANCES = Object.freeze({
	maximumMeanNormalAngleErrorInDegrees: 8,
	minimumFlatSurfaceProbeCount: 8,
});


export const MSM_SCENE_INPUT_SLEEP_REASONS = Object.freeze({
	missingFrameDescription: "no frame description reached the read contract",
	orthographicCamera:
		"the camera is orthographic: the perspective ray model of this phase does not apply, so the pass sleeps (same posture as the MegaLights lite pass)",
	unknownProjection: "the camera projection is neither perspective nor orthographic, so the reconstruction cannot be trusted",
	missingSharedDepth: "the shared depth is not available, and this phase never renders a depth prepass of its own",
	invalidCameraPlanes: "the camera near and far planes are not a finite, positive, ordered pair",
	degenerateGridSize: "the reduced-resolution grid has no area",
});


export const MSM_DECLARED_RESIDUALS = Object.freeze([
	Object.freeze({
		id: "silhouetteNormalError",
		planResidualNumber: 4,
		summary: "the normal rebuilt from depth is wrong on a silhouette, about one pixel of border",
		why: "a depth discontinuity is not a surface: the three taps straddle two different surfaces and the cross product describes neither",
		howItIsContained:
			"the flat-surface gate of this phase measures interior pixels only, and every consumer downstream keeps a bilateral depth guard",
	}),
	Object.freeze({
		id: "orthographicPassSleeps",
		planResidualNumber: 11,
		summary: "under an orthographic camera the pass sleeps instead of reconstructing",
		why: "parallel rays break the perspective reconstruction, and the error grows away from the centre of the screen",
		howItIsContained: "the read contract refuses the frame by name and the pass acquires nothing, so a sleeping frame costs nothing",
	}),
]);

function isFinitePositiveNumber(value) {
	return Number.isFinite(value) && value > 0;
}

function hasUsableCameraPlanes(frameDescription) {
	const near = Number(frameDescription.cameraNear);
	const far = Number(frameDescription.cameraFar);
	return isFinitePositiveNumber(near) && isFinitePositiveNumber(far) && far > near;
}

function hasUsableGridSize(frameDescription) {
	const width = Number(frameDescription.width);
	const height = Number(frameDescription.height);
	return Number.isFinite(width) && Number.isFinite(height) && width >= 1 && height >= 1;
}











export function resolveSceneInputSleepReason(frameDescription) {
	if (!frameDescription) return "missingFrameDescription";
	if (frameDescription.isOrthographicProjection === true) return "orthographicCamera";
	if (frameDescription.isPerspectiveProjection !== true) return "unknownProjection";
	if (frameDescription.hasSharedDepthProvider !== true) return "missingSharedDepth";
	if (!hasUsableCameraPlanes(frameDescription)) return "invalidCameraPlanes";
	if (!hasUsableGridSize(frameDescription)) return "degenerateGridSize";
	return null;
}






export function describeSceneInputReadiness(frameDescription) {
	const sleepReason = resolveSceneInputSleepReason(frameDescription);
	return {
		readable: sleepReason === null,
		sleepReason,
		sleepExplanation: sleepReason === null ? null : MSM_SCENE_INPUT_SLEEP_REASONS[sleepReason] || sleepReason,
	};
}


export function evaluateFlatSurfaceNormalProbes(probes) {
	const problems = [];
	const rows = [];
	const probeList = Array.isArray(probes) ? probes : [];

	if (probeList.length < MSM_SCENE_INPUT_TOLERANCES.minimumFlatSurfaceProbeCount) {
		problems.push(
			"only " +
				probeList.length +
				" flat-surface probes, the gate needs at least " +
				MSM_SCENE_INPUT_TOLERANCES.minimumFlatSurfaceProbeCount,
		);
	}

	let angleErrorSumInDegrees = 0;
	let worstAngleErrorInDegrees = 0;

	probeList.forEach((probe, probeIndex) => {
		const label = probe.label || "probe " + probeIndex;
		const angleErrorInDegrees = angleBetweenUnitVectorsInDegrees(
			probe.expectedViewNormal,
			probe.reconstructedViewNormal,
		);
		angleErrorSumInDegrees += angleErrorInDegrees;
		if (angleErrorInDegrees > worstAngleErrorInDegrees) worstAngleErrorInDegrees = angleErrorInDegrees;
		rows.push({ label, angleErrorInDegrees });
	});

	const meanAngleErrorInDegrees = probeList.length > 0 ? angleErrorSumInDegrees / probeList.length : Infinity;
	if (!(meanAngleErrorInDegrees <= MSM_SCENE_INPUT_TOLERANCES.maximumMeanNormalAngleErrorInDegrees)) {
		problems.push(
			"mean normal error is " +
				meanAngleErrorInDegrees.toFixed(3) +
				" degrees, the gate is " +
				MSM_SCENE_INPUT_TOLERANCES.maximumMeanNormalAngleErrorInDegrees,
		);
	}

	return {
		pass: problems.length === 0,
		probeCount: probeList.length,
		meanAngleErrorInDegrees,
		worstAngleErrorInDegrees,
		rows,
		problems,
	};
}
