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
	FADE_RANGE_PROP,
	LIGHT_FADE_FLAG_ID,
	LIGHT_FADE_MODE,
	LIGHT_FADE_PHASE_ID,
	MAX_DRAW_DISTANCE_PROP,
	MAX_FADE_STEP_PER_PLAN,
	PLANS_BEFORE_HIDING_FADED_LIGHT,
	activeLightBudgetForTier,
	cullRadiusPixelsForTier,
	shadowLightBudgetForTier,
} from "../lighting/llLightFadeContract.js";
import { distanceFadeTable } from "../lighting/llLightFadeCore.js";
import { createLightFadeState, nextLightFadeState, planLocalLightFade } from "../lighting/llLightFadePlanCore.js";
import { REFERENCE_VIEW, resolveView } from "../lighting/llShadowScreenSizeCore.js";


const INTENSITY_MATCH_EPSILON = 1e-6;


const LOCAL_LIGHT_PROPS_USER_DATA_KEY = "llProps";


const LOCAL_FADE_FLAG_DEFAULT = Object.freeze({ fraco: false, medio: true, forte: true });

registerLocalLightFlag({
	id: LIGHT_FADE_FLAG_ID,
	phase: LIGHT_FADE_PHASE_ID,
	description:
		"fade by distance and by screen size of the LOCAL lights, plus the active-light and shadow-caster budgets (MaxDrawDistance / FadeRange)",
	defaultsByTier: LOCAL_FADE_FLAG_DEFAULT,
});

function asObject(value) {
	return value && typeof value === "object" ? value : {};
}

function readWorldPosition(object3d) {
	const node = asObject(object3d);
	const elements = asObject(node.matrixWorld).elements;
	if (elements && elements.length >= 16 && Number.isFinite(elements[12])) {
		return [elements[12], elements[13], elements[14]];
	}
	const position = asObject(node.position);
	return [Number(position.x) || 0, Number(position.y) || 0, Number(position.z) || 0];
}

function readCameraForward(camera) {
	const elements = asObject(asObject(camera).matrixWorld).elements;
	if (elements && elements.length >= 16) {
		const forward = [-elements[8], -elements[9], -elements[10]];
		if (Math.hypot(forward[0], forward[1], forward[2]) > 0) return forward;
	}
	return [0, 0, -1];
}


function readLocalLightProperty(light, properties, camelCaseName, publicApiName) {
	const livePropertyBag = asObject(properties);
	if (livePropertyBag[camelCaseName] !== undefined) return Number(livePropertyBag[camelCaseName]) || 0;
	if (livePropertyBag[publicApiName] !== undefined) return Number(livePropertyBag[publicApiName]) || 0;
	const authored = asObject(asObject(light).userData)[LOCAL_LIGHT_PROPS_USER_DATA_KEY];
	if (asObject(authored)[publicApiName] !== undefined) return Number(asObject(authored)[publicApiName]) || 0;
	return 0;
}


export function createLocalLightFadeFeed(options) {
	const settings = asObject(options);
	const logger = settings.logger && typeof settings.logger.warn === "function" ? settings.logger : null;


	const appliedRecords = new Map();


	const lightByKey = new Map();
	let fadeState = createLightFadeState();
	let planIndex = 0;
	let appliedPlans = 0;
	let healCount = 0;


	let lightWriteRevision = 0;
	let lastPlan = null;
	let lastApplied = null;
	let lastRefusal = "";

	function isPhaseActive(frame) {
		const context = asObject(frame);
		if (!isLocalLightTechnology(context.technology)) return false;
		if (isLocalLightBaselineFrozen(context.tier)) return false;
		return isLocalLightFlagActive(LIGHT_FADE_FLAG_ID, context.tier);
	}


	function rememberRestoreState(key, light) {
		const record = appliedRecords.get(key);
		if (record === undefined) {
			return {
				authoritativeIntensity: Number(light.intensity) || 0,
				restoreCastShadow: light.castShadow === true,
				restoreVisible: light.visible !== false,
			};
		}
		const liveIntensity = Number(light.intensity) || 0;
		const weWroteThisValue = INTENSITY_MATCH_EPSILON >= Math.abs(liveIntensity - record.lastAppliedIntensity);
		return {
			authoritativeIntensity: weWroteThisValue ? record.authoritativeIntensity : liveIntensity,
			restoreCastShadow: record.restoreCastShadow,
			restoreVisible: record.restoreVisible,
		};
	}

	function describeLight(entry) {
		const source = asObject(entry);
		const light = source.light;
		if (!light) return null;
		const key = source.id !== undefined && source.id !== null ? String(source.id) : String(light.uuid);
		const restore = rememberRestoreState(key, light);
		return {
			key,
			name: key,
			kind: source.kind || light.type,
			worldPosition: readWorldPosition(light),
			influenceRadius: Number(light.distance) || 0,
			intensity: restore.authoritativeIntensity,
			enabled: restore.restoreVisible,
			shadowsRequested: restore.restoreCastShadow,
			maxDrawDistance: readLocalLightProperty(light, source.props, "maxDrawDistance", MAX_DRAW_DISTANCE_PROP),
			fadeRange: readLocalLightProperty(light, source.props, "fadeRange", FADE_RANGE_PROP),
		};
	}

	function describeLights(lights) {
		const described = [];
		lightByKey.clear();
		if (!lights || typeof lights[Symbol.iterator] !== "function") return described;
		for (const entry of lights) {
			const descriptor = describeLight(entry);
			if (descriptor === null) continue;


			lightByKey.set(descriptor.key, asObject(entry).light);
			described.push(descriptor);
		}
		return described;
	}

	function viewFromFrame(frame) {
		const context = asObject(frame);
		const camera = asObject(context.camera);
		return resolveView({
			verticalFovDeg: Number(camera.fov) || REFERENCE_VIEW.verticalFovDeg,
			widthPixels: Number(context.viewportWidth) || REFERENCE_VIEW.widthPixels,
			heightPixels: Number(context.viewportHeight) || REFERENCE_VIEW.heightPixels,
		});
	}

	function cameraFromFrame(frame) {
		const camera = asObject(frame).camera;
		return { position: readWorldPosition(camera), forward: readCameraForward(camera) };
	}

	function applyEntryToLight(entry, light, key) {
		const restore = rememberRestoreState(key, light);
		const appliedIntensity = restore.authoritativeIntensity * entry.fade;
		light.intensity = appliedIntensity;
		light.castShadow = entry.castsShadow;
		light.visible = restore.restoreVisible && !entry.hidden;
		lightWriteRevision += 1;
		appliedRecords.set(key, {
			light,
			authoritativeIntensity: restore.authoritativeIntensity,
			lastAppliedIntensity: appliedIntensity,
			restoreCastShadow: restore.restoreCastShadow,
			restoreVisible: restore.restoreVisible,
		});
		return appliedIntensity;
	}


	function applyPlan(plan) {
		let written = 0;
		let faded = 0;
		let shadowed = 0;
		let hidden = 0;
		plan.entries.forEach((entry) => {
			const light = lightByKey.get(entry.key);
			if (light === undefined) return;
			applyEntryToLight(entry, light, entry.key);
			written += 1;
			if (entry.fade !== 1) faded += 1;
			if (entry.castsShadow) shadowed += 1;
			if (entry.hidden) hidden += 1;
		});
		return { written, faded, shadowed, hidden };
	}


	function heal(reason) {
		let restored = 0;
		appliedRecords.forEach((record) => {
			const light = record.light;
			if (!light) return;
			light.intensity = record.authoritativeIntensity;
			light.castShadow = record.restoreCastShadow;
			light.visible = record.restoreVisible;
			restored += 1;
		});
		if (restored > 0) lightWriteRevision += 1;
		appliedRecords.clear();
		lightByKey.clear();
		fadeState = createLightFadeState();
		planIndex = 0;
		lastApplied = null;
		healCount += 1;
		llQa.setPhase(LIGHT_FADE_PHASE_ID, {
			heal: String(reason || "manual"),
			restoredLights: restored,
			heals: healCount,
		});
		return { restored, reason: String(reason || "manual") };
	}

	function publishTelemetry(plan, applied, active) {
		llQa.setPhase(LIGHT_FADE_PHASE_ID, {
			flag: LIGHT_FADE_FLAG_ID,
			on: active,
			mode: plan.mode,
			plan: plan.planIndex,
			lights: plan.summary.lights,
			active: plan.summary.active,
			shadowed: plan.summary.shadowed,
			fading: plan.summary.fading,
			culled: plan.summary.culled,
			hidden: plan.summary.hidden,
			maxFadeStep: plan.summary.maxFadeStep,
			withinBudgets: plan.summary.withinActiveBudget && plan.summary.withinShadowBudget,
			withinFadeStep: plan.summary.withinFadeStepLimit,
			byRefusal: plan.summary.byRefusal,
			appliedPlans,
			heals: healCount,
			noGlsl: true,
			refusal: lastRefusal,
		});
	}


	function runPlan(input) {
		const frame = asObject(input);
		const active = isPhaseActive(frame);
		const mode = frame.mode || (active ? LIGHT_FADE_MODE.FADE : LIGHT_FADE_MODE.LEGACY);
		planIndex += 1;
		const plan = planLocalLightFade({
			lights: describeLights(frame.lights),
			view: viewFromFrame(frame),
			camera: cameraFromFrame(frame),
			tier: frame.tier,
			mode,
			planIndex,
			previousState: fadeState,
		});
		fadeState = nextLightFadeState(plan);
		lastPlan = plan;
		const applied = frame.apply === true ? applyPlan(plan) : null;
		if (applied !== null) {
			appliedPlans += 1;
			lastApplied = applied;
		}
		publishTelemetry(plan, applied, active);
		return { mode: plan.mode, summary: plan.summary, entries: plan.entries, applied, view: plan.view };
	}

	return {
		phaseId: LIGHT_FADE_PHASE_ID,
		flagId: LIGHT_FADE_FLAG_ID,


		planFrame(input) {
			try {
				const frame = asObject(input);
				if (!isPhaseActive(frame)) {
					if (appliedRecords.size > 0) heal("flag-off");
					return null;
				}
				lastRefusal = "";
				return runPlan({
					lights: frame.lights,
					camera: frame.camera,
					tier: frame.tier,
					technology: frame.technology,
					viewportWidth: frame.viewportWidth,
					viewportHeight: frame.viewportHeight,
					apply: true,
				});
			} catch (error) {
				lastRefusal = String((error && error.message) || error);
				llQa.addError("LL-F21: " + lastRefusal, { phase: LIGHT_FADE_PHASE_ID });
				if (logger) logger.warn("[Luzes locais] LL-F21 curou a cena: " + lastRefusal);
				heal("frame-error");
				return null;
			}
		},


		plan(input) {
			return runPlan(asObject(input));
		},


		reset(reason) {
			const healed = heal(reason || "reset");
			appliedPlans = 0;
			lastPlan = null;
			return healed;
		},

		heal,


		lightWriteRevision() {
			return lightWriteRevision;
		},


		curve(input) {
			const settings = asObject(input);
			const maxDrawDistance = Number(settings.maxDrawDistance) || 40;
			const fadeRange = settings.fadeRange === undefined ? 10 : Number(settings.fadeRange) || 0;
			const distances = Array.isArray(settings.distances) && settings.distances.length
				? settings.distances
				: [0, maxDrawDistance - fadeRange, maxDrawDistance - fadeRange / 2, maxDrawDistance, maxDrawDistance + 1];
			return distanceFadeTable({ maxDrawDistance, fadeRange, distances });
		},

		setFlag(value) {
			return setLocalLightFlagOverride(LIGHT_FADE_FLAG_ID, value);
		},

		lastPlan() {
			return lastPlan ? lastPlan.summary : null;
		},

		status(context) {
			const frame = asObject(context);
			const flagDecision = resolveLocalLightFlag(LIGHT_FADE_FLAG_ID, { tier: frame.tier });
			const technologyAllowed = isLocalLightTechnology(frame.technology);
			return {
				phase: LIGHT_FADE_PHASE_ID,
				flag: LIGHT_FADE_FLAG_ID,
				tier: frame.tier || null,
				technologyAllowed,
				baselineFrozen: isLocalLightBaselineFrozen(frame.tier),
				flagOn: flagDecision.active,
				flagToken: flagDecision.token,
				active: isPhaseActive(frame),
				mode: isPhaseActive(frame) ? LIGHT_FADE_MODE.FADE : LIGHT_FADE_MODE.LEGACY,
				properties: [MAX_DRAW_DISTANCE_PROP, FADE_RANGE_PROP],
				activeLightBudget: activeLightBudgetForTier(frame.tier),
				shadowLightBudget: shadowLightBudgetForTier(frame.tier),
				cullRadiusPixels: cullRadiusPixelsForTier(frame.tier),
				maxFadeStepPerPlan: MAX_FADE_STEP_PER_PLAN,
				plansBeforeHiding: PLANS_BEFORE_HIDING_FADED_LIGHT,
				plans: planIndex,
				appliedPlans,
				heals: healCount,
				writtenLights: appliedRecords.size,
				lastPlan: lastPlan ? lastPlan.summary : null,
				lastApplied,
				noGlsl: true,
				refusal: lastRefusal,
				pending: !technologyAllowed
					? "Technology outside ShadowMap / Future keeps the legacy path byte for byte"
					: "Declared residuals: (1) MaxDrawDistance / FadeRange only reach a light once LL-F22 plumbs the public API into the property panel - until then both read 0, which is the legacy default (no cut, no band), so the phase acts through screen culling and budgets only; (2) the plan runs after the shadow-atlas ranking of LL-F10 in the frame, so the atlas sees the faded intensity of the PREVIOUS plan - one plan of latency, never a wrong image; (3) the active-light budget of this phase and the forward light budget of LL-F20 are still counted separately and must be unified when the cluster lands.",
			};
		},
	};
}
