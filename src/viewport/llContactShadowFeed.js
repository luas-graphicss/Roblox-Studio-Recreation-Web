import { createSharedDepth } from "./sharedDepth.js";
import { orderLightsAsRendererDoes } from "../lighting/llShadowGateCore.js";
import {
	CONTACT_SHADOW_LIGHT_SLOTS,
	CONTACT_SHADOW_MAX_MARCHING_LIGHTS,
	CONTACT_SHADOW_PHASE_ID,
} from "../lighting/llContactShadowContract.js";
import {
	clampContactShadowLengthStuds,
	resolveContactShadowSettings,
} from "../lighting/llContactShadowCore.js";
import { planContactShadowBudget } from "../lighting/llContactShadowBudgetCore.js";
import { contactShadowScreenPriority } from "../lighting/llContactShadowPriority.js";
import { llQa } from "../lighting/llTelemetry.js";


export const CONTACT_LENGTH_USER_DATA_KEY = "__llContactShadowLength";


export const CONTACT_DEPTH_RESOLUTION_DIVISOR = 2;


export const DEPTH_IDLE_FRAMES = 61;

const SPOT_LIGHT_TYPE = "SpotLight";
const POINT_LIGHT_TYPE = "PointLight";

function authoredMarchLengthOf(threeLight) {
	if (!threeLight || !threeLight.userData) return 0;
	return clampContactShadowLengthStuds(threeLight.userData[CONTACT_LENGTH_USER_DATA_KEY]);
}


function cameraForwardOf(camera) {
	if (!camera || !camera.matrixWorld) return [0, 0, -1];
	const elements = camera.matrixWorld.elements;
	return [-elements[8], -elements[9], -elements[10]];
}


export function createContactShadowFeed(options) {
	const settings = options && typeof options === "object" ? options : {};
	const THREE = settings.THREE;
	const scene = settings.scene;
	const camera = settings.camera;
	const renderer = settings.renderer;
	const logger = settings.logger && typeof settings.logger.warn === "function" ? settings.logger : null;


	const lightEntries = [];
	const worldPositionPool = [];
	let depthProvider = null;
	let lastPlan = null;
	let lastSettings = null;
	let lastMarchingCount = 0;
	let prepassesThisSession = 0;

	function viewportWidthPixels() {
		if (!renderer || !renderer.domElement) return 0;
		return Number(renderer.domElement.clientWidth) || 0;
	}

	function viewportHeightPixels() {
		if (!renderer || !renderer.domElement) return 0;
		return Number(renderer.domElement.clientHeight) || 0;
	}

	function worldPositionAt(index, threeLight) {
		let target = worldPositionPool[index];
		if (!target) {
			target = [0, 0, 0];
			worldPositionPool[index] = target;
		}
		target[0] = threeLight.position.x;
		target[1] = threeLight.position.y;
		target[2] = threeLight.position.z;
		return target;
	}


	function collectCandidates(spotLights, pointLights, influenceRadiusById) {
		lightEntries.length = 0;
		const cameraPosition = camera && camera.position ? camera.position : { x: 0, y: 0, z: 0 };


		const kinds = [
			{ list: Array.isArray(pointLights) ? pointLights : [], type: POINT_LIGHT_TYPE },
			{ list: Array.isArray(spotLights) ? spotLights : [], type: SPOT_LIGHT_TYPE },
		];
		for (let kindIndex = 0; kindIndex < kinds.length; kindIndex++) {
			const kind = kinds[kindIndex];
			const described = kind.list
				.filter((threeLight) => threeLight && threeLight.visible !== false)
				.map((threeLight) => ({
					threeLight,
					castShadow: threeLight.castShadow === true,
					hasMap: !!threeLight.map,
				}));
			const ordered = orderLightsAsRendererDoes(described);
			for (let index = 0; index < ordered.length; index++) {
				const threeLight = ordered[index].threeLight;
				const declaredRange = Number(threeLight.distance) || 0;
				const influenceRadius =
					declaredRange > 0
						? declaredRange
						: (influenceRadiusById && Number(influenceRadiusById[threeLight.uuid])) || 0;
				const dx = threeLight.position.x - cameraPosition.x;
				const dy = threeLight.position.y - cameraPosition.y;
				const dz = threeLight.position.z - cameraPosition.z;
				lightEntries.push({


					name: threeLight.uuid,
					type: kind.type,
					intensity: Math.max(Number(threeLight.intensity) || 0, 0),
					distanceToCamera: Math.sqrt(dx * dx + dy * dy + dz * dz),
					contactShadowLengthStuds: authoredMarchLengthOf(threeLight),
					coneGateHalfAngleDeg:
						kind.type === SPOT_LIGHT_TYPE ? ((Number(threeLight.angle) || 0) * 180) / Math.PI : 0,
					worldPosition: worldPositionAt(lightEntries.length, threeLight),
					influenceRadius,
				});
			}
		}
		return lightEntries;
	}


	function longestMarchLengthOf(candidates) {
		let longest = 0;
		for (let index = 0; index < candidates.length; index++) {
			if (candidates[index].contactShadowLengthStuds > longest) {
				longest = candidates[index].contactShadowLengthStuds;
			}
		}
		return longest;
	}

	function ensureDepthProvider() {
		if (depthProvider) return depthProvider;
		if (!THREE || !scene || !camera) return null;
		depthProvider = createSharedDepth({ THREE, scene, camera });
		return depthProvider;
	}


	function planFrame(input) {
		const request = input && typeof input === "object" ? input : {};
		const patch = request.patch;
		if (!patch) return null;
		const frameContext = { tier: request.tier, technology: request.technology };


		if (patch.isActive(frameContext) !== true) {
			patch.clearMarch();
			lastPlan = null;
			lastSettings = null;
			lastMarchingCount = 0;
			return null;
		}

		const candidates = collectCandidates(
			request.spotLights,
			request.pointLights,
			request.influenceRadiusById || null,
		);
		const longestMarch = longestMarchLengthOf(candidates);


		if (!(longestMarch > 0)) {
			patch.clearMarch();
			lastPlan = null;
			lastSettings = null;
			lastMarchingCount = 0;
			return null;
		}


		const priority = contactShadowScreenPriority({
			view: {
				verticalFovDeg: Number(camera && camera.fov) || 0,
				widthPixels: viewportWidthPixels(),
				heightPixels: viewportHeightPixels(),
			},
			camera: {
				position: camera && camera.position ? [camera.position.x, camera.position.y, camera.position.z] : [0, 0, 0],
				forward: cameraForwardOf(camera),
			},
			lights: candidates,
		});

		const plan = planContactShadowBudget({
			lights: candidates,
			slotCount: CONTACT_SHADOW_LIGHT_SLOTS,
			maxMarchingLights: CONTACT_SHADOW_MAX_MARCHING_LIGHTS,
			screenCoveragePriorityByName: priority.priorityByName,
		});
		lastPlan = plan;
		lastMarchingCount = plan.marchingCount;


		if (!(plan.marchingCount > 0)) {
			patch.clearMarch();
			lastSettings = null;
			return plan;
		}


		const resolved = resolveContactShadowSettings({
			tier: request.tier,
			contactShadowLengthStuds: longestMarch,
		});
		lastSettings = resolved;


		if (resolved.fallbackToGlobalFuse || !resolved.enabled) {
			patch.clearMarch();
			return plan;
		}

		const provider = ensureDepthProvider();
		if (!provider) {
			patch.clearMarch();
			if (logger) {
				logger.warn("[Luzes locais] LL-F15: sem provedor de depth - marcha desligada neste frame.");
			}
			llQa.addError("LL-F15: sem provedor de depth", { phase: CONTACT_SHADOW_PHASE_ID });
			return plan;
		}

		const depthWidth = Math.max(1, viewportWidthPixels() / CONTACT_DEPTH_RESOLUTION_DIVISOR) | 0;
		const depthHeight = Math.max(1, viewportHeightPixels() / CONTACT_DEPTH_RESOLUTION_DIVISOR) | 0;

		provider.beginFrame();
		const depthTexture = provider.acquire(renderer, depthWidth, depthHeight);
		prepassesThisSession++;

		if (!patch.setDepthTexture(depthTexture)) {
			patch.clearMarch();
			llQa.addError("LL-F15: prepass sem textura de depth", { phase: CONTACT_SHADOW_PHASE_ID });
			return plan;
		}
		patch.writeProjection(camera);
		patch.writeMarchParams(resolved);
		patch.writeLightLengths(plan.pointLengths, plan.spotLengths);
		return plan;
	}


	function reset(patch) {
		if (patch && typeof patch.clearMarch === "function") patch.clearMarch();
		lastPlan = null;
		lastSettings = null;
		lastMarchingCount = 0;
		if (!depthProvider) return;
		for (let frame = 0; frame < DEPTH_IDLE_FRAMES; frame++) depthProvider.beginFrame();
	}

	function dispose() {
		if (depthProvider) depthProvider.dispose();
		depthProvider = null;
		lightEntries.length = 0;
		worldPositionPool.length = 0;
	}

	return {
		phaseId: CONTACT_SHADOW_PHASE_ID,
		planFrame,
		reset,
		dispose,
		lastPlan() {
			return lastPlan;
		},
		lastSettings() {
			return lastSettings;
		},
		stats() {
			return {
				fase: CONTACT_SHADOW_PHASE_ID,
				marchingCount: lastMarchingCount,
				maxMarchingLights: CONTACT_SHADOW_MAX_MARCHING_LIGHTS,
				lightSlots: CONTACT_SHADOW_LIGHT_SLOTS,
				prepassesThisSession,
				hasDepthProvider: depthProvider !== null,
				prioritySource: lastPlan ? lastPlan.prioritySource : null,
			};
		},
	};
}
