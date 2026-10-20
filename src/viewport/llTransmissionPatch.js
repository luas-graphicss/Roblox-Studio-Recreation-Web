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
	ATLAS_TINT_FUNCTION,
	COLORED_SHADOW_FLAG_ID,
	SUBSURFACE_MATERIAL_UNIFORM,
	TRANSMISSION_DECLARATION_CHUNK,
	TRANSMISSION_LIGHT_LOOP_CHUNK,
	TRANSMISSION_MIX_UNIFORM,
	TRANSMISSION_PATCH_ID,
	TRANSMISSION_PATCH_ORDER,
	TRANSMISSION_PHASE_ID,
	TRANSMISSION_TEXTURE_UNITS,
	TRANSMISSION_TINT_FUNCTION,
} from "../lighting/llTransmissionContract.js";
import {
	RE_DIRECT_CALL,
	buildTransmissionDeclarations,
	injectTransmissionIntoLocalLightLoops,
} from "../lighting/llTransmissionGlsl.js";
import {
	resolveSubsurfaceMaterial,
	subsurfaceUniformVector,
} from "../lighting/llLocalSubsurfaceCore.js";

const VEC4_LENGTH = 4;


const MIX_TINT_CHANNEL = 0;
const MIX_SUBSURFACE_CHANNEL = 1;

export const TRANSMISSION_REFUSALS = Object.freeze({
	noAtlasTint: "atlas-tint-function-missing",
	noReDirect: "re-direct-call-missing",
	declarationsFailed: "declarations-chunk-missing",
});


registerLocalLightFlag({
	id: COLORED_SHADOW_FLAG_ID,
	phase: TRANSMISSION_PHASE_ID,
	description:
		"coloured transmission of LOCAL lights: stained glass tints the light it lets through instead of casting a grey shadow, plus local subsurface for curtain/leaf/skin",
	defaultsByTier: { fraco: false, medio: true, forte: true },
});


export function registerLocalLightTransmissionPhase(options) {
	const settings = options && typeof options === "object" ? options : {};
	const registry = settings.registry;
	if (!registry || typeof registry.registerShaderPatch !== "function") {
		throw new Error("LL-F16: a local-light patch registry is required");
	}
	const logger = settings.logger && typeof settings.logger.warn === "function" ? settings.logger : null;


	const mixVector = new Float32Array(VEC4_LENGTH);
	const subsurfaceVector = new Float32Array(VEC4_LENGTH);

	registry.registerUniform(TRANSMISSION_MIX_UNIFORM, mixVector);
	registry.registerUniform(SUBSURFACE_MATERIAL_UNIFORM, subsurfaceVector);


	llQa.setTextureUnits(TRANSMISSION_PHASE_ID, TRANSMISSION_TEXTURE_UNITS);

	let appliedShaderCount = 0;
	let lastPatchedKinds = [];
	let lastRefusal = "";
	let lastSubsurface = null;

	function recordRefusal(reason) {
		lastRefusal = reason;
		llQa.addError("LL-F16: " + reason, { phase: TRANSMISSION_PHASE_ID, patch: TRANSMISSION_PATCH_ID });
		if (logger) logger.warn("[Luzes locais] LL-F16 recusou: " + reason);
	}

	function isPhaseActive(context) {
		const frame = context && typeof context === "object" ? context : {};
		if (!isLocalLightTechnology(frame.technology)) return false;
		if (isLocalLightBaselineFrozen(frame.tier)) return false;
		return isLocalLightFlagActive(COLORED_SHADOW_FLAG_ID, frame.tier);
	}


	function declareTransmissionAfterAtlas(context) {
		if (context.contains("fragment", TRANSMISSION_TINT_FUNCTION)) return true;
		const declared = context.patchChunk("fragment", TRANSMISSION_DECLARATION_CHUNK, (chunkSource) => {
			if (typeof chunkSource !== "string") return null;
			if (chunkSource.indexOf(TRANSMISSION_TINT_FUNCTION) >= 0) return null;
			return chunkSource + "\n" + buildTransmissionDeclarations();
		});
		if (!declared) {
			recordRefusal(TRANSMISSION_REFUSALS.declarationsFailed + " (" + TRANSMISSION_DECLARATION_CHUNK + ")");
			return false;
		}
		return true;
	}

	registry.registerShaderPatch({
		id: TRANSMISSION_PATCH_ID,
		phase: TRANSMISSION_PHASE_ID,
		anchor: RE_DIRECT_CALL,
		order: TRANSMISSION_PATCH_ORDER,
		isActive: (context) => isPhaseActive(context),
		apply: (context) => {
			const anchor = context.checkAnchor(TRANSMISSION_LIGHT_LOOP_CHUNK, RE_DIRECT_CALL);
			if (!anchor.found) {

				return false;
			}


			if (!context.contains("fragment", ATLAS_TINT_FUNCTION)) {
				recordRefusal(TRANSMISSION_REFUSALS.noAtlasTint);
				return false;
			}
			if (!declareTransmissionAfterAtlas(context)) return false;
			let verdict = null;
			const patched = context.patchChunk("fragment", TRANSMISSION_LIGHT_LOOP_CHUNK, (chunkSource) => {
				verdict = injectTransmissionIntoLocalLightLoops(chunkSource);
				return verdict.replaced ? verdict.source : null;
			});
			if (!patched || !verdict || !verdict.replaced) {
				recordRefusal("did not inject the local light loops: " + (verdict ? verdict.reason : "chunk missing"));
				return false;
			}
			lastPatchedKinds = verdict.patchedKinds.slice();
			appliedShaderCount++;
			lastRefusal = "";
			return true;
		},
	});

	const phase = {
		phaseId: TRANSMISSION_PHASE_ID,
		flagId: COLORED_SHADOW_FLAG_ID,
		patchId: TRANSMISSION_PATCH_ID,
		anchor: RE_DIRECT_CALL,
		textureUnits: TRANSMISSION_TEXTURE_UNITS,
		uniformNames: Object.freeze([TRANSMISSION_MIX_UNIFORM, SUBSURFACE_MATERIAL_UNIFORM]),

		setFlag(value) {
			return setLocalLightFlagOverride(COLORED_SHADOW_FLAG_ID, value);
		},

		isActive(context) {
			return isPhaseActive(context);
		},


		writeMix(input) {
			const frame = input && typeof input === "object" ? input : {};
			const tintMix = Number(frame.tintMix);
			const subsurfaceMix = Number(frame.subsurfaceMix);
			mixVector[MIX_TINT_CHANNEL] = Number.isFinite(tintMix) ? Math.min(Math.max(tintMix, 0), 1) : 0;
			mixVector[MIX_SUBSURFACE_CHANNEL] = Number.isFinite(subsurfaceMix)
				? Math.min(Math.max(subsurfaceMix, 0), 1)
				: 0;
			registry.setUniformValue(TRANSMISSION_MIX_UNIFORM, mixVector);
			return mixVector;
		},


		writeSubsurfaceMaterial(input) {
			const resolved = resolveSubsurfaceMaterial(input || {});
			const vector = subsurfaceUniformVector(resolved);
			for (let index = 0; index < VEC4_LENGTH; index++) subsurfaceVector[index] = vector[index];
			registry.setUniformValue(SUBSURFACE_MATERIAL_UNIFORM, subsurfaceVector);
			lastSubsurface = resolved;
			return resolved;
		},


		clearMix() {
			mixVector[MIX_TINT_CHANNEL] = 0;
			mixVector[MIX_SUBSURFACE_CHANNEL] = 0;
			registry.setUniformValue(TRANSMISSION_MIX_UNIFORM, mixVector);
			return mixVector;
		},

		appliedCount() {
			return appliedShaderCount;
		},

		reset() {
			phase.clearMix();
			lastSubsurface = null;
			return true;
		},

		status(context) {
			const frame = context && typeof context === "object" ? context : {};
			const flagDecision = resolveLocalLightFlag(COLORED_SHADOW_FLAG_ID, { tier: frame.tier });
			const baselineFrozen = isLocalLightBaselineFrozen(frame.tier);
			const technologyAllowed = isLocalLightTechnology(frame.technology);
			const anchor = registry.checkAnchor(TRANSMISSION_LIGHT_LOOP_CHUNK, RE_DIRECT_CALL);
			const status = {
				phase: TRANSMISSION_PHASE_ID,
				flag: COLORED_SHADOW_FLAG_ID,
				patch: TRANSMISSION_PATCH_ID,
				tier: frame.tier || null,
				technologyAllowed,
				flagOn: flagDecision.active,
				flagToken: flagDecision.token,
				flagSource: flagDecision.source,
				baselineFrozen,
				active: isPhaseActive(frame),
				chunks: [TRANSMISSION_DECLARATION_CHUNK, TRANSMISSION_LIGHT_LOOP_CHUNK],
				anchor: anchor.found ? "ok" : anchor.reason,
				patchedShaders: appliedShaderCount,
				patchedKinds: lastPatchedKinds.slice(),
				tintMix: mixVector[MIX_TINT_CHANNEL],
				subsurfaceMix: mixVector[MIX_SUBSURFACE_CHANNEL],
				subsurface: lastSubsurface,
				textureUnits: TRANSMISSION_TEXTURE_UNITS,
				refusal: lastRefusal,
				pending: !technologyAllowed
					? "Technology outside ShadowMap / Future keeps the legacy path byte for byte"
					: baselineFrozen
						? "LlBaseline is freezing the legacy path: release it for the phase to enter"
						: "Declared residuals: (a) the phase needs the LL-F10 GATE open, not only its own flag - with the atlas closed rswSaTint is absent and the patch refuses with atlas-tint-function-missing; (b) only 8 transmitter boxes fit the frame, the 9th is refused with over-budget; (c) a transmitter is an axis-aligned world box, so a rotated stained-glass pane tints its bounding box and not its exact outline; (d) subsurface thickness is authored per material, the shadow-depth route (thicknessFromShadowDepth) is not wired yet.",
			};
			llQa.setPhase(TRANSMISSION_PHASE_ID, {
				flagOn: flagDecision.active,
				technologyAllowed,
				baselineFrozen,
				patchedShaders: appliedShaderCount,
				patchedKinds: lastPatchedKinds.slice(),
				anchorOk: anchor.found,
				tintMix: mixVector[MIX_TINT_CHANNEL],
				subsurfaceMix: mixVector[MIX_SUBSURFACE_CHANNEL],
				refusal: lastRefusal,
			});
			return status;
		},
	};

	llQa.setPhase(TRANSMISSION_PHASE_ID, {
		registered: true,
		flag: COLORED_SHADOW_FLAG_ID,
		patch: TRANSMISSION_PATCH_ID,
		anchor: RE_DIRECT_CALL,
		chunks: [TRANSMISSION_DECLARATION_CHUNK, TRANSMISSION_LIGHT_LOOP_CHUNK],
		uniforms: phase.uniformNames,
		textureUnits: TRANSMISSION_TEXTURE_UNITS,
	});

	return phase;
}
