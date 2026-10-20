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
	ATLAS_GATE_FLAG_ID,
	ATLAS_PHASE_ID,
	ATLAS_TEXTURE_UNITS,
	resolveAtlasGate,
} from "../lighting/llShadowGateCore.js";
import {
	ATLAS_ON_UNIFORM,
	ATLAS_SPOT_SHADOW_FUNCTION,
	LEGACY_SPOT_SHADOW_COUNT_UNIFORM,
	SPOT_BLOCK_OPEN,
	buildAtlasFragmentDeclarations,
	rewriteSpotLightBlock,
} from "../lighting/llShadowGateShader.js";
import { SA_DEFAULT_BIAS, SA_DEFAULT_SAMPLES } from "../lighting/shadowAtlasCore.js";

export const ATLAS_GATE_PATCH_ID = "ll-f10-shadow-atlas-gate";


export const LIGHTS_FRAGMENT_CHUNK = "lights_fragment_begin";


export const LIGHTS_PARS_CHUNK = "lights_pars_begin";


export const ATLAS_GATE_PATCH_ORDER = 50;


export const ATLAS_UNIFORMS = Object.freeze({
	atlasTexture: "uAtlasTex",
	metaTexture: "uAtlasMeta",
	enabled: ATLAS_ON_UNIFORM,
	bias: "uAtlasBias",
	texel: "uAtlasTexel",
	samplesK: "uSamplesK",
	topCount: "uTopCount",
	cameraWorld: "uCamWorld",
	transmitterCount: "uTransCount",
	transmitterMin: "uTransMin",
	transmitterMax: "uTransMax",
	transmitterTint: "uTransTint",
	legacySpotShadowCount: LEGACY_SPOT_SHADOW_COUNT_UNIFORM,
});

const TRANSMITTER_SLOTS = 8;
const VEC4_LENGTH = 4;
const MATRIX4_LENGTH = 16;

const IDENTITY_MATRIX4 = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);


registerLocalLightFlag({
	id: ATLAS_GATE_FLAG_ID,
	phase: ATLAS_PHASE_ID,
	description:
		"shadow atlas on the DETERMINISTIC path: local spots read their atlas page instead of depending on the standalone shadow-map budget",
	defaultsByTier: { fraco: false, medio: true, forte: true },
});

let declarationsGlslCache = null;
function buildDeclarationsOnce() {
	if (declarationsGlslCache === null) declarationsGlslCache = buildAtlasFragmentDeclarations();
	return declarationsGlslCache;
}


export function registerLocalLightShadowAtlasPhase(options) {
	const settings = options && typeof options === "object" ? options : {};
	const registry = settings.registry;
	if (!registry || typeof registry.registerShaderPatch !== "function") {
		throw new Error("LL-F10: a local-light patch registry is required");
	}
	const logger = settings.logger && typeof settings.logger.warn === "function" ? settings.logger : null;


	const cameraWorldMatrix = new Float32Array(IDENTITY_MATRIX4);

	registry.registerUniform(ATLAS_UNIFORMS.atlasTexture, null);
	registry.registerUniform(ATLAS_UNIFORMS.metaTexture, null);
	registry.registerUniform(ATLAS_UNIFORMS.enabled, 0);
	registry.registerUniform(ATLAS_UNIFORMS.bias, SA_DEFAULT_BIAS);
	registry.registerUniform(ATLAS_UNIFORMS.texel, 0);
	registry.registerUniform(ATLAS_UNIFORMS.samplesK, SA_DEFAULT_SAMPLES);
	registry.registerUniform(ATLAS_UNIFORMS.topCount, 0);
	registry.registerUniform(ATLAS_UNIFORMS.cameraWorld, cameraWorldMatrix);
	registry.registerUniform(ATLAS_UNIFORMS.legacySpotShadowCount, 0);


	registry.registerUniform(ATLAS_UNIFORMS.transmitterCount, 0);
	registry.registerUniform(ATLAS_UNIFORMS.transmitterMin, new Float32Array(TRANSMITTER_SLOTS * VEC4_LENGTH));
	registry.registerUniform(ATLAS_UNIFORMS.transmitterMax, new Float32Array(TRANSMITTER_SLOTS * VEC4_LENGTH));
	registry.registerUniform(ATLAS_UNIFORMS.transmitterTint, new Float32Array(TRANSMITTER_SLOTS * VEC4_LENGTH));


	llQa.setTextureUnits(ATLAS_PHASE_ID, ATLAS_TEXTURE_UNITS);

	let appliedShaderCount = 0;
	let lastRewriteCount = 0;
	let lastRefusal = "";
	let gateWasOpen = false;
	let lastGate = null;

	function recordRefusal(reason) {
		lastRefusal = reason;
		llQa.addError("LL-F10: " + reason, { phase: ATLAS_PHASE_ID, patch: ATLAS_GATE_PATCH_ID });
		if (logger) logger.warn("[Luzes locais] LL-F10 recusou: " + reason);
	}

	function isPhaseActive(context) {
		const frame = context && typeof context === "object" ? context : {};
		if (!isLocalLightTechnology(frame.technology)) return false;
		if (isLocalLightBaselineFrozen(frame.tier)) return false;
		return isLocalLightFlagActive(ATLAS_GATE_FLAG_ID, frame.tier);
	}


	function declareAtlasAtGlobalScope(context) {
		if (context.contains("fragment", ATLAS_SPOT_SHADOW_FUNCTION)) return true;
		const declared = context.patchChunk("fragment", LIGHTS_PARS_CHUNK, (chunkSource) => {
			if (typeof chunkSource !== "string") return null;
			if (chunkSource.indexOf(ATLAS_SPOT_SHADOW_FUNCTION) >= 0) return null;
			return chunkSource + "\n" + buildDeclarationsOnce();
		});
		if (!declared) {
			recordRefusal("could not declare the atlas sampler at global scope in " + LIGHTS_PARS_CHUNK);
			return false;
		}
		return true;
	}

	registry.registerShaderPatch({
		id: ATLAS_GATE_PATCH_ID,
		phase: ATLAS_PHASE_ID,
		anchor: SPOT_BLOCK_OPEN,
		order: ATLAS_GATE_PATCH_ORDER,
		isActive: (context) => isPhaseActive(context),
		apply: (context) => {
			const anchor = context.checkAnchor(LIGHTS_FRAGMENT_CHUNK, SPOT_BLOCK_OPEN);
			if (!anchor.found) {

				return false;
			}
			if (!declareAtlasAtGlobalScope(context)) return false;
			let verdict = null;
			const patched = context.patchChunk("fragment", LIGHTS_FRAGMENT_CHUNK, (chunkSource) => {
				verdict = rewriteSpotLightBlock(chunkSource);
				return verdict.ok ? verdict.source : null;
			});
			if (!patched || !verdict || !verdict.ok) {
				recordRefusal(
					"did not rewrite the spot block: " + (verdict ? verdict.refusal : "chunk missing"),
				);
				return false;
			}
			lastRewriteCount = verdict.rewrites;
			appliedShaderCount++;
			lastRefusal = "";
			return true;
		},
	});


	function closeGate() {
		registry.setUniformValue(ATLAS_UNIFORMS.enabled, 0);
		registry.setUniformValue(ATLAS_UNIFORMS.atlasTexture, null);
		registry.setUniformValue(ATLAS_UNIFORMS.metaTexture, null);
		registry.setUniformValue(ATLAS_UNIFORMS.texel, 0);
		registry.setUniformValue(ATLAS_UNIFORMS.topCount, 0);
		registry.setUniformValue(ATLAS_UNIFORMS.legacySpotShadowCount, 0);
	}

	const phase = {
		phaseId: ATLAS_PHASE_ID,
		flagId: ATLAS_GATE_FLAG_ID,
		patchId: ATLAS_GATE_PATCH_ID,
		anchor: SPOT_BLOCK_OPEN,
		uniformNames: Object.freeze(Object.keys(ATLAS_UNIFORMS).map((key) => ATLAS_UNIFORMS[key])),
		textureUnits: ATLAS_TEXTURE_UNITS,

		setFlag(value) {
			return setLocalLightFlagOverride(ATLAS_GATE_FLAG_ID, value);
		},

		isActive(context) {
			return isPhaseActive(context);
		},


		wantsDeterministicAtlas(context) {
			const frame = context && typeof context === "object" ? context : {};
			const flagDecision = resolveLocalLightFlag(ATLAS_GATE_FLAG_ID, { tier: frame.tier });
			lastGate = resolveAtlasGate({
				flagOn: isPhaseActive(frame),
				flagMode: flagDecision.token,
				maxTextureSize: frame.maxTextureSize,
				allow8k: frame.allow8k === true,
			});
			return lastGate.on;
		},


		syncAtlasFrame(input) {
			const frame = input && typeof input === "object" ? input : {};
			const atlasSize = Number(frame.atlasSize) || 0;




			const open =
				isPhaseActive(frame) &&
				!!frame.atlasTexture &&
				!!frame.metaTexture &&
				atlasSize > 0 &&
				Number(frame.pagedSpots) > 0;
			if (!open) {
				if (gateWasOpen) {
					gateWasOpen = false;
					closeGate();
				}
				return false;
			}
			gateWasOpen = true;
			const camera = frame.camera;
			if (camera && camera.matrixWorld && camera.matrixWorld.elements) {
				const elements = camera.matrixWorld.elements;
				for (let index = 0; index < MATRIX4_LENGTH; index++) cameraWorldMatrix[index] = elements[index];
			}
			registry.setUniformValue(ATLAS_UNIFORMS.atlasTexture, frame.atlasTexture);
			registry.setUniformValue(ATLAS_UNIFORMS.metaTexture, frame.metaTexture);
			registry.setUniformValue(ATLAS_UNIFORMS.texel, 1 / atlasSize);
			registry.setUniformValue(ATLAS_UNIFORMS.bias, SA_DEFAULT_BIAS);
			registry.setUniformValue(ATLAS_UNIFORMS.samplesK, SA_DEFAULT_SAMPLES);
			registry.setUniformValue(ATLAS_UNIFORMS.topCount, Number(frame.pagedSpots) || 0);


			registry.setUniformValue(
				ATLAS_UNIFORMS.legacySpotShadowCount,
				Math.max(Number(frame.legacySpotShadowCount) || 0, 0),
			);
			registry.setUniformValue(ATLAS_UNIFORMS.enabled, 1);
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
			const flagDecision = resolveLocalLightFlag(ATLAS_GATE_FLAG_ID, { tier: frame.tier });
			const baselineFrozen = isLocalLightBaselineFrozen(frame.tier);
			const technologyAllowed = isLocalLightTechnology(frame.technology);
			const anchor = registry.checkAnchor(LIGHTS_FRAGMENT_CHUNK, SPOT_BLOCK_OPEN);
			const status = {
				phase: ATLAS_PHASE_ID,
				flag: ATLAS_GATE_FLAG_ID,
				tier: frame.tier || null,
				technologyAllowed,
				flagOn: flagDecision.active,
				flagToken: flagDecision.token,
				flagSource: flagDecision.source,
				baselineFrozen,
				active: isPhaseActive(frame),
				gateOpen: gateWasOpen,
				gate: lastGate,
				chunks: [LIGHTS_PARS_CHUNK, LIGHTS_FRAGMENT_CHUNK],
				anchor: anchor.found ? "ok" : anchor.reason,
				patchedShaders: appliedShaderCount,
				callSitesRewritten: lastRewriteCount,
				textureUnits: ATLAS_TEXTURE_UNITS,
				refusal: lastRefusal,
				pending: !technologyAllowed
					? "Technology outside ShadowMap / Future keeps the legacy path byte for byte"
					: baselineFrozen
						? "LlBaseline is freezing the legacy path: release it for the phase to enter"
						: "Declared residuals: (a) only CONE frustums get a page in this phase - point cube faces are LL-F11 and the meta rows 64..127 are already reserved for them; (b) a spot with three distance 0 (infinite range) has no finite far plane and is refused with range-too-small, because choosing that far plane from screen coverage is LL-F12; (c) the resolution ladder and its hysteresis stay owned by shadowAtlas.frame(), the single source of truth with the pixel actually drawn.",
			};
			llQa.setPhase(ATLAS_PHASE_ID, {
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

	llQa.setPhase(ATLAS_PHASE_ID, {
		registered: true,
		flag: ATLAS_GATE_FLAG_ID,
		patch: ATLAS_GATE_PATCH_ID,
		anchor: SPOT_BLOCK_OPEN,
		chunks: [LIGHTS_PARS_CHUNK, LIGHTS_FRAGMENT_CHUNK],
		uniforms: phase.uniformNames,
		textureUnits: ATLAS_TEXTURE_UNITS,
	});

	return phase;
}
