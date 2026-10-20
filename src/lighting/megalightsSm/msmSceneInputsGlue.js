import {
	MSM_SCENE_INPUTS_OWNER,
	MSM_SCENE_INPUT_TOLERANCES,
	describeSceneInputReadiness,
} from "./msmSceneInputsContractCore.js";
import { MSM_NORMAL_TAP_COUNT } from "./msmNormalFromDepthCore.js";
import {
	MSM_NORMAL_FROM_DEPTH_REQUIRED_INCLUDES,
	MSM_NORMAL_FROM_DEPTH_UNIFORMS,
	buildNormalFromDepthGlsl,
} from "./msmNormalFromDepthGlsl.js";


export const MSM_SCENE_INPUT_FALLBACK_DIVISOR = 2;

function resolveDivisorValue(candidate) {
	const numericValue = Math.floor(Number(candidate));
	return Number.isFinite(numericValue) && numericValue >= 1 ? numericValue : null;
}

export function createSceneInputsReader(dependencies) {
	const options = dependencies || {};
	const THREE = options.THREE;
	const renderer = options.renderer || null;
	const defaultCamera = options.camera || null;
	const sharedDepth = options.sharedDepth || null;
	const telemetry = options.telemetry || null;
	const resolveDivisor = typeof options.resolveDivisor === "function" ? options.resolveDivisor : null;
	const acquireDepthTexture = typeof options.acquireDepthTexture === "function" ? options.acquireDepthTexture : null;

	if (!THREE) {
		throw new Error("createSceneInputsReader: THREE is required - this is the integration layer of MSM-F5, not a pure core");
	}
	if (!sharedDepth && !acquireDepthTexture) {
		throw new Error(
			"createSceneInputsReader: sharedDepth is required - MSM-F5 reads the shared depth and never renders a depth prepass of its own",
		);
	}

	const uniforms = {
		tMsmSceneDepth: { value: null },
		uMsmSceneDepthTexel: { value: new THREE.Vector2(0, 0) },
		uMsmInverseProjection: { value: new THREE.Vector2(0, 0) },
		uMsmCameraNear: { value: 0 },
		uMsmCameraFar: { value: 0 },
	};


	MSM_NORMAL_FROM_DEPTH_UNIFORMS.forEach((declaredUniform) => {
		if (!Object.prototype.hasOwnProperty.call(uniforms, declaredUniform.name)) {
			throw new Error(
				"createSceneInputsReader: the GLSL chunk declares the uniform " +
					declaredUniform.name +
					" but the reader does not publish it",
			);
		}
	});

	const handle = {
		owner: MSM_SCENE_INPUTS_OWNER,
		ready: false,
		sleepReason: null,
		width: 0,
		height: 0,
		divisor: MSM_SCENE_INPUT_FALLBACK_DIVISOR,
		divisorSource: "fallback",
		tapCount: MSM_NORMAL_TAP_COUNT,
		uniforms,
	};

	let lastReport = null;
	let lastPublishedSignature = "";

	function resolveGridSize(frame) {
		const injectedDivisor = resolveDivisor ? resolveDivisorValue(resolveDivisor(frame)) : null;
		const divisor = injectedDivisor === null ? MSM_SCENE_INPUT_FALLBACK_DIVISOR : injectedDivisor;
		const divisorSource = injectedDivisor === null ? "fallback" : "injected";
		const fullWidth = Math.floor(Number(frame.width));
		const fullHeight = Math.floor(Number(frame.height));


		if (!Number.isFinite(fullWidth) || !Number.isFinite(fullHeight) || fullWidth < 1 || fullHeight < 1) {
			return { divisor, divisorSource, width: 0, height: 0 };
		}
		return {
			divisor,
			divisorSource,
			width: Math.max(1, Math.floor(fullWidth / divisor)),
			height: Math.max(1, Math.floor(fullHeight / divisor)),
		};
	}

	function describeFrame(camera, gridSize) {
		return {
			isPerspectiveProjection: !!(camera && camera.isPerspectiveCamera),
			isOrthographicProjection: !!(camera && camera.isOrthographicCamera),
			hasSharedDepthProvider: true,
			cameraNear: camera ? Number(camera.near) : 0,
			cameraFar: camera ? Number(camera.far) : 0,
			width: gridSize.width,
			height: gridSize.height,
		};
	}


	function inverseProjectionScaleOf(camera) {
		const elements = camera && camera.projectionMatrix ? camera.projectionMatrix.elements : null;
		const horizontalScale = elements ? Number(elements[0]) : 0;
		const verticalScale = elements ? Number(elements[5]) : 0;
		return {
			x: Number.isFinite(horizontalScale) && horizontalScale !== 0 ? 1 / horizontalScale : 0,
			y: Number.isFinite(verticalScale) && verticalScale !== 0 ? 1 / verticalScale : 0,
		};
	}

	function acquireSceneDepth(gridSize) {
		if (acquireDepthTexture) {
			return acquireDepthTexture({ renderer, width: gridSize.width, height: gridSize.height }) || null;
		}
		if (typeof sharedDepth.acquire !== "function") return null;
		return sharedDepth.acquire(renderer, gridSize.width, gridSize.height) || null;
	}

	function updateUniforms(camera, gridSize, depthTexture) {
		const inverseProjection = inverseProjectionScaleOf(camera);
		uniforms.tMsmSceneDepth.value = depthTexture;
		uniforms.uMsmSceneDepthTexel.value.set(1 / gridSize.width, 1 / gridSize.height);
		uniforms.uMsmInverseProjection.value.set(inverseProjection.x, inverseProjection.y);
		uniforms.uMsmCameraNear.value = Number(camera.near);
		uniforms.uMsmCameraFar.value = Number(camera.far);
	}

	function buildReport() {
		return {
			owner: MSM_SCENE_INPUTS_OWNER,
			ready: handle.ready,
			sleepReason: handle.sleepReason,
			width: handle.width,
			height: handle.height,
			divisor: handle.divisor,
			divisorSource: handle.divisorSource,
			tapCount: MSM_NORMAL_TAP_COUNT,
		};
	}

	function publishReport() {
		lastReport = buildReport();
		if (!telemetry || typeof telemetry.phase !== "function") return;
		const signature = [
			lastReport.ready,
			lastReport.sleepReason,
			lastReport.width,
			lastReport.height,
			lastReport.divisor,
			lastReport.divisorSource,
		].join("|");
		if (signature === lastPublishedSignature) return;
		lastPublishedSignature = signature;
		telemetry.phase(MSM_SCENE_INPUTS_OWNER, { implemented: true, ...lastReport });
	}

	function goToSleep(sleepReason) {
		handle.ready = false;
		handle.sleepReason = sleepReason;
		uniforms.tMsmSceneDepth.value = null;
		publishReport();
		return handle;
	}


	function readFrame(frameContext) {
		const frame = frameContext || {};
		const camera = frame.camera || defaultCamera;
		const gridSize = resolveGridSize(frame);

		handle.divisor = gridSize.divisor;
		handle.divisorSource = gridSize.divisorSource;
		handle.width = gridSize.width;
		handle.height = gridSize.height;

		const readiness = describeSceneInputReadiness(describeFrame(camera, gridSize));
		if (!readiness.readable) return goToSleep(readiness.sleepReason);

		const depthTexture = acquireSceneDepth(gridSize);
		if (!depthTexture) return goToSleep("missingSharedDepth");

		updateUniforms(camera, gridSize, depthTexture);
		handle.ready = true;
		handle.sleepReason = null;
		publishReport();
		return handle;
	}

	return {
		readFrame,


		handle: () => handle,


		uniforms: () => uniforms,


		glslChunk: () => buildNormalFromDepthGlsl(),
		requiredIncludes: () => MSM_NORMAL_FROM_DEPTH_REQUIRED_INCLUDES,


		inspect: () => ({
			...(lastReport || buildReport()),
			tolerances: MSM_SCENE_INPUT_TOLERANCES,
			uniformNames: MSM_NORMAL_FROM_DEPTH_UNIFORMS.map((declaredUniform) => declaredUniform.name),
		}),


		dispose() {
			uniforms.tMsmSceneDepth.value = null;
			handle.ready = false;
			handle.sleepReason = null;
			lastReport = null;
			lastPublishedSignature = "";
		},
	};
}
