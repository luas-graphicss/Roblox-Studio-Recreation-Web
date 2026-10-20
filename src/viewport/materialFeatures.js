import {
	cacheKeySuffix,
	patchMatFeatFragment,
	uniformValuesFor,
} from "../lighting/materialFeaturesCore.js";
import { featuresForMaterial } from "../lighting/materialPhysicsTable.js";
import { isSubstrateSmShaderResponseOwned } from "./substrateSm/ssmShaderOwnership.js";


export function syncMatFeatUniforms(mat) {
	if (!mat || !mat.userData) return false;
	const uni = mat.userData.__rswMFUni;
	if (!uni || !uni.a || !uni.a.value || typeof uni.a.value.set !== "function") return false;
	const v = uniformValuesFor(featuresForMaterial(mat.userData.__rswMatName));
	uni.a.value.set(v.a[0], v.a[1], v.a[2], v.a[3]);
	uni.b.value.set(v.b[0], v.b[1], v.b[2], v.b[3]);
	uni.tint.value.set(v.tint[0], v.tint[1], v.tint[2]);
	return true;
}

export function createMaterialFeatures(opts) {
	const THREE = opts && opts.THREE;
	const supported = !!(THREE && THREE.Vector3 && THREE.Vector4);
	const shared = supported
		? {
				on: { value: 0 },
				sunDir: { value: new THREE.Vector3(0.3, 0.8, 0.5) },
				sunColor: { value: new THREE.Vector3(1, 1, 1) },
				amb: { value: 0.25 },
			}
		: null;
	let generation = 0;
	let patchedCompiles = 0;                                                 
	let patchedMaterials = 0;                                   
	let anchorMiss = 0;

	function setEnabled(on) {
		if (shared) shared.on.value = on ? 1 : 0;
	}
	function isEnabled() {
		return !!shared && shared.on.value === 1;
	}
	function setSunDirWorld(d) {
		if (!shared || !d) return;
		const x = Number.isFinite(d.x) ? d.x : 0;
		const y = Number.isFinite(d.y) ? d.y : 1;
		const z = Number.isFinite(d.z) ? d.z : 0;
		shared.sunDir.value.set(x, y, z);
		if (shared.sunDir.value.lengthSq() > 1e-8) shared.sunDir.value.normalize();
		else shared.sunDir.value.set(0, 1, 0);
	}
	function setSunColor(r, g, b) {
		if (!shared) return;
		shared.sunColor.value.set(
			Number.isFinite(r) ? Math.max(0, r) : 0,
			Number.isFinite(g) ? Math.max(0, g) : 0,
			Number.isFinite(b) ? Math.max(0, b) : 0
		);
	}
	function setAmbient(v) {
		if (shared) shared.amb.value = Number.isFinite(v) ? Math.max(0, v) : 0;
	}
	function bumpGeneration() {
		generation += 1;
	}

	function patchMaterial(mat) {
		if (!supported || !mat) return false;
		if (!(mat.isMeshPhongMaterial || mat.isMeshStandardMaterial)) return false;
		if (!mat.userData) mat.userData = {};
		const ud = mat.userData;
		if (ud.__rswMatFeat) {
			syncMatFeatUniforms(mat);
			return true;
		}
		ud.__rswMatFeat = true;
		const uni = {
			a: { value: new THREE.Vector4(0, 0.15, 0, 0.4) },
			b: { value: new THREE.Vector4(0, 0.4, 0, 0) },
			tint: { value: new THREE.Vector3(1, 1, 1) },
		};
		ud.__rswMFUni = uni;
		syncMatFeatUniforms(mat);
		const prevCompile = mat.onBeforeCompile;
		const prevKey = mat.customProgramCacheKey;
		mat.onBeforeCompile = function (shader, renderer) {
			if (typeof prevCompile === "function") prevCompile.call(this, shader, renderer);
			if (isSubstrateSmShaderResponseOwned(shader)) return;

			if (/^\s*#define\s+SB_REAL_CLOSURES\b/m.test(shader.fragmentShader)) return;
			const res = patchMatFeatFragment(shader.fragmentShader);
			if (!res.ok) {
				anchorMiss += 1;
				return;
			}
			shader.uniforms.uRswMFOn = shared.on;
			shader.uniforms.uRswMFSunDirW = shared.sunDir;
			shader.uniforms.uRswMFSunColor = shared.sunColor;
			shader.uniforms.uRswMFAmb = shared.amb;
			shader.uniforms.uRswMFA = uni.a;
			shader.uniforms.uRswMFB = uni.b;
			shader.uniforms.uRswMFTint = uni.tint;
			shader.fragmentShader = res.text;
			patchedCompiles += 1;
		};
		mat.customProgramCacheKey = function () {
			const base = typeof prevKey === "function" ? String(prevKey.call(this)) : "rswBase";
			return base + cacheKeySuffix(generation);
		};
		mat.needsUpdate = true;
		patchedMaterials += 1;
		return true;
	}

	function getDebugState() {
		return {
			on: isEnabled(),
			generation,
			patchedMaterials,
			patchedCompiles,
			anchorMiss,
		};
	}

	const api = {
		supported,
		patchMaterial,
		syncMatFeatUniforms,
		setEnabled,
		isEnabled,
		setSunDirWorld,
		setSunColor,
		setAmbient,
		bumpGeneration,
		getDebugState,
		dispose,
	};

	function dispose() {
		try {
			if (typeof window !== "undefined" && window.__rswMaterialFeatures && window.__rswMaterialFeatures.__owner === api) {
				delete window.__rswMaterialFeatures;
			}
		} catch (_e) {

		}
	}

	try {
		if (typeof window !== "undefined") {
			window.__rswMaterialFeatures = {
				get state() {
					return getDebugState();
				},
				__owner: api,
			};
		}
	} catch (_e) {

	}

	return api;
}
