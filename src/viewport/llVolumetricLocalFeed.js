import { ATLAS_META_ROW_BASE } from "../lighting/llShadowGateCore.js";
import {
	LOCAL_VOLUMETRIC_FLAG_ID,
	LOCAL_VOLUMETRIC_MAX_LIGHTS,
	LOCAL_VOLUMETRIC_NO_ATLAS_ROW,
	LOCAL_VOLUMETRIC_PHASE_ID,
} from "../lighting/llVolumetricLocalContract.js";
import { resolveVolumetricLight } from "../lighting/llVolumetricLocalCore.js";
import { planLocalVolumetricBudget } from "../lighting/llVolumetricLocalBudgetCore.js";
import { llQa } from "../lighting/llTelemetry.js";

const SPOT_LIGHT_KIND = "SpotLight";


export function createLocalVolumetricFeed(options) {
	const settings = options && typeof options === "object" ? options : {};
	const logger = settings.logger && typeof settings.logger.warn === "function" ? settings.logger : null;

	const cameraScratch = { position: { x: 0, y: 0, z: 0 }, forward: { x: 0, y: 0, z: -1 } };
	const candidateBuffer = [];
	const atlasRowByLightId = new Map();

	let lastPlan = null;


	function indexAtlasRows(rankedSpotLights) {
		atlasRowByLightId.clear();
		if (!Array.isArray(rankedSpotLights)) return;
		for (let rank = 0; rank < rankedSpotLights.length; rank++) {
			const spot = rankedSpotLights[rank];
			if (!spot || spot.id === undefined || spot.id === null) continue;
			atlasRowByLightId.set(spot.id, ATLAS_META_ROW_BASE.spotFrustum + rank);
		}
	}

	function atlasRowOf(lightId) {
		if (lightId === undefined || lightId === null) return LOCAL_VOLUMETRIC_NO_ATLAS_ROW;
		const row = atlasRowByLightId.get(lightId);
		return row === undefined ? LOCAL_VOLUMETRIC_NO_ATLAS_ROW : row;
	}



	function coneAxisOf(threeLight) {
		const target = threeLight.target;
		if (!target || !target.matrixWorld) return [0, -1, 0];
		const lightMatrix = threeLight.matrixWorld.elements;
		const targetMatrix = target.matrixWorld.elements;
		const axisX = targetMatrix[12] - lightMatrix[12];
		const axisY = targetMatrix[13] - lightMatrix[13];
		const axisZ = targetMatrix[14] - lightMatrix[14];
		const length = Math.sqrt(axisX * axisX + axisY * axisY + axisZ * axisZ);
		if (!(length > 0)) return [0, -1, 0];
		return [axisX / length, axisY / length, axisZ / length];
	}

	return {
		phaseId: LOCAL_VOLUMETRIC_PHASE_ID,


		flagId: LOCAL_VOLUMETRIC_FLAG_ID,
		maxLights: LOCAL_VOLUMETRIC_MAX_LIGHTS,


		planFrame(input) {
			const frame = input && typeof input === "object" ? input : {};
			const extension = frame.extension;
			if (!extension || typeof extension.isActive !== "function") {
				lastPlan = null;
				return null;
			}
			if (extension.isActive({ tier: frame.tier, technology: frame.technology }) !== true) {
				lastPlan = null;
				return null;
			}

			indexAtlasRows(frame.rankedSpotLights);
			candidateBuffer.length = 0;
			const lights = frame.lights;
			if (lights && typeof lights[Symbol.iterator] === "function") {
				for (const entry of lights) {
					const threeLight = entry && entry.light;
					if (!threeLight || threeLight.visible === false) continue;
					const properties = entry.props || null;
					const lightMatrix = threeLight.matrixWorld.elements;
					const isSpot = entry.kind === SPOT_LIGHT_KIND;
					candidateBuffer.push(
						resolveVolumetricLight({
							name: entry.id !== undefined && entry.id !== null ? String(entry.id) : threeLight.uuid,
							type: entry.kind,
							worldPosition: [lightMatrix[12], lightMatrix[13], lightMatrix[14]],
							coneAxis: isSpot ? coneAxisOf(threeLight) : null,
							range: properties && Number.isFinite(properties.range)
								? properties.range
								: Number(threeLight.distance) || 0,
							color: {
								red: threeLight.color ? threeLight.color.r : 1,
								green: threeLight.color ? threeLight.color.g : 1,
								blue: threeLight.color ? threeLight.color.b : 1,
							},
							intensity: Number(threeLight.intensity) || 0,
							scatteringIntensity: properties ? properties.volumetricScatteringIntensity : undefined,
							cone: isSpot && properties && properties.cone ? properties.cone : null,
							coneAngleDeg: properties ? properties.coneAngleDeg : undefined,
							atlasMetaRow: isSpot ? atlasRowOf(entry.id) : LOCAL_VOLUMETRIC_NO_ATLAS_ROW,
						}),
					);
				}
			}

			const camera = frame.camera;
			if (camera && camera.matrixWorld) {
				const cameraMatrix = camera.matrixWorld.elements;
				cameraScratch.position.x = cameraMatrix[12];
				cameraScratch.position.y = cameraMatrix[13];
				cameraScratch.position.z = cameraMatrix[14];

				cameraScratch.forward.x = -cameraMatrix[8];
				cameraScratch.forward.y = -cameraMatrix[9];
				cameraScratch.forward.z = -cameraMatrix[10];
			}

			const plan = planLocalVolumetricBudget({
				lights: candidateBuffer,
				camera: camera ? cameraScratch : null,
				viewDistance: frame.viewDistance,
				tier: frame.tier,
			});
			if (plan.refused.length > 0) {
				llQa.setPhase(LOCAL_VOLUMETRIC_PHASE_ID, { refusedLights: plan.refused.length });
				if (logger && plan.selectedCount === 0 && candidateBuffer.length > 0) {
					logger.warn(
						"[Luzes locais] LL-F17: nenhuma luz marchou (" + plan.refused[0].refusal + ")",
					);
				}
			}
			lastPlan = plan;
			return plan;
		},


		reset(extension) {
			lastPlan = null;
			atlasRowByLightId.clear();
			if (extension && typeof extension.reset === "function") extension.reset();
			return true;
		},

		lastPlan() {
			return lastPlan;
		},

		stats() {
			return {
				phase: LOCAL_VOLUMETRIC_PHASE_ID,
				maxLights: LOCAL_VOLUMETRIC_MAX_LIGHTS,
				candidates: candidateBuffer.length,
				marchingLights: lastPlan ? lastPlan.selectedCount : 0,
				refusedLights: lastPlan ? lastPlan.refused.length : 0,
				stepCount: lastPlan ? lastPlan.stepCount : 0,
				indexedAtlasRows: atlasRowByLightId.size,
			};
		},
	};
}
