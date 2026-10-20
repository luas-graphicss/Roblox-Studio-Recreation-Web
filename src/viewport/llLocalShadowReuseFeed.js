import {
	isLocalLightFlagActive,
	registerLocalLightFlag,
	resolveLocalLightFlag,
	setLocalLightFlagOverride,
} from "../lighting/llFeatureFlags.js";
import { isLocalLightBaselineFrozen } from "../lighting/llBaselineFreezeFlag.js";
import { isLocalLightTechnology } from "../lighting/llTechnologyGate.js";
import { llQa } from "../lighting/llTelemetry.js";
import {
	DEFAULT_MAX_PULSES_WITHOUT_REFRESH,
	LOCAL_SHADOW_REUSE_PHASE_ID,
	POINT_KIND,
	SPOT_KIND,
	createLocalShadowReuseGate,
} from "../lighting/llLocalShadowReuseCore.js";

export const LOCAL_SHADOW_REUSE_FLAG_ID = "LocalShadowReuse";


const LOCAL_SHADOW_REUSE_FLAG_DEFAULT = Object.freeze({ fraco: true, medio: true, forte: true });

registerLocalLightFlag({
	id: LOCAL_SHADOW_REUSE_FLAG_ID,
	phase: LOCAL_SHADOW_REUSE_PHASE_ID,
	description:
		"reuses the shadow map of a local light while its pose, its frustum, its resolution and the casters around it are unchanged (no redraw of an identical depth texture)",
	defaultsByTier: LOCAL_SHADOW_REUSE_FLAG_DEFAULT,
});

const DOWNWARD_DIRECTION = Object.freeze([0, -1, 0]);

function asObject(value) {
	return value && typeof value === "object" ? value : {};
}

function finiteOr(value, fallback) {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}


function readLightPosition(light) {
	const position = asObject(asObject(light).position);
	return [finiteOr(position.x, 0), finiteOr(position.y, 0), finiteOr(position.z, 0)];
}


function readSpotDirection(light) {
	const source = asObject(light);
	if (source.isSpotLight !== true) return DOWNWARD_DIRECTION;
	const target = asObject(asObject(source.target).position);
	const position = readLightPosition(source);
	const direction = [
		finiteOr(target.x, 0) - position[0],
		finiteOr(target.y, 0) - position[1],
		finiteOr(target.z, 0) - position[2],
	];
	const length = Math.hypot(direction[0], direction[1], direction[2]);
	if (!(length > 0)) return DOWNWARD_DIRECTION;
	return [direction[0] / length, direction[1] / length, direction[2] / length];
}

function describeLightForGate(entry) {
	const source = asObject(entry);
	const light = source.light;
	if (!light || !light.shadow) return null;
	if (light.castShadow !== true) return null;
	const key = source.key === undefined || source.key === null ? String(light.uuid) : String(source.key);
	const shadow = light.shadow;
	const shadowCamera = asObject(shadow.camera);
	const kind = light.isSpotLight === true ? SPOT_KIND : POINT_KIND;
	return {
		key,
		kind,
		hasMap: !!shadow.map,
		config: {
			kind,
			position: readLightPosition(light),
			direction: readSpotDirection(light),
			outerHalfAngleRad: finiteOr(light.angle, 0),
			range: finiteOr(light.distance, 0),
			near: finiteOr(shadowCamera.near, 0),
			far: finiteOr(shadowCamera.far, 0),
			mapSize: finiteOr(asObject(shadow.mapSize).x, 0),
			castShadow: true,
		},
		shadow,
	};
}


export function createLocalShadowReuseFeed(options) {
	const settings = asObject(options);
	const logger = settings.logger && typeof settings.logger.warn === "function" ? settings.logger : null;
	const gate = createLocalShadowReuseGate({
		maxPulsesWithoutRefresh: finiteOr(settings.maxPulsesWithoutRefresh, DEFAULT_MAX_PULSES_WITHOUT_REFRESH),
	});


	const heldShadowsByKey = new Map();


	const gateLights = [];
	const shadowsByKey = new Map();
	let appliedPulses = 0;
	let healCount = 0;
	let lastRefusal = "";

	function isPhaseActive(frame) {
		const context = asObject(frame);
		if (!isLocalLightTechnology(context.technology)) return false;
		if (isLocalLightBaselineFrozen(context.tier)) return false;
		return isLocalLightFlagActive(LOCAL_SHADOW_REUSE_FLAG_ID, context.tier);
	}


	function releaseShadow(shadow) {
		if (!shadow) return false;
		shadow.autoUpdate = true;
		shadow.needsUpdate = true;
		return true;
	}

	function heal(reason) {
		let released = 0;
		heldShadowsByKey.forEach((shadow) => {
			if (releaseShadow(shadow)) released += 1;
		});
		heldShadowsByKey.clear();
		gate.reset();
		healCount += 1;
		llQa.setPhase(LOCAL_SHADOW_REUSE_PHASE_ID, {
			heal: String(reason || "manual"),
			releasedShadows: released,
			heals: healCount,
		});
		return { released, reason: String(reason || "manual") };
	}


	function releaseShadowsOutsideOf(pulse) {
		const plannedKeys = new Set(pulse.verdicts.map((verdict) => verdict.key));
		const releasedKeys = [];
		heldShadowsByKey.forEach((shadow, key) => {
			if (plannedKeys.has(key)) return;
			releaseShadow(shadow);
			releasedKeys.push(key);
		});
		releasedKeys.forEach((key) => heldShadowsByKey.delete(key));
		return releasedKeys.length;
	}

	function collectGateLights(lights) {
		gateLights.length = 0;
		shadowsByKey.clear();
		if (!lights || typeof lights[Symbol.iterator] !== "function") return;
		for (const entry of lights) {
			const descriptor = describeLightForGate(entry);
			if (descriptor === null) continue;
			shadowsByKey.set(descriptor.key, descriptor.shadow);
			gateLights.push(descriptor);
		}
	}

	function applyPulse(pulse) {
		let refreshed = 0;
		let reused = 0;
		pulse.verdicts.forEach((verdict) => {
			const shadow = shadowsByKey.get(verdict.key);
			if (shadow === undefined) return;


			shadow.autoUpdate = false;
			shadow.needsUpdate = verdict.refresh === true;
			heldShadowsByKey.set(verdict.key, shadow);
			if (verdict.refresh === true) refreshed += 1;
			else reused += 1;
		});
		return { refreshed, reused };
	}

	function publishTelemetry(pulse, applied, releasedKeys) {
		llQa.setPhase(LOCAL_SHADOW_REUSE_PHASE_ID, {
			flag: LOCAL_SHADOW_REUSE_FLAG_ID,
			on: true,
			pulse: pulse.pulse,
			casterRevision: pulse.casterRevision,
			lights: pulse.lightCount,
			refreshedMaps: applied.refreshed,
			reusedMaps: applied.reused,
			refreshedFacePasses: pulse.refreshedFacePasses,
			facePassBaseline: pulse.facePassBaseline,
			savedFacePasses: pulse.savedFacePasses,
			reductionRatio: pulse.reductionRatio,
			releasedShadows: releasedKeys,
			heldShadows: heldShadowsByKey.size,
			appliedPulses,
			heals: healCount,
			noGlsl: true,
			refusal: lastRefusal,
		});
	}

	return {
		phaseId: LOCAL_SHADOW_REUSE_PHASE_ID,
		flagId: LOCAL_SHADOW_REUSE_FLAG_ID,


		planFrame(input) {
			try {
				const frame = asObject(input);
				if (!isPhaseActive(frame)) {
					if (heldShadowsByKey.size > 0) heal("flag-off");
					return null;
				}
				lastRefusal = "";
				collectGateLights(frame.lights);
				const pulse = gate.planPulse({
					lights: gateLights,
					casterRevision: frame.casterRevision,
					invalidateAll: frame.invalidateAll === true,
				});
				const applied = applyPulse(pulse);
				const releasedShadows = releaseShadowsOutsideOf(pulse);
				appliedPulses += 1;
				publishTelemetry(pulse, applied, releasedShadows);
				return pulse;
			} catch (error) {
				lastRefusal = String((error && error.message) || error);
				llQa.addError("LL-F25: " + lastRefusal, { phase: LOCAL_SHADOW_REUSE_PHASE_ID });
				if (logger) logger.warn("[Luzes locais] LL-F25 curou as sombras locais: " + lastRefusal);
				heal("frame-error");
				return null;
			}
		},

		heal,


		reset(reason) {
			const healed = heal(reason || "reset");
			appliedPulses = 0;
			return healed;
		},

		setFlag(value) {
			return setLocalLightFlagOverride(LOCAL_SHADOW_REUSE_FLAG_ID, value);
		},

		isActive(context) {
			return isPhaseActive(context);
		},

		lastPulse() {
			return gate.lastPulse();
		},


		heldShadowCount() {
			return heldShadowsByKey.size;
		},

		stats() {
			return gate.stats();
		},

		status(context) {
			const frame = asObject(context);
			const flagDecision = resolveLocalLightFlag(LOCAL_SHADOW_REUSE_FLAG_ID, { tier: frame.tier });
			const technologyAllowed = isLocalLightTechnology(frame.technology);
			const pulse = gate.lastPulse();
			return {
				phase: LOCAL_SHADOW_REUSE_PHASE_ID,
				flag: LOCAL_SHADOW_REUSE_FLAG_ID,
				tier: frame.tier || null,
				technologyAllowed,
				baselineFrozen: isLocalLightBaselineFrozen(frame.tier),
				flagOn: flagDecision.active,
				flagToken: flagDecision.token,
				active: isPhaseActive(frame),
				heldShadows: heldShadowsByKey.size,
				appliedPulses,
				heals: healCount,
				maxPulsesWithoutRefresh: gate.maxPulsesWithoutRefresh,
				lastPulse: pulse,
				stats: gate.stats(),
				noGlsl: true,
				refusal: lastRefusal,
				pending: !technologyAllowed
					? "Technology outside ShadowMap / Future keeps the legacy path byte for byte"
					: "Declared residuals: (1) the caster revision is raised per SCENE, not per light, so a part moving in one room also refreshes the maps of the lights in another - exact, never wrong, just less thrifty than a per-light caster diff (LL-F13 owns that diff for the atlas path); (2) with the weak-GPU rotation (F9) active the maps belong to the rotation and this phase stays out, so the profile that already spends one map per frame is untouched; (3) the max-age net redraws every held map once every maxPulsesWithoutRefresh pulses, which is what makes an unreported caster change heal by itself.",
			};
		},
	};
}
