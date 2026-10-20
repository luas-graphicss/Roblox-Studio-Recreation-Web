import { normalizeBlueNoiseDescriptor, sliceIndexForFrame, cycleIndexForFrame, describeBlueNoiseVolume } from "./mlBlueNoiseDescriptor.js";
import { createBlueNoiseVolumeBuilder, estimatedWorkUnits } from "./mlBlueNoiseCore.js";
import { packBlueNoiseVolume, blueNoiseAtlasLayout } from "./mlBlueNoiseTextureLayoutCore.js";
import { BLUE_NOISE_SAMPLER_UNIFORM, BLUE_NOISE_FRAME_OFFSET_UNIFORM } from "./mlBlueNoiseGlsl.js";


export const DEFAULT_WORK_UNITS_PER_TICK = 400000;

export function createBlueNoiseRuntime(options) {
	const settings = options || {};
	const three = settings.THREE || null;
	const descriptor = normalizeBlueNoiseDescriptor(settings.descriptor);
	const layout = blueNoiseAtlasLayout(descriptor);
	const telemetry = settings.telemetry || null;
	const scheduleTick = typeof settings.scheduleTick === "function" ? settings.scheduleTick : null;
	const workUnitsPerTick = settings.workUnitsPerTick > 0 ? Math.floor(settings.workUnitsPerTick) : DEFAULT_WORK_UNITS_PER_TICK;
	const registerUniform = typeof settings.registerUniform === "function" ? settings.registerUniform : null;


	const samplerUniform = registerUniform ? registerUniform(BLUE_NOISE_SAMPLER_UNIFORM, null) : { value: null };
	const frameOffsetUniform = registerUniform ? registerUniform(BLUE_NOISE_FRAME_OFFSET_UNIFORM, 0) : { value: 0 };

	let builder = null;
	let volume = null;
	let packed = null;
	let texture = null;
	let consumedWorkUnits = 0;
	let generationTickCount = 0;
	let tickScheduled = false;
	let disposed = false;

	function reportTelemetry(state) {
		if (!telemetry || typeof telemetry.phase !== "function") return;
		telemetry.phase("ML-F8", state);
	}

	function createTexture() {
		if (!three || typeof three.DataTexture !== "function") return null;
		const created = new three.DataTexture(packed.data, layout.width, layout.height, three.RGBAFormat, three.UnsignedByteType);


		created.magFilter = three.NearestFilter;
		created.minFilter = three.NearestFilter;
		created.generateMipmaps = false;

		created.wrapS = three.RepeatWrapping;
		created.wrapT = three.RepeatWrapping;
		created.flipY = false;
		if (three.NoColorSpace !== undefined) created.colorSpace = three.NoColorSpace;
		created.needsUpdate = true;
		return created;
	}

	function publishVolume() {
		volume = builder.volume();
		builder = null;
		packed = packBlueNoiseVolume(volume);
		texture = createTexture();
		samplerUniform.value = texture;
		reportTelemetry({
			implemented: true,
			ready: true,
			volume: describeBlueNoiseVolume(volume),
			generationTickCount,
			consumedWorkUnits,
		});
	}

	function advanceGeneration(workUnitBudget) {
		if (disposed || !builder) return { complete: volume !== null, progress: volume ? 1 : 0 };
		const budget = workUnitBudget > 0 ? Math.floor(workUnitBudget) : workUnitsPerTick;
		const stepped = builder.step(budget);
		consumedWorkUnits += stepped.consumedUnits;
		generationTickCount++;
		if (stepped.complete) publishVolume();
		return { complete: volume !== null, progress: volume ? 1 : stepped.progress };
	}

	function scheduleNextTick() {
		if (!scheduleTick || tickScheduled || disposed || !builder) return;
		tickScheduled = true;
		scheduleTick(() => {
			tickScheduled = false;
			if (disposed || !builder) return;
			advanceGeneration(workUnitsPerTick);
			scheduleNextTick();
		});
	}

	function startBackgroundGeneration() {
		if (disposed || volume || builder) return false;
		builder = createBlueNoiseVolumeBuilder(descriptor);
		reportTelemetry({ implemented: true, ready: false, generating: true, estimatedWorkUnits: estimatedWorkUnits(descriptor) });
		scheduleNextTick();
		return true;
	}


	function bindFrame(frameIndex) {
		const sliceIndex = sliceIndexForFrame(frameIndex, descriptor.sliceCount);
		frameOffsetUniform.value = sliceIndex;
		return {
			ready: volume !== null,
			sliceIndex,
			cycleIndex: cycleIndexForFrame(frameIndex, descriptor.sliceCount),
		};
	}

	function dispose() {
		disposed = true;
		builder = null;
		volume = null;
		packed = null;
		if (texture && typeof texture.dispose === "function") texture.dispose();
		texture = null;

		samplerUniform.value = null;
		frameOffsetUniform.value = 0;
	}

	return {
		descriptor,
		layout,
		uniforms: { sampler: samplerUniform, frameOffset: frameOffsetUniform },
		isReady: () => volume !== null,
		isGenerating: () => builder !== null,
		volume: () => volume,
		packedTexels: () => packed,
		texture: () => texture,
		startBackgroundGeneration,
		advanceGeneration,
		bindFrame,
		dispose,
		report: () => ({
			ready: volume !== null,
			generating: builder !== null,
			descriptor,
			layout,
			bytes: layout.byteLength,
			estimatedWorkUnits: estimatedWorkUnits(descriptor),
			consumedWorkUnits,
			generationTickCount,
			frameOffset: frameOffsetUniform.value,
		}),
	};
}
