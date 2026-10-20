import * as THREE from "three";
import { LIGHT_PROXY_LAYER, LIGHT_PROXY_PROBE_TEXTURE_UNITS } from "./llLightProxyContract.js";
import { llQa } from "./llTelemetry.js";


export const PROBE_FACE_SIZE_BY_TIER = Object.freeze({ fraco: 0, medio: 64, forte: 128 });
export const MIN_MS_BETWEEN_CAPTURES = 100;
export const PROBE_NEAR = 0.05;
export const PROBE_FAR = 200;
export const PROBE_TELEMETRY_ID = "ll-f19-probe";

export function probeFaceSizeForTier(tier) {
	const size = PROBE_FACE_SIZE_BY_TIER[tier];
	return size === undefined ? 0 : size;
}

export function createLightSourceProbe(bench) {
	const clearColor = new THREE.Color();
	let renderTarget = null;
	let cubeCamera = null;
	let faceSize = 0;
	let captureCount = 0;
	let lastCaptureAtMs = 0;
	let lastCaptureDurationMs = 0;
	let lastSignature = "";
	let lastReason = "never-captured";
	let dirty = true;

	function disposeTarget() {
		if (renderTarget) renderTarget.dispose();
		renderTarget = null;
		cubeCamera = null;
		faceSize = 0;
	}

	function ensureTarget(tier) {
		const size = probeFaceSizeForTier(tier);
		if (!(size > 0)) return null;
		if (renderTarget && faceSize === size) return renderTarget;
		disposeTarget();
		renderTarget = new THREE.WebGLCubeRenderTarget(size, {
			type: THREE.HalfFloatType,
			generateMipmaps: false,
			minFilter: THREE.LinearFilter,
			magFilter: THREE.LinearFilter,
		});
		faceSize = size;
		cubeCamera = new THREE.CubeCamera(PROBE_NEAR, PROBE_FAR, renderTarget);


		cubeCamera.children.forEach((child) => {
			if (child.isCamera) child.layers.set(LIGHT_PROXY_LAYER);
		});
		dirty = true;
		llQa.texUnit(PROBE_TELEMETRY_ID, LIGHT_PROXY_PROBE_TEXTURE_UNITS);
		return renderTarget;
	}

	function capture(options) {
		const settings = options || {};
		const target = ensureTarget(settings.tier || bench.tier);
		if (!target) return null;
		const renderer = bench.renderer;
		const scene = bench.scene;
		const center = settings.center || { x: 0, y: 0, z: 0 };
		cubeCamera.position.set(Number(center.x) || 0, Number(center.y) || 0, Number(center.z) || 0);
		const previousBackground = scene.background;
		const previousClearColor = renderer.getClearColor(clearColor).getHex();
		const previousClearAlpha = renderer.getClearAlpha();
		const previousShadowAutoUpdate = renderer.shadowMap.autoUpdate;
		const previousToneMapping = renderer.toneMapping;
		const startedAt = performance.now();
		scene.background = null;
		renderer.setClearColor(0x000000, 1);
		renderer.shadowMap.autoUpdate = false;
		renderer.toneMapping = THREE.NoToneMapping;
		try {
			cubeCamera.update(renderer, scene);
		} finally {
			renderer.toneMapping = previousToneMapping;
			renderer.shadowMap.autoUpdate = previousShadowAutoUpdate;
			renderer.setClearColor(previousClearColor, previousClearAlpha);
			scene.background = previousBackground;
		}
		captureCount++;
		lastCaptureDurationMs = performance.now() - startedAt;
		lastCaptureAtMs = performance.now();
		lastReason = settings.reason || "requested";
		dirty = false;
		return Object.freeze({
			texture: target.texture,
			faceSize: faceSize,
			ms: lastCaptureDurationMs,
			motivo: lastReason,
		});
	}

	return {
		ensureTarget: ensureTarget,
		texture() {
			return renderTarget ? renderTarget.texture : null;
		},
		markDirty(signature) {
			const next = String(signature === undefined ? "" : signature);
			if (next === lastSignature) return false;
			lastSignature = next;
			dirty = true;
			return true;
		},
		isDirty() {
			return dirty;
		},
		capture: capture,
		captureIfDirty(options) {
			const settings = options || {};
			if (!dirty) return null;
			const nowMs = Number.isFinite(Number(settings.nowMs)) ? Number(settings.nowMs) : performance.now();
			if (captureCount > 0 && nowMs - lastCaptureAtMs < MIN_MS_BETWEEN_CAPTURES) return null;
			return capture(Object.assign({ reason: "dirty" }, settings));
		},
		stats() {
			return {
				alvoCriado: !!renderTarget,
				ladoDaFace: faceSize,
				capturas: captureCount,
				ultimoMsCpu: Math.round(lastCaptureDurationMs * 1000) / 1000,
				sujo: dirty,
				assinatura: lastSignature,
				ultimoMotivo: lastReason,
				texUnits: renderTarget ? LIGHT_PROXY_PROBE_TEXTURE_UNITS : 0,
			};
		},
		dispose: disposeTarget,
	};
}
