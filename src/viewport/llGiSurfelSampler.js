export const DEFAULT_SAMPLES_PER_MESH = 12;

export const PROXY_SAMPLES_PER_MESH = 1;
export const MIN_SURFEL_AREA = 1e-4;
export const MAX_SAMPLES_PER_MESH = 64;

export const MAX_SCANNED_TRIANGLES = 4096;

export const MIN_TRIANGLE_AREA = 1e-9;

export const LIGHT_PROXY_USER_DATA_KEY = "llProxy";

const HALTON_BASE_FOR_FIRST_WEIGHT = 2;
const HALTON_BASE_FOR_SECOND_WEIGHT = 3;


function radicalInverse(index, base) {
	let result = 0;
	let denominator = 1;
	let remaining = Math.floor(index);
	while (remaining > 0) {
		denominator *= base;
		result += (remaining % base) / denominator;
		remaining = Math.floor(remaining / base);
	}
	return result;
}


function triangleSlotAtArea(cumulativeArea, targetArea) {
	let low = 0;
	let high = cumulativeArea.length - 1;
	while (low < high) {
		const middle = (low + high) >> 1;
		if (cumulativeArea[middle] < targetArea) low = middle + 1;
		else high = middle;
	}
	return low;
}

function firstMaterialOf(mesh) {
	return Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
}

function albedoOf(material) {
	if (!material || !material.color) return [1, 1, 1];
	const metalness = Number(material.metalness);


	const diffuseShare = Number.isFinite(metalness) ? Math.max(1 - metalness, 0) : 1;
	return [material.color.r * diffuseShare, material.color.g * diffuseShare, material.color.b * diffuseShare];
}

function emissiveStrengthOf(material) {
	if (!material || !material.emissive) return 0;
	const intensity = Number.isFinite(Number(material.emissiveIntensity)) ? Number(material.emissiveIntensity) : 1;
	const luminance = 0.2126 * material.emissive.r + 0.7152 * material.emissive.g + 0.0722 * material.emissive.b;
	return Math.max(luminance * intensity, 0);
}

function clampSampleCount(value, fallback) {
	const asInteger = Math.floor(Number(value));
	if (!Number.isFinite(asInteger)) return fallback;
	return Math.min(Math.max(asInteger, 0), MAX_SAMPLES_PER_MESH);
}

function emptyBounds() {
	return { min: [0, 0, 0], max: [0, 0, 0], empty: true };
}


export function createGiSurfelSampler(options) {
	const settings = options && typeof options === "object" ? options : {};
	const THREE = settings.THREE;
	if (!THREE) throw new Error("createGiSurfelSampler: THREE is required");


	const firstCorner = new THREE.Vector3();
	const secondCorner = new THREE.Vector3();
	const thirdCorner = new THREE.Vector3();
	const firstEdge = new THREE.Vector3();
	const secondEdge = new THREE.Vector3();
	const edgeCrossProduct = new THREE.Vector3();
	const firstCornerNormal = new THREE.Vector3();
	const secondCornerNormal = new THREE.Vector3();
	const thirdCornerNormal = new THREE.Vector3();
	const sampleWorldPosition = new THREE.Vector3();
	const sampleWorldNormal = new THREE.Vector3();
	const worldNormalMatrix = new THREE.Matrix3();

	function readWorldCorner(target, positionAttribute, matrixWorld, vertexIndex) {
		return target.fromBufferAttribute(positionAttribute, vertexIndex).applyMatrix4(matrixWorld);
	}

	function worldTriangleArea(positionAttribute, matrixWorld, firstIndex, secondIndex, thirdIndex) {
		readWorldCorner(firstCorner, positionAttribute, matrixWorld, firstIndex);
		readWorldCorner(secondCorner, positionAttribute, matrixWorld, secondIndex);
		readWorldCorner(thirdCorner, positionAttribute, matrixWorld, thirdIndex);
		firstEdge.subVectors(secondCorner, firstCorner);
		secondEdge.subVectors(thirdCorner, firstCorner);
		edgeCrossProduct.crossVectors(firstEdge, secondEdge);
		return edgeCrossProduct.length() * 0.5;
	}


	function collectWorldTriangles(mesh) {
		const geometry = mesh.geometry;
		const positionAttribute = geometry.attributes.position;
		const indexAttribute = geometry.index;
		const totalTriangles = indexAttribute
			? Math.floor(indexAttribute.count / 3)
			: Math.floor(positionAttribute.count / 3);
		if (totalTriangles === 0) return null;

		const stride = Math.max(1, Math.ceil(totalTriangles / MAX_SCANNED_TRIANGLES));
		const cornerIndices = [];
		const cumulativeArea = [];
		let scannedArea = 0;
		let scannedTriangles = 0;

		for (let triangle = 0; triangle < totalTriangles; triangle += stride) {
			const firstCornerSlot = triangle * 3;
			const firstIndex = indexAttribute ? indexAttribute.getX(firstCornerSlot) : firstCornerSlot;
			const secondIndex = indexAttribute ? indexAttribute.getX(firstCornerSlot + 1) : firstCornerSlot + 1;
			const thirdIndex = indexAttribute ? indexAttribute.getX(firstCornerSlot + 2) : firstCornerSlot + 2;
			const area = worldTriangleArea(positionAttribute, mesh.matrixWorld, firstIndex, secondIndex, thirdIndex);
			if (!(area > MIN_TRIANGLE_AREA)) continue;
			scannedArea += area;
			scannedTriangles += 1;
			cornerIndices.push(firstIndex, secondIndex, thirdIndex);
			cumulativeArea.push(scannedArea);
		}
		if (scannedTriangles === 0) return null;

		return {
			cornerIndices,
			cumulativeArea,
			scannedArea,

			estimatedSurfaceArea: stride === 1 ? scannedArea : scannedArea * stride,
			scannedTriangles,
			totalTriangles,
			stride,
		};
	}

	return {


		sampleScene(scene, sampleOptions) {
			const frame = sampleOptions && typeof sampleOptions === "object" ? sampleOptions : {};
			const samplesPerMesh = clampSampleCount(frame.samplesPerMesh, DEFAULT_SAMPLES_PER_MESH);
			const surfels = [];
			const stats = {
				meshes: 0,
				sampledMeshes: 0,
				surfels: 0,
				proxies: 0,
				skippedInstanced: 0,
				skippedWithoutNormals: 0,
				skippedWithoutTriangles: 0,
				stridedMeshes: 0,
				trianglesScanned: 0,
				sampledArea: 0,
				samplesPerMesh,
			};
			const minimum = [Infinity, Infinity, Infinity];
			const maximum = [-Infinity, -Infinity, -Infinity];


			if (!scene || samplesPerMesh === 0) {
				return { surfels, bounds: emptyBounds(), stats };
			}

			scene.updateMatrixWorld();
			scene.traverseVisible((object) => {
				if (object.isMesh !== true) return;
				stats.meshes += 1;
				if (object.isInstancedMesh === true) {
					stats.skippedInstanced += 1;
					return;
				}
				const geometry = object.geometry;
				const positionAttribute = geometry && geometry.attributes ? geometry.attributes.position : null;
				const normalAttribute = geometry && geometry.attributes ? geometry.attributes.normal : null;
				if (!positionAttribute || !positionAttribute.count) return;
				if (!normalAttribute || !normalAttribute.count) {
					stats.skippedWithoutNormals += 1;
					return;
				}

				const triangles = collectWorldTriangles(object);
				if (!triangles) {
					stats.skippedWithoutTriangles += 1;
					return;
				}

				const isLightProxy = !!(object.userData && object.userData[LIGHT_PROXY_USER_DATA_KEY] === true);
				const wantedSamples = isLightProxy ? PROXY_SAMPLES_PER_MESH : samplesPerMesh;
				const material = firstMaterialOf(object);
				const albedo = albedoOf(material);
				const emissiveStrength = emissiveStrengthOf(material);
				worldNormalMatrix.getNormalMatrix(object.matrixWorld);
				const meshName = object.name || object.uuid;

				const sampledPositions = [];
				const sampledNormals = [];
				for (let sampleIndex = 0; sampleIndex < wantedSamples; sampleIndex += 1) {


					const stratifiedArea = ((sampleIndex + 0.5) / wantedSamples) * triangles.scannedArea;
					const triangleSlot = triangleSlotAtArea(triangles.cumulativeArea, stratifiedArea);
					const cornerSlot = triangleSlot * 3;
					const firstIndex = triangles.cornerIndices[cornerSlot];
					const secondIndex = triangles.cornerIndices[cornerSlot + 1];
					const thirdIndex = triangles.cornerIndices[cornerSlot + 2];


					let firstWeight = radicalInverse(sampleIndex + 1, HALTON_BASE_FOR_FIRST_WEIGHT);
					let secondWeight = radicalInverse(sampleIndex + 1, HALTON_BASE_FOR_SECOND_WEIGHT);
					if (firstWeight + secondWeight > 1) {
						firstWeight = 1 - firstWeight;
						secondWeight = 1 - secondWeight;
					}
					const thirdWeight = 1 - firstWeight - secondWeight;

					readWorldCorner(firstCorner, positionAttribute, object.matrixWorld, firstIndex);
					readWorldCorner(secondCorner, positionAttribute, object.matrixWorld, secondIndex);
					readWorldCorner(thirdCorner, positionAttribute, object.matrixWorld, thirdIndex);
					sampleWorldPosition
						.set(0, 0, 0)
						.addScaledVector(firstCorner, thirdWeight)
						.addScaledVector(secondCorner, firstWeight)
						.addScaledVector(thirdCorner, secondWeight);

					firstCornerNormal.fromBufferAttribute(normalAttribute, firstIndex);
					secondCornerNormal.fromBufferAttribute(normalAttribute, secondIndex);
					thirdCornerNormal.fromBufferAttribute(normalAttribute, thirdIndex);
					sampleWorldNormal
						.set(0, 0, 0)
						.addScaledVector(firstCornerNormal, thirdWeight)
						.addScaledVector(secondCornerNormal, firstWeight)
						.addScaledVector(thirdCornerNormal, secondWeight)
						.applyMatrix3(worldNormalMatrix);
					if (sampleWorldNormal.lengthSq() <= 0) continue;
					sampleWorldNormal.normalize();

					sampledPositions.push([sampleWorldPosition.x, sampleWorldPosition.y, sampleWorldPosition.z]);
					sampledNormals.push([sampleWorldNormal.x, sampleWorldNormal.y, sampleWorldNormal.z]);
				}

				const takenSamples = sampledPositions.length;
				if (takenSamples === 0) return;

				const surfelArea = Math.max(triangles.estimatedSurfaceArea / takenSamples, MIN_SURFEL_AREA);
				for (let sampleIndex = 0; sampleIndex !== takenSamples; sampleIndex += 1) {
					const position = sampledPositions[sampleIndex];
					surfels.push({
						key: meshName + "#" + sampleIndex,
						position,
						normal: sampledNormals[sampleIndex],
						area: surfelArea,
						albedo,
						isLightProxy,
						emissiveStrength,
						mesh: meshName,
					});
					for (let axis = 0; axis !== 3; axis += 1) {
						if (position[axis] < minimum[axis]) minimum[axis] = position[axis];
						if (position[axis] > maximum[axis]) maximum[axis] = position[axis];
					}
				}
				stats.sampledMeshes += 1;
				stats.surfels += takenSamples;
				stats.sampledArea += surfelArea * takenSamples;
				stats.trianglesScanned += triangles.scannedTriangles;
				if (triangles.stride > 1) stats.stridedMeshes += 1;
				if (isLightProxy) stats.proxies += 1;
			});

			const empty = surfels.length === 0;
			return {
				surfels,
				bounds: empty ? emptyBounds() : { min: minimum, max: maximum, empty: false },
				stats,
			};
		},
	};
}
