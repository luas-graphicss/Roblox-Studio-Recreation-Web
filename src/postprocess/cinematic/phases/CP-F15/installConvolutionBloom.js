import { makeTextureResource } from "../../contracts/frameContract.js";
import { CONVOLUTION_OWNER, CONVOLUTION_SETTING_KEY, resolveConvolutionSettings, describeStandardBloomFallback } from "./convolutionSettings.js";
import { createConvolutionPlan } from "./convolutionPlan.js";
import { createConvolutionGpu } from "./convolutionGpu.js";
import { resolveConvolutionColorMetadata } from "./convolutionColorMetadata.js";

export function installConvolutionBloom(services) {
  const { graph, rendererAdapter, pool, settings, capabilities, report } = services;
  if (!capabilities?.webgl2 || !capabilities.floatColorBuffer) throw new Error("CP-F15 requires WebGL2 and floating-point color targets; standard bloom is non-equivalent and is never substituted automatically");
  const gpu = createConvolutionGpu(rendererAdapter, pool);
  let cachedInput;
  let cachedRevision;
  let resolved;
  const plans = new Map();
  let unregister;
  let disposed = false;
  try {
    unregister = graph.register({
      id: "CP-F15.convolution", owner: CONVOLUTION_OWNER, stage: "bloom", order: 150,
      reads: ["$color"], writes: ["CP-F15.color", "CP-F15.glare", "CP-F15.layout"], transformsColor: true,
      execute(context) {
        const input = context.read("$color");
        const authored = settings.get(CONVOLUTION_SETTING_KEY);
        const revision = settings.revision?.();
        if (!resolved || authored !== cachedInput || revision !== cachedRevision) {
          resolved = resolveConvolutionSettings(authored ?? null);
          cachedInput = authored;
          cachedRevision = revision;
          plans.clear();
        }
        const metadata = resolveConvolutionColorMetadata(input, context.frame, resolved.enabled && resolved.intensity > 0);
        if (resolved.enabled && resolved.intensity > 0 && context.frame.referenceMode) throw new Error("CP-F15 BLOCKED_REFERENCE: no verified UE5.9 convolution profile");
        const signature = `${input.width}:${input.height}`;
        let plan = plans.get(signature);
        if (!plan) {
          try { plan = createConvolutionPlan(input.width, input.height, resolved, capabilities.maxTextureSize); }
          catch (error) { report?.({ phase: CONVOLUTION_OWNER, status: "blocked", reason: error.message, fallback: describeStandardBloomFallback(error.message) }); throw error; }
          if (plans.size >= 4) plans.delete(plans.keys().next().value);
          plans.set(signature, plan);
          report?.({ phase: CONVOLUTION_OWNER, status: plan.active ? "active" : "bypass", algorithm: plan.algorithm, quality: plan.quality, targetBytes: plan.targetBytes, sampleOperations: plan.sampleOperations, drawCalls: plan.drawCalls, accounting: plan.memory.accounting, reference: "BLOCKED_REFERENCE" });
        }
        const targets = gpu.render(input, context.frame, resolved, plan);
        const color = Object.freeze({ ...makeTextureResource(targets.color, context.frame, input.encoding), ...metadata });
        const glare = Object.freeze({ ...makeTextureResource(targets.glare, context.frame, input.encoding), ...metadata });
        context.publish("CP-F15.color", color);
        context.publish("CP-F15.glare", glare);
        context.publish("CP-F15.layout", { value: { active: plan.active, sourceWidth: plan.sourceWidth, sourceHeight: plan.sourceHeight, paddedWidth: plan.paddedWidth, paddedHeight: plan.paddedHeight, padding: plan.padding, intensity: resolved.intensity, alreadyComposited: plan.active, framePreExposure: context.frame.preExposure, inputProvenance: input.provenance, kernelProvenance: plan.kernelProvenance, targetBytes: plan.targetBytes, memory: plan.memory, sampleOperations: plan.sampleOperations, drawCalls: plan.drawCalls, quality: plan.quality, borderPolicy: "zero-extended-full-convolution", reference: "BLOCKED_REFERENCE" }, frameId: context.frame.frameId, viewId: context.frame.viewId, generation: context.frame.generation, provenance: "gpu" });
        return { color };
      }
    });
  } catch (error) { gpu.dispose(); throw error; }
  return () => {
    if (disposed) return;
    disposed = true;
    unregister();
    gpu.dispose();
    plans.clear();
  };
}
