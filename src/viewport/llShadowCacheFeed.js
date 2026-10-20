import {
	registerLocalLightFlag,
	isLocalLightFlagActive,
	resolveLocalLightFlag,
	setLocalLightFlagOverride,
} from "../lighting/llFeatureFlags.js";
import { isLocalLightBaselineFrozen } from "../lighting/llBaselineFreezeFlag.js";
import { isLocalLightTechnology } from "../lighting/llTechnologyGate.js";
import { llQa } from "../lighting/llTelemetry.js";
import { createShadowCasterTracker } from "../lighting/llShadowCasterTrackerCore.js";
import { DIRTY_REASON, createLocalShadowCache } from "../lighting/llShadowCacheCore.js";


export const SHADOW_CACHE_FLAG_ID = "LlShadowCache";


export const SHADOW_CACHE_PHASE_ID = "LL-F13";


export const MAX_TRACKED_CASTERS = 512;


const MATRIX_SIGNATURE_PRECISION = 1000;

function matrixSignatureOf(matrixWorld) {
	const e = matrixWorld.elements;


	return (
		Math.round(e[12] * MATRIX_SIGNATURE_PRECISION) + "," +
		Math.round(e[13] * MATRIX_SIGNATURE_PRECISION) + "," +
		Math.round(e[14] * MATRIX_SIGNATURE_PRECISION) + "," +
		Math.round(e[0] * MATRIX_SIGNATURE_PRECISION) + "," +
		Math.round(e[5] * MATRIX_SIGNATURE_PRECISION) + "," +
		Math.round(e[10] * MATRIX_SIGNATURE_PRECISION)
	);
}

function maximumScaleOf(matrixWorld) {
	const e = matrixWorld.elements;
	const scaleX = Math.hypot(e[0], e[1], e[2]);
	const scaleY = Math.hypot(e[4], e[5], e[6]);
	const scaleZ = Math.hypot(e[8], e[9], e[10]);
	return Math.max(scaleX, scaleY, scaleZ);
}

registerLocalLightFlag({
	id: SHADOW_CACHE_FLAG_ID,
	phase: SHADOW_CACHE_PHASE_ID,
	description:
		"local shadow pages are kept between frames and redrawn only when a caster that touches them moved (Unreal-style static / dynamic shadow cache)",
	defaultsByTier: { fraco: false, medio: true, forte: true },
});


export function createShadowCacheFeed(options) {
	const settings = options && typeof options === "object" ? options : {};
	const logger = settings.logger && typeof settings.logger.warn === "function" ? settings.logger : null;

	const tracker = createShadowCasterTracker({});
	const cache = createLocalShadowCache({});
	const lightDescriptors = [];
	const casterSnapshots = [];


	const dirtyLightIds = Object.create(null);
	const redrawPolicy = { persistent: false, dirtyIds: dirtyLightIds };
	let lastPulseSummary = null;
	let healRequested = true;
	let healReason = DIRTY_REASON.NEW_PAGE;
	let lastTechnology = null;
	let lastTier = null;

	function describeLight(threeLight, target) {
		const isSpot = threeLight.isSpotLight === true;
		const targetPosition =
			threeLight.target && threeLight.target.position ? threeLight.target.position : null;
		const position = threeLight.position;
		let directionX = 0;
		let directionY = -1;
		let directionZ = 0;
		if (isSpot) {
			const toX = (targetPosition ? targetPosition.x : 0) - position.x;
			const toY = (targetPosition ? targetPosition.y : 0) - position.y;
			const toZ = (targetPosition ? targetPosition.z : 0) - position.z;
			const length = Math.sqrt(toX * toX + toY * toY + toZ * toZ);
			if (length > 0) {
				directionX = toX / length;
				directionY = toY / length;
				directionZ = toZ / length;
			}
		}
		target.key = threeLight.uuid;
		target.kind = isSpot ? "spot" : "point";
		target.position[0] = position.x;
		target.position[1] = position.y;
		target.position[2] = position.z;
		target.direction[0] = directionX;
		target.direction[1] = directionY;
		target.direction[2] = directionZ;
		target.outerHalfAngleRad = Number(threeLight.angle) || 0;
		target.range = Math.max(Number(threeLight.distance) || 0, 0.02);
		target.near = Math.min(Math.max(target.range * 0.01, 0.05), target.range * 0.5);
		target.mapSize =
			threeLight.shadow && threeLight.shadow.mapSize ? Math.floor(threeLight.shadow.mapSize.x) || 512 : 512;
		target.castShadow = true;
		return target;
	}

	function lightDescriptorAt(index) {
		let descriptor = lightDescriptors[index];
		if (!descriptor) {
			descriptor = {
				key: null,
				kind: "spot",
				position: [0, 0, 0],
				direction: [0, -1, 0],
				outerHalfAngleRad: 0,
				range: 1,
				near: 0.5,
				mapSize: 512,
				castShadow: true,
			};
			lightDescriptors[index] = descriptor;
		}
		return descriptor;
	}





	function snapshotCaster(mesh, target) {
		const geometry = mesh.geometry;
		if (!geometry) return false;
		if (!geometry.boundingSphere && typeof geometry.computeBoundingSphere === "function") {
			geometry.computeBoundingSphere();
		}
		const sphere = geometry.boundingSphere;
		if (!sphere || !Number.isFinite(sphere.radius)) return false;
		const matrixWorld = mesh.matrixWorld;
		if (!matrixWorld) return false;
		const e = matrixWorld.elements;
		const localX = sphere.center.x;
		const localY = sphere.center.y;
		const localZ = sphere.center.z;
		const centerX = e[0] * localX + e[4] * localY + e[8] * localZ + e[12];
		const centerY = e[1] * localX + e[5] * localY + e[9] * localZ + e[13];
		const centerZ = e[2] * localX + e[6] * localY + e[10] * localZ + e[14];
		const worldRadius = sphere.radius * maximumScaleOf(matrixWorld);
		if (!Number.isFinite(centerX) || !Number.isFinite(worldRadius)) return false;
		target.key = mesh.uuid;
		target.stateKey = matrixSignatureOf(matrixWorld);
		target.box.min[0] = centerX - worldRadius;
		target.box.min[1] = centerY - worldRadius;
		target.box.min[2] = centerZ - worldRadius;
		target.box.max[0] = centerX + worldRadius;
		target.box.max[1] = centerY + worldRadius;
		target.box.max[2] = centerZ + worldRadius;
		return true;
	}

	function casterSnapshotAt(index) {
		let snapshot = casterSnapshots[index];
		if (!snapshot) {
			snapshot = { key: null, stateKey: "", box: { min: [0, 0, 0], max: [0, 0, 0] } };
			casterSnapshots[index] = snapshot;
		}
		return snapshot;
	}

	function isPhaseActive(context) {
		const frame = context && typeof context === "object" ? context : {};
		if (!isLocalLightTechnology(frame.technology)) return false;
		if (isLocalLightBaselineFrozen(frame.tier)) return false;
		return isLocalLightFlagActive(SHADOW_CACHE_FLAG_ID, frame.tier);
	}

	function clearDirtyLookup() {
		for (const key of Object.keys(dirtyLightIds)) delete dirtyLightIds[key];
		publishedPageCount = 0;
	}


	const atlasPageIdsByLightKey = Object.create(null);
	let knownAtlasPageCount = 0;
	let publishedPageCount = 0;

	function clearAtlasPageLookup() {
		for (const key of Object.keys(atlasPageIdsByLightKey)) delete atlasPageIdsByLightKey[key];
		knownAtlasPageCount = 0;
	}

	function rememberAtlasPageId(lightKey, atlasPageId) {
		if (!lightKey || !atlasPageId) return;
		const known = atlasPageIdsByLightKey[lightKey];
		if (known) known.push(atlasPageId);
		else atlasPageIdsByLightKey[lightKey] = [atlasPageId];
		knownAtlasPageCount++;
	}


	function atlasSpotPageIdOf(threeLight) {
		const stampedByFeed = threeLight.userData ? threeLight.userData.__rswAtlasId : null;
		return stampedByFeed || threeLight.uuid;
	}


	function rememberAtlasPageIdsOf(request) {
		const spotLights = Array.isArray(request.spotLights) ? request.spotLights : null;
		if (spotLights) {
			for (let index = 0; index < spotLights.length; index++) {
				const threeLight = spotLights[index];
				if (!threeLight || threeLight.visible === false) continue;
				rememberAtlasPageId(threeLight.uuid, atlasSpotPageIdOf(threeLight));
			}
		}


		const cubePages = Array.isArray(request.cubePages) ? request.cubePages : null;
		if (cubePages) {
			for (let index = 0; index < cubePages.length; index++) {
				const page = cubePages[index];
				if (!page || !page.id) continue;
				rememberAtlasPageId(page.lightKey, page.id);
			}
		}
	}


	function requestHeal(reason) {
		healRequested = true;
		healReason = reason || DIRTY_REASON.HEAL;
	}


	function planFrame(input) {
		const request = input && typeof input === "object" ? input : {};
		if (!isPhaseActive(request)) {


			clearDirtyLookup();
			clearAtlasPageLookup();
			redrawPolicy.persistent = false;
			lastPulseSummary = null;
			requestHeal(DIRTY_REASON.HEAL);
			return null;
		}


		if (request.technology !== lastTechnology || request.tier !== lastTier) {
			lastTechnology = request.technology;
			lastTier = request.tier;
			requestHeal(DIRTY_REASON.HEAL);
		}


		let lightCount = 0;
		const appendLights = (list) => {
			if (!Array.isArray(list)) return;
			for (let index = 0; index < list.length; index++) {
				const threeLight = list[index];
				if (!threeLight || !threeLight.position || threeLight.visible === false) continue;
				describeLight(threeLight, lightDescriptorAt(lightCount));
				lightCount++;
			}
		};
		appendLights(request.spotLights);
		appendLights(request.pointLights);
		cache.syncLights(lightDescriptors.slice(0, lightCount));


		clearAtlasPageLookup();
		rememberAtlasPageIdsOf(request);

		let casterCount = 0;
		let casterOverflow = false;


		const meshSource = request.meshes;
		const meshes =
			meshSource && typeof meshSource.values === "function" ? meshSource.values() : meshSource;
		if (meshes && typeof meshes[Symbol.iterator] === "function") {
			for (const mesh of meshes) {
				if (!mesh || mesh.visible === false || mesh.castShadow === false) continue;
				if (casterCount >= MAX_TRACKED_CASTERS) {
					casterOverflow = true;
					break;
				}
				if (snapshotCaster(mesh, casterSnapshotAt(casterCount))) casterCount++;
			}
		}

		if (casterOverflow) requestHeal(DIRTY_REASON.HEAL);

		const tracked = tracker.trackPulse(casterSnapshots.slice(0, casterCount));


		if (tracked.teleported) requestHeal(DIRTY_REASON.HEAL);

		const plan = cache.planPulse({
			dirtyBoxes: tracked.dirtyBoxes,
			invalidateAll: healRequested,
			reason: healReason,
		});
		healRequested = false;
		healReason = DIRTY_REASON.HEAL;


		clearDirtyLookup();
		for (let index = 0; index < plan.lightsToRender.length; index++) {
			const atlasPageIds = atlasPageIdsByLightKey[plan.lightsToRender[index]];
			if (!atlasPageIds) continue;
			for (let pageIndex = 0; pageIndex < atlasPageIds.length; pageIndex++) {
				dirtyLightIds[atlasPageIds[pageIndex]] = true;
				publishedPageCount++;
			}
		}


		redrawPolicy.persistent = knownAtlasPageCount > 0;

		lastPulseSummary = {
			pulse: plan.pulse,
			healed: plan.healed,
			lightCount: plan.lightCount,
			totalPages: plan.totalPages,
			dirtyPageCount: plan.dirtyPageCount,
			pageRenders: plan.pageRenders.length,
			lightsToRender: plan.lightsToRender.length,
			knownAtlasPages: knownAtlasPageCount,
			publishedPages: publishedPageCount,
			persistentAtlas: redrawPolicy.persistent,
			staticPages: plan.staticPages,
			dynamicPages: plan.dynamicPages,
			savedPages: plan.savedPages,
			reductionRatio: plan.reductionRatio,
			casterCount: tracked.casterCount,
			movingCasters: tracked.movingCount,
			casterOverflow,
		};


		if (plan.dirtyPagesLeft > 0 && plan.pageRenders.length === 0) {
			llQa.addError("LL-F13: paginas sujas sem nenhum render no pulso", {
				phase: SHADOW_CACHE_PHASE_ID,
				dirtyPagesLeft: plan.dirtyPagesLeft,
			});
			if (logger) logger.warn("[Luzes locais] LL-F13: pulso sem render com paginas sujas");
		}
		return lastPulseSummary;
	}

	return {
		phaseId: SHADOW_CACHE_PHASE_ID,
		flagId: SHADOW_CACHE_FLAG_ID,

		textureUnits: 0,

		setFlag(value) {
			return setLocalLightFlagOverride(SHADOW_CACHE_FLAG_ID, value);
		},

		isActive(context) {
			return isPhaseActive(context);
		},

		planFrame,
		requestHeal,


		policy() {
			return redrawPolicy;
		},

		lastPulse() {
			return lastPulseSummary;
		},

		stats() {
			return cache.stats();
		},

		reset() {
			clearDirtyLookup();
			clearAtlasPageLookup();
			redrawPolicy.persistent = false;
			cache.reset();
			tracker.reset();
			lastPulseSummary = null;
			requestHeal(DIRTY_REASON.NEW_PAGE);
		},

		status(context) {
			const frame = context && typeof context === "object" ? context : {};
			const flagDecision = resolveLocalLightFlag(SHADOW_CACHE_FLAG_ID, { tier: frame.tier });
			const baselineFrozen = isLocalLightBaselineFrozen(frame.tier);
			const technologyAllowed = isLocalLightTechnology(frame.technology);
			const status = {
				phase: SHADOW_CACHE_PHASE_ID,
				flag: SHADOW_CACHE_FLAG_ID,
				tier: frame.tier || null,
				technologyAllowed,
				flagOn: flagDecision.active,
				flagToken: flagDecision.token,
				flagSource: flagDecision.source,
				baselineFrozen,
				active: isPhaseActive(frame),
				glsl: false,
				textureUnits: 0,
				persistentAtlas: redrawPolicy.persistent,
				lastPulse: lastPulseSummary,
				cache: cache.stats(),
				pending: !technologyAllowed
					? "Technology outside ShadowMap / Future keeps the atlas redrawing every frame"
					: baselineFrozen
						? "LlBaseline is freezing the legacy path: release it for the phase to enter"
						: "Declared residuals: (a) the atlas redraws a WHOLE tile, so the saving is per LIGHT, not per page - the per page grid is fully tracked and proven by the core, but spending it needs a page sized scissor inside one tile, which changes the depth hook and belongs with LL-F14's meta rework; (b) a caster's world box comes from its bounding SPHERE, a deliberate superset: it survives rotation with no refit and can never miss a page, at the cost of dirtying slightly more than an exact AABB would; (c) past MAX_TRACKED_CASTERS casters the phase heals every pulse instead of diffing, so a very large place gets correctness and no saving.",
			};
			llQa.setPhase(SHADOW_CACHE_PHASE_ID, {
				flagOn: flagDecision.active,
				technologyAllowed,
				baselineFrozen,
				glsl: false,
				persistentAtlas: redrawPolicy.persistent,
				lastPulse: lastPulseSummary,
			});
			return status;
		},
	};
}
