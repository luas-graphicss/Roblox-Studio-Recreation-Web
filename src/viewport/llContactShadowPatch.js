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
	CONTACT_SHADOW_CHUNK_NAME,
	CONTACT_SHADOW_DECLARATIONS_CHUNK_NAME,
	CONTACT_SHADOW_DEPTH_UNIFORM,
	CONTACT_SHADOW_FLAG_ID,
	CONTACT_SHADOW_LIGHT_SLOTS,
	CONTACT_SHADOW_MARCH_UNIFORM,
	CONTACT_SHADOW_PARAMS_UNIFORM,
	CONTACT_SHADOW_PATCH_ID,
	CONTACT_SHADOW_PATCH_ORDER,
	CONTACT_SHADOW_PHASE_ID,
	CONTACT_SHADOW_POINT_LENGTH_UNIFORM,
	CONTACT_SHADOW_PROJECTION_UNIFORM,
	CONTACT_SHADOW_SPOT_LENGTH_UNIFORM,
	CONTACT_SHADOW_TEXTURE_UNITS,
} from "../lighting/llContactShadowContract.js";
import {
	CONTACT_SHADOW_CALL_MARKER,
	CONTACT_SHADOW_DECLARATIONS_MARKER,
	RE_DIRECT_CALL_SIGNATURE,
	buildContactShadowDeclarationsGlsl,
	injectContactShadowIntoLocalLightLoops,
} from "../lighting/llContactShadowGlsl.js";


export const ENGINE_DEPTH_DECODE = (depthFetch) => "unpackRGBAToDepth( " + depthFetch + " )";


export const CONTACT_SHADOW_UNIFORMS = Object.freeze([
	CONTACT_SHADOW_DEPTH_UNIFORM,
	CONTACT_SHADOW_PARAMS_UNIFORM,
	CONTACT_SHADOW_PROJECTION_UNIFORM,
	CONTACT_SHADOW_MARCH_UNIFORM,
	CONTACT_SHADOW_POINT_LENGTH_UNIFORM,
	CONTACT_SHADOW_SPOT_LENGTH_UNIFORM,
]);

registerLocalLightFlag({
	id: CONTACT_SHADOW_FLAG_ID,
	phase: CONTACT_SHADOW_PHASE_ID,
	description:
		"short depth march per local light that closes the contact gap the shadow map cannot resolve; weak tier keeps the engine's global contact fuse",
	defaultsByTier: { fraco: false, medio: true, forte: true },
});


export function registerLocalLightContactShadowPhase(options) {
	const settings = options && typeof options === "object" ? options : {};
	const registry = settings.registry;
	if (!registry) throw new Error("registerLocalLightContactShadowPhase requires a registry");
	const logger = settings.logger && typeof settings.logger.warn === "function" ? settings.logger : null;


	const paramsSlot = registry.registerUniform(CONTACT_SHADOW_PARAMS_UNIFORM, new Float32Array(4));
	const projectionSlot = registry.registerUniform(CONTACT_SHADOW_PROJECTION_UNIFORM, new Float32Array(4));
	const marchSlot = registry.registerUniform(CONTACT_SHADOW_MARCH_UNIFORM, new Float32Array(2));
	const pointLengthSlot = registry.registerUniform(
		CONTACT_SHADOW_POINT_LENGTH_UNIFORM,
		new Float32Array(CONTACT_SHADOW_LIGHT_SLOTS),
	);
	const spotLengthSlot = registry.registerUniform(
		CONTACT_SHADOW_SPOT_LENGTH_UNIFORM,
		new Float32Array(CONTACT_SHADOW_LIGHT_SLOTS),
	);
	const depthSlot = registry.registerUniform(CONTACT_SHADOW_DEPTH_UNIFORM, null);

	let lastRefusal = null;
	let appliedThisSession = false;
	let patchedKinds = [];

	registry.registerShaderPatch({
		id: CONTACT_SHADOW_PATCH_ID,
		phase: CONTACT_SHADOW_PHASE_ID,
		anchor: RE_DIRECT_CALL_SIGNATURE,
		order: CONTACT_SHADOW_PATCH_ORDER,
		isActive: (context) => isPhaseActive(context),
		apply: (context) => {


			if (!context.contains("fragment", RE_DIRECT_CALL_SIGNATURE)) {
				lastRefusal = "RE_Direct signature absent from this fragment";
				return false;
			}


			if (context.contains("fragment", CONTACT_SHADOW_CALL_MARKER)) {
				lastRefusal = null;
				return false;
			}



			let declared = context.contains("fragment", CONTACT_SHADOW_DECLARATIONS_MARKER);
			if (!declared) {
				const declarations = buildContactShadowDeclarationsGlsl({ decodeDepth: ENGINE_DEPTH_DECODE });
				declared = context.patchChunk(
					"fragment",
					CONTACT_SHADOW_DECLARATIONS_CHUNK_NAME,
					(chunkSource) => chunkSource + "\n" + declarations + "\n",
				);


				if (!declared) {
					declared = context.insertBeforeMarker("fragment", context.declarationMarker, declarations);
				}
			}
			if (!declared) {
				lastRefusal = "could not declare the contact shadow uniforms in global scope";
				if (logger) {
					logger.warn(
						"[Luzes locais] LL-F15: declaracoes nao entraram em escopo global - caminho legado mantido.",
					);
				}
				llQa.addError("LL-F15: declaracoes fora de escopo global", { phase: CONTACT_SHADOW_PHASE_ID });
				return false;
			}


			let injection = null;
			const injected = context.patchChunk("fragment", CONTACT_SHADOW_CHUNK_NAME, (chunkSource) => {
				injection = injectContactShadowIntoLocalLightLoops(chunkSource);
				return injection.source;
			});
			if (!injected) {
				lastRefusal = injection ? injection.reason : "light loop injection refused";
				if (logger) {
					logger.warn(
						"[Luzes locais] LL-F15: marcha nao foi injetada (" + String(lastRefusal) + ").",
					);
				}
				return false;
			}
			patchedKinds = injection && injection.patchedKinds ? injection.patchedKinds.slice() : [];
			lastRefusal = null;
			appliedThisSession = true;
			return true;
		},
	});

	llQa.setTextureUnits(CONTACT_SHADOW_PHASE_ID, CONTACT_SHADOW_TEXTURE_UNITS);

	function isPhaseActive(context) {
		const frame = context && typeof context === "object" ? context : {};
		if (!isLocalLightTechnology(frame.technology)) return false;
		if (isLocalLightBaselineFrozen(frame.tier)) return false;
		return isLocalLightFlagActive(CONTACT_SHADOW_FLAG_ID, frame.tier);
	}


	function writeMarchParams(input) {
		const plan = input && typeof input === "object" ? input : {};
		const params = paramsSlot.value;
		params[0] = Number(plan.intensity) || 0;
		params[1] = Number(plan.stepCount) || 0;
		params[2] = Number(plan.thicknessStuds) || 0;
		params[3] = Number(plan.temporalPhase) || 0;
		const march = marchSlot.value;
		march[0] = Number(plan.depthBiasStuds) || 0;
		march[1] = Number(plan.normalOffsetStuds) || 0;
	}


	function writeProjection(camera) {
		const projection = projectionSlot.value;
		if (!camera || !camera.projectionMatrix) {
			projection[0] = 1;
			projection[1] = 1;
			projection[2] = 0.1;
			projection[3] = 1000;
			return;
		}
		const elements = camera.projectionMatrix.elements;
		projection[0] = elements[0] > 0 ? elements[0] : 1;
		projection[1] = elements[5] > 0 ? elements[5] : 1;
		projection[2] = Number(camera.near) || 0.1;
		projection[3] = Number(camera.far) || 1000;
	}


	function writeLightLengths(pointLengths, spotLengths) {
		const point = pointLengthSlot.value;
		const spot = spotLengthSlot.value;
		for (let slot = 0; slot < CONTACT_SHADOW_LIGHT_SLOTS; slot++) {
			point[slot] = Array.isArray(pointLengths) && pointLengths[slot] > 0 ? Number(pointLengths[slot]) : 0;
			spot[slot] = Array.isArray(spotLengths) && spotLengths[slot] > 0 ? Number(spotLengths[slot]) : 0;
		}
	}

	function setDepthTexture(texture) {
		depthSlot.value = texture || null;
		return depthSlot.value !== null;
	}


	function clearMarch() {
		const params = paramsSlot.value;
		params[0] = 0;
		params[1] = 0;
		params[2] = 0;
		params[3] = 0;
		const march = marchSlot.value;
		march[0] = 0;
		march[1] = 0;
		writeLightLengths(null, null);
		depthSlot.value = null;
	}

	return {
		phaseId: CONTACT_SHADOW_PHASE_ID,
		flagId: CONTACT_SHADOW_FLAG_ID,
		patchId: CONTACT_SHADOW_PATCH_ID,
		textureUnits: CONTACT_SHADOW_TEXTURE_UNITS,

		setFlag(value) {
			return setLocalLightFlagOverride(CONTACT_SHADOW_FLAG_ID, value);
		},

		isActive(context) {
			return isPhaseActive(context);
		},

		writeMarchParams,
		writeProjection,
		writeLightLengths,
		setDepthTexture,
		clearMarch,

		reset() {
			clearMarch();
		},

		status(context) {
			const frame = context && typeof context === "object" ? context : {};
			const flagDecision = resolveLocalLightFlag(CONTACT_SHADOW_FLAG_ID, { tier: frame.tier });
			const baselineFrozen = isLocalLightBaselineFrozen(frame.tier);
			const technologyAllowed = isLocalLightTechnology(frame.technology);
			const status = {
				phase: CONTACT_SHADOW_PHASE_ID,
				flag: CONTACT_SHADOW_FLAG_ID,
				patch: CONTACT_SHADOW_PATCH_ID,
				tier: frame.tier || null,
				technologyAllowed,
				flagOn: flagDecision.active,
				flagToken: flagDecision.token,
				flagSource: flagDecision.source,
				baselineFrozen,
				active: isPhaseActive(frame),
				appliedThisSession,
				patchedKinds: patchedKinds.slice(),
				refusal: lastRefusal,
				intensity: paramsSlot.value[0],
				stepCount: paramsSlot.value[1],
				hasDepthTexture: depthSlot.value !== null,
				lightSlots: CONTACT_SHADOW_LIGHT_SLOTS,
				textureUnits: CONTACT_SHADOW_TEXTURE_UNITS,
				pending: !technologyAllowed
					? "Technology outside ShadowMap / Future keeps the engine's global contact fuse"
					: baselineFrozen
						? "LlBaseline is freezing the legacy path: release it for the phase to enter"
						: "Declared residuals: (a) the march params (thickness, depth bias, normal offset) are GLOBAL while the LENGTH is per light, because that is the shape of the pure GLSL - they are resolved from the LONGEST authored march of the frame, which is the conservative choice; (b) a scene with more lights of one kind than the " + CONTACT_SHADOW_LIGHT_SLOTS + " uniform slots loses the march on that kind, and the GLSL vetoes itself through the preprocessor - the per light channel without a ceiling is the LL-F20 cluster's job; (c) screen space, so an occluder off screen casts no contact - the same declared residual the engine's legacy fuse already carries.",
			};
			llQa.setPhase(CONTACT_SHADOW_PHASE_ID, {
				flagOn: flagDecision.active,
				technologyAllowed,
				baselineFrozen,
				appliedThisSession,
				refusal: lastRefusal,
				intensity: status.intensity,
				hasDepthTexture: status.hasDepthTexture,
			});
			return status;
		},
	};
}
