import { isLocalLightFlagActive } from "../lighting/llFeatureFlags.js";
import { isLocalLightBaselineFrozen } from "../lighting/llBaselineFreezeFlag.js";
import { isLocalLightTechnology } from "../lighting/llTechnologyGate.js";
import { llQa } from "../lighting/llTelemetry.js";
import { CLUSTER_SHADING_FLAG_ID, CLUSTER_SHADING_PHASE_ID } from "../lighting/llClusterShadingContract.js";
import {
	CLUSTER_LIGHT_TEXTURE_HEIGHT,
	CLUSTER_LIGHT_TEXTURE_WIDTH,
	DEFAULT_LIGHT_DECAY,
	MAX_CLUSTER_SHADED_LIGHTS,
	NO_ATLAS_SLOT,
	POINT_LIGHT_KIND,
	SPOT_LIGHT_KIND,
	createClusterLightDataBuffer,
	createClusterLightRecord,
	packClusterLightData,
} from "../lighting/llClusterShadingCore.js";
import { CL_IDX_TEX_H, CL_IDX_TEX_W, CL_TEX_CLUSTER, packClusterBuffers } from "../lighting/lightClusterCore.js";

const FLOATS_PER_TEXEL = 4;

export const CLUSTER_FEED_REASONS = Object.freeze({
	technologyGate: "technology-out-of-gate",
	baselineFrozen: "baseline-frozen",
	flagOff: "flag-off",
	noCamera: "no-camera",
	notPerspective: "camera-not-perspective",
	noLight: "no-shadable-local-light",
	reset: "reset",
});


export function createLocalLightClusterFeed(options) {
	const settings = options && typeof options === "object" ? options : {};
	const THREE = settings.THREE;
	if (!THREE) throw new Error("LL-F20: THREE is required");


	const recordPool = [];
	const shadableRecords = [];
	const lightData = createClusterLightDataBuffer(MAX_CLUSTER_SHADED_LIGHTS);
	const cellData = new Float32Array(CL_TEX_CLUSTER * FLOATS_PER_TEXEL);
	const lightIndexData = new Float32Array(CL_IDX_TEX_W * CL_IDX_TEX_H * FLOATS_PER_TEXEL);

	let lightTexture = null;
	let cellTexture = null;
	let lightIndexTexture = null;
	let lastPlan = emptyPlan(CLUSTER_FEED_REASONS.reset);

	function emptyPlan(reason) {
		return { active: false, lights: 0, skipped: 0, cellLights: 0, indexEntries: 0, reason: reason || "" };
	}

	function createDataTexture(data, width, height) {
		const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
		texture.magFilter = THREE.NearestFilter;
		texture.minFilter = THREE.NearestFilter;
		texture.generateMipmaps = false;
		texture.needsUpdate = true;
		return texture;
	}


	function ensureTextures(patch) {
		if (lightTexture) return;
		lightTexture = createDataTexture(lightData, CLUSTER_LIGHT_TEXTURE_WIDTH, CLUSTER_LIGHT_TEXTURE_HEIGHT);
		cellTexture = createDataTexture(cellData, CL_TEX_CLUSTER, 1);
		lightIndexTexture = createDataTexture(lightIndexData, CL_IDX_TEX_W, CL_IDX_TEX_H);
		patch.bindTextures({ lightTexture, cellTexture, lightIndexTexture });
	}

	function recordAt(index) {
		if (!recordPool[index]) recordPool[index] = createClusterLightRecord();
		return recordPool[index];
	}

	function writeViewDirection(record, worldX, worldY, worldZ, viewElements) {
		const length = Math.sqrt(worldX * worldX + worldY * worldY + worldZ * worldZ);
		if (!(length > 0)) {
			record.directionX = 0;
			record.directionY = 0;
			record.directionZ = -1;
			return;
		}
		const x = worldX / length;
		const y = worldY / length;
		const z = worldZ / length;

		record.directionX = viewElements[0] * x + viewElements[4] * y + viewElements[8] * z;
		record.directionY = viewElements[1] * x + viewElements[5] * y + viewElements[9] * z;
		record.directionZ = viewElements[2] * x + viewElements[6] * y + viewElements[10] * z;
	}

	function collectRecords(lights, camera) {
		const viewElements = camera.matrixWorldInverse.elements;


		const infiniteRange = Number.isFinite(camera.far) && camera.far > 0 ? camera.far : 0;
		shadableRecords.length = 0;
		if (!lights) return 0;
		let index = 0;
		for (const light of lights) {
			if (index === MAX_CLUSTER_SHADED_LIGHTS) break;
			if (!light || light.visible === false || !light.matrixWorld) continue;
			const isSpot = light.isSpotLight === true;
			const isPoint = light.isPointLight === true;
			if (!isSpot && !isPoint) continue;
			const intensity = Number(light.intensity) || 0;
			if (!(intensity > 0)) continue;
			const distance = Number(light.distance) || 0;
			const range = distance > 0 ? distance : infiniteRange;
			if (!(range > 0)) continue;

			const world = light.matrixWorld.elements;
			const worldX = world[12];
			const worldY = world[13];
			const worldZ = world[14];
			const record = recordAt(index);
			record.key = light.uuid || "";
			record.kind = isSpot ? SPOT_LIGHT_KIND : POINT_LIGHT_KIND;
			record.x = worldX;
			record.y = worldY;
			record.z = worldZ;
			record.range = range;
			record.intensity = intensity;
			record.r = light.color ? light.color.r : 1;
			record.g = light.color ? light.color.g : 1;
			record.b = light.color ? light.color.b : 1;
			record.viewX = viewElements[0] * worldX + viewElements[4] * worldY + viewElements[8] * worldZ + viewElements[12];
			record.viewY = viewElements[1] * worldX + viewElements[5] * worldY + viewElements[9] * worldZ + viewElements[13];
			record.viewZ = viewElements[2] * worldX + viewElements[6] * worldY + viewElements[10] * worldZ + viewElements[14];
			record.colorR = record.r * intensity;
			record.colorG = record.g * intensity;
			record.colorB = record.b * intensity;
			record.decay = Number.isFinite(light.decay) ? light.decay : DEFAULT_LIGHT_DECAY;
			record.atlasSlot = NO_ATLAS_SLOT;
			record.sourceRadius = 0;

			if (isSpot) {


				const target = light.target && light.target.matrixWorld ? light.target.matrixWorld.elements : null;
				const targetX = target ? target[12] : worldX;
				const targetY = target ? target[13] : worldY - 1;
				const targetZ = target ? target[14] : worldZ;
				writeViewDirection(record, worldX - targetX, worldY - targetY, worldZ - targetZ, viewElements);
				const coneAngle = Number.isFinite(light.angle) ? light.angle : 0;
				const penumbra = Math.min(1, Math.max(0, Number(light.penumbra) || 0));
				record.coneCosine = Math.cos(coneAngle);
				record.penumbraCosine = Math.cos(coneAngle * (1 - penumbra));
			} else {
				record.directionX = 0;
				record.directionY = 0;
				record.directionZ = -1;
				record.coneCosine = -1;
				record.penumbraCosine = -1;
			}

			shadableRecords.push(record);
			index++;
		}
		return shadableRecords.length;
	}

	function publishPlan(plan) {
		lastPlan = plan;
		llQa.setPhase(CLUSTER_SHADING_PHASE_ID, {
			clusterFeedActive: plan.active,
			clusterFeedLights: plan.lights,
			clusterFeedSkipped: plan.skipped,
			clusterFeedIndexEntries: plan.indexEntries,
			clusterFeedReason: plan.reason,
		});
		return plan;
	}

	function stepAside(patch, reason) {
		shadableRecords.length = 0;
		if (patch) patch.disable(reason);
		return publishPlan(emptyPlan(reason));
	}

	return {
		phaseId: CLUSTER_SHADING_PHASE_ID,


		planFrame(options) {
			const frame = options && typeof options === "object" ? options : {};
			const patch = frame.patch;
			if (!patch) return publishPlan(emptyPlan(CLUSTER_FEED_REASONS.reset));
			if (!isLocalLightTechnology(frame.technology)) return stepAside(patch, CLUSTER_FEED_REASONS.technologyGate);
			if (isLocalLightBaselineFrozen(frame.tier)) return stepAside(patch, CLUSTER_FEED_REASONS.baselineFrozen);
			if (!isLocalLightFlagActive(CLUSTER_SHADING_FLAG_ID, frame.tier)) {
				return stepAside(patch, CLUSTER_FEED_REASONS.flagOff);
			}
			const camera = frame.camera;
			if (!camera || !camera.projectionMatrix || !camera.matrixWorldInverse) {
				return stepAside(patch, CLUSTER_FEED_REASONS.noCamera);
			}
			const projection = camera.projectionMatrix.elements;


			if (projection[15] !== 0) return stepAside(patch, CLUSTER_FEED_REASONS.notPerspective);

			const collected = collectRecords(frame.lights, camera);
			if (collected === 0) return stepAside(patch, CLUSTER_FEED_REASONS.noLight);

			const packed = packClusterLightData({
				records: shadableRecords,
				recordCount: collected,
				target: lightData,
				maxLights: MAX_CLUSTER_SHADED_LIGHTS,
			});
			if (packed.count === 0) return stepAside(patch, CLUSTER_FEED_REASONS.noLight);


			const cells = packClusterBuffers(
				shadableRecords,
				camera.matrixWorldInverse.elements,
				projection[0],
				projection[5],
				camera.near,
				camera.far,
				cellData,
				lightIndexData,
				packed.count,
			);

			ensureTextures(patch);
			lightTexture.needsUpdate = true;
			cellTexture.needsUpdate = true;
			lightIndexTexture.needsUpdate = true;
			patch.publishFrame({
				lightCount: packed.count,
				near: camera.near,
				far: camera.far,
				projectionScaleX: projection[0],
				projectionScaleY: projection[5],
			});

			return publishPlan({
				active: true,
				lights: packed.count,
				skipped: packed.skipped,
				cellLights: cells.count,
				indexEntries: cells.totalIdx,
				reason: "",
			});
		},


		reset(patch, reason) {
			return stepAside(patch, reason || CLUSTER_FEED_REASONS.reset);
		},


		dispose(patch) {
			if (lightTexture) lightTexture.dispose();
			if (cellTexture) cellTexture.dispose();
			if (lightIndexTexture) lightIndexTexture.dispose();
			lightTexture = null;
			cellTexture = null;
			lightIndexTexture = null;
			if (patch) patch.bindTextures({});
			return stepAside(patch, CLUSTER_FEED_REASONS.reset);
		},

		lastPlan: () => lastPlan,
		texturesReady: () => !!lightTexture,
	};
}
