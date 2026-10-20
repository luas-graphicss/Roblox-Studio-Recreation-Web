import {
	MSM_INJECTION_COMPOSITE_MODE,
	MSM_INJECTION_HISTORY_BUFFER_ID,
	MSM_INJECTION_HISTORY_LAG_FRAMES,
	MSM_INJECTION_OWNER_PHASE,
	MSM_INJECTION_TEXTURE_UNIT_COST,
} from "../lighting/megalightsSm/msmCompositeInjectionCore.js";
import {
	MSM_INJECTION_FRAGMENT_ANCHORS,
	MSM_INJECTION_FRAGMENT_APPLY_ANCHOR,
	MSM_INJECTION_FRAGMENT_DECLARATION_ANCHOR,
	MSM_INJECTION_REQUIRED_SHADER_CHUNKS,
	MSM_INJECTION_REQUIRED_SYMBOLS,
	MSM_INJECTION_UNIFORM_GAIN,
	MSM_INJECTION_UNIFORM_HISTORY,
	MSM_INJECTION_UNIFORM_ON,
	MSM_INJECTION_UNIFORM_PREVIOUS_VIEW_PROJECTION,
	MSM_INJECTION_VERTEX_ANCHORS,
	MSM_INJECTION_VERTEX_WRITE_ANCHOR,
	buildCompositeInjectionApplyGlsl,
	buildCompositeInjectionDeclarationGlsl,
	buildCompositeInjectionVertexDeclarationGlsl,
	buildCompositeInjectionVertexWriteGlsl,
} from "../lighting/megalightsSm/msmCompositeInjectionGlsl.js";
import {
	MSM_FORWARD_INJECTION_CONSUMER_READY,
	msmExtraGlobalTextureCharge,
} from "../lighting/megalightsSm/msmMaterialTextureAccountingCore.js";
import {
	MSM_PATCH_DECISION_APPLY,
	MSM_PATCH_SKIP_REASONS,
	decidePatch,
	verifyShaderAnchors,
	verifyShaderChunkNames,
} from "../lighting/megalightsSm/msmPatchAnchorCore.js";

import {
	MSM_FORWARD_LIGHT_LOOP_REVISION,
	guardMsmForwardLightLoops,
} from "../lighting/megalightsSm/msmForwardLightLoopGlsl.js";

import { MSM_ALL_NATIVE_LIGHT_SEGMENTS, MSM_NATIVE_LIGHT_SEGMENTS, msmForwardLightSegmentMask } from "../lighting/megalightsSm/msmForwardLightSegmentsCore.js";

import { refreshMsmForwardUniformBindings } from "./msmForwardUniformBindings.js";

const MATERIAL_PATCH_FLAG = "__rswMsmInjection";
const DEFAULT_INJECTION_GAIN = 1;

function hasOwnField(target, field) {
	return Boolean(target) && Object.prototype.hasOwnProperty.call(target, field);
}

function ensureUserData(material) {
	if (!material.userData || typeof material.userData !== "object") material.userData = {};
	return material.userData;
}

import { expandMsmShaderIncludes } from '../lighting/megalightsSm/msmShaderInspectionCore.js';
import { buildMsmForwardSpecularDeclarations, buildMsmForwardSpecularApply } from './msmForwardSpecular.js';

export function createMegaLightsSmComposite(options = {}) {
	const consumerReady = typeof options.consumerReady === "boolean"
		? options.consumerReady
		: MSM_FORWARD_INJECTION_CONSUMER_READY;
	const chunkCheck = verifyShaderChunkNames(options.shaderChunks, MSM_INJECTION_REQUIRED_SHADER_CHUNKS);
	const declarationGlsl = buildCompositeInjectionDeclarationGlsl()
		+ (options.forwardSpecular ? '\n' + buildMsmForwardSpecularDeclarations() : '');
	const applyGlsl = options.forwardSpecular ? buildMsmForwardSpecularApply() : buildCompositeInjectionApplyGlsl();
	const vertexDeclarationGlsl = buildCompositeInjectionVertexDeclarationGlsl();
	const vertexWriteGlsl = buildCompositeInjectionVertexWriteGlsl();


	const sharedUniforms = {
		[MSM_INJECTION_UNIFORM_ON]: { value: 0 },
		[MSM_INJECTION_UNIFORM_HISTORY]: { value: null },
		[MSM_INJECTION_UNIFORM_PREVIOUS_VIEW_PROJECTION]: { value: options.previousViewProjection || null },
		[MSM_INJECTION_UNIFORM_GAIN]: {
			value: Number.isFinite(options.injectionGain) ? options.injectionGain : DEFAULT_INJECTION_GAIN,
		},
	};

	if (options.forwardSpecular) {
		sharedUniforms.uMsmForwardSpecularOn = { value: 0 };
		sharedUniforms.uMsmForwardRepresentativePosition = { value: options.representativePosition };
	}

	const telemetry = {
		patchedMaterialCount: 0,
		skippedMaterialCount: 0,
		compiledPatchCount: 0,
		lastSkipReason: chunkCheck.ok ? null : chunkCheck.reason,
		frameSyncCount: 0,
	};

	let generation = 1;
	let injectionEnabled = false;
	let nativeLightMask = MSM_ALL_NATIVE_LIGHT_SEGMENTS;
	const patchedMaterials = new Set();
	const guardedLoopsByMask = new Map();

	function setNativeLightMask(nextMask) {
		if (nativeLightMask === nextMask) return;
		nativeLightMask = nextMask;
		for (const material of patchedMaterials) material.needsUpdate = true;
	}

	const supported = chunkCheck.ok;

	function programCacheKey() {
		return MSM_INJECTION_OWNER_PHASE + ":inject:" + generation + ":" + MSM_FORWARD_LIGHT_LOOP_REVISION + ":native:" + nativeLightMask;
	}

	function isInjectionLive() {
		return supported === true && consumerReady === true && injectionEnabled === true;
	}

	function registerSkip(reason) {
		telemetry.skippedMaterialCount += 1;
		telemetry.lastSkipReason = reason;
		return { patched: false, reason };
	}

	function applyPatchToShader(shader) {
		const verification = verifyShaderAnchors({
			fragmentShader: shader.fragmentShader,
			symbolSource: expandMsmShaderIncludes(shader.fragmentShader, options.shaderChunks),
			vertexShader: shader.vertexShader,
			fragmentAnchors: MSM_INJECTION_FRAGMENT_ANCHORS,
			vertexAnchors: MSM_INJECTION_VERTEX_ANCHORS,
			requiredSymbols: MSM_INJECTION_REQUIRED_SYMBOLS,
		});
		if (verification.ok !== true) {

			telemetry.lastSkipReason = verification.reason;
			return { patched: false, reason: verification.reason };
		}
		shader.vertexShader = vertexDeclarationGlsl + shader.vertexShader.replace(
			MSM_INJECTION_VERTEX_WRITE_ANCHOR,
			MSM_INJECTION_VERTEX_WRITE_ANCHOR + "\n" + vertexWriteGlsl,
		);
		shader.fragmentShader = shader.fragmentShader
			.replace(
				MSM_INJECTION_FRAGMENT_DECLARATION_ANCHOR,
				MSM_INJECTION_FRAGMENT_DECLARATION_ANCHOR + "\n" + declarationGlsl,
			)
			.replace(
				MSM_INJECTION_FRAGMENT_APPLY_ANCHOR,
				MSM_INJECTION_FRAGMENT_APPLY_ANCHOR + "\n" + applyGlsl,
			);
		const guardedLoops = guardMsmForwardLightLoops(shader.fragmentShader, options.shaderChunks, nativeLightMask);
		shader.fragmentShader = guardedLoops.source;
		guardedLoopsByMask.set(nativeLightMask, guardedLoops.guardedLoopCount);
		if (shader.uniforms && typeof shader.uniforms === "object") {
			for (const uniformName of Object.keys(sharedUniforms)) {
				shader.uniforms[uniformName] = sharedUniforms[uniformName];
			}
		}
		telemetry.compiledPatchCount += 1;
		return { patched: true, reason: null };
	}


	function patchMaterial(material) {
		if (!material || typeof material !== "object") {
			return registerSkip(MSM_PATCH_SKIP_REASONS.missingShaderSource);
		}


		if (supported !== true) return registerSkip(chunkCheck.reason);
		const userData = ensureUserData(material);
		const previousRecord = userData[MATERIAL_PATCH_FLAG];
		if (previousRecord && (material.onBeforeCompile !== previousRecord.patchHandler ||
			material.customProgramCacheKey !== previousRecord.keyHandler || material.onBeforeRender !== previousRecord.renderHandler)) unpatchMaterial(material);
		const decision = decidePatch({
			consumerReady: consumerReady === true,
			alreadyPatched: Boolean(userData[MATERIAL_PATCH_FLAG]),
			verification: { ok: true, reason: null },
		});
		if (decision.decision !== MSM_PATCH_DECISION_APPLY) return registerSkip(decision.reason);

		const hadOwnCompile = hasOwnField(material, "onBeforeCompile");
		const previousCompile = hadOwnCompile ? material.onBeforeCompile : null;
		const hadOwnRender = hasOwnField(material, "onBeforeRender");
		const previousRender = material.onBeforeRender;
		const hadOwnKey = hasOwnField(material, "customProgramCacheKey");
		const previousKey = hadOwnKey ? material.customProgramCacheKey : null;

		const patchHandler = function (shader, renderer) {
			if (typeof previousCompile === "function") previousCompile.call(this, shader, renderer);
			if (material.userData?.[MATERIAL_PATCH_FLAG]?.patchHandler === patchHandler) applyPatchToShader(shader);
		};
		const renderHandler = function (renderer) {
			if (typeof previousRender === "function") previousRender.apply(this, arguments);
			if (material.userData?.[MATERIAL_PATCH_FLAG]?.renderHandler === renderHandler) {
				refreshMsmForwardUniformBindings(renderer, material, sharedUniforms);
			}
		};
		const keyHandler = () => (typeof previousKey === 'function' ? String(previousKey.call(material)) : '')
			+ (material.userData?.[MATERIAL_PATCH_FLAG]?.keyHandler === keyHandler ? programCacheKey() : '');

		material.onBeforeCompile = patchHandler;
		material.onBeforeRender = renderHandler;
		material.customProgramCacheKey = keyHandler;
		userData[MATERIAL_PATCH_FLAG] = {
			ownerPhase: MSM_INJECTION_OWNER_PHASE,
			hadOwnCompile,
			previousCompile,
			hadOwnRender,
			previousRender,
			renderHandler,
			hadOwnKey,
			previousKey,
			patchHandler,
			keyHandler,
		};
		material.needsUpdate = true;
		patchedMaterials.add(material);
		telemetry.patchedMaterialCount += 1;
		return { patched: true, reason: null };
	}


	function unpatchMaterial(material) {
		patchedMaterials.delete(material);
		const record = material && material.userData ? material.userData[MATERIAL_PATCH_FLAG] : null;
		if (!record) return { unpatched: false, reason: MSM_PATCH_SKIP_REASONS.alreadyPatched };
		if (material.onBeforeCompile === record.patchHandler) {
			if (record.hadOwnCompile) material.onBeforeCompile = record.previousCompile;
			else delete material.onBeforeCompile;
		}
		if (material.onBeforeRender === record.renderHandler) {
			if (record.hadOwnRender) material.onBeforeRender = record.previousRender;
			else delete material.onBeforeRender;
		}
		if (material.customProgramCacheKey === record.keyHandler) {
			if (record.hadOwnKey) material.customProgramCacheKey = record.previousKey;
			else delete material.customProgramCacheKey;
		}
		delete material.userData[MATERIAL_PATCH_FLAG];
		material.needsUpdate = true;
		telemetry.patchedMaterialCount = Math.max(0, telemetry.patchedMaterialCount - 1);
		return { unpatched: true, reason: null };
	}


	function repatchMaterial(material) {
		unpatchMaterial(material);
		const result = patchMaterial(material);
		if (result.patched) material.needsUpdate = true;
		return result;
	}

	function setInjectionEnabled(enabled) {
		injectionEnabled = enabled === true;
		if (!injectionEnabled) setNativeLightMask(MSM_ALL_NATIVE_LIGHT_SEGMENTS);
		sharedUniforms[MSM_INJECTION_UNIFORM_ON].value = isInjectionLive() ? 1 : 0;
		return isInjectionLive();
	}


	function syncFrame(frame = {}) {
		if (frame.historyTexture !== undefined) {
			sharedUniforms[MSM_INJECTION_UNIFORM_HISTORY].value = frame.historyTexture;
		}
		if (frame.previousViewProjection !== undefined) {
			sharedUniforms[MSM_INJECTION_UNIFORM_PREVIOUS_VIEW_PROJECTION].value = frame.previousViewProjection;
		}
		if (Number.isFinite(frame.injectionGain)) {
			sharedUniforms[MSM_INJECTION_UNIFORM_GAIN].value = frame.injectionGain;
		}
		if (options.forwardSpecular && frame.specularEnabled !== undefined) {
			sharedUniforms.uMsmForwardSpecularOn.value = frame.specularEnabled ? 1 : 0;
		}
		const historyMissing = !sharedUniforms[MSM_INJECTION_UNIFORM_HISTORY].value;
		setNativeLightMask(isInjectionLive() && !historyMissing
			? msmForwardLightSegmentMask(frame.nativeLightSegments)
			: MSM_ALL_NATIVE_LIGHT_SEGMENTS);
		sharedUniforms[MSM_INJECTION_UNIFORM_ON].value = isInjectionLive() && !historyMissing ? 1 : 0;
		telemetry.frameSyncCount += 1;
		return sharedUniforms[MSM_INJECTION_UNIFORM_ON].value === 1;
	}


	function bumpGeneration() {
		generation += 1;
		return generation;
	}

	function getExtraGlobalTextureCharge() {
		return msmExtraGlobalTextureCharge({
			injectionActive: isInjectionLive(),
			compositeMode: MSM_INJECTION_COMPOSITE_MODE,
		});
	}

	function getTelemetry() {
		return Object.freeze({
			ownerPhase: MSM_INJECTION_OWNER_PHASE,
			compositeMode: MSM_INJECTION_COMPOSITE_MODE,
			historyBufferId: MSM_INJECTION_HISTORY_BUFFER_ID,
			historyLagFrames: MSM_INJECTION_HISTORY_LAG_FRAMES,
			supported,
			consumerReady,
			injectionLive: isInjectionLive(),
			scalarSpecular: sharedUniforms.uMsmForwardSpecularOn?.value === 1,
			materialTextureUnitCost: MSM_INJECTION_TEXTURE_UNIT_COST,
			extraGlobalTextureCharge: getExtraGlobalTextureCharge(),
			programCacheKey: programCacheKey(),
			patchedMaterialCount: telemetry.patchedMaterialCount,
			skippedMaterialCount: telemetry.skippedMaterialCount,
			compiledPatchCount: telemetry.compiledPatchCount,
			guardedLightLoopCount: guardedLoopsByMask.get(nativeLightMask) || 0,
			nativeLightMask,
			nativeLightSegments: {
				pointSampler: (nativeLightMask & MSM_NATIVE_LIGHT_SEGMENTS.pointSampler) !== 0,
				pointDirect: (nativeLightMask & MSM_NATIVE_LIGHT_SEGMENTS.pointDirect) !== 0,
				spotSampler: (nativeLightMask & MSM_NATIVE_LIGHT_SEGMENTS.spotSampler) !== 0,
				spotDirect: (nativeLightMask & MSM_NATIVE_LIGHT_SEGMENTS.spotDirect) !== 0,
			},
			frameSyncCount: telemetry.frameSyncCount,
			lastSkipReason: telemetry.lastSkipReason,
			missingShaderChunks: chunkCheck.missingShaderChunks,
		});
	}

	return {
		supported,
		consumerReady,
		patchMaterial,
		unpatchMaterial,
		repatchMaterial,
		setInjectionEnabled,
		syncFrame,
		isInjectionLive,
		programCacheKey,
		bumpGeneration,
		getExtraGlobalTextureCharge,
		getUniforms: () => sharedUniforms,
		getTelemetry,
	};
}
