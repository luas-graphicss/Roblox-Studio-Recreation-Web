import {
	registerLocalLightFlag,
	isLocalLightFlagActive,
	resolveLocalLightFlag,
	setLocalLightFlagOverride,
} from "../lighting/llFeatureFlags.js";
import { isLocalLightBaselineFrozen } from "../lighting/llBaselineFreezeFlag.js";
import { isLocalLightTechnology } from "../lighting/llTechnologyGate.js";
import { llQa } from "../lighting/llTelemetry.js";
import { pageBudgetForTier } from "../lighting/llShadowGateCore.js";
import { createShadowBudgetCeiling } from "../lighting/llShadowBudgetEmaCore.js";
import {
	SHADOW_RESOLUTION_MODE,
	planShadowResolutions,
} from "../lighting/llShadowResolutionPlanCore.js";


export const SCREEN_RESOLUTION_FLAG_ID = "LlShadowScreenRes";


export const SCREEN_RESOLUTION_PHASE_ID = "LL-F12";


export const INFINITE_RANGE_FAR_PLANE_SCALE = 4;
export const INFINITE_RANGE_MIN_FAR_PLANE = 8;
export const INFINITE_RANGE_MAX_FAR_PLANE = 512;


const MAX_FRAME_SAMPLE_MS = 250;

function cameraForwardOf(camera) {


	const elements = camera && camera.matrixWorld ? camera.matrixWorld.elements : null;
	if (!elements) return [0, 0, -1];
	return [-elements[8], -elements[9], -elements[10]];
}

registerLocalLightFlag({
	id: SCREEN_RESOLUTION_FLAG_ID,
	phase: SCREEN_RESOLUTION_PHASE_ID,
	description:
		"atlas page resolution chosen by the light's projected screen coverage (Unreal TexelsPerPixel) instead of by its rank in the budget list",
	defaultsByTier: { fraco: false, medio: true, forte: true },
});


export function createShadowResolutionFeed(options) {
	const settings = options && typeof options === "object" ? options : {};
	const logger = settings.logger && typeof settings.logger.warn === "function" ? settings.logger : null;

	const ceiling = createShadowBudgetCeiling({ tier: "medio" });
	const descriptorPool = [];
	const descriptors = [];


	const resolutionByLightId = Object.create(null);
	const influenceRadiusByLightId = Object.create(null);
	let previousResolutions = new Map();
	let lastVisiblePlans = new Map();
	let planIndex = 0;
	let lastPlanSummary = null;
	let lastFrameTimestamp = 0;
	let activeTier = "medio";

	function descriptorAt(index) {
		let descriptor = descriptorPool[index];
		if (!descriptor) {
			descriptor = {
				key: null,
				name: "",
				kind: "SpotLight",
				worldPosition: [0, 0, 0],
				influenceRadius: 0,
				intensity: 0,
				enabled: true,
				shadowsRequested: false,
				infiniteRange: false,
			};
			descriptorPool[index] = descriptor;
		}
		return descriptor;
	}






	function resolveInfluenceRadius(threeLight, cameraPosition) {
		const declaredRange = Number(threeLight.distance) || 0;
		if (declaredRange > 0) return { radius: declaredRange, infinite: false };
		const dx = threeLight.position.x - cameraPosition[0];
		const dy = threeLight.position.y - cameraPosition[1];
		const dz = threeLight.position.z - cameraPosition[2];
		const cameraDistance = Math.sqrt(dx * dx + dy * dy + dz * dz);
		const farPlane = Math.min(
			Math.max(cameraDistance * INFINITE_RANGE_FAR_PLANE_SCALE, INFINITE_RANGE_MIN_FAR_PLANE),
			INFINITE_RANGE_MAX_FAR_PLANE,
		);
		return { radius: farPlane, infinite: true };
	}

	function describeLight(threeLight, descriptor, cameraPosition) {
		const resolved = resolveInfluenceRadius(threeLight, cameraPosition);
		descriptor.key = threeLight.uuid;
		descriptor.name = threeLight.name || threeLight.uuid;
		descriptor.kind = threeLight.isSpotLight ? "SpotLight" : "PointLight";
		descriptor.worldPosition[0] = threeLight.position.x;
		descriptor.worldPosition[1] = threeLight.position.y;
		descriptor.worldPosition[2] = threeLight.position.z;
		descriptor.influenceRadius = resolved.radius;
		descriptor.infiniteRange = resolved.infinite;
		descriptor.intensity = Math.max(Number(threeLight.intensity) || 0, 0);
		descriptor.enabled = threeLight.visible !== false && descriptor.intensity > 0;


		descriptor.shadowsRequested =
			!!threeLight.userData && threeLight.userData.__rswShadowsRequested === true;
		return descriptor;
	}

	function observeFrameCost() {
		const now = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
		if (lastFrameTimestamp > 0) {
			ceiling.observe(Math.min(now - lastFrameTimestamp, MAX_FRAME_SAMPLE_MS));
		}
		lastFrameTimestamp = now;
	}

	function isPhaseActive(context) {
		const frame = context && typeof context === "object" ? context : {};
		if (!isLocalLightTechnology(frame.technology)) return false;
		if (isLocalLightBaselineFrozen(frame.tier)) return false;
		return isLocalLightFlagActive(SCREEN_RESOLUTION_FLAG_ID, frame.tier);
	}

	function clearPublishedMaps() {
		for (const key of Object.keys(resolutionByLightId)) delete resolutionByLightId[key];
		for (const key of Object.keys(influenceRadiusByLightId)) delete influenceRadiusByLightId[key];
	}


	function planFrame(input) {
		const request = input && typeof input === "object" ? input : {};
		if (!isPhaseActive(request)) {

			clearPublishedMaps();
			lastPlanSummary = null;
			lastFrameTimestamp = 0;
			return null;
		}

		const tier = request.tier === undefined ? activeTier : String(request.tier);
		if (tier !== activeTier) {
			activeTier = tier;
			ceiling.setTier(tier);
		}
		observeFrameCost();

		const camera = request.camera;
		const cameraPosition = camera && camera.position
			? [camera.position.x, camera.position.y, camera.position.z]
			: [0, 0, 0];
		const lights = Array.isArray(request.lights) ? request.lights : [];

		descriptors.length = 0;
		for (let index = 0; index < lights.length; index++) {
			const threeLight = lights[index];
			if (!threeLight || !threeLight.position) continue;
			descriptors.push(describeLight(threeLight, descriptorAt(descriptors.length), cameraPosition));
		}

		planIndex += 1;
		const plan = planShadowResolutions({
			lights: descriptors,
			view: {
				verticalFovDeg: camera && Number(camera.fov) ? Number(camera.fov) : undefined,
				widthPixels: request.viewWidthPixels,
				heightPixels: request.viewHeightPixels,
			},
			camera: { position: cameraPosition, forward: cameraForwardOf(camera) },
			planIndex,
			previousResolutions,
			lastVisiblePlans,
			pageBudget: pageBudgetForTier(tier),
			ceilingResolution: ceiling.ceilingResolution(),
			mode: SHADOW_RESOLUTION_MODE.SCREEN_COVERAGE,
		});

		clearPublishedMaps();
		for (let index = 0; index < plan.entries.length; index++) {
			const entry = plan.entries[index];
			resolutionByLightId[entry.key] = entry.resolution;
		}


		for (let index = 0; index < descriptors.length; index++) {
			const descriptor = descriptors[index];
			if (descriptor.infiniteRange) influenceRadiusByLightId[descriptor.key] = descriptor.influenceRadius;
		}


		previousResolutions = new Map();
		lastVisiblePlans = new Map();
		for (let index = 0; index < plan.entries.length; index++) {
			const entry = plan.entries[index];
			previousResolutions.set(entry.key, entry.resolution);
			lastVisiblePlans.set(entry.key, planIndex);
		}

		const ceilingSnapshot = ceiling.snapshot();
		lastPlanSummary = {
			mode: plan.mode,
			planIndex,
			lights: descriptors.length,
			pages: plan.entries.length,
			pageBudget: plan.pageBudget,
			ceilingResolution: plan.ceilingResolution,
			byResolution: plan.summary.byResolution,
			upgrades: plan.summary.upgrades,
			downgrades: plan.summary.downgrades,
			maxLadderSteps: plan.summary.maxLadderSteps,
			refused: plan.refused.length,
			infiniteRangeLights: Object.keys(influenceRadiusByLightId).length,
			framePressure: ceilingSnapshot.pressure,
			emaMs: ceilingSnapshot.emaMs,
		};


		if (plan.summary.maxLadderSteps > 1) {
			llQa.addError("LL-F12: mais de um degrau de escada em um plano", {
				phase: SCREEN_RESOLUTION_PHASE_ID,
				maxLadderSteps: plan.summary.maxLadderSteps,
			});
			if (logger) logger.warn("[Luzes locais] LL-F12: degrau duplo de resolucao em um plano");
		}
		return lastPlanSummary;
	}

	return {
		phaseId: SCREEN_RESOLUTION_PHASE_ID,
		flagId: SCREEN_RESOLUTION_FLAG_ID,

		textureUnits: 0,

		setFlag(value) {
			return setLocalLightFlagOverride(SCREEN_RESOLUTION_FLAG_ID, value);
		},

		isActive(context) {
			return isPhaseActive(context);
		},

		planFrame,


		resolutions() {
			return resolutionByLightId;
		},


		influenceRadii() {
			return influenceRadiusByLightId;
		},

		lastPlan() {
			return lastPlanSummary;
		},

		reset() {
			clearPublishedMaps();
			previousResolutions = new Map();
			lastVisiblePlans = new Map();
			lastPlanSummary = null;
			lastFrameTimestamp = 0;
			ceiling.reset();
		},

		status(context) {
			const frame = context && typeof context === "object" ? context : {};
			const flagDecision = resolveLocalLightFlag(SCREEN_RESOLUTION_FLAG_ID, { tier: frame.tier });
			const baselineFrozen = isLocalLightBaselineFrozen(frame.tier);
			const technologyAllowed = isLocalLightTechnology(frame.technology);
			const status = {
				phase: SCREEN_RESOLUTION_PHASE_ID,
				flag: SCREEN_RESOLUTION_FLAG_ID,
				tier: frame.tier || null,
				technologyAllowed,
				flagOn: flagDecision.active,
				flagToken: flagDecision.token,
				flagSource: flagDecision.source,
				baselineFrozen,
				active: isPhaseActive(frame),
				glsl: false,
				textureUnits: 0,
				ceiling: ceiling.snapshot(),
				lastPlan: lastPlanSummary,
				pending: !technologyAllowed
					? "Technology outside ShadowMap / Future keeps page sizing by rank"
					: baselineFrozen
						? "LlBaseline is freezing the legacy path: release it for the phase to enter"
						: "Declared residuals: (a) the EMA ceiling is fed by the WALL CLOCK delta between frames, not by an isolated GPU timing of the shadow pass - it reacts to real frame pressure, but a frame slowed down by something other than shadows also lowers the ceiling; a per-pass GPU timer belongs to LL-F23; (b) the far plane invented for an infinite-range spot is a camera-distance heuristic (INFINITE_RANGE_FAR_PLANE_SCALE), honest but not photometric - deriving it from intensity units needs LL-F3 data per light; (c) point cube faces keep the ladder step of llPointAtlasPlanCore (one step below the spot of the same rank), because six pages per light have a different texel economy than one.",
			};
			llQa.setPhase(SCREEN_RESOLUTION_PHASE_ID, {
				flagOn: flagDecision.active,
				technologyAllowed,
				baselineFrozen,
				glsl: false,
				ceilingResolution: ceiling.ceilingResolution(),
				lastPlan: lastPlanSummary,
			});
			return status;
		},
	};
}
