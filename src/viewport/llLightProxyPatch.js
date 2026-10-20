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
	LIGHT_PROXY_DECLARATION_CHUNK,
	LIGHT_PROXY_FLAG_ID,
	LIGHT_PROXY_LAYER,
	LIGHT_PROXY_PATCH_ID,
	LIGHT_PROXY_PATCH_ORDER,
	LIGHT_PROXY_PHASE_ID,
	LIGHT_PROXY_PROBE_TEXTURE_UNITS,
	LIGHT_PROXY_RADIANCE_CHUNK,
	LIGHT_PROXY_UNIFORMS,
} from "../lighting/llLightProxyContract.js";
import {
	LIGHT_PROXY_MAX_VISIBLE,
	proxyBudgetForTier,
	resolveLightProxyPlan,
} from "../lighting/llLightProxyMeshCore.js";
import {
	LIGHT_PROXY_REFLECTION_TOLERANCE,
	LIGHT_PROXY_ROUGHNESS_CUTOFF,
	LIGHT_PROXY_ROUGHNESS_SOFT_EDGE,
	proxyLuminanceNits,
} from "../lighting/llLightProxyRadianceCore.js";
import {
	LEGACY_IBL_RADIANCE_SIGNATURE,
	LIGHT_PROXY_FUNCTION_NAME,
	appendLightProxyReflection,
	buildLightProxyDeclarationsGlsl,
} from "../lighting/llLightProxyGlsl.js";
import { createLightSourceProbe, probeFaceSizeForTier } from "../lighting/llLightProxyEnvCapture.js";
import { rectLightCandela, surfaceLightFaceRotation } from "../lighting/llRectExtrasCore.js";
import { createLightProxySourceMeshPool } from "./llLightProxySourceMeshPool.js";

const SURFACE_LIGHT_KIND = "SurfaceLight";


const SOURCE_RADIUS_LIMIT = 8;
const SOURCE_LENGTH_LIMIT = 64;
const RECT_SIDE_MINIMUM = 0.05;
const RECT_SIDE_LIMIT = 64;


const PHYSICAL_LIGHTING_INCLUDE = "#include <lights_physical_pars_fragment>";
const PHYSICAL_MATERIAL_STRUCT = "PhysicalMaterial material;";

export const LIGHT_PROXY_REFUSALS = Object.freeze({
	materialPathNotPhysical: "material-path-not-physical",
	radianceAnchorMissing: "radiance-anchor-missing",
	declarationsFailed: "declaration-anchor-missing",
	injectionFailed: "radiance-chunk-injection-failed",
	probeUnavailable: "probe-target-unavailable",
	rendererMissing: "renderer-or-scene-missing",
});


const LIGHT_PROXY_FLAG_DEFAULT = Object.freeze({ fraco: false, medio: true, forte: true });

registerLocalLightFlag({
	id: LIGHT_PROXY_FLAG_ID,
	phase: LIGHT_PROXY_PHASE_ID,
	description:
		"the local light SOURCE becomes an emissive shape a glossy surface can reflect (sphere, capsule or rect) carrying the nits of LL-F3/LL-F7",
	defaultsByTier: LIGHT_PROXY_FLAG_DEFAULT,
});

function asObject(value) {
	return value && typeof value === "object" ? value : {};
}

function readClampedProperty(instance, propertyName, minimum, maximum) {
	if (!instance || typeof instance.getProperty !== "function") return 0;
	const raw = Number(instance.getProperty(propertyName));
	if (!Number.isFinite(raw)) return 0;
	return Math.min(Math.max(raw, minimum), maximum);
}

function isPhysicalMaterialPath(fragmentSource) {
	const source = typeof fragmentSource === "string" ? fragmentSource : "";
	return source.indexOf(PHYSICAL_LIGHTING_INCLUDE) >= 0 || source.indexOf(PHYSICAL_MATERIAL_STRUCT) >= 0;
}


export function registerLocalLightProxyPhase(options) {
	const settings = asObject(options);
	const registry = settings.registry;
	if (!registry || typeof registry.registerShaderPatch !== "function") {
		throw new Error("LL-F19: a local-light patch registry is required");
	}
	const logger = settings.logger && typeof settings.logger.warn === "function" ? settings.logger : null;

	const meshPool = createLightProxySourceMeshPool({ scene: null });


	const probeHost = { renderer: null, scene: null, tier: null };
	const probe = createLightSourceProbe(probeHost);

	const enabledSlot = registry.registerUniform(LIGHT_PROXY_UNIFORMS.enabled, 0);
	const intensitySlot = registry.registerUniform(LIGHT_PROXY_UNIFORMS.intensity, 1);
	registry.registerUniform(LIGHT_PROXY_UNIFORMS.roughnessCutoff, LIGHT_PROXY_ROUGHNESS_CUTOFF);
	registry.registerUniform(LIGHT_PROXY_UNIFORMS.roughnessSoftEdge, LIGHT_PROXY_ROUGHNESS_SOFT_EDGE);
	const probeSlot = registry.registerUniform(LIGHT_PROXY_UNIFORMS.probe, null);

	let lastRefusal = "";
	let lastPlan = null;
	let visibleCount = 0;
	let captureCount = 0;
	let appliedShaderCount = 0;

	function recordRefusal(reason) {
		if (reason === lastRefusal) return;
		lastRefusal = reason;
		llQa.addError("LL-F19: " + reason, { phase: LIGHT_PROXY_PHASE_ID, patch: LIGHT_PROXY_PATCH_ID });
		if (logger) logger.warn("[Luzes locais] LL-F19 recusou: " + reason);
	}

	function isPhaseActive(context) {
		const frame = asObject(context);
		if (!isLocalLightTechnology(frame.technology)) return false;
		if (isLocalLightBaselineFrozen(frame.tier)) return false;
		if (!(proxyBudgetForTier(frame.tier) > 0)) return false;
		return isLocalLightFlagActive(LIGHT_PROXY_FLAG_ID, frame.tier);
	}


	function isPatchCompilable(context) {
		return isPhaseActive(context) && probeSlot.value !== null && probeSlot.value !== undefined;
	}

	registry.registerShaderPatch({
		id: LIGHT_PROXY_PATCH_ID,
		phase: LIGHT_PROXY_PHASE_ID,
		anchor: LIGHT_PROXY_RADIANCE_CHUNK,
		order: LIGHT_PROXY_PATCH_ORDER,
		isActive: (context) => isPatchCompilable(context),
		apply: (context) => {


			if (!isPhysicalMaterialPath(context.read("fragment"))) {
				recordRefusal(LIGHT_PROXY_REFUSALS.materialPathNotPhysical);
				return false;
			}
			const anchor = context.checkAnchor(LIGHT_PROXY_RADIANCE_CHUNK, LEGACY_IBL_RADIANCE_SIGNATURE);
			if (!anchor.found) {
				recordRefusal(LIGHT_PROXY_REFUSALS.radianceAnchorMissing + ": " + anchor.reason);
				return false;
			}
			if (!context.contains("fragment", "vec3 " + LIGHT_PROXY_FUNCTION_NAME)) {
				const declarations = buildLightProxyDeclarationsGlsl();


				const landed =
					context.insertBeforeMarker(
						"fragment",
						"#include <" + LIGHT_PROXY_DECLARATION_CHUNK + ">",
						declarations,
					) || context.insertBeforeMarker("fragment", context.declarationMarker, declarations);
				if (!landed) {
					recordRefusal(LIGHT_PROXY_REFUSALS.declarationsFailed);
					return false;
				}
			}
			const injected = context.patchChunk("fragment", LIGHT_PROXY_RADIANCE_CHUNK, (chunkSource) => {
				const rewrite = appendLightProxyReflection(chunkSource);
				return rewrite.injected ? rewrite.source : null;
			});
			if (!injected) {
				recordRefusal(LIGHT_PROXY_REFUSALS.injectionFailed);
				return false;
			}
			appliedShaderCount += 1;
			lastRefusal = "";
			return true;
		},
	});


	function describeSources(lights) {
		const descriptors = [];
		const sourcesByKey = new Map();
		if (!lights || typeof lights[Symbol.iterator] !== "function") return { descriptors, sourcesByKey };
		for (const entry of lights) {
			const source = asObject(entry);
			const light = source.light;
			if (!light || !light.matrixWorld) continue;
			const instance = source.inst || null;
			const key =
				instance && instance.id !== undefined && instance.id !== null ? String(instance.id) : String(light.uuid);
			const isRectArea = light.isRectAreaLight === true;
			descriptors.push({
				name: key,
				type: source.kind || light.type,
				enabled: light.visible !== false,


				candela: isRectArea
					? rectLightCandela(light.intensity, light.width, light.height)
					: Number(light.intensity) || 0,
				width: isRectArea
					? light.width
					: readClampedProperty(instance, "Width", RECT_SIDE_MINIMUM, RECT_SIDE_LIMIT),
				height: isRectArea
					? light.height
					: readClampedProperty(instance, "Height", RECT_SIDE_MINIMUM, RECT_SIDE_LIMIT),
				sourceRadius: readClampedProperty(instance, "SourceRadius", 0, SOURCE_RADIUS_LIMIT),
				sourceLength: readClampedProperty(instance, "SourceLength", 0, SOURCE_LENGTH_LIMIT),
			});
			sourcesByKey.set(key, { light, instance, kind: source.kind || light.type });
		}
		return { descriptors, sourcesByKey };
	}

	function buildVisibleSources(plan, sourcesByKey) {
		const visible = [];
		plan.decisions.forEach((decision) => {
			if (!decision.visible) return;
			const source = sourcesByKey.get(decision.name);
			if (!source) return;
			const nits = proxyLuminanceNits(decision.candela, decision.projectedArea);
			if (!(nits > 0)) return;
			source.light.updateWorldMatrix(true, false);
			visible.push({
				key: decision.name,
				shape: decision.shape,
				dimensions: decision.dimensions,
				nits,
				color: source.light.color,
				worldMatrix: source.light.matrixWorld,
				faceRotation:
					source.kind === SURFACE_LIGHT_KIND && source.instance
						? surfaceLightFaceRotation(source.instance.getProperty("Face"))
						: null,
			});
		});
		return visible;
	}

	function publishProbeTexture() {
		const texture = probe.texture();
		if (probeSlot.value !== texture) probeSlot.value = texture;
		return texture;
	}

	function publishTelemetry(active) {
		llQa.setPhase(LIGHT_PROXY_PHASE_ID, {
			flag: LIGHT_PROXY_FLAG_ID,
			patch: LIGHT_PROXY_PATCH_ID,
			on: active,
			visibleSources: visibleCount,
			maxVisible: LIGHT_PROXY_MAX_VISIBLE,
			sources: meshPool.describe(),
			captures: captureCount,
			probe: probe.stats(),
			layer: LIGHT_PROXY_LAYER,
			patchedShaders: appliedShaderCount,
			textureUnits: active ? LIGHT_PROXY_PROBE_TEXTURE_UNITS : 0,
			refusal: lastRefusal,
		});
	}


	function reset() {
		meshPool.clear();
		probe.dispose();
		probeSlot.value = null;
		enabledSlot.value = 0;
		visibleCount = 0;
		lastPlan = null;
		llQa.setTextureUnits(LIGHT_PROXY_PHASE_ID, 0);
		publishTelemetry(false);
		return true;
	}

	return {
		phaseId: LIGHT_PROXY_PHASE_ID,
		flagId: LIGHT_PROXY_FLAG_ID,
		patchId: LIGHT_PROXY_PATCH_ID,
		layer: LIGHT_PROXY_LAYER,


		planFrame(input) {
			try {
				const frame = asObject(input);
				if (!isPhaseActive(frame)) {
					if (meshPool.size() > 0 || probeSlot.value) reset();
					return null;
				}
				if (!frame.renderer || !frame.scene) {
					recordRefusal(LIGHT_PROXY_REFUSALS.rendererMissing);
					enabledSlot.value = 0;
					return null;
				}
				probeHost.renderer = frame.renderer;
				probeHost.scene = frame.scene;
				probeHost.tier = frame.tier;
				meshPool.useScene(frame.scene);

				const described = describeSources(frame.lights);
				const plan = resolveLightProxyPlan({
					tier: frame.tier,
					phaseFlagOn: true,
					lights: described.descriptors,
				});
				lastPlan = plan;
				const visible = buildVisibleSources(plan, described.sourcesByKey);
				meshPool.sync(visible);
				visibleCount = visible.length;


				if (!probe.ensureTarget(frame.tier)) {
					recordRefusal(LIGHT_PROXY_REFUSALS.probeUnavailable);
					probeSlot.value = null;
					enabledSlot.value = 0;
					publishTelemetry(false);
					return null;
				}
				publishProbeTexture();
				enabledSlot.value = 1;
				llQa.setTextureUnits(LIGHT_PROXY_PHASE_ID, LIGHT_PROXY_PROBE_TEXTURE_UNITS);

				probe.markDirty(meshPool.signature());
				const capture = probe.captureIfDirty({
					nowMs: Number.isFinite(Number(frame.now)) ? Number(frame.now) : undefined,
					center: meshPool.centroid(),
					tier: frame.tier,
				});
				if (capture) {
					captureCount += 1;
					publishProbeTexture();
				}
				lastRefusal = "";
				publishTelemetry(true);
				return { visibleSources: visibleCount, captured: !!capture };
			} catch (error) {
				recordRefusal(String((error && error.message) || error));
				reset();
				return null;
			}
		},

		reset,


		setIntensity(value) {
			intensitySlot.value = Math.min(Math.max(Number(value) || 0, 0), 4);
			return intensitySlot.value;
		},

		setFlag(value) {
			return setLocalLightFlagOverride(LIGHT_PROXY_FLAG_ID, value);
		},

		plan() {
			return lastPlan;
		},

		status(context) {
			const frame = asObject(context);
			const flagDecision = resolveLocalLightFlag(LIGHT_PROXY_FLAG_ID, { tier: frame.tier });
			const technologyAllowed = isLocalLightTechnology(frame.technology);
			return {
				phase: LIGHT_PROXY_PHASE_ID,
				flag: LIGHT_PROXY_FLAG_ID,
				patch: LIGHT_PROXY_PATCH_ID,
				tier: frame.tier || null,
				technologyAllowed,
				baselineFrozen: isLocalLightBaselineFrozen(frame.tier),
				flagOn: flagDecision.active,
				flagToken: flagDecision.token,
				active: isPhaseActive(frame),
				budget: proxyBudgetForTier(frame.tier),
				maxVisible: LIGHT_PROXY_MAX_VISIBLE,
				visibleSources: visibleCount,
				sources: meshPool.describe(),
				probeFaceSize: probeFaceSizeForTier(frame.tier),
				probe: probe.stats(),
				captures: captureCount,
				layer: LIGHT_PROXY_LAYER,
				roughnessWindow: {
					cutoff: LIGHT_PROXY_ROUGHNESS_CUTOFF,
					softEdge: LIGHT_PROXY_ROUGHNESS_SOFT_EDGE,
				},
				energyTolerance: LIGHT_PROXY_REFLECTION_TOLERANCE,
				patchedShaders: appliedShaderCount,
				textureUnits: LIGHT_PROXY_PROBE_TEXTURE_UNITS,
				refusal: lastRefusal,
				pending: !technologyAllowed
					? "Technology outside ShadowMap / Future keeps the legacy path byte for byte"
					: "Declared residuals: (1) ONE cube probe is captured at the centroid of the visible sources, so a surface far from that centroid reflects the source with parallax error; (2) the emissive shapes live only on layer " +
						LIGHT_PROXY_LAYER +
						", which the cube probe reads - the SSR and planar passes of this engine do not render that layer yet, so they still miss the source; (3) above roughness " +
						LIGHT_PROXY_ROUGHNESS_CUTOFF +
						" the reflection leaves on purpose and the surface keeps only the LTC highlight of LL-F6/LL-F7, which is what prevents counting the same light twice.",
			};
		},
	};
}
