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
	BOUNCE_EMITTER_SLOT_SIZE,
	FALLOFF_BLEND_UNIFORM,
	GI_BLEND_UNIFORM,
	GI_EMITTER_COUNT_UNIFORM,
	GI_EMITTER_NORMAL_UNIFORM,
	GI_EMITTER_ORIGIN_UNIFORM,
	GI_EMITTER_RADIANCE_UNIFORM,
	INDIRECT_INTENSITY_PROP,
	LOCAL_GI_DECLARATION_CHUNK,
	LOCAL_GI_FLAG_DEFAULT,
	LOCAL_GI_FLAG_ID,
	LOCAL_GI_INJECTION_CHUNK,
	LOCAL_GI_PATCH_ID,
	LOCAL_GI_PATCH_ORDER,
	LOCAL_GI_PHASE_ID,
	LOCAL_GI_SHADING_POINT_CHUNK,
	LOCAL_GI_SOLVE_INTERVAL_MS,
	LOCAL_GI_TEXTURE_UNITS,
	MAX_BOUNCE_EMITTERS,
	SPOT_CONE_MIX_UNIFORM,
	clampIndirectIntensity,
	emitterBufferLength,
	tierBudgetFor,
} from "../lighting/llGiLocalContract.js";
import {
	INDIRECT_DIFFUSE_GUARD,
	buildGiLocalDeclarations,
	declarationsArePresent,
	injectGiLocalIntoIndirectChunk,
	resolveShadingPointExpressions,
} from "../lighting/llGiLocalGlsl.js";
import { selectInjectingLights, summarizeSelection } from "../lighting/llGiLocalCore.js";
import { harmonizeSurfels } from "../lighting/llGiEmissiveHarmonyCore.js";
import { buildBounceEmitters, gatherIndirectIrradiance } from "../lighting/llGiBounceCore.js";
import { createVoxelGrid } from "../lighting/llGiVoxelGridCore.js";


import { localLightsInRenderOrder } from "../lighting/llLocalLightWalkCache.js";
import {
	normalizeVector,
	subtractVectors,
	transformDirectionByMatrix4,
	transformPointByMatrix4,
} from "../lighting/llGiVectorCore.js";
import { createGiSurfelSampler } from "./llGiSurfelSampler.js";

const SPOT_LIGHT_KIND = "SpotLight";
const POINT_LIGHT_KIND = "PointLight";
const CORE_SPOT_KIND = "spot";
const CORE_POINT_KIND = "point";

const LOCAL_LIGHT_PROPS_USER_DATA_KEY = "llProps";

export const LOCAL_GI_REFUSALS = Object.freeze({
	guardMissing: "indirect-diffuse-guard-missing",
	declarationsFailed: "declaration-anchor-missing",
	injectionFailed: "indirect-chunk-injection-failed",
});


registerLocalLightFlag({
	id: LOCAL_GI_FLAG_ID,
	phase: LOCAL_GI_PHASE_ID,
	description:
		"local GI: the bounce of the local lights is added to the indirect irradiance, scaled per light by IndirectLightingIntensity",
	defaultsByTier: LOCAL_GI_FLAG_DEFAULT,
});


export function registerLocalLightGiPhase(options) {
	const settings = options && typeof options === "object" ? options : {};
	const THREE = settings.THREE;
	if (!THREE) throw new Error("LL-F18: THREE is required");
	const registry = settings.registry;
	if (!registry || typeof registry.registerShaderPatch !== "function") {
		throw new Error("LL-F18: a local-light patch registry is required");
	}
	const logger = settings.logger && typeof settings.logger.warn === "function" ? settings.logger : null;

	const sampler = createGiSurfelSampler({ THREE });


	const emitterOrigins = new Float32Array(emitterBufferLength());
	const emitterRadiances = new Float32Array(emitterBufferLength());
	const emitterNormals = new Float32Array(emitterBufferLength());

	const blendSlot = registry.registerUniform(GI_BLEND_UNIFORM, 0);
	const emitterCountSlot = registry.registerUniform(GI_EMITTER_COUNT_UNIFORM, 0);
	registry.registerUniform(GI_EMITTER_ORIGIN_UNIFORM, emitterOrigins);
	registry.registerUniform(GI_EMITTER_RADIANCE_UNIFORM, emitterRadiances);
	registry.registerUniform(GI_EMITTER_NORMAL_UNIFORM, emitterNormals);

	let lastRefusal = "";
	let blendOverride = null;
	let worldEmitters = [];
	let lastSolve = null;
	let lastSolveTime = -Infinity;
	let solveCount = 0;
	let sceneIsDirty = true;
	let uploadedEmitters = 0;

	function recordRefusal(reason) {
		lastRefusal = reason;
		llQa.addError("LL-F18: " + reason, { phase: LOCAL_GI_PHASE_ID, patch: LOCAL_GI_PATCH_ID });
		if (logger) logger.warn("[Luzes locais] LL-F18 recusou: " + reason);
	}





	function readUniformNumber(name, fallback) {
		const slot = typeof registry.getUniformSlot === "function" ? registry.getUniformSlot(name) : null;
		const value = slot ? Number(slot.value) : NaN;
		return Number.isFinite(value) ? value : fallback;
	}

	function isPhaseActive(context) {
		const frame = context && typeof context === "object" ? context : {};
		if (!isLocalLightTechnology(frame.technology)) return false;
		if (isLocalLightBaselineFrozen(frame.tier)) return false;
		if (tierBudgetFor(frame.tier).bounceEmitters === 0) return false;
		return isLocalLightFlagActive(LOCAL_GI_FLAG_ID, frame.tier);
	}

	registry.registerShaderPatch({
		id: LOCAL_GI_PATCH_ID,
		phase: LOCAL_GI_PHASE_ID,
		anchor: LOCAL_GI_INJECTION_CHUNK,
		order: LOCAL_GI_PATCH_ORDER,
		isActive: (context) => isPhaseActive(context),
		apply: (context) => {


			const anchor = context.checkAnchor(LOCAL_GI_INJECTION_CHUNK, INDIRECT_DIFFUSE_GUARD);
			if (!anchor.found) {
				recordRefusal(LOCAL_GI_REFUSALS.guardMissing + ": " + anchor.reason);
				return false;
			}


			const shaderChunks = context.THREE && context.THREE.ShaderChunk ? context.THREE.ShaderChunk : {};
			const shadingPoint = resolveShadingPointExpressions([
				shaderChunks[LOCAL_GI_SHADING_POINT_CHUNK],
				context.read("fragment"),
			]);
			if (!declarationsArePresent(context.read("fragment"))) {
				const declarations = buildGiLocalDeclarations();


				const landed =
					context.insertBeforeMarker("fragment", "#include <" + LOCAL_GI_DECLARATION_CHUNK + ">", declarations) ||
					context.insertBeforeMarker("fragment", context.declarationMarker, declarations);
				if (!landed) {
					recordRefusal(LOCAL_GI_REFUSALS.declarationsFailed);
					return false;
				}
			}
			const injected = context.patchChunk("fragment", LOCAL_GI_INJECTION_CHUNK, (source) =>
				injectGiLocalIntoIndirectChunk(source, shadingPoint),
			);
			if (!injected) {
				recordRefusal(LOCAL_GI_REFUSALS.injectionFailed);
				return false;
			}
			lastRefusal = "";
			return true;
		},
	});

	llQa.setTextureUnits(LOCAL_GI_PHASE_ID, LOCAL_GI_TEXTURE_UNITS);


	function worldPositionOf(object) {
		const elements = object.matrixWorld.elements;
		return [elements[12], elements[13], elements[14]];
	}

	function spotAxisOf(light) {
		if (!light.target || !light.target.matrixWorld) return [0, -1, 0];
		return normalizeVector(subtractVectors(worldPositionOf(light.target), worldPositionOf(light)), [0, -1, 0]);
	}


	function indirectIntensityOf(light, properties) {
		if (properties && properties.indirectLightingIntensity !== undefined) {
			return clampIndirectIntensity(properties.indirectLightingIntensity);
		}
		if (properties && properties[INDIRECT_INTENSITY_PROP] !== undefined) {
			return clampIndirectIntensity(properties[INDIRECT_INTENSITY_PROP]);
		}
		const authored = light.userData && light.userData[LOCAL_LIGHT_PROPS_USER_DATA_KEY];
		if (authored && authored[INDIRECT_INTENSITY_PROP] !== undefined) {
			return clampIndirectIntensity(authored[INDIRECT_INTENSITY_PROP]);
		}
		return clampIndirectIntensity(undefined);
	}

	function describeLight(light, coreKind, key, properties) {


		const cone =
			coreKind === CORE_SPOT_KIND
				? { cosOuter: Math.cos(light.angle), cosInner: Math.cos(light.angle * (1 - light.penumbra)) }
				: null;
		return {
			key,
			kind: coreKind,
			enabled: light.visible !== false,
			position: worldPositionOf(light),
			direction: coreKind === CORE_SPOT_KIND ? spotAxisOf(light) : [0, -1, 0],
			color: [light.color.r, light.color.g, light.color.b],
			candela: light.intensity,
			range: light.distance,
			indirectIntensity: indirectIntensityOf(light, properties),
			cone,
		};
	}


	function describeLights(scene, lights) {
		const described = [];
		if (lights && typeof lights[Symbol.iterator] === "function") {
			for (const entry of lights) {
				const light = entry && entry.light;
				if (!light || !light.matrixWorld) continue;
				const coreKind = entry.kind === SPOT_LIGHT_KIND ? CORE_SPOT_KIND : CORE_POINT_KIND;
				const key = entry.id !== undefined && entry.id !== null ? String(entry.id) : light.uuid;
				described.push(describeLight(light, coreKind, key, entry.props || null));
			}
			if (described.length > 0) return described;
		}
		if (!scene) return described;
		const collected = localLightsInRenderOrder(scene);
		collected.pointLights.forEach((light, index) => {
			described.push(describeLight(light, CORE_POINT_KIND, light.name || POINT_LIGHT_KIND + "-" + index, null));
		});
		collected.spotLights.forEach((light, index) => {
			described.push(describeLight(light, CORE_SPOT_KIND, light.name || SPOT_LIGHT_KIND + "-" + index, null));
		});
		return described;
	}


	function clearEmitterUniforms() {
		emitterOrigins.fill(0);
		emitterRadiances.fill(0);
		emitterNormals.fill(0);
		emitterCountSlot.value = 0;
		uploadedEmitters = 0;
	}


	function uploadEmitters(camera) {
		if (!camera || !camera.matrixWorldInverse || worldEmitters.length === 0) {
			clearEmitterUniforms();
			return 0;
		}
		const viewMatrix = camera.matrixWorldInverse.elements;
		emitterOrigins.fill(0);
		emitterRadiances.fill(0);
		emitterNormals.fill(0);
		const uploaded = Math.min(worldEmitters.length, MAX_BOUNCE_EMITTERS);
		for (let index = 0; index !== uploaded; index += 1) {
			const emitter = worldEmitters[index];
			const viewPosition = transformPointByMatrix4(emitter.position, viewMatrix);
			const viewNormal = transformDirectionByMatrix4(emitter.normal, viewMatrix);
			const offset = index * BOUNCE_EMITTER_SLOT_SIZE;
			emitterOrigins[offset] = viewPosition[0];
			emitterOrigins[offset + 1] = viewPosition[1];
			emitterOrigins[offset + 2] = viewPosition[2];
			emitterOrigins[offset + 3] = emitter.influenceRadius;
			emitterRadiances[offset] = emitter.radiance[0];
			emitterRadiances[offset + 1] = emitter.radiance[1];
			emitterRadiances[offset + 2] = emitter.radiance[2];
			emitterRadiances[offset + 3] = emitter.area;
			emitterNormals[offset] = viewNormal[0];
			emitterNormals[offset + 1] = viewNormal[1];
			emitterNormals[offset + 2] = viewNormal[2];
			emitterNormals[offset + 3] = 0;
		}
		emitterCountSlot.value = uploaded;
		uploadedEmitters = uploaded;
		return uploaded;
	}


	function solveBounceField(scene, frame) {
		const input = frame && typeof frame === "object" ? frame : {};
		const tier = input.tier;
		const budget = tierBudgetFor(tier);
		const falloffBlend = readUniformNumber(FALLOFF_BLEND_UNIFORM, 0);
		const coneBlend = readUniformNumber(SPOT_CONE_MIX_UNIFORM, 0);

		const sampled = sampler.sampleScene(scene, { samplesPerMesh: budget.samplesPerMesh });
		const harmony = harmonizeSurfels({
			surfels: sampled.surfels,
			emissiveGiActive: input.emissiveGiActive === true,
		});
		const grid = createVoxelGrid({ bounds: sampled.bounds, resolution: budget.voxelResolution });
		const selection = selectInjectingLights({
			lights: describeLights(scene, input.lights),
			maxInjectedLights: budget.injectedLights,
		});
		const bounce = buildBounceEmitters({
			grid,
			surfels: harmony.surfels,
			injectedLights: selection.injected,
			maxEmitters: budget.bounceEmitters,
			bounces: budget.bounces,
			falloffBlend,
			coneBlend,
		});

		worldEmitters = bounce.emitters;
		solveCount += 1;
		lastSolve = {
			tier: tier || null,
			budget,
			falloffBlend,
			coneBlend,
			grid: { resolution: grid.resolution, cellSize: grid.cellSize, min: grid.min, max: grid.max },
			sampler: sampled.stats,
			harmony: { kept: harmony.surfels.length, dropped: harmony.dropped.length, byReason: harmony.byReason },
			selection: summarizeSelection(selection),
			bounce: bounce.stats,
			emitters: bounce.emitters.length,
			solveCount,
		};
		return lastSolve;
	}

	function publishTelemetry(blend) {
		llQa.setPhase(LOCAL_GI_PHASE_ID, {
			flag: LOCAL_GI_FLAG_ID,
			on: blend > 0,
			blend,
			emitters: uploadedEmitters,
			maxEmitters: MAX_BOUNCE_EMITTERS,
			injectedLights: lastSolve ? lastSolve.selection.injected : 0,
			refusedLights: lastSolve ? lastSolve.selection.refused : 0,
			surfels: lastSolve ? lastSolve.harmony.kept : 0,
			solves: solveCount,
			textureUnits: LOCAL_GI_TEXTURE_UNITS,
			refusal: lastRefusal,
		});
	}

	return {
		phaseId: LOCAL_GI_PHASE_ID,
		flagId: LOCAL_GI_FLAG_ID,
		patchId: LOCAL_GI_PATCH_ID,
		textureUnits: LOCAL_GI_TEXTURE_UNITS,


		syncGiLocalFrame(input) {
			const frame = input && typeof input === "object" ? input : {};
			if (!isPhaseActive(frame)) {
				worldEmitters = [];
				clearEmitterUniforms();
				blendSlot.value = 0;
				return null;
			}
			const now = Number.isFinite(Number(frame.now)) ? Number(frame.now) : 0;
			if (sceneIsDirty || now - lastSolveTime >= LOCAL_GI_SOLVE_INTERVAL_MS) {
				lastSolveTime = now;
				sceneIsDirty = false;
				solveBounceField(frame.scene, frame);
			}
			const uploaded = uploadEmitters(frame.camera);
			const blend = blendOverride === null ? 1 : blendOverride;
			blendSlot.value = blend;
			publishTelemetry(blend);
			return { emitters: uploaded, blend };
		},


		reset() {
			worldEmitters = [];
			lastSolve = null;
			lastSolveTime = -Infinity;
			sceneIsDirty = true;
			clearEmitterUniforms();
			blendSlot.value = 0;
			return true;
		},


		invalidateScene() {
			sceneIsDirty = true;
			lastSolveTime = -Infinity;
			return true;
		},


		setBlend(value) {
			blendOverride = value === null || value === undefined ? null : Math.min(Math.max(Number(value) || 0, 0), 1);
			if (blendOverride !== null) blendSlot.value = blendOverride;
			return { blend: blendSlot.value, override: blendOverride };
		},

		setFlag(value) {
			return setLocalLightFlagOverride(LOCAL_GI_FLAG_ID, value);
		},


		probe(position, normal) {
			return gatherIndirectIrradiance(worldEmitters, position || [0, 0, 0], normal || [0, 1, 0]);
		},

		status(context) {
			const frame = context && typeof context === "object" ? context : {};
			const flagDecision = resolveLocalLightFlag(LOCAL_GI_FLAG_ID, { tier: frame.tier });
			const technologyAllowed = isLocalLightTechnology(frame.technology);
			const baselineFrozen = isLocalLightBaselineFrozen(frame.tier);
			return {
				phase: LOCAL_GI_PHASE_ID,
				flag: LOCAL_GI_FLAG_ID,
				patch: LOCAL_GI_PATCH_ID,
				tier: frame.tier || null,
				technologyAllowed,
				baselineFrozen,
				flagOn: flagDecision.active,
				flagToken: flagDecision.token,
				active: isPhaseActive(frame),
				blend: blendSlot.value,
				blendOverride,
				emitters: uploadedEmitters,
				maxEmitters: MAX_BOUNCE_EMITTERS,
				budget: tierBudgetFor(frame.tier),
				solves: solveCount,
				lastSolve,
				textureUnits: LOCAL_GI_TEXTURE_UNITS,
				refusal: lastRefusal,
				pending: !technologyAllowed
					? "Technology outside ShadowMap / Future keeps the legacy path byte for byte"
					: "Declared residual inherited from the bench: the red-wall QA (ll-f18-gi-parede-vermelha) is still RED - the bounce carries the wall colour weakly and the energy of the closing term needs a second pass. The wiring is complete and honest; the calibration is not signed off.",
			};
		},

		stats() {
			return {
				phase: LOCAL_GI_PHASE_ID,
				emitters: uploadedEmitters,
				solves: solveCount,
				blend: blendSlot.value,
			};
		},
	};
}
