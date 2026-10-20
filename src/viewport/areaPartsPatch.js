import { AP_MAX_LIGHTS, patchAreaPartsFragment } from "../lighting/areaPartsCore.js";

export function createAreaPartsPatch({ THREE }) {
	const supported = !!THREE;                                                   

	let enabled = false;
	let generation = 0;
	let patched = 0;                                                          
	let lights = 0;                                              

	const uniforms = {
		uRswApOn: { value: 0 },
		uRswApCount: { value: 0 },
		uRswApPos: { value: new Float32Array(4 * AP_MAX_LIGHTS) },
		uRswApRight: { value: new Float32Array(4 * AP_MAX_LIGHTS) },
		uRswApUp: { value: new Float32Array(4 * AP_MAX_LIGHTS) },
		uRswApColor: { value: new Float32Array(4 * AP_MAX_LIGHTS) },
		uRswApMisc: { value: new Float32Array(4 * AP_MAX_LIGHTS) },
	};

	function patchMaterial(mat) {
		if (!supported || !mat || !mat.isMeshPhongMaterial) return;
		const ud = mat.userData || (mat.userData = {});
		if (ud.__rswAreaPt) return;                              
		ud.__rswAreaPt = true;
		patched += 1;
		const prevCompile = mat.onBeforeCompile;
		const prevKey = mat.customProgramCacheKey;
		mat.onBeforeCompile = function (shader, renderer) {
			if (typeof prevCompile === "function") prevCompile.call(this, shader, renderer);
			const res = patchAreaPartsFragment(shader.fragmentShader);
			if (!res.ok) return;                                              
			shader.fragmentShader = res.text;
			shader.uniforms.uRswApOn = uniforms.uRswApOn;
			shader.uniforms.uRswApCount = uniforms.uRswApCount;
			shader.uniforms.uRswApPos = uniforms.uRswApPos;
			shader.uniforms.uRswApRight = uniforms.uRswApRight;
			shader.uniforms.uRswApUp = uniforms.uRswApUp;
			shader.uniforms.uRswApColor = uniforms.uRswApColor;
			shader.uniforms.uRswApMisc = uniforms.uRswApMisc;
		};
		mat.customProgramCacheKey = function () {
			const base = typeof prevKey === "function" ? String(prevKey.call(this)) : "";
			return base + "|rswAreaPt" + generation;
		};
		mat.needsUpdate = true;
	}



	function setLight(i, x, y, z, kind, rx, ry, rz, halfW, ux, uy, uz, halfH, r, g, b, intensity, nx, ny, nz, range) {
		if (i < 0 || i >= AP_MAX_LIGHTS) return;
		const o = i * 4;
		const pos = uniforms.uRswApPos.value;
		const rig = uniforms.uRswApRight.value;
		const up = uniforms.uRswApUp.value;
		const col = uniforms.uRswApColor.value;
		const mis = uniforms.uRswApMisc.value;
		pos[o] = x; pos[o + 1] = y; pos[o + 2] = z; pos[o + 3] = kind === 1 ? 1 : 0;
		rig[o] = rx; rig[o + 1] = ry; rig[o + 2] = rz; rig[o + 3] = halfW > 0 ? halfW : 0;
		up[o] = ux; up[o + 1] = uy; up[o + 2] = uz; up[o + 3] = halfH > 0 ? halfH : 0;
		col[o] = r; col[o + 1] = g; col[o + 2] = b; col[o + 3] = intensity > 0 ? intensity : 0;
		mis[o] = nx; mis[o + 1] = ny; mis[o + 2] = nz; mis[o + 3] = range > 0 ? range : 0;
	}


	function setCount(n) {
		const c = Math.max(0, Math.min(Number(n) || 0, AP_MAX_LIGHTS));
		uniforms.uRswApCount.value = c;
		uniforms.uRswApOn.value = enabled && c > 0 ? 1 : 0;
		lights = c;
	}

	function setEnabled(on) {
		enabled = !!on;
		if (!enabled) {
			uniforms.uRswApOn.value = 0;
			uniforms.uRswApCount.value = 0;
			lights = 0;
		}
	}


	function bumpGeneration() {
		generation += 1;
	}

	function getState() {
		return {
			supported,
			enabled,
			on: uniforms.uRswApOn.value === 1,
			lights,
			patched,
			generation,
			maxLights: AP_MAX_LIGHTS,
		};
	}

	function dispose() {
		setEnabled(false);
	}


	if (typeof window !== "undefined") {
		window.__rswAreaParts = window.__rswAreaParts || {};
		window.__rswAreaParts.patchState = getState;
	}

	return {
		supported,
		uniforms,
		patchMaterial,
		setLight,
		setCount,
		setEnabled,
		bumpGeneration,
		getState,
		dispose,
	};
}
