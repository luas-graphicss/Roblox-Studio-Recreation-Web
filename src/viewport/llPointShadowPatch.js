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
	POINT_ATLAS_FIRST_META_ROW_UNIFORM,
	POINT_ATLAS_LIGHT_COUNT_UNIFORM,
	POINT_ATLAS_ON_UNIFORM,
	POINT_LEGACY_SHADOW_COUNT_UNIFORM,
	POINT_SHADOW_FLAG_ID,
	POINT_SHADOW_PATCH_ID,
	POINT_SHADOW_PHASE_ID,
} from "../lighting/llPointShadowContract.js";
import {
	POINT_BLOCK_OPEN,
	POINT_DISPATCHER_MARKER,
	buildPointDispatcherGlsl,
	rewritePointLightBlock,
} from "../lighting/llPointShadowGlsl.js";
import { ATLAS_META_ROW_BASE } from "../lighting/llShadowGateCore.js";


export const LIGHTS_FRAGMENT_CHUNK = "lights_fragment_begin";


export const LIGHTS_PARS_CHUNK = "lights_pars_begin";


export const POINT_SHADOW_PATCH_ORDER = 60;


export const ATLAS_SAMPLER_SYMBOL = "rswSaVis";


registerLocalLightFlag({
	id: POINT_SHADOW_FLAG_ID,
	phase: POINT_SHADOW_PHASE_ID,
	description:
		"point lights read their shadow from six atlas cube pages instead of owning a standalone three.js cube render target",
	defaultsByTier: { fraco: false, medio: true, forte: true },
});

let dispatcherGlslCache = null;
function buildDispatchersOnce() {
	if (dispatcherGlslCache === null) dispatcherGlslCache = buildPointDispatcherGlsl();
	return dispatcherGlslCache;
}


export function registerLocalLightPointShadowPhase(options) {
	const settings = options && typeof options === "object" ? options : {};
	const registry = settings.registry;
	if (!registry || typeof registry.registerShaderPatch !== "function") {
		throw new Error("LL-F11: a local-light patch registry is required");
	}
	const logger = settings.logger && typeof settings.logger.warn === "function" ? settings.logger : null;

	registry.registerUniform(POINT_ATLAS_ON_UNIFORM, 0);
	registry.registerUniform(POINT_ATLAS_FIRST_META_ROW_UNIFORM, ATLAS_META_ROW_BASE.pointCubeFace);
	registry.registerUniform(POINT_ATLAS_LIGHT_COUNT_UNIFORM, 0);
	registry.registerUniform(POINT_LEGACY_SHADOW_COUNT_UNIFORM, 0);


	llQa.setTextureUnits(POINT_SHADOW_PHASE_ID, 0);

	let appliedShaderCount = 0;
	let lastRewriteCount = 0;
	let lastLegacyShadowCall = "";
	let lastRefusal = "";
	let gateWasOpen = false;

	function recordRefusal(reason) {
		if (lastRefusal === reason) return;
		lastRefusal = reason;
		llQa.addError("LL-F11: " + reason, { phase: POINT_SHADOW_PHASE_ID, patch: POINT_SHADOW_PATCH_ID });
		if (logger) logger.warn("[Luzes locais] LL-F11 recusou: " + reason);
	}

	function isPhaseActive(context) {
		const frame = context && typeof context === "object" ? context : {};
		if (!isLocalLightTechnology(frame.technology)) return false;
		if (isLocalLightBaselineFrozen(frame.tier)) return false;
		return isLocalLightFlagActive(POINT_SHADOW_FLAG_ID, frame.tier);
	}








	function declareDispatchersAtGlobalScope(context) {
		if (context.contains("fragment", POINT_DISPATCHER_MARKER)) return true;
		const declared = context.patchChunk("fragment", LIGHTS_PARS_CHUNK, (chunkSource) => {
			if (typeof chunkSource !== "string") return null;
			if (chunkSource.indexOf(POINT_DISPATCHER_MARKER) >= 0) return null;
			return chunkSource + "\n" + buildDispatchersOnce();
		});
		if (!declared) {
			recordRefusal("could not declare the point dispatchers at global scope in " + LIGHTS_PARS_CHUNK);
			return false;
		}
		return true;
	}

	registry.registerShaderPatch({
		id: POINT_SHADOW_PATCH_ID,
		phase: POINT_SHADOW_PHASE_ID,
		anchor: POINT_BLOCK_OPEN,
		order: POINT_SHADOW_PATCH_ORDER,
		isActive: (context) => isPhaseActive(context),
		apply: (context) => {
			const anchor = context.checkAnchor(LIGHTS_FRAGMENT_CHUNK, POINT_BLOCK_OPEN);

			if (!anchor.found) return false;


			if (!context.contains("fragment", ATLAS_SAMPLER_SYMBOL)) {
				recordRefusal(
					"LL-F10 nao declarou " + ATLAS_SAMPLER_SYMBOL + " neste programa: cubemap avulso mantido",
				);
				return false;
			}
			if (!declareDispatchersAtGlobalScope(context)) return false;
			let verdict = null;
			const patched = context.patchChunk("fragment", LIGHTS_FRAGMENT_CHUNK, (chunkSource) => {
				verdict = rewritePointLightBlock(chunkSource);
				return verdict.ok ? verdict.source : null;
			});
			if (!patched || !verdict || !verdict.ok) {
				recordRefusal("nao reescreveu o bloco point: " + (verdict ? verdict.reason : "chunk ausente"));
				return false;
			}
			lastRewriteCount = verdict.rewrites;
			lastLegacyShadowCall = verdict.legacyShadowCall || "";
			appliedShaderCount++;
			lastRefusal = "";
			return true;
		},
	});


	function closeGate() {
		registry.setUniformValue(POINT_ATLAS_ON_UNIFORM, 0);
		registry.setUniformValue(POINT_ATLAS_LIGHT_COUNT_UNIFORM, 0);
	}

	const phase = {
		phaseId: POINT_SHADOW_PHASE_ID,
		flagId: POINT_SHADOW_FLAG_ID,
		patchId: POINT_SHADOW_PATCH_ID,
		anchor: POINT_BLOCK_OPEN,
		uniformNames: Object.freeze([
			POINT_ATLAS_ON_UNIFORM,
			POINT_ATLAS_FIRST_META_ROW_UNIFORM,
			POINT_ATLAS_LIGHT_COUNT_UNIFORM,
			POINT_LEGACY_SHADOW_COUNT_UNIFORM,
		]),
		textureUnits: 0,

		setFlag(value) {
			return setLocalLightFlagOverride(POINT_SHADOW_FLAG_ID, value);
		},

		isActive(context) {
			return isPhaseActive(context);
		},


		syncPointCubeFrame(input) {
			const frame = input && typeof input === "object" ? input : {};
			const open =
				isPhaseActive(frame) &&
				frame.atlasReady === true &&
				Number(frame.pageCount) > 0 &&
				Number(frame.atlasLightCount) > 0;
			if (!open) {
				if (gateWasOpen) {
					gateWasOpen = false;
					closeGate();
				}
				return false;
			}
			gateWasOpen = true;
			registry.setUniformValue(POINT_ATLAS_FIRST_META_ROW_UNIFORM, ATLAS_META_ROW_BASE.pointCubeFace);
			registry.setUniformValue(POINT_ATLAS_LIGHT_COUNT_UNIFORM, Math.max(Number(frame.atlasLightCount) || 0, 0));
			registry.setUniformValue(
				POINT_LEGACY_SHADOW_COUNT_UNIFORM,
				Math.max(Number(frame.legacyShadowCount) || 0, 0),
			);
			registry.setUniformValue(POINT_ATLAS_ON_UNIFORM, 1);
			return true;
		},

		appliedCount() {
			return appliedShaderCount;
		},

		resetCounters() {
			appliedShaderCount = 0;
			lastRewriteCount = 0;
			return appliedShaderCount;
		},

		status(context) {
			const frame = context && typeof context === "object" ? context : {};
			const flagDecision = resolveLocalLightFlag(POINT_SHADOW_FLAG_ID, { tier: frame.tier });
			const baselineFrozen = isLocalLightBaselineFrozen(frame.tier);
			const technologyAllowed = isLocalLightTechnology(frame.technology);
			const anchor = registry.checkAnchor(LIGHTS_FRAGMENT_CHUNK, POINT_BLOCK_OPEN);
			const status = {
				phase: POINT_SHADOW_PHASE_ID,
				flag: POINT_SHADOW_FLAG_ID,
				tier: frame.tier || null,
				technologyAllowed,
				flagOn: flagDecision.active,
				flagToken: flagDecision.token,
				flagSource: flagDecision.source,
				baselineFrozen,
				active: isPhaseActive(frame),
				gateOpen: gateWasOpen,
				chunks: [LIGHTS_PARS_CHUNK, LIGHTS_FRAGMENT_CHUNK],
				anchor: anchor.found ? "ok" : anchor.reason,
				patchedShaders: appliedShaderCount,
				callSitesRewritten: lastRewriteCount,
				legacyShadowCall: lastLegacyShadowCall,
				textureUnits: 0,
				refusal: lastRefusal,
				pending: !technologyAllowed
					? "Technology outside ShadowMap / Future keeps the legacy path byte for byte"
					: baselineFrozen
						? "LlBaseline is freezing the legacy path: release it for the phase to enter"
						: "Declared residuals: (a) six rows per light over the 64 reserved by LL-F10 is a HARD ceiling of 10 atlased point lights (POINT_CUBE_MAX_LIGHTS, derived from the meta texture, not hardcoded), so the 96-lamp budget scene still keeps most lights on the legacy cubemap; (b) every placed face is redrawn every frame because the engine's atlas clears its whole target each frame - the per-light redraw rationing of llPointAtlasPlanCore only pays off once the atlas keeps pages between frames, which is LL-F13; (c) the ANGULAR PCSS penumbra is measured by llPointPenumbraCore but the kernel itself is still the 4-tap PCF of rswSaVis, and widening it past SA_PAD texels reads the neighbour page - that negotiation belongs to LL-F14.",
			};
			llQa.setPhase(POINT_SHADOW_PHASE_ID, {
				flagOn: flagDecision.active,
				technologyAllowed,
				baselineFrozen,
				gateOpen: gateWasOpen,
				patchedShaders: appliedShaderCount,
				anchorOk: anchor.found,
				refusal: lastRefusal,
			});
			return status;
		},
	};

	llQa.setPhase(POINT_SHADOW_PHASE_ID, {
		registered: true,
		flag: POINT_SHADOW_FLAG_ID,
		patch: POINT_SHADOW_PATCH_ID,
		anchor: POINT_BLOCK_OPEN,
		chunks: [LIGHTS_PARS_CHUNK, LIGHTS_FRAGMENT_CHUNK],
		uniforms: phase.uniformNames,
		textureUnits: 0,
	});

	return phase;
}
