import { copyMsmBlueNoiseVolume } from '../lighting/megalightsSm/msmBlueNoiseVolume.generated.js';
import {
	MSM_BLUE_NOISE_TEXTURE_HEIGHT,
	MSM_BLUE_NOISE_TEXTURE_WIDTH,
	describeBlueNoiseShape,
} from "../lighting/megalightsSm/msmBlueNoiseDescriptorCore.js";
import { MSM_LIGHT_RECORD_TEXEL_ORDER } from "../lighting/megalightsSm/msmLightRecordCore.js";
import { MSM_GRID_LAYOUT_CEILING } from "../lighting/megalightsSm/msmPipelineContract.js";
import {
	MSM_LIGHT_DATA_TEXTURE_HEIGHT,
	MSM_LIGHT_DATA_TEXTURE_WIDTH,
	MSM_LIGHT_RECORD_TEXEL_COUNT,
} from "../lighting/megalightsSm/msmSamplePassGlsl.js";
import {
	MSM_GRID_MAX_LIGHT_COUNT,
	createGridTextureData,
} from "../lighting/megalightsSm/msmWorldGridLayout.js";


const CHANNELS_PER_TEXEL = 4;


export const MSM_LIGHT_DATA_FLOATS_PER_LIGHT = MSM_LIGHT_RECORD_TEXEL_COUNT * CHANNELS_PER_TEXEL;


export const MSM_RESOURCE_REFUSALS = Object.freeze({
	MISSING_WORLD_GRID: "missing-world-grid",
});

function readClockMilliseconds() {
	if (typeof performance !== "undefined" && typeof performance.now === "function") return performance.now();
	return Date.now();
}

function applyDataTextureDefaults(THREE, texture) {
	texture.minFilter = THREE.NearestFilter;
	texture.magFilter = THREE.NearestFilter;
	texture.generateMipmaps = false;
	texture.flipY = false;
	texture.needsUpdate = true;
	return texture;
}


export function createMegaLightsSmResources(dependencies) {
	const options = dependencies || {};
	const THREE = options.THREE;
	if (!THREE) {
		throw new Error("createMegaLightsSmResources: THREE is required - this file is glue, not a pure core");
	}

	const lightData = new Float32Array(
		MSM_LIGHT_DATA_TEXTURE_WIDTH * MSM_LIGHT_DATA_TEXTURE_HEIGHT * CHANNELS_PER_TEXEL,
	);
	const lightDataTexture = applyDataTextureDefaults(
		THREE,
		new THREE.DataTexture(
			lightData,
			MSM_LIGHT_DATA_TEXTURE_WIDTH,
			MSM_LIGHT_DATA_TEXTURE_HEIGHT,
			THREE.RGBAFormat,
			THREE.FloatType,
		),
	);

	const gridData = createGridTextureData(MSM_GRID_LAYOUT_CEILING);
	const gridTexture = applyDataTextureDefaults(
		THREE,
		new THREE.DataTexture(
			gridData,
			MSM_GRID_LAYOUT_CEILING.textureWidth,
			MSM_GRID_LAYOUT_CEILING.textureHeight,
			THREE.RGBAFormat,
			THREE.UnsignedByteType,
		),
	);

	const blueNoiseData = new Uint8Array(
		MSM_BLUE_NOISE_TEXTURE_WIDTH * MSM_BLUE_NOISE_TEXTURE_HEIGHT * CHANNELS_PER_TEXEL,
	);
	const blueNoiseTexture = applyDataTextureDefaults(
		THREE,
		new THREE.DataTexture(
			blueNoiseData,
			MSM_BLUE_NOISE_TEXTURE_WIDTH,
			MSM_BLUE_NOISE_TEXTURE_HEIGHT,
			THREE.RGBAFormat,
			THREE.UnsignedByteType,
		),
	);


	blueNoiseTexture.wrapS = THREE.RepeatWrapping;
	blueNoiseTexture.wrapT = THREE.RepeatWrapping;

	let writtenLightFloatCount = 0;
	let writtenLightCount = 0;
	let blueNoiseBuilt = false;
	let blueNoiseBuildMilliseconds = 0;
	let gridWriteCount = 0;


	function writeLightRecords(lightRecords) {
		const records = Array.isArray(lightRecords) ? lightRecords : [];
		const writableCount = MSM_GRID_MAX_LIGHT_COUNT > records.length ? records.length : MSM_GRID_MAX_LIGHT_COUNT;

		for (let recordIndex = 0; writableCount > recordIndex; recordIndex += 1) {
			const record = records[recordIndex];
			const recordBase = recordIndex * MSM_LIGHT_DATA_FLOATS_PER_LIGHT;
			for (let texel = 0; MSM_LIGHT_RECORD_TEXEL_ORDER.length > texel; texel += 1) {
				const fields = MSM_LIGHT_RECORD_TEXEL_ORDER[texel].fields;
				const texelBase = recordBase + texel * CHANNELS_PER_TEXEL;
				for (let channel = 0; CHANNELS_PER_TEXEL > channel; channel += 1) {
					const value = Number(record ? record[fields[channel]] : 0);
					lightData[texelBase + channel] = Number.isFinite(value) ? value : 0;
				}
			}
		}


		const usedFloatCount = writableCount * MSM_LIGHT_DATA_FLOATS_PER_LIGHT;
		if (writtenLightFloatCount > usedFloatCount) lightData.fill(0, usedFloatCount, writtenLightFloatCount);
		writtenLightFloatCount = usedFloatCount;
		writtenLightCount = writableCount;
		lightDataTexture.needsUpdate = true;
		return writableCount;
	}


	function writeWorldGrid(worldGrid) {
		if (!worldGrid || typeof worldGrid.writeTexture !== "function") {
			return Object.freeze({ ok: false, refusedReason: MSM_RESOURCE_REFUSALS.MISSING_WORLD_GRID });
		}
		const report = worldGrid.writeTexture(gridData);
		if (report && report.ok) {
			gridTexture.needsUpdate = true;
			gridWriteCount += 1;
		}
		return report;
	}


	function ensureBlueNoiseVolume() {
		if (blueNoiseBuilt) return false;
		const startedAtMilliseconds = readClockMilliseconds();
		copyMsmBlueNoiseVolume(blueNoiseData);
		blueNoiseTexture.needsUpdate = true;
		blueNoiseBuilt = true;
		blueNoiseBuildMilliseconds = readClockMilliseconds() - startedAtMilliseconds;
		return true;
	}


	function describe() {
		return {
			lightDataTexture: MSM_LIGHT_DATA_TEXTURE_WIDTH + "x" + MSM_LIGHT_DATA_TEXTURE_HEIGHT,
			lightDataBytes: lightData.byteLength,
			lightCount: writtenLightCount,
			gridTexture: MSM_GRID_LAYOUT_CEILING.textureWidth + "x" + MSM_GRID_LAYOUT_CEILING.textureHeight,
			gridBytes: gridData.byteLength,
			gridWriteCount,
			blueNoise: describeBlueNoiseShape(),
			blueNoiseBuilt,
			blueNoiseBuildMilliseconds,
			newVramBytes: lightData.byteLength + gridData.byteLength + blueNoiseData.byteLength,
			textureUnitCost: 3,
		};
	}

	function dispose() {
		lightDataTexture.dispose();
		gridTexture.dispose();
		blueNoiseTexture.dispose();
	}

	return {
		lightDataTexture,
		gridTexture,
		blueNoiseTexture,
		lightDataTexelWidth: 1 / MSM_LIGHT_DATA_TEXTURE_WIDTH,
		lightDataTexelHeight: 1 / MSM_LIGHT_DATA_TEXTURE_HEIGHT,
		blueNoiseTexelWidth: 1 / MSM_BLUE_NOISE_TEXTURE_WIDTH,
		blueNoiseTexelHeight: 1 / MSM_BLUE_NOISE_TEXTURE_HEIGHT,
		writeLightRecords,
		writeWorldGrid,
		ensureBlueNoiseVolume,
		describe,
		dispose,
	};
}
