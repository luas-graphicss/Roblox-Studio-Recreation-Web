import {
	TRANSMITTER_BOX_SLOTS,
	TRANSMISSION_PHASE_ID,
} from "../lighting/llTransmissionContract.js";
import { collectTransmitterBoxes } from "../lighting/llTransmissionLocalCore.js";
import { resolveSubsurfaceMaterial } from "../lighting/llLocalSubsurfaceCore.js";
import { llQa } from "../lighting/llTelemetry.js";
import { ATLAS_UNIFORMS } from "./llShadowGatePatch.js";

const VEC4_LENGTH = 4;


export const TRANSMITTER_SUPPRESSED_USER_DATA_KEY = "__llTransmissionSuppressedCastShadow";


function threeObjectOf(entry) {
	if (!entry) return null;
	if (entry.isObject3D === true) return entry;
	if (entry.mesh && entry.mesh.isObject3D === true) return entry.mesh;
	if (entry.object && entry.object.isObject3D === true) return entry.object;
	return null;
}


function entriesOf(meshes) {
	if (!meshes) return [];
	if (typeof meshes.values === "function") return Array.from(meshes.values());
	return Array.isArray(meshes) ? meshes : [];
}

function firstMaterialOf(object) {
	const material = object.material;
	if (!material) return null;
	return Array.isArray(material) ? material[0] || null : material;
}

function colorTripletOf(material) {
	const color = material && material.color;
	if (!color || !Number.isFinite(color.r)) return [1, 1, 1];
	return [color.r, color.g, color.b];
}


export function createTransmissionFeed(options) {
	const settings = options && typeof options === "object" ? options : {};
	const THREE = settings.THREE;
	const registry = settings.registry;
	if (!THREE || !registry || typeof registry.setUniformValue !== "function") {
		throw new Error("createTransmissionFeed: THREE and a local-light patch registry are required");
	}
	const logger = settings.logger && typeof settings.logger.warn === "function" ? settings.logger : null;


	const transmitterMin = new Float32Array(TRANSMITTER_BOX_SLOTS * VEC4_LENGTH);
	const transmitterMax = new Float32Array(TRANSMITTER_BOX_SLOTS * VEC4_LENGTH);
	const transmitterTint = new Float32Array(TRANSMITTER_BOX_SLOTS * VEC4_LENGTH);

	const worldBox = new THREE.Box3();
	const suppressedCasters = new Map();
	const candidateBuffer = [];

	let lastPlan = null;
	let lastUploadedCount = 0;

	function restoreCastShadow(object) {
		if (!suppressedCasters.has(object)) return;
		object.castShadow = suppressedCasters.get(object);
		if (object.userData) delete object.userData[TRANSMITTER_SUPPRESSED_USER_DATA_KEY];
		suppressedCasters.delete(object);
	}

	function restoreAllCastShadows() {
		Array.from(suppressedCasters.keys()).forEach(restoreCastShadow);
	}

	function suppressCastShadow(object) {
		if (suppressedCasters.has(object)) return;
		suppressedCasters.set(object, object.castShadow === true);
		object.castShadow = false;
		if (object.userData) object.userData[TRANSMITTER_SUPPRESSED_USER_DATA_KEY] = true;
	}


	function collectCandidates(meshes) {
		candidateBuffer.length = 0;
		const entries = entriesOf(meshes);
		for (let index = 0; index < entries.length; index++) {
			const object = threeObjectOf(entries[index]);
			if (!object || object.visible === false) continue;
			const material = firstMaterialOf(object);
			if (!material) continue;
			const isTransmissive = Number(material.transmission) > 0 || material.transparent === true;
			if (!isTransmissive) continue;
			worldBox.setFromObject(object);
			if (worldBox.isEmpty()) continue;
			candidateBuffer.push({
				name: object.uuid,
				object,
				color: colorTripletOf(material),
				transmission: Number(material.transmission) || 0,
				opacity: Number.isFinite(material.opacity) ? material.opacity : 1,
				transparent: material.transparent === true,
				box: {
					minX: worldBox.min.x, minY: worldBox.min.y, minZ: worldBox.min.z,
					maxX: worldBox.max.x, maxY: worldBox.max.y, maxZ: worldBox.max.z,
				},
			});
		}
		return candidateBuffer;
	}

	function packBoxes(boxes) {
		transmitterMin.fill(0);
		transmitterMax.fill(0);
		transmitterTint.fill(0);
		const used = Math.min(boxes.length, TRANSMITTER_BOX_SLOTS);
		for (let index = 0; index < used; index++) {
			const box = boxes[index];
			const base = index * VEC4_LENGTH;
			transmitterMin[base] = box.minX;
			transmitterMin[base + 1] = box.minY;
			transmitterMin[base + 2] = box.minZ;
			transmitterMax[base] = box.maxX;
			transmitterMax[base + 1] = box.maxY;
			transmitterMax[base + 2] = box.maxZ;
			transmitterTint[base] = box.r;
			transmitterTint[base + 1] = box.g;
			transmitterTint[base + 2] = box.b;
			transmitterTint[base + 3] = 1;
		}
		return used;
	}

	function uploadBoxes(count) {
		registry.setUniformValue(ATLAS_UNIFORMS.transmitterMin, transmitterMin);
		registry.setUniformValue(ATLAS_UNIFORMS.transmitterMax, transmitterMax);
		registry.setUniformValue(ATLAS_UNIFORMS.transmitterTint, transmitterTint);
		registry.setUniformValue(ATLAS_UNIFORMS.transmitterCount, count);
		lastUploadedCount = count;
	}


	function clearBoxes(patch) {
		restoreAllCastShadows();
		if (lastUploadedCount !== 0) uploadBoxes(0);
		if (patch && typeof patch.clearMix === "function") patch.clearMix();
		lastPlan = null;
	}

	return {
		phaseId: TRANSMISSION_PHASE_ID,
		slotCount: TRANSMITTER_BOX_SLOTS,
		textureUnits: 0,


		planFrame(input) {
			const frame = input && typeof input === "object" ? input : {};
			const patch = frame.patch;
			if (!patch || typeof patch.isActive !== "function") {
				clearBoxes(patch);
				return null;
			}
			if (patch.isActive({ tier: frame.tier, technology: frame.technology }) !== true) {
				clearBoxes(patch);
				return null;
			}

			const candidates = collectCandidates(frame.meshes);
			const plan = collectTransmitterBoxes({
				candidates,
				slotCount: TRANSMITTER_BOX_SLOTS,
				cameraPosition: frame.cameraPosition || null,
			});


			const subsurface = patch.writeSubsurfaceMaterial({ tier: frame.tier });

			if (plan.accepted.length === 0) {
				restoreAllCastShadows();
				if (lastUploadedCount !== 0) uploadBoxes(0);
				patch.writeMix({ tintMix: 0, subsurfaceMix: subsurface.enabled ? 1 : 0 });
				lastPlan = plan;
				return plan;
			}

			const acceptedObjects = new Set();
			plan.accepted.forEach((entry) => {
				if (!entry.object) return;
				acceptedObjects.add(entry.object);
				suppressCastShadow(entry.object);
			});

			Array.from(suppressedCasters.keys()).forEach((object) => {
				if (!acceptedObjects.has(object)) restoreCastShadow(object);
			});

			uploadBoxes(packBoxes(plan.boxes));
			patch.writeMix({ tintMix: 1, subsurfaceMix: subsurface.enabled ? 1 : 0 });
			if (plan.refusals.length > 0 && logger) {
				llQa.setPhase(TRANSMISSION_PHASE_ID, { refusedTransmitters: plan.refusals.length });
			}
			lastPlan = plan;
			return plan;
		},


		reset(patch) {
			clearBoxes(patch);
			return true;
		},

		lastPlan() {
			return lastPlan;
		},

		stats() {
			const resolved = resolveSubsurfaceMaterial({});
			return {
				phase: TRANSMISSION_PHASE_ID,
				slotCount: TRANSMITTER_BOX_SLOTS,
				uploadedBoxes: lastUploadedCount,
				suppressedCasters: suppressedCasters.size,
				acceptedTransmitters: lastPlan ? lastPlan.accepted.length : 0,
				refusedTransmitters: lastPlan ? lastPlan.refusals.length : 0,
				defaultSubsurfaceThicknessStuds: resolved.thicknessStuds,
			};
		},
	};
}
