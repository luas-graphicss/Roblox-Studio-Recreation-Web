import * as THREE from "three";
import { LIGHT_PROXY_LAYER } from "../lighting/llLightProxyContract.js";
import { LIGHT_PROXY_SHAPE } from "../lighting/llLightProxyMeshCore.js";

const SPHERE_WIDTH_SEGMENTS = 16;
const SPHERE_HEIGHT_SEGMENTS = 12;
const CAPSULE_CAP_SEGMENTS = 6;
const CAPSULE_RADIAL_SEGMENTS = 12;


const SIGNATURE_PRECISION = 1000;

function roundForSignature(value) {
	return Math.round((Number(value) || 0) * SIGNATURE_PRECISION) / SIGNATURE_PRECISION;
}

function geometrySignatureOf(shape, dimensions) {
	const size = dimensions && typeof dimensions === "object" ? dimensions : {};
	return [
		String(shape),
		roundForSignature(size.width),
		roundForSignature(size.height),
		roundForSignature(size.radius),
		roundForSignature(size.length),
	].join(":");
}

function buildGeometryFor(shape, dimensions) {
	const size = dimensions && typeof dimensions === "object" ? dimensions : {};
	if (shape === LIGHT_PROXY_SHAPE.RECTANGLE) {
		return new THREE.PlaneGeometry(
			Math.max(Number(size.width) || 0, 0),
			Math.max(Number(size.height) || 0, 0),
		);
	}
	if (shape === LIGHT_PROXY_SHAPE.CAPSULE) {
		return new THREE.CapsuleGeometry(
			Math.max(Number(size.radius) || 0, 0),
			Math.max(Number(size.length) || 0, 0),
			CAPSULE_CAP_SEGMENTS,
			CAPSULE_RADIAL_SEGMENTS,
		);
	}
	return new THREE.SphereGeometry(
		Math.max(Number(size.radius) || 0, 0),
		SPHERE_WIDTH_SEGMENTS,
		SPHERE_HEIGHT_SEGMENTS,
	);
}




export function createLightProxySourceMeshPool(options) {
	const settings = options && typeof options === "object" ? options : {};
	let scene = settings.scene || null;


	const entriesByKey = new Map();
	const worldPosition = new THREE.Vector3();
	const worldQuaternion = new THREE.Quaternion();
	const worldScale = new THREE.Vector3();
	const faceQuaternion = new THREE.Quaternion();

	function disposeEntry(entry) {
		if (!entry || !entry.mesh) return;
		if (entry.mesh.parent) entry.mesh.parent.remove(entry.mesh);
		if (entry.mesh.geometry) entry.mesh.geometry.dispose();
		if (entry.mesh.material) entry.mesh.material.dispose();
	}

	function ensureEntry(key, shape, dimensions) {
		const signature = geometrySignatureOf(shape, dimensions);
		const existing = entriesByKey.get(key);
		if (existing) {
			if (existing.signature !== signature) {


				existing.mesh.geometry.dispose();
				existing.mesh.geometry = buildGeometryFor(shape, dimensions);
				existing.signature = signature;
			}
			if (scene && existing.mesh.parent !== scene) scene.add(existing.mesh);
			return existing;
		}
		const material = new THREE.MeshBasicMaterial({ toneMapped: false, fog: false });
		const mesh = new THREE.Mesh(buildGeometryFor(shape, dimensions), material);
		mesh.frustumCulled = false;

		mesh.layers.set(LIGHT_PROXY_LAYER);
		mesh.name = "llLightProxySource:" + key;
		if (scene) scene.add(mesh);
		const created = { mesh, signature, nits: 0 };
		entriesByKey.set(key, created);
		return created;
	}

	function poseMesh(mesh, source) {
		const worldMatrix = source.worldMatrix;
		if (worldMatrix && typeof worldMatrix.decompose === "function") {
			worldMatrix.decompose(worldPosition, worldQuaternion, worldScale);
			mesh.position.copy(worldPosition);
			mesh.quaternion.copy(worldQuaternion);
		}


		const rotation = source.faceRotation;
		if (rotation && rotation.length === 4) {
			faceQuaternion.set(rotation[0], rotation[1], rotation[2], rotation[3]);
			mesh.quaternion.multiply(faceQuaternion);
		}
	}

	return {

		useScene(nextScene) {
			if (nextScene === scene) return scene;
			if (scene) entriesByKey.forEach((entry) => scene.remove(entry.mesh));
			scene = nextScene || null;
			if (scene) entriesByKey.forEach((entry) => scene.add(entry.mesh));
			return scene;
		},


		sync(visibleSources) {
			const wanted = Array.isArray(visibleSources) ? visibleSources : [];
			const keptKeys = new Set();
			wanted.forEach((source) => {
				if (!source || source.key === undefined || source.key === null) return;
				const key = String(source.key);
				const entry = ensureEntry(key, source.shape, source.dimensions);
				poseMesh(entry.mesh, source);
				const nits = Math.max(Number(source.nits) || 0, 0);
				if (source.color) entry.mesh.material.color.copy(source.color).multiplyScalar(nits);
				entry.mesh.visible = nits > 0;
				entry.nits = nits;
				keptKeys.add(key);
			});
			entriesByKey.forEach((entry, key) => {
				if (keptKeys.has(key)) return;
				disposeEntry(entry);
				entriesByKey.delete(key);
			});
			return entriesByKey.size;
		},


		signature() {
			const parts = [];
			entriesByKey.forEach((entry, key) => {
				const mesh = entry.mesh;
				parts.push(
					[
						key,
						roundForSignature(entry.nits),
						roundForSignature(mesh.position.x),
						roundForSignature(mesh.position.y),
						roundForSignature(mesh.position.z),
						roundForSignature(mesh.quaternion.x),
						roundForSignature(mesh.quaternion.y),
						roundForSignature(mesh.quaternion.z),
						roundForSignature(mesh.quaternion.w),
					].join(":"),
				);
			});
			return parts.sort().join(";");
		},


		centroid() {
			if (entriesByKey.size === 0) return { x: 0, y: 0, z: 0 };
			let x = 0;
			let y = 0;
			let z = 0;
			entriesByKey.forEach((entry) => {
				x += entry.mesh.position.x;
				y += entry.mesh.position.y;
				z += entry.mesh.position.z;
			});
			return { x: x / entriesByKey.size, y: y / entriesByKey.size, z: z / entriesByKey.size };
		},

		describe() {
			const described = [];
			entriesByKey.forEach((entry, key) => {
				described.push({ key, nits: entry.nits, visible: entry.mesh.visible });
			});
			return described;
		},

		size() {
			return entriesByKey.size;
		},


		clear() {
			const removed = entriesByKey.size;
			entriesByKey.forEach((entry) => disposeEntry(entry));
			entriesByKey.clear();
			return removed;
		},
	};
}
