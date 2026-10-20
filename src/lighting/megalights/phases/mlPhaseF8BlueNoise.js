import * as labFlags from "../runtime/megaLightsFlagRegistry.js";
import * as labPatch from "../runtime/megaLightsPatchRegistry.js";
import { mlQa } from "../runtime/megaLightsTelemetry.js";
import * as blueNoiseGlue from "../mlBlueNoiseGlue.js";
import * as blueNoiseDescriptor from "../mlBlueNoiseDescriptor.js";

export const PHASE_ID = "ML-F8";
export const FLAG_ID = "MegaLightsBlueNoise";
export const TEXTURE_UNIT_KEY = "ML-F8:blueNoise";

let runtime = null;


export function blueNoiseRuntime() {
	return runtime;
}


function createBackgroundScheduler() {
	if (typeof requestIdleCallback === "function") {
		return (callback) => requestIdleCallback(() => callback(), { timeout: 200 });
	}
	return (callback) => setTimeout(callback, 0);
}

export function installPhase(installContext) {
	const context = installContext || {};

	labFlags.registerFlag({
		id: FLAG_ID,
		phase: PHASE_ID,
		description: "spatio-temporal blue noise as the only random source for sampling and tracing",


		defaultsByTier: { fraco: false, medio: true, forte: true },
	});


	mlQa.textureUnit(TEXTURE_UNIT_KEY, 1);

	const tierName = context.bench && context.bench.tier ? context.bench.tier : "medio";
	const isActive = labFlags.isFlagActive(FLAG_ID, tierName);
	const descriptor = blueNoiseDescriptor.normalizeBlueNoiseDescriptor(context.blueNoiseDescriptor);

	if (!isActive) {

		runtime = null;
		mlQa.phase(PHASE_ID, {
			implemented: true,
			title: "Spatio-temporal blue noise",
			block: "C",
			ownsPass: null,
			active: false,
			allocated: false,
			tier: tierName,
			note: "flag off for this tier: no volume generated and no texture created",
		});
		return { implemented: true, active: false, runtime: null };
	}

	runtime = blueNoiseGlue.createBlueNoiseRuntime({
		THREE: context.THREE || null,
		descriptor,
		telemetry: mlQa,
		registerUniform: labPatch.registerUniform,
		scheduleTick: createBackgroundScheduler(),
	});
	runtime.startBackgroundGeneration();

	mlQa.uniform("uMglBlueNoiseFrameOffset", 0);
	mlQa.phase(PHASE_ID, {
		implemented: true,
		title: "Spatio-temporal blue noise",
		block: "C",
		ownsPass: null,
		active: true,
		allocated: true,
		tier: tierName,
		note: "volume generated in sliced background work; consumers inject the GLSL of mlBlueNoiseGlsl.js",
		report: runtime.report(),
	});

	if (typeof window !== "undefined" && window.__mlLab && typeof window.__mlLab === "object") {
		window.__mlLab.blueNoise = {
			report: () => runtime.report(),
			isReady: () => runtime.isReady(),
			bindFrame: (frameIndex) => runtime.bindFrame(frameIndex),
			volume: () => runtime.volume(),
		};
	}

	return { implemented: true, active: true, runtime };
}

export function uninstallPhase() {
	if (!runtime) return false;
	runtime.dispose();
	runtime = null;
	return true;
}
