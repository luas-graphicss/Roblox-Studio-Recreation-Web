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
import {
	LOCAL_SHADOW_INVALIDATION_PHASE_ID,
	createLocalLightShadowInvalidator,
} from "../lighting/localLightShadowInvalidationCore.js";


export const LOCAL_SHADOW_INVALIDATION_FLAG_ID = "LlLocalShadowInvalidation";


export { LOCAL_SHADOW_INVALIDATION_PHASE_ID };


export const MAX_TRACKED_CASTERS = 512;


const MATRIX_SIGNATURE_PRECISION = 1000;

function roundedForSignature(value) {
	return Math.round(value * MATRIX_SIGNATURE_PRECISION);
}


function worldMatrixSignatureOf(matrixWorld) {
	const e = matrixWorld.elements;
	return (
		roundedForSignature(e[12]) + "," +
		roundedForSignature(e[13]) + "," +
		roundedForSignature(e[14]) + "," +
		roundedForSignature(e[0]) + "," +
		roundedForSignature(e[1]) + "," +
		roundedForSignature(e[2]) + "," +
		roundedForSignature(e[4]) + "," +
		roundedForSignature(e[5]) + "," +
		roundedForSignature(e[6]) + "," +
		roundedForSignature(e[8]) + "," +
		roundedForSignature(e[9]) + "," +
		roundedForSignature(e[10])
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
	id: LOCAL_SHADOW_INVALIDATION_FLAG_ID,
	phase: LOCAL_SHADOW_INVALIDATION_PHASE_ID,
	description:
		"a local shadow map is redrawn only when the light config changed or a caster moved inside the light reach, instead of every light redrawing on every global shadow pulse",
	defaultsByTier: { fraco: true, medio: true, forte: true },
});




export function createLocalLightShadowInvalidationFeed(options) {
	const settings = options && typeof options === "object" ? options : {};
	const logger = settings.logger && typeof settings.logger.warn === "function" ? settings.logger : null;

	const invalidator = createLocalLightShadowInvalidator({});
	const tracker = createShadowCasterTracker({});


	const lightDescriptors = [];
	const casterSnapshots = [];
	const activeLights = [];
	const activeCasters = [];
	const seenLightKeys = new Set();

	const managedLightsByKey = new Map();

	const inactivePulse = Object.freeze({
		active: false,
		redrawCount: 0,
		keptCount: 0,
		pulseRequested: false,
	});

	let lastPulseSummary = null;
	let lastTechnology = null;
	let lastTier = null;
	let handedOverTo = "";
	let healRequested = true;
	let healReason = "phase-start";


	function requestHeal(reason) {
		healRequested = true;
		healReason = reason ? String(reason) : "heal";
		return healReason;
	}

	function isPhaseActive(context) {
		const frame = context && typeof context === "object" ? context : {};
		if (!isLocalLightTechnology(frame.technology)) return false;
		if (isLocalLightBaselineFrozen(frame.tier)) return false;
		return isLocalLightFlagActive(LOCAL_SHADOW_INVALIDATION_FLAG_ID, frame.tier);
	}

	function lightDescriptorAt(index) {
		let descriptor = lightDescriptors[index];
		if (!descriptor) {
			descriptor = {
				key: "",
				kind: "point",
				position: [0, 0, 0],
				direction: [0, -1, 0],
				coneHalfAngleRad: 0,
				range: 0,
				near: 0,
				far: 0,
				mapSize: 0,
				hasMap: false,
			};
			lightDescriptors[index] = descriptor;
		}
		return descriptor;
	}

	function casterSnapshotAt(index) {
		let snapshot = casterSnapshots[index];
		if (!snapshot) {
			snapshot = { key: "", stateKey: "", box: { min: [0, 0, 0], max: [0, 0, 0] } };
			casterSnapshots[index] = snapshot;
		}
		return snapshot;
	}


	function describeLight(threeLight, target) {
		const isSpot = threeLight.isSpotLight === true;
		const shadow = threeLight.shadow;
		const shadowCamera = shadow && shadow.camera ? shadow.camera : null;
		const position = threeLight.position;
		const targetPosition =
			isSpot && threeLight.target && threeLight.target.position ? threeLight.target.position : null;

		target.key = threeLight.uuid;
		target.kind = isSpot ? "spot" : "point";
		target.position[0] = position.x;
		target.position[1] = position.y;
		target.position[2] = position.z;
		target.direction[0] = 0;
		target.direction[1] = -1;
		target.direction[2] = 0;
		if (targetPosition) {
			const toX = targetPosition.x - position.x;
			const toY = targetPosition.y - position.y;
			const toZ = targetPosition.z - position.z;
			const length = Math.sqrt(toX * toX + toY * toY + toZ * toZ);
			if (length > 0) {
				target.direction[0] = toX / length;
				target.direction[1] = toY / length;
				target.direction[2] = toZ / length;
			}
		}
		target.coneHalfAngleRad = isSpot ? Number(threeLight.angle) || 0 : 0;
		target.range = Math.max(Number(threeLight.distance) || 0, 0);
		target.near = shadowCamera ? Number(shadowCamera.near) || 0 : 0;
		target.far = shadowCamera ? Number(shadowCamera.far) || 0 : 0;
		target.mapSize = shadow && shadow.mapSize ? Math.floor(shadow.mapSize.x) || 0 : 0;


		target.hasMap = !!(shadow && shadow.map);
		return target;
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
		if (!matrixWorld || !matrixWorld.elements) return false;
		const e = matrixWorld.elements;
		const localX = sphere.center.x;
		const localY = sphere.center.y;
		const localZ = sphere.center.z;
		const centerX = e[0] * localX + e[4] * localY + e[8] * localZ + e[12];
		const centerY = e[1] * localX + e[5] * localY + e[9] * localZ + e[13];
		const centerZ = e[2] * localX + e[6] * localY + e[10] * localZ + e[14];
		const worldRadius = sphere.radius * maximumScaleOf(matrixWorld);
		if (!Number.isFinite(centerX) || !Number.isFinite(centerY) || !Number.isFinite(centerZ)) return false;
		if (!Number.isFinite(worldRadius)) return false;
		target.key = mesh.uuid;


		target.stateKey = worldMatrixSignatureOf(matrixWorld) + "|" + (geometry.id === undefined ? "g" : geometry.id);
		target.box.min[0] = centerX - worldRadius;
		target.box.min[1] = centerY - worldRadius;
		target.box.min[2] = centerZ - worldRadius;
		target.box.max[0] = centerX + worldRadius;
		target.box.max[1] = centerY + worldRadius;
		target.box.max[2] = centerZ + worldRadius;
		return true;
	}


	function releaseManagedLights() {
		if (!(managedLightsByKey.size > 0)) return 0;
		let released = 0;
		managedLightsByKey.forEach((threeLight) => {
			if (!threeLight || !threeLight.shadow) return;
			threeLight.shadow.autoUpdate = true;


			threeLight.shadow.needsUpdate = true;
			released += 1;
		});
		managedLightsByKey.clear();
		return released;
	}


	function handOverTo(ownerName) {
		const owner = ownerName ? String(ownerName) : "another-owner";
		if (handedOverTo === owner && !(managedLightsByKey.size > 0)) return lastPulseSummary;
		handedOverTo = owner;
		managedLightsByKey.clear();
		invalidator.reset();
		tracker.reset();
		requestHeal("handed-over-to:" + owner);
		lastPulseSummary = { active: false, handedOverTo: owner, redrawCount: 0, keptCount: 0, pulseRequested: false };
		return lastPulseSummary;
	}

	function standDown(reason) {
		const released = releaseManagedLights();
		invalidator.reset();
		tracker.reset();
		requestHeal(reason || "stand-down");
		return released;
	}


	function planFrame(input) {
		const request = input && typeof input === "object" ? input : {};
		if (!isPhaseActive(request)) {
			standDown("phase-off");
			handedOverTo = "";
			lastPulseSummary = null;
			return inactivePulse;
		}
		handedOverTo = "";


		if (request.technology !== lastTechnology || request.tier !== lastTier) {
			lastTechnology = request.technology;
			lastTier = request.tier;
			requestHeal("tier-or-technology-change");
		}

		const entries = Array.isArray(request.entries) ? request.entries : [];
		const requestedCount = Math.floor(Number(request.managedCount) || 0);
		const managedCount = requestedCount >= 0 ? requestedCount : 0;
		const limit = managedCount >= entries.length ? entries.length : managedCount;

		activeLights.length = 0;
		seenLightKeys.clear();
		for (let index = 0; limit > index; index += 1) {
			const entry = entries[index];
			const threeLight = entry ? entry.light : null;
			if (!threeLight || !threeLight.shadow || !threeLight.position) continue;
			if (threeLight.castShadow !== true || threeLight.visible === false) continue;
			const descriptor = describeLight(threeLight, lightDescriptorAt(activeLights.length));
			activeLights.push(descriptor);
			seenLightKeys.add(descriptor.key);
		}


		let releasedLights = 0;
		if (managedLightsByKey.size > 0) {
			const staleKeys = [];
			managedLightsByKey.forEach((threeLight, key) => {
				if (!seenLightKeys.has(key)) staleKeys.push(key);
			});
			for (let index = 0; staleKeys.length > index; index += 1) {
				const key = staleKeys[index];
				const threeLight = managedLightsByKey.get(key);
				if (threeLight && threeLight.shadow) {
					threeLight.shadow.autoUpdate = true;
					threeLight.shadow.needsUpdate = true;
				}
				managedLightsByKey.delete(key);
				invalidator.forget(key);
				releasedLights += 1;
			}
		}

		let casterCount = 0;
		let casterOverflow = false;
		activeCasters.length = 0;


		const meshSource = request.meshes;
		const meshes = meshSource && typeof meshSource.values === "function" ? meshSource.values() : meshSource;
		if (meshes && typeof meshes[Symbol.iterator] === "function") {
			for (const mesh of meshes) {
				if (!mesh || mesh.visible === false || mesh.castShadow === false) continue;
				if (casterCount >= MAX_TRACKED_CASTERS) {
					casterOverflow = true;
					break;
				}
				const snapshot = casterSnapshotAt(casterCount);
				if (!snapshotCaster(mesh, snapshot)) continue;
				activeCasters.push(snapshot);
				casterCount += 1;
			}
		}

		if (casterOverflow) requestHeal("caster-overflow");

		const tracked = tracker.trackPulse(activeCasters);


		if (tracked.teleported) requestHeal("caster-teleport");

		const healedThisPulse = healRequested;
		const reasonThisPulse = healReason;
		const plan = invalidator.planFrame({
			lights: activeLights,
			dirtyBoxes: tracked.dirtyBoxes,
			invalidateAll: healedThisPulse,
		});
		healRequested = false;
		healReason = "heal";


		let redrawCount = 0;
		for (let index = 0; activeLights.length > index; index += 1) {
			const key = activeLights[index].key;
			const entry = entries[index];
			const threeLight = entry && entry.light && entry.light.uuid === key ? entry.light : null;
			const target = threeLight || managedLightsByKey.get(key);
			if (!target || !target.shadow) continue;
			managedLightsByKey.set(key, target);
			target.shadow.autoUpdate = false;
			if (plan.reasonByKey.get(key)) {
				target.shadow.needsUpdate = true;
				redrawCount += 1;
			}
		}


		for (let index = 0; activeLights.length > index; index += 1) {
			const descriptor = activeLights[index];
			if (descriptor.hasMap || plan.reasonByKey.get(descriptor.key)) continue;
			llQa.addError("LL-OPT1: luz local sem mapa e sem redraw no pulso", {
				phase: LOCAL_SHADOW_INVALIDATION_PHASE_ID,
				lightKey: descriptor.key,
			});
			if (logger) logger.warn("[Luzes locais] LL-OPT1: luz sem mapa nao recebeu redraw");
		}

		lastPulseSummary = {
			active: true,
			pulse: plan.pulse,
			healed: plan.healed,
			healReason: plan.healed ? reasonThisPulse : "",
			managedLights: managedLightsByKey.size,
			lightCount: plan.lightCount,
			redrawCount,
			keptCount: plan.keptCount,
			reductionRatio: plan.reductionRatio,
			releasedLights,
			casterCount: tracked.casterCount,
			movingCasters: tracked.movingCount,
			dirtyBoxes: tracked.dirtyBoxes.length,
			casterOverflow,
			pulseRequested: redrawCount > 0,
		};
		return lastPulseSummary;
	}

	return {
		phaseId: LOCAL_SHADOW_INVALIDATION_PHASE_ID,
		flagId: LOCAL_SHADOW_INVALIDATION_FLAG_ID,

		textureUnits: 0,

		setFlag(value) {
			return setLocalLightFlagOverride(LOCAL_SHADOW_INVALIDATION_FLAG_ID, value);
		},

		isActive(context) {
			return isPhaseActive(context);
		},

		planFrame,
		handOverTo,
		requestHeal,


		reset() {
			standDown("reset");
			handedOverTo = "";
			lastTechnology = null;
			lastTier = null;
			lastPulseSummary = null;
			return true;
		},

		lastPulse() {
			return lastPulseSummary;
		},

		stats() {
			return invalidator.stats();
		},

		status(context) {
			const frame = context && typeof context === "object" ? context : {};
			const flagDecision = resolveLocalLightFlag(LOCAL_SHADOW_INVALIDATION_FLAG_ID, { tier: frame.tier });
			const baselineFrozen = isLocalLightBaselineFrozen(frame.tier);
			const technologyAllowed = isLocalLightTechnology(frame.technology);
			const status = {
				phase: LOCAL_SHADOW_INVALIDATION_PHASE_ID,
				flag: LOCAL_SHADOW_INVALIDATION_FLAG_ID,
				tier: frame.tier || null,
				technologyAllowed,
				flagOn: flagDecision.active,
				flagToken: flagDecision.token,
				flagSource: flagDecision.source,
				baselineFrozen,
				active: isPhaseActive(frame),
				glsl: false,
				textureUnits: 0,
				handedOverTo,
				managedLights: managedLightsByKey.size,
				lastPulse: lastPulseSummary,
				invalidator: invalidator.stats(),
				pending: !technologyAllowed
					? "Technology outside ShadowMap / Future keeps every local map on the global shadow pulse"
					: baselineFrozen
						? "LlBaseline is freezing the legacy path: release it for the phase to enter"
						: "Declared residuals: (a) a caster world box comes from its bounding SPHERE, a deliberate superset - it survives rotation with no refit and can never miss a light, at the cost of dirtying slightly more than an exact AABB would; (b) past MAX_TRACKED_CASTERS casters the phase heals every pulse instead of diffing, so a very large place gets correctness and no saving; (c) the caster diff is computed here and again in LL-F13 for the atlas path - one shared diff would save a second scan of the mesh registry per frame; (d) skinned or morphed geometry that animates WITHOUT changing matrixWorld or the geometry id is not detected, the same assumption LL-F13 already ships with.",
			};
			llQa.setPhase(LOCAL_SHADOW_INVALIDATION_PHASE_ID, {
				flagOn: flagDecision.active,
				technologyAllowed,
				baselineFrozen,
				glsl: false,
				managedLights: managedLightsByKey.size,
				lastPulse: lastPulseSummary,
			});
			return status;
		},
	};
}
