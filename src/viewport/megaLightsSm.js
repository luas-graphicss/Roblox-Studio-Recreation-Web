import { createMegaLightsSmResources } from "./megaLightsSmResources.js";
import { createMsmSampleRuntimeBindings } from './msmSampleRuntimeBindings.js';
import { createMsmStableLightRecords } from './msmStableLightRecords.js';
import { MSM_SAMPLE_ADDRESS_UNIFORMS } from '../lighting/megalightsSm/msmSampleAddressGlsl.js';
import { compileMsmMaterial } from './msmProgramWarmup.js';
import { blueNoiseSliceForFrame } from "../lighting/megalightsSm/msmBlueNoiseDescriptorCore.js";
import {
	MSM_FAR_LIST_CAPACITY,
	MSM_FAR_LIST_COUNT_UNIFORM_NAME,
	MSM_FAR_LIST_SLOTS_UNIFORM_NAME,
	createFarListBuilder,
	farListSlotsForUniform,
} from "../lighting/megalightsSm/msmFarListCore.js";
import { normalizeMsmLightRecords } from "../lighting/megalightsSm/msmLightRecordCore.js";
import { MSM_NORMAL_FROM_DEPTH_UNIFORMS } from "../lighting/megalightsSm/msmNormalFromDepthGlsl.js";
import {
	MSM_SAMPLE_PASS_ID,
} from "../lighting/megalightsSm/msmPipelineContract.js";
import { resolveMsmScreenTargetBudget } from "../lighting/megalightsSm/msmScreenTargetBudgetCore.js";
import { MSM_RESERVOIR_MAX_CANDIDATES } from "../lighting/megalightsSm/msmReservoirCore.js";
import {
	MSM_SAMPLE_PASS_UNIFORMS,
	buildSamplePassFragmentShader,
	buildSamplePassVertexShader,
	describeSamplePassProgram,
} from "../lighting/megalightsSm/msmSamplePassGlsl.js";
import { createSceneInputsReader } from "../lighting/megalightsSm/msmSceneInputsGlue.js";
import {
	MSM_SCREEN_TRACE_STEP_CEILING,
	MSM_SCREEN_TRACE_STEP_FLOOR,
} from "../lighting/megalightsSm/msmScreenTraceBudgetCore.js";
import { describeMsmTierPolicy } from "../lighting/megalightsSm/msmTierPolicy.js";
import {
	createWorldGrid,
	resolveWorldGridConfiguration,
} from "../lighting/megalightsSm/msmWorldGridCore.js";
import { MSM_GRID_MAX_LIGHT_COUNT } from "../lighting/megalightsSm/msmWorldGridLayout.js";


export const MSM_SCREEN_TRACE_THICKNESS_STUDS = 0.5;


export const MSM_MAXIMUM_TRACE_DISTANCE_IN_CELLS = 2;


export const MSM_SAMPLE_PASS_SLEEP_REASON = Object.freeze({
	TIER_WITHOUT_MSM: "tier-without-msm",
	NO_LIGHTS: "no-lights",
	GRID_NOT_CONFIGURED: "grid-not-configured",
	SCENE_NOT_READABLE: "scene-not-readable",
});

function createScalarUniformValue(THREE, glslType) {
	if (glslType === "sampler2D") return null;
	if (glslType === "vec2") return new THREE.Vector2(0, 0);
	if (glslType === "vec3") return new THREE.Vector3(0, 0, 0);
	if (glslType === "vec4") return new THREE.Vector4(0, 0, 0, 0);
	if (glslType === "mat4") return new THREE.Matrix4();
	return 0;
}




function createUniformValue(THREE, glslType) {
	const arrayMatch = /^(.*?)\s*\[\s*(\d+)\s*\]$/.exec(glslType);
	if (!arrayMatch) return createScalarUniformValue(THREE, glslType);
	const length = Math.max(1, Math.floor(Number(arrayMatch[2])));
	const elementType = arrayMatch[1].trim();
	const values = new Array(length);
	for (let index = 0; length > index; index += 1) values[index] = createScalarUniformValue(THREE, elementType);
	return values;
}

function lightRecordFingerprintOf(records) {

	return JSON.stringify(records);
}


export function createMegaLightsSmSamplePass(dependencies) {
	const options = dependencies || {};
	const THREE = options.THREE;
	const renderer = options.renderer || null;
	const camera = options.camera || null;
	const FullScreenQuad = options.FullScreenQuad;
	const sharedDepth = options.sharedDepth || null;

	if (!THREE) throw new Error("createMegaLightsSmSamplePass: THREE is required");
	if (!FullScreenQuad) throw new Error("createMegaLightsSmSamplePass: FullScreenQuad is required");
	if (!sharedDepth) {
		throw new Error(
			"createMegaLightsSmSamplePass: sharedDepth is required - MSM-F5 reads the shared depth and never renders its own prepass",
		);
	}

	const resources = createMegaLightsSmResources({ THREE });
	const stableRecords = createMsmStableLightRecords();
	const residentTextureBytes = resources.describe().newVramBytes;
	const worldGrid = createWorldGrid({});
	const farListBuilder = createFarListBuilder({});

	let fullWidth = 0;
	let fullHeight = 0;
	let activeDivisor = 2;
	let preferredDivisor = 2;
	let targetBudget = null;





	const sceneInputs = createSceneInputsReader({
		THREE,
		renderer,
		camera,
		sharedDepth,
		resolveDivisor: () => activeDivisor,
		acquireDepthTexture: (request) => {
			const activeRenderer = (request && request.renderer) || renderer;
			if (!activeRenderer || typeof sharedDepth.acquire !== "function") return null;
			if (!(fullWidth >= 1) || !(fullHeight >= 1)) return null;
			return sharedDepth.acquire(activeRenderer, fullWidth, fullHeight) || null;
		},
	});

	const sceneUniforms = sceneInputs.uniforms();
	const sceneUniformNames = MSM_NORMAL_FROM_DEPTH_UNIFORMS.map((uniform) => uniform.name);


	const uniforms = {};
	MSM_SAMPLE_PASS_UNIFORMS.forEach((uniform) => {
		if (sceneUniformNames.indexOf(uniform.name) !== -1) {
			uniforms[uniform.name] = sceneUniforms[uniform.name];
			return;
		}
		uniforms[uniform.name] = { value: createUniformValue(THREE, uniform.glslType) };
	});

	uniforms.tMsmLightData.value = resources.lightDataTexture;
	uniforms.tMsmGridTexture.value = resources.gridTexture;
	uniforms.tMsmBlueNoise.value = resources.blueNoiseTexture;
	uniforms.uMsmLightDataTexel.value.set(resources.lightDataTexelWidth, resources.lightDataTexelHeight);
	uniforms.uMsmBlueNoiseTexel.value.set(resources.blueNoiseTexelWidth, resources.blueNoiseTexelHeight);

	const filterInputs = { ...sceneUniforms };
	for (const { name } of MSM_SAMPLE_ADDRESS_UNIFORMS) filterInputs[name] = uniforms[name];
	const runtimeBindings = createMsmSampleRuntimeBindings({ THREE, scene: options.scene, camera, uniforms });
	let activeLightKeys = [];
	const quad = new FullScreenQuad(null);
	let material = null;
	let renderTarget = null;
	let renderTargetWidth = 0;
	let renderTargetHeight = 0;

	let enabled = false;
	let sleepReason = MSM_SAMPLE_PASS_SLEEP_REASON.NO_LIGHTS;
	let activeTier = "";
	let activeCellSizeStuds = 0;
	let activeLightCount = 0;
	let configuredTier = "";
	let lightFingerprint = -1;
	let lastRebuildReport = null;
	let lastFarListReport = null;
	let renderedFrameCount = 0;

	const cameraWorldPosition = new THREE.Vector3();
	const farListLights = [];
	const farListGridBounds = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };

	function ensureMaterial() {
		if (material) return material;
		material = new THREE.ShaderMaterial({
			uniforms,
			vertexShader: buildSamplePassVertexShader(),
			fragmentShader: buildSamplePassFragmentShader(),
			depthTest: false,
			depthWrite: false,
		});
		return material;
	}

	function ensureRenderTarget(width, height) {
		if (renderTarget && renderTargetWidth === width && renderTargetHeight === height) return renderTarget;
		if (renderTarget) renderTarget.dispose();
		renderTarget = new THREE.WebGLRenderTarget(width, height, {
			minFilter: THREE.NearestFilter,
			magFilter: THREE.NearestFilter,
			format: THREE.RGBAFormat,
			type: THREE.HalfFloatType,
			depthBuffer: false,
			stencilBuffer: false,
		});
		renderTarget.texture.generateMipmaps = false;
		renderTargetWidth = width;
		renderTargetHeight = height;
		return renderTarget;
	}

	function configureGridForTier(tierPolicy) {
		if (configuredTier === tierPolicy.tier) return true;
		const configuration = resolveWorldGridConfiguration(tierPolicy);
		const report = worldGrid.configure(configuration);
		if (!report.ok) {
			configuredTier = "";
			return false;
		}
		configuredTier = tierPolicy.tier;
		activeCellSizeStuds = configuration.cellSizeStuds;
		lightFingerprint = -1;
		return true;
	}

	function updateFarList(records, tier) {
		farListLights.length = 0;
		for (let index = 0; records.length > index; index += 1) {
			const record = records[index];
			if (!record) continue;


			farListLights.push({
				lightIndex: index + 1,
				lightId: index + 1,
				position: { x: record.positionX, y: record.positionY, z: record.positionZ },
				range: record.range,
				color: { r: record.chromaticityRed, g: record.chromaticityGreen, b: record.chromaticityBlue },
				intensity: record.luminance,
			});
		}
		const report = farListBuilder.rebuild({
			tier,
			gridBounds: farListGridBounds,
			lights: farListLights,
			gridResidentLightIndices: worldGrid.listWindowLightIndices().map((lightIndex) => lightIndex + 1),
		});
		const slots = farListSlotsForUniform(report);
		const slotUniform = uniforms[MSM_FAR_LIST_SLOTS_UNIFORM_NAME].value;
		for (let slot = 0; MSM_FAR_LIST_CAPACITY > slot; slot += 1) slotUniform[slot] = slots[slot];
		uniforms[MSM_FAR_LIST_COUNT_UNIFORM_NAME].value = report.enabled ? report.entryCount : 0;
		lastFarListReport = report;
		return report;
	}

	function goToSleep(reason) {
		enabled = false;
		sleepReason = reason;
		activeLightCount = 0;
		return false;
	}


	function applyState(state) {
		const source = state && typeof state === "object" ? state : {};
		const tierDecision = describeMsmTierPolicy(source.tier);
		if (!tierDecision.runs) return goToSleep(MSM_SAMPLE_PASS_SLEEP_REASON.TIER_WITHOUT_MSM);

		const tierPolicy = { ...tierDecision.policy, ...(source.quality || {}) };
		uniforms.uMsmOutputMode.value = source.mode === 'B' ? 1 : 0;
		uniforms.uMsmShadowStrength.value = source.mode === 'B' && Number.isFinite(source.strength) ? source.strength : 1;
		activeTier = tierPolicy.tier;
		preferredDivisor = tierPolicy.resolutionDivisor;
		activeDivisor = preferredDivisor;
		if (!configureGridForTier(tierPolicy)) return goToSleep(MSM_SAMPLE_PASS_SLEEP_REASON.GRID_NOT_CONFIGURED);

		const normalization = normalizeMsmLightRecords(source.lights);
		const lightCap = MSM_GRID_MAX_LIGHT_COUNT > tierPolicy.lightCap ? tierPolicy.lightCap : MSM_GRID_MAX_LIGHT_COUNT;
		const liveRecords =
			normalization.records.length > lightCap ? normalization.records.slice(0, lightCap) : normalization.records;
		const records = stableRecords.update(liveRecords);
		activeLightCount = liveRecords.length;
		activeLightKeys = liveRecords.map(record => record.lightKey);
		runtimeBindings.applyState(source, records);
		if (activeLightCount === 0) return goToSleep(MSM_SAMPLE_PASS_SLEEP_REASON.NO_LIGHTS);


		const cameraPosition = camera && typeof camera.getWorldPosition === "function"
			? camera.getWorldPosition(cameraWorldPosition) : camera ? camera.position : null;
		if (!cameraPosition) return goToSleep(MSM_SAMPLE_PASS_SLEEP_REASON.SCENE_NOT_READABLE);
		const anchorReport = worldGrid.anchorToCamera(cameraPosition);
		if (!anchorReport.ok) return goToSleep(MSM_SAMPLE_PASS_SLEEP_REASON.GRID_NOT_CONFIGURED);

		const nextFingerprint = lightRecordFingerprintOf(records);
		const lightsChanged = nextFingerprint !== lightFingerprint;
		if (lightsChanged) resources.writeLightRecords(records);
		lightFingerprint = nextFingerprint;
		const rebuildReport =
			lightsChanged
				? worldGrid.rebuildEveryCell(records)
				: worldGrid.rebuildPendingCells(records);
		if (rebuildReport.ok && rebuildReport.rebuiltCellCount > 0) resources.writeWorldGrid(worldGrid);
		lastRebuildReport = rebuildReport;

		const anchorCell = anchorReport.anchorCell;
		const originX = anchorCell.x * activeCellSizeStuds;
		const originY = anchorCell.y * activeCellSizeStuds;
		const originZ = anchorCell.z * activeCellSizeStuds;
		farListGridBounds.minX = originX;
		farListGridBounds.minY = originY;
		farListGridBounds.minZ = originZ;
		farListGridBounds.maxX = originX + tierPolicy.worldGrid.cellsX * activeCellSizeStuds;
		farListGridBounds.maxY = originY + tierPolicy.worldGrid.cellsY * activeCellSizeStuds;
		farListGridBounds.maxZ = originZ + tierPolicy.worldGrid.cellsZ * activeCellSizeStuds;
		if (anchorReport.anchorChanged || lightsChanged) updateFarList(records, tierPolicy.tier);
		uniforms[MSM_FAR_LIST_COUNT_UNIFORM_NAME].value = lastFarListReport?.enabled ? lastFarListReport.entryCount : 0;
		if (source.quality?.farListCapacity === 0) uniforms[MSM_FAR_LIST_COUNT_UNIFORM_NAME].value = 0;

		uniforms.uMsmGridOriginWorld.value.set(originX, originY, originZ);
		uniforms.uMsmGridRingOffset.value.set(anchorCell.x, anchorCell.y, anchorCell.z);
		uniforms.uMsmGridInverseCellSize.value = 1 / activeCellSizeStuds;
		uniforms.uMsmGridCellCounts.value.set(
			tierPolicy.worldGrid.cellsX,
			tierPolicy.worldGrid.cellsY,
			tierPolicy.worldGrid.cellsZ,
		);

		const candidateCeiling =
			MSM_RESERVOIR_MAX_CANDIDATES > tierPolicy.worldGrid.listsPerCell
				? tierPolicy.worldGrid.listsPerCell
				: MSM_RESERVOIR_MAX_CANDIDATES;
		uniforms.uMsmCandidateCount.value = candidateCeiling;
		uniforms.uMsmStreamCount.value = tierPolicy.samplesPerPixel;

		const requestedSteps = tierPolicy.screenTraceSteps;
		const clampedSteps = MSM_SCREEN_TRACE_STEP_CEILING > requestedSteps ? requestedSteps : MSM_SCREEN_TRACE_STEP_CEILING;
		uniforms.uMsmScreenTraceStepCount.value =
			clampedSteps > MSM_SCREEN_TRACE_STEP_FLOOR ? clampedSteps : MSM_SCREEN_TRACE_STEP_FLOOR;
		uniforms.uMsmScreenTraceThickness.value = MSM_SCREEN_TRACE_THICKNESS_STUDS;
		uniforms.uMsmMaximumTraceDistance.value = activeCellSizeStuds * MSM_MAXIMUM_TRACE_DISTANCE_IN_CELLS;
		uniforms.uMsmBlueNoiseSlice.value = blueNoiseSliceForFrame(source.frame);

		enabled = true;
		sleepReason = "";
		return true;
	}


	function render(activeRenderer, frameWidth, frameHeight, frame = {}) {
		if (!enabled || !activeRenderer) return false;
		fullWidth = Math.max(1, Math.floor(frameWidth) || 0);
		fullHeight = Math.max(1, Math.floor(frameHeight) || 0);

		targetBudget = frame.budget || resolveMsmScreenTargetBudget({
			width: fullWidth, height: fullHeight, preferredDivisor,
			fixedBytes: residentTextureBytes,
		});
		if (!targetBudget.fits) return goToSleep(targetBudget.reason);
		activeDivisor = targetBudget.divisor;
		const resolution = targetBudget;


		resources.ensureBlueNoiseVolume();

		const sceneHandle = sceneInputs.readFrame({ width: fullWidth, height: fullHeight, camera });
		if (!sceneHandle.ready) return goToSleep(MSM_SAMPLE_PASS_SLEEP_REASON.SCENE_NOT_READABLE);

		uniforms.uMsmViewToWorld.value.copy(camera.matrixWorld);
		uniforms.uMsmWorldToView.value.copy(camera.matrixWorldInverse);
		uniforms.uMsmProjection.value.copy(camera.projectionMatrix);

		const target = frame.target || ensureRenderTarget(resolution.width, resolution.height);
		renderTargetWidth = resolution.width;
		renderTargetHeight = resolution.height;
		if (Number.isFinite(frame.frame)) uniforms.uMsmBlueNoiseSlice.value = blueNoiseSliceForFrame(frame.frame);
		runtimeBindings.beginFrame(Number.isFinite(frame.frame) ? frame.frame : renderedFrameCount,
			activeDivisor, fullWidth, fullHeight);
		quad.material = ensureMaterial();
		activeRenderer.setRenderTarget(target);
		quad.render(activeRenderer);
		renderedFrameCount += 1;
		return true;
	}


	function irradianceTexture() {
		return renderTarget && enabled ? renderTarget.texture : null;
	}


	function describe() {
		return {
			passId: MSM_SAMPLE_PASS_ID,
			enabled,
			sleepReason,
			tier: activeTier,
			divisor: activeDivisor,
			targetBudget,
			lightCount: activeLightCount,
			reducedWidth: renderTargetWidth,
			reducedHeight: renderTargetHeight,
			streamCount: uniforms.uMsmStreamCount.value,
			candidateCount: uniforms.uMsmCandidateCount.value,
			screenTraceSteps: uniforms.uMsmScreenTraceStepCount.value,
			blueNoiseSlice: uniforms.uMsmBlueNoiseSlice.value,
			programCompiled: material !== null,
			renderedFrameCount,
			grid: worldGrid.describe(),
			lastRebuild: lastRebuildReport,
			farListEntryCount: lastFarListReport ? lastFarListReport.entryCount : 0,
			farListSleepReason: lastFarListReport ? lastFarListReport.sleepReason : "never-rebuilt",
			runtime: runtimeBindings.describe(),
			resources: resources.describe(),
			program: describeSamplePassProgram(),
			stableIndices: stableRecords.describe(),
			sceneInputs: sceneInputs.inspect(),
		};
	}

	function dispose() {
		if (renderTarget) renderTarget.dispose();
		renderTarget = null;
		if (material) material.dispose();
		material = null;
		quad.dispose();
		sceneInputs.dispose();
		resources.dispose();
		enabled = false;
	}

	return {
		passId: MSM_SAMPLE_PASS_ID,
		applyState,
		render,
		irradianceTexture,
		sceneUniforms: () => filterInputs,
		activeLightKeys: () => activeLightKeys,
		warmupProgram: renderer => compileMsmMaterial({ THREE, renderer, material: ensureMaterial() }),
		warmupNoise: () => {
			const built = resources.ensureBlueNoiseVolume();
			for (const texture of [resources.lightDataTexture, resources.gridTexture, resources.blueNoiseTexture])
				renderer.initTexture?.(texture);
			return built;
		},
		warmupSharedDepth: (width, height) => sharedDepth.acquire(renderer, width, height),
		isNoiseReady: () => resources.describe().blueNoiseBuilt,
		residentTextureBytes: () => residentTextureBytes,
		isEnabled: () => enabled,
		sleepReason: () => sleepReason,
		reducedSize: () => ({ width: renderTargetWidth, height: renderTargetHeight }),
		describe,
		dispose,
	};
}
