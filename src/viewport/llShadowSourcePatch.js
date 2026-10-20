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
	SHADOW_SOURCE_FLAG_ID,
	SHADOW_SOURCE_MIX_UNIFORM,
	SHADOW_SOURCE_PATCH_ID,
	SHADOW_SOURCE_PHASE_ID,
} from "../lighting/llShadowSourceContract.js";
import {
	SHADOW_SOURCE_CHUNK,
	SHADOW_SOURCE_TEXT_MARKER,
	STOCK_SHADOW_FUNCTION,
	rewriteShadowmapChunk,
} from "../lighting/llShadowSourceGlsl.js";
import { describeLocalShadowPenumbra } from "../lighting/llShadowSourceCore.js";
import { LEGACY_SHADOW_RADIUS, packLocalShadowMeta } from "../lighting/llShadowMetaPackCore.js";


export const SHADOW_SOURCE_PATCH_ORDER = 100;


export const SHADOW_SOURCE_PROPS = Object.freeze(["FilterSharpen", "ShadowSlopeBias"]);

registerLocalLightFlag({
	id: SHADOW_SOURCE_FLAG_ID,
	phase: SHADOW_SOURCE_PHASE_ID,
	description:
		"penumbra of a local shadow comes from the physical size of the source per light (Unreal style), with slope bias and FilterSharpen",
	defaultsByTier: { fraco: false, medio: true, forte: true },
});


export function registerLocalLightShadowSourcePhase(options) {
	const settings = options && typeof options === "object" ? options : {};
	const registry = settings.registry;
	if (!registry) throw new Error("registerLocalLightShadowSourcePhase requires a registry");
	const logger = settings.logger && typeof settings.logger.warn === "function" ? settings.logger : null;

	const mixSlot = registry.registerUniform(SHADOW_SOURCE_MIX_UNIFORM, 0);


	const touchedLights = new Set();
	const frameCounters = { spotsWithPenumbra: 0, spotsWithoutSource: 0 };
	let lastRefusal = null;
	let appliedThisSession = false;

	registry.registerShaderPatch({
		id: SHADOW_SOURCE_PATCH_ID,
		phase: SHADOW_SOURCE_PHASE_ID,
		anchor: STOCK_SHADOW_FUNCTION,
		order: SHADOW_SOURCE_PATCH_ORDER,
		isActive: (context) => isPhaseActive(context),
		apply: (context) => {


			let refusal = null;
			const changed = context.patchChunk("fragment", SHADOW_SOURCE_CHUNK, (chunkSource) => {
				const rewritten = rewriteShadowmapChunk(chunkSource);
				refusal = rewritten.refusal;
				return rewritten.source;
			});
			lastRefusal = changed ? null : refusal;
			if (changed) appliedThisSession = true;
			if (!changed && logger) {
				logger.warn(
					"[Luzes locais] LL-F14: getShadow nao foi reescrito (" + String(refusal) + ") - caminho legado mantido.",
				);
			}
			if (!changed) {
				llQa.addError("LL-F14: reescrita de getShadow recusada", {
					phase: SHADOW_SOURCE_PHASE_ID,
					refusal: String(refusal),
				});
			}
			return changed;
		},
	});

	llQa.setTextureUnits(SHADOW_SOURCE_PHASE_ID, 0);

	function isPhaseActive(context) {
		const frame = context && typeof context === "object" ? context : {};
		if (!isLocalLightTechnology(frame.technology)) return false;
		if (isLocalLightBaselineFrozen(frame.tier)) return false;
		return isLocalLightFlagActive(SHADOW_SOURCE_FLAG_ID, frame.tier);
	}


	function restoreTouchedLights() {
		if (touchedLights.size === 0) return 0;
		let restored = 0;
		touchedLights.forEach((threeLight) => {
			if (threeLight && threeLight.shadow) {
				threeLight.shadow.radius = LEGACY_SHADOW_RADIUS;
				restored++;
			}
		});
		touchedLights.clear();
		return restored;
	}

	function beginFrame() {
		frameCounters.spotsWithPenumbra = 0;
		frameCounters.spotsWithoutSource = 0;
	}


	function applySpotPenumbra(threeLight, authored) {
		if (!threeLight || threeLight.isSpotLight !== true || !threeLight.shadow) return LEGACY_SHADOW_RADIUS;
		const source = authored && typeof authored === "object" ? authored : {};
		const mapSize = threeLight.shadow.mapSize ? Number(threeLight.shadow.mapSize.x) || 0 : 0;
		const penumbra = describeLocalShadowPenumbra({
			light: { type: String(source.type || "SpotLight"), props: source.props || {} },
			mapSize,
			angleRad: Number(threeLight.angle) || 0,
			range: Number(threeLight.distance) || 0,
		});
		if (!penumbra.hasPenumbra) {


			frameCounters.spotsWithoutSource++;
			if (touchedLights.has(threeLight)) {
				threeLight.shadow.radius = LEGACY_SHADOW_RADIUS;
				touchedLights.delete(threeLight);
			}
			return LEGACY_SHADOW_RADIUS;
		}
		const packed = packLocalShadowMeta({
			sourceTexelScale: penumbra.sourceTexelScale,
			slopeBias: penumbra.slopeBias,
		});
		threeLight.shadow.radius = packed;
		touchedLights.add(threeLight);
		frameCounters.spotsWithPenumbra++;
		return packed;
	}


	function syncShadowSourceFrame(context) {
		const active = isPhaseActive(context);
		registry.setUniformValue(SHADOW_SOURCE_MIX_UNIFORM, active ? 1 : 0);
		if (!active) restoreTouchedLights();
		return active;
	}

	return {
		phaseId: SHADOW_SOURCE_PHASE_ID,
		flagId: SHADOW_SOURCE_FLAG_ID,
		patchId: SHADOW_SOURCE_PATCH_ID,
		textureUnits: 0,

		setFlag(value) {
			return setLocalLightFlagOverride(SHADOW_SOURCE_FLAG_ID, value);
		},

		isActive(context) {
			return isPhaseActive(context);
		},

		beginFrame,
		applySpotPenumbra,
		syncShadowSourceFrame,


		reset() {
			restoreTouchedLights();
			registry.setUniformValue(SHADOW_SOURCE_MIX_UNIFORM, 0);
			frameCounters.spotsWithPenumbra = 0;
			frameCounters.spotsWithoutSource = 0;
		},

		status(context) {
			const frame = context && typeof context === "object" ? context : {};
			const flagDecision = resolveLocalLightFlag(SHADOW_SOURCE_FLAG_ID, { tier: frame.tier });
			const baselineFrozen = isLocalLightBaselineFrozen(frame.tier);
			const technologyAllowed = isLocalLightTechnology(frame.technology);
			const status = {
				phase: SHADOW_SOURCE_PHASE_ID,
				flag: SHADOW_SOURCE_FLAG_ID,
				patch: SHADOW_SOURCE_PATCH_ID,
				tier: frame.tier || null,
				technologyAllowed,
				flagOn: flagDecision.active,
				flagToken: flagDecision.token,
				flagSource: flagDecision.source,
				baselineFrozen,
				active: isPhaseActive(frame),
				mix: mixSlot ? mixSlot.value : 0,
				glslMarker: SHADOW_SOURCE_TEXT_MARKER,
				appliedThisSession,
				refusal: lastRefusal,
				textureUnits: 0,
				spotsWithPenumbra: frameCounters.spotsWithPenumbra,
				spotsWithoutSource: frameCounters.spotsWithoutSource,
				packedLights: touchedLights.size,
				pending: !technologyAllowed
					? "Technology outside ShadowMap / Future keeps three's stock getShadow"
					: baselineFrozen
						? "LlBaseline is freezing the legacy path: release it for the phase to enter"
						: "Declared residuals: (a) SPOT lights only - the wrapper replaces getShadow, and point lights are sampled by getPointShadow, which LL-F11 owns with its own angular PCSS; (b) the filter is ISOTROPIC, so a tube or rect source collapses into the disk of equal area and its anisotropy is reported by resolveLocalShadowSource but not drawn - an anisotropic kernel needs the atlas meta texel and belongs with the wider kernel negotiation against SA_PAD; (c) the per-light channel rides on shadowRadius, which is only free because the engine renders with PCFSoft and Basic shadow maps - switching three to SHADOWMAP_TYPE_PCF would need the atlas meta texel instead, and the pack / unpack pair is already the single definition of that channel.",
			};
			llQa.setPhase(SHADOW_SOURCE_PHASE_ID, {
				flagOn: flagDecision.active,
				technologyAllowed,
				baselineFrozen,
				mix: status.mix,
				appliedThisSession,
				refusal: lastRefusal,
				spotsWithPenumbra: frameCounters.spotsWithPenumbra,
				packedLights: touchedLights.size,
			});
			return status;
		},
	};
}
