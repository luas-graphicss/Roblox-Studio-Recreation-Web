import {
	registerLocalLightFlag,
	isLocalLightFlagActive,
	resolveLocalLightFlag,
	setLocalLightFlagOverride,
} from "../lighting/llFeatureFlags.js";
import { isLocalLightBaselineFrozen } from "../lighting/llBaselineFreezeFlag.js";
import { isLocalLightTechnology } from "../lighting/llTechnologyGate.js";
import { llQa } from "../lighting/llTelemetry.js";
import {
	LIGHTS_FRAGMENT_CHUNK,
	LOCAL_HDR_FLAG_ID,
	LOCAL_HDR_PATCH_ID,
	LOCAL_HDR_PHASE_ID,
	LOCAL_HDR_UNIFORMS,
} from "../lighting/llHdrLocalContract.js";
import { INJECTION_MARK, buildLocalHdrHelpersGlsl, injectLocalHdr } from "../lighting/llHdrLocalGlsl.js";
import {
	DEFAULT_ADAPTATION_RATE_PER_SECOND,
	MINIMUM_METERED_LUMINANCE,
	adaptExposure,
	meteredIlluminance,
	peakIlluminance,
	resolveAutoExposure,
	resolvePreExposure,
} from "../lighting/llHdrLocalCore.js";
import {
	CLAMPABLE_FEATURES,
	DEFAULT_CEILING_DISPLAY_LUMINANCE,
	DEFAULT_KNEE_DISPLAY_LUMINANCE,
	resolveClampWindow,
} from "../lighting/llFireflyClampCore.js";
import {
	DEFAULT_SPECULAR_AA_THRESHOLD,
	DEFAULT_SPECULAR_AA_VARIANCE,
	specularAaVarianceForLocalLight,
} from "../lighting/llSpecularAaCore.js";


import { localLightsInRenderOrder } from "../lighting/llLocalLightWalkCache.js";


import { createMeteredLightPool } from "../lighting/llMeteredLightPool.js";


export const LOCAL_HDR_PARS_CHUNK = "lights_pars_begin";


export const RE_DIRECT_CALL_ANCHOR = "RE_Direct( directLight,";


export const LOCAL_HDR_PATCH_ORDER = 90;


const NEAR_FIELD_PROBE_DISTANCE = 0.5;


const REFERENCE_HIGHLIGHT_PERCEPTUAL_ROUGHNESS = 0.08;


const MAXIMUM_ADAPTATION_DELTA_SECONDS = 0.25;


const DEFAULT_TONE_MAPPING_EXPOSURE = 1;

function finiteOr(value, fallback) {
	return Number.isFinite(value) ? value : fallback;
}

function positiveOr(value, fallback) {
	return Number.isFinite(value) && value > 0 ? value : fallback;
}


function worldPositionOf(object3d) {
	const elements = object3d && object3d.matrixWorld ? object3d.matrixWorld.elements : null;
	if (!elements) return { x: 0, y: 0, z: 0 };
	return { x: elements[12], y: elements[13], z: elements[14] };
}


function distanceToMeteringPoint(object3d, meteringPoint) {
	const elements = object3d && object3d.matrixWorld ? object3d.matrixWorld.elements : null;
	const deltaX = (elements ? elements[12] : 0) - meteringPoint.x;
	const deltaY = (elements ? elements[13] : 0) - meteringPoint.y;
	const deltaZ = (elements ? elements[14] : 0) - meteringPoint.z;
	return Math.sqrt(deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ);
}

function appendMeteredLights(sourceLights, meteringPoint, pool) {
	if (!Array.isArray(sourceLights)) return;
	for (let index = 0; index !== sourceLights.length; index++) {
		const light = sourceLights[index];
		if (!light || light.visible === false) continue;
		const intensityCandela = Number(light.intensity);
		if (!(intensityCandela > 0)) continue;


		pool.add(intensityCandela, distanceToMeteringPoint(light, meteringPoint));
	}
}


function meterLocalLights(scene, meteringPoint, pool) {
	const collected = localLightsInRenderOrder(scene);
	pool.begin();
	appendMeteredLights(collected.pointLights, meteringPoint, pool);
	appendMeteredLights(collected.spotLights, meteringPoint, pool);
	return pool.lights();
}


registerLocalLightFlag({
	id: LOCAL_HDR_FLAG_ID,
	phase: LOCAL_HDR_PHASE_ID,
	description:
		"local HDR: local lights enter the metering (100k lm without clip), calibrated specular AA and anti firefly clamp",
	defaultsByTier: { fraco: false, medio: true, forte: true },
});


let helpersGlslCache = null;
function buildHelpersOnce() {
	if (helpersGlslCache === null) helpersGlslCache = buildLocalHdrHelpersGlsl();
	return helpersGlslCache;
}


export function registerLocalLightHdrPhase(options) {
	const settings = options && typeof options === "object" ? options : {};
	const registry = settings.registry;
	if (!registry || typeof registry.registerShaderPatch !== "function") {
		throw new Error("LL-F9: a local-light patch registry is required");
	}
	const logger = settings.logger && typeof settings.logger.warn === "function" ? settings.logger : null;


	registry.registerUniform(LOCAL_HDR_UNIFORMS.enabled, 0);
	registry.registerUniform(LOCAL_HDR_UNIFORMS.clampKnee, DEFAULT_KNEE_DISPLAY_LUMINANCE);
	registry.registerUniform(LOCAL_HDR_UNIFORMS.clampCeiling, DEFAULT_CEILING_DISPLAY_LUMINANCE);
	registry.registerUniform(LOCAL_HDR_UNIFORMS.specularAaVariance, DEFAULT_SPECULAR_AA_VARIANCE);
	registry.registerUniform(LOCAL_HDR_UNIFORMS.specularAaThreshold, DEFAULT_SPECULAR_AA_THRESHOLD);


	llQa.setTextureUnits(LOCAL_HDR_PHASE_ID, 0);


	const meteredLightPool = createMeteredLightPool();

	const tuning = {
		exposureCompensationEv: 0,
		adaptationRatePerSecond: DEFAULT_ADAPTATION_RATE_PER_SECOND,
		kneeDisplayLuminance: DEFAULT_KNEE_DISPLAY_LUMINANCE,
		ceilingDisplayLuminance: DEFAULT_CEILING_DISPLAY_LUMINANCE,
		specularAaVariance: DEFAULT_SPECULAR_AA_VARIANCE,
		specularAaThreshold: DEFAULT_SPECULAR_AA_THRESHOLD,
	};

	let appliedShaderCount = 0;
	let lastClampedCallCount = 0;
	let lastMeasurement = null;
	let adaptedMeterExposure = null;
	let phaseWasActive = false;
	let lastRefusal = "";
	let previousFrameTimestamp = null;

	function recordRefusal(reason) {
		lastRefusal = reason;
		llQa.addError("LL-F9: " + reason, { phase: LOCAL_HDR_PHASE_ID, patch: LOCAL_HDR_PATCH_ID });
		if (logger) logger.warn("[Luzes locais] LL-F9 recusou: " + reason);
	}


	function resolveDeltaTimeSeconds(reportedDeltaTimeSeconds) {
		if (Number.isFinite(reportedDeltaTimeSeconds) && reportedDeltaTimeSeconds >= 0) {
			return Math.min(reportedDeltaTimeSeconds, MAXIMUM_ADAPTATION_DELTA_SECONDS);
		}
		const now =
			typeof performance === "object" && performance && typeof performance.now === "function"
				? performance.now()
				: Date.now();
		const elapsedSeconds = previousFrameTimestamp === null ? 0 : (now - previousFrameTimestamp) / 1000;
		previousFrameTimestamp = now;
		return Math.min(Math.max(elapsedSeconds, 0), MAXIMUM_ADAPTATION_DELTA_SECONDS);
	}


	function isPhaseActive(context) {
		const frame = context && typeof context === "object" ? context : {};
		if (!isLocalLightTechnology(frame.technology)) return false;
		if (isLocalLightBaselineFrozen(frame.tier)) return false;
		return isLocalLightFlagActive(LOCAL_HDR_FLAG_ID, frame.tier);
	}


	function declareHelpersAtGlobalScope(context) {
		if (context.contains("fragment", INJECTION_MARK)) return true;
		const declared = context.patchChunk("fragment", LOCAL_HDR_PARS_CHUNK, (chunkSource) => {
			if (typeof chunkSource !== "string") return null;
			if (chunkSource.indexOf(INJECTION_MARK) >= 0) return null;
			return chunkSource + "\n" + buildHelpersOnce();
		});
		if (!declared) {
			recordRefusal("could not declare the helpers at global scope in " + LOCAL_HDR_PARS_CHUNK);
			return false;
		}
		return true;
	}

	registry.registerShaderPatch({
		id: LOCAL_HDR_PATCH_ID,
		phase: LOCAL_HDR_PHASE_ID,
		anchor: RE_DIRECT_CALL_ANCHOR,
		order: LOCAL_HDR_PATCH_ORDER,


		isActive: (context) => isPhaseActive(context),
		apply: (context) => {
			const anchor = context.checkAnchor(LIGHTS_FRAGMENT_CHUNK, RE_DIRECT_CALL_ANCHOR);
			if (!anchor.found) {
				recordRefusal(anchor.reason);
				return false;
			}


			if (!declareHelpersAtGlobalScope(context)) return false;
			let injection = null;
			const patched = context.patchChunk("fragment", LIGHTS_FRAGMENT_CHUNK, (chunkSource) => {
				injection = injectLocalHdr(chunkSource);
				return injection.injected ? injection.source : null;
			});
			if (!patched || !injection || !injection.injected) {
				recordRefusal(
					"did not inject into " + LIGHTS_FRAGMENT_CHUNK + ": " + (injection ? injection.reason : "chunk missing"),
				);
				return false;
			}
			lastClampedCallCount = injection.clampedCallCount;
			appliedShaderCount++;
			lastRefusal = "";
			return true;
		},
	});


	function restoreNeutralUniforms() {
		registry.setUniformValue(LOCAL_HDR_UNIFORMS.enabled, 0);
		registry.setUniformValue(LOCAL_HDR_UNIFORMS.clampKnee, tuning.kneeDisplayLuminance);
		registry.setUniformValue(LOCAL_HDR_UNIFORMS.clampCeiling, tuning.ceilingDisplayLuminance);
		registry.setUniformValue(LOCAL_HDR_UNIFORMS.specularAaVariance, tuning.specularAaVariance);
		registry.setUniformValue(LOCAL_HDR_UNIFORMS.specularAaThreshold, tuning.specularAaThreshold);
		adaptedMeterExposure = null;
		previousFrameTimestamp = null;
	}

	const phase = {
		phaseId: LOCAL_HDR_PHASE_ID,
		flagId: LOCAL_HDR_FLAG_ID,
		patchId: LOCAL_HDR_PATCH_ID,
		anchor: RE_DIRECT_CALL_ANCHOR,
		uniformNames: Object.freeze(Object.keys(LOCAL_HDR_UNIFORMS).map((key) => LOCAL_HDR_UNIFORMS[key])),


		setFlag(value) {
			return setLocalLightFlagOverride(LOCAL_HDR_FLAG_ID, value);
		},

		isActive(context) {
			return isPhaseActive(context);
		},

		configure(partialTuning) {
			Object.keys(partialTuning || {}).forEach((key) => {
				if (Object.prototype.hasOwnProperty.call(tuning, key) && Number.isFinite(partialTuning[key])) {
					tuning[key] = partialTuning[key];
				}
			});
			return Object.assign({}, tuning);
		},


		syncLocalHdrFrame(scene, camera, context) {
			const frame = context && typeof context === "object" ? context : {};
			if (!isPhaseActive(frame)) {


				if (phaseWasActive) {
					phaseWasActive = false;
					restoreNeutralUniforms();
					llQa.setPhase(LOCAL_HDR_PHASE_ID, { on: false, reason: "flag off: legacy window restored" });
				}
				return null;
			}
			if (!phaseWasActive) {
				phaseWasActive = true;
				registry.setUniformValue(LOCAL_HDR_UNIFORMS.enabled, 1);
			}

			const meteringPoint = worldPositionOf(camera);
			const lights = meterLocalLights(scene, meteringPoint, meteredLightPool);


			const exposure = positiveOr(frame.exposure, DEFAULT_TONE_MAPPING_EXPOSURE);
			const clampWindow = resolveClampWindow({
				exposure,
				kneeDisplayLuminance: tuning.kneeDisplayLuminance,
				ceilingDisplayLuminance: tuning.ceilingDisplayLuminance,
			});
			registry.setUniformValue(LOCAL_HDR_UNIFORMS.clampKnee, clampWindow.knee);
			registry.setUniformValue(LOCAL_HDR_UNIFORMS.clampCeiling, clampWindow.ceiling);

			const averageIlluminance = meteredIlluminance(lights);
			const nearFieldIlluminance = peakIlluminance(lights, NEAR_FIELD_PROBE_DISTANCE);
			const radianceRatio = nearFieldIlluminance / Math.max(averageIlluminance, MINIMUM_METERED_LUMINANCE);
			const variance = specularAaVarianceForLocalLight({
				baseVariance: tuning.specularAaVariance,
				perceptualRoughness: REFERENCE_HIGHLIGHT_PERCEPTUAL_ROUGHNESS,
				radianceRatio,
			});
			registry.setUniformValue(LOCAL_HDR_UNIFORMS.specularAaVariance, variance);
			registry.setUniformValue(LOCAL_HDR_UNIFORMS.specularAaThreshold, tuning.specularAaThreshold);


			const metering = resolveAutoExposure({ lights, exposureCompensationEv: tuning.exposureCompensationEv });
			const deltaTimeSeconds = resolveDeltaTimeSeconds(frame.deltaTimeSeconds);
			adaptedMeterExposure = adaptExposure(
				adaptedMeterExposure,
				metering.exposure,
				tuning.adaptationRatePerSecond,
				deltaTimeSeconds,
			);
			const preExposure = resolvePreExposure({ peakRadiance: nearFieldIlluminance });

			lastMeasurement = {
				meteredLights: lights.length,
				averageIlluminance,
				peakIlluminance: nearFieldIlluminance,
				rendererExposure: exposure,
				measuredEv100: metering.measuredEv100,
				targetEv100: metering.ev100,
				targetExposure: metering.exposure,
				adaptedExposure: adaptedMeterExposure,
				displayLuminance: metering.displayLuminance,
				wouldClipWithoutMetering: metering.clipped,
				clampKnee: clampWindow.knee,
				clampCeiling: clampWindow.ceiling,
				specularAaVariance: variance,
				preExposure: preExposure.preExposure,
				preExposureCompensation: preExposure.toneMappingCompensation,
				fitsInHdrBuffer: preExposure.fitsInBuffer,
			};
			return lastMeasurement;
		},

		lastMeasurement() {
			return lastMeasurement ? Object.assign({}, lastMeasurement) : null;
		},

		appliedCount() {
			return appliedShaderCount;
		},

		resetCounters() {
			appliedShaderCount = 0;
			lastClampedCallCount = 0;
			return appliedShaderCount;
		},




		status(context) {
			const frame = context && typeof context === "object" ? context : {};
			const flagDecision = resolveLocalLightFlag(LOCAL_HDR_FLAG_ID, { tier: frame.tier });
			const baselineFrozen = isLocalLightBaselineFrozen(frame.tier);
			const technologyAllowed = isLocalLightTechnology(frame.technology);
			const anchor = registry.checkAnchor(LIGHTS_FRAGMENT_CHUNK, RE_DIRECT_CALL_ANCHOR);
			const status = {
				phase: LOCAL_HDR_PHASE_ID,
				flag: LOCAL_HDR_FLAG_ID,
				tier: frame.tier || null,
				technologyAllowed,
				flagOn: flagDecision.active,
				flagToken: flagDecision.token,
				flagSource: flagDecision.source,
				baselineFrozen,
				active: isPhaseActive(frame),
				chunks: [LOCAL_HDR_PARS_CHUNK, LIGHTS_FRAGMENT_CHUNK],
				anchor: anchor.found ? "ok" : anchor.reason,
				patchedShaders: appliedShaderCount,
				guardedDirectLightCalls: lastClampedCallCount,
				authoredClampableFeatures: CLAMPABLE_FEATURES.slice(),
				measurement: lastMeasurement,
				tuning: Object.assign({}, tuning),
				refusal: lastRefusal,
				pending: !technologyAllowed
					? "Technology outside ShadowMap / Future keeps the legacy path byte for byte"
					: baselineFrozen
						? "LlBaseline is freezing the legacy path: release it for the phase to enter"
						: "Declared residuals: (a) applying auto exposure belongs to the engine exposure owner - this phase only measures and publishes it; (b) in the shader the clamp protects EVERY point/spot sample, because the GPU cannot know which phase produced a sample - CLAMPABLE_FEATURES is the authoring contract, not a runtime filter. The knee at 4x white is what keeps legacy content bit identical.",
			};
			llQa.setPhase(LOCAL_HDR_PHASE_ID, {
				flagOn: flagDecision.active,
				technologyAllowed,
				baselineFrozen,
				patchedShaders: appliedShaderCount,
				anchorOk: anchor.found,
				measurement: lastMeasurement,
				refusal: lastRefusal,
			});
			return status;
		},
	};

	llQa.setPhase(LOCAL_HDR_PHASE_ID, {
		registered: true,
		flag: LOCAL_HDR_FLAG_ID,
		patch: LOCAL_HDR_PATCH_ID,
		anchor: RE_DIRECT_CALL_ANCHOR,
		chunks: [LOCAL_HDR_PARS_CHUNK, LIGHTS_FRAGMENT_CHUNK],
		uniforms: phase.uniformNames,
		textureUnits: 0,
	});

	return phase;
}
