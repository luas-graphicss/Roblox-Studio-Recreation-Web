import { isLocalLightFlagActive, registerLocalLightFlag } from "../lighting/llFeatureFlags.js";
import { isLocalLightBaselineFrozen } from "../lighting/llBaselineFreezeFlag.js";
import { isLocalLightTechnology } from "../lighting/llTechnologyGate.js";
import { llQa } from "../lighting/llTelemetry.js";
import {
	CLUSTER_SHADING_ANCHOR,
	CLUSTER_SHADING_CHUNK_NAME,
	CLUSTER_SHADING_FLAG_ID,
	CLUSTER_SHADING_PATCH_ID,
	CLUSTER_SHADING_PATCH_ORDER,
	CLUSTER_SHADING_PHASE_ID,
	CLUSTER_SHADING_TEXTURE_UNITS,
	CLUSTER_SHADING_UNIFORMS,
} from "../lighting/llClusterShadingContract.js";
import {
	CLUSTER_SHADING_LOOP_MARKER,
	CLUSTER_SHADING_MARKER,
	buildClusterShadingDeclarations,
	injectClusterShadingLoop,
} from "../lighting/llClusterShadingGlsl.js";


export const CLUSTER_SHADING_FLAG_DEFAULT = Object.freeze({ fraco: false, medio: true, forte: true });

export const CLUSTER_SHADING_REFUSALS = Object.freeze({
	declarationAnchorMissing: "cluster-declaration-anchor-missing",
	loopInjectionFailed: "cluster-loop-injection-failed",
});


const MAIN_FUNCTION_MARKER = "void main()";

registerLocalLightFlag({
	id: CLUSTER_SHADING_FLAG_ID,
	phase: CLUSTER_SHADING_PHASE_ID,
	description:
		"cluster shading: the local lights of the cell of the pixel are shaded past the forward light budget of three",
	defaultsByTier: CLUSTER_SHADING_FLAG_DEFAULT,
});


export function registerLocalLightClusterShadingPhase(options) {
	const settings = options && typeof options === "object" ? options : {};
	const registry = settings.registry;
	if (!registry || typeof registry.registerShaderPatch !== "function") {
		throw new Error("LL-F20: a local-light patch registry is required");
	}
	const logger = settings.logger && typeof settings.logger.warn === "function" ? settings.logger : null;

	const uniformNames = CLUSTER_SHADING_UNIFORMS;
	registry.registerUniform(uniformNames.enabled, 0);
	registry.registerUniform(uniformNames.lightCount, 0);
	registry.registerUniform(uniformNames.lightTexture, null);
	registry.registerUniform(uniformNames.cellTexture, null);
	registry.registerUniform(uniformNames.lightIndexTexture, null);
	registry.registerUniform(uniformNames.near, 0.1);
	registry.registerUniform(uniformNames.far, 1000);
	registry.registerUniform(uniformNames.projectionScaleX, 0);
	registry.registerUniform(uniformNames.projectionScaleY, 0);


	llQa.setTextureUnits(CLUSTER_SHADING_PHASE_ID, CLUSTER_SHADING_TEXTURE_UNITS);

	let appliedShaderCount = 0;
	let lastRefusal = "";
	let publishedLightCount = 0;
	let clusterEnabled = false;
	let texturesBound = false;

	function recordRefusal(reason) {
		lastRefusal = reason;
		llQa.addError("LL-F20: " + reason, { phase: CLUSTER_SHADING_PHASE_ID, patch: CLUSTER_SHADING_PATCH_ID });
		if (logger) logger.warn("[Luzes locais] LL-F20 recusou: " + reason);
	}

	function isPhaseActive(context) {
		const frame = context && typeof context === "object" ? context : {};
		if (!isLocalLightTechnology(frame.technology)) return false;
		if (isLocalLightBaselineFrozen(frame.tier)) return false;
		return isLocalLightFlagActive(CLUSTER_SHADING_FLAG_ID, frame.tier);
	}


	function injectDeclarations(context) {
		if (context.contains("fragment", CLUSTER_SHADING_MARKER)) return true;
		const declarations = buildClusterShadingDeclarations();
		if (context.insertBeforeMarker("fragment", context.declarationMarker, declarations)) return true;
		if (context.insertBeforeMarker("fragment", MAIN_FUNCTION_MARKER, declarations)) return true;
		recordRefusal(CLUSTER_SHADING_REFUSALS.declarationAnchorMissing);
		return false;
	}

	function injectLoop(context) {
		let failureReason = "";
		const patched = context.patchChunk("fragment", CLUSTER_SHADING_CHUNK_NAME, (chunkSource) => {
			const injection = injectClusterShadingLoop(chunkSource);
			if (injection.injected) return injection.source;
			if (!injection.alreadyInjected) {
				failureReason = injection.reason || CLUSTER_SHADING_REFUSALS.loopInjectionFailed;
			}
			return chunkSource;
		});
		if (patched && !failureReason) return true;
		recordRefusal(CLUSTER_SHADING_REFUSALS.loopInjectionFailed + (failureReason ? ": " + failureReason : ""));
		return false;
	}

	registry.registerShaderPatch({
		id: CLUSTER_SHADING_PATCH_ID,
		phase: CLUSTER_SHADING_PHASE_ID,
		anchor: CLUSTER_SHADING_ANCHOR,
		order: CLUSTER_SHADING_PATCH_ORDER,
		isActive: (context) => isPhaseActive(context),
		apply: (context) => {


			if (context.contains("fragment", CLUSTER_SHADING_LOOP_MARKER)) return false;
			if (!injectDeclarations(context)) return false;
			if (!injectLoop(context)) return false;
			appliedShaderCount++;
			lastRefusal = "";
			return true;
		},
	});

	function publishTelemetry(reason) {
		llQa.setPhase(CLUSTER_SHADING_PHASE_ID, {
			flag: CLUSTER_SHADING_FLAG_ID,
			patch: CLUSTER_SHADING_PATCH_ID,
			shadersPatched: appliedShaderCount,
			clusterEnabled,
			clusterLights: publishedLightCount,
			clusterReason: reason || "",
			texturesBound,
			lastRefusal,
		});
	}

	return {
		phaseId: CLUSTER_SHADING_PHASE_ID,
		flagId: CLUSTER_SHADING_FLAG_ID,
		patchId: CLUSTER_SHADING_PATCH_ID,
		anchor: CLUSTER_SHADING_ANCHOR,
		textureUnits: CLUSTER_SHADING_TEXTURE_UNITS,
		isActive: (context) => isPhaseActive(context),


		bindTextures(textures) {
			const source = textures && typeof textures === "object" ? textures : {};
			registry.setUniformValue(uniformNames.lightTexture, source.lightTexture || null);
			registry.setUniformValue(uniformNames.cellTexture, source.cellTexture || null);
			registry.setUniformValue(uniformNames.lightIndexTexture, source.lightIndexTexture || null);
			texturesBound = !!(source.lightTexture && source.cellTexture && source.lightIndexTexture);
			return texturesBound;
		},


		publishFrame(frame) {
			const source = frame && typeof frame === "object" ? frame : {};
			publishedLightCount = Math.max(0, Math.floor(Number(source.lightCount) || 0));
			registry.setUniformValue(uniformNames.lightCount, publishedLightCount);
			registry.setUniformValue(uniformNames.near, Number(source.near) || 0.1);
			registry.setUniformValue(uniformNames.far, Number(source.far) || 1000);
			registry.setUniformValue(uniformNames.projectionScaleX, Number(source.projectionScaleX) || 0);
			registry.setUniformValue(uniformNames.projectionScaleY, Number(source.projectionScaleY) || 0);


			clusterEnabled = texturesBound && publishedLightCount > 0;
			registry.setUniformValue(uniformNames.enabled, clusterEnabled ? 1 : 0);
			publishTelemetry("");
			return clusterEnabled;
		},


		disable(reason) {
			publishedLightCount = 0;
			clusterEnabled = false;
			registry.setUniformValue(uniformNames.enabled, 0);
			registry.setUniformValue(uniformNames.lightCount, 0);
			publishTelemetry(reason);
			return false;
		},

		appliedCount: () => appliedShaderCount,
		resetCounters() {
			appliedShaderCount = 0;
		},
		lastRefusal: () => lastRefusal,
		status(context) {
			return {
				phaseId: CLUSTER_SHADING_PHASE_ID,
				flagId: CLUSTER_SHADING_FLAG_ID,
				patchId: CLUSTER_SHADING_PATCH_ID,
				active: isPhaseActive(context),
				enabled: clusterEnabled,
				lights: publishedLightCount,
				shadersPatched: appliedShaderCount,
				texturesBound,
				lastRefusal,
			};
		},
	};
}
