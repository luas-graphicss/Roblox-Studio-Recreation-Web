import { OUTPUT_OWNER, OUTPUT_LINEAR_COLOR, OUTPUT_INPUT_STATE, OUTPUT_COLOR, OUTPUT_STATE, OUTPUT_PROFILE } from "./outputContract.js";
import { createOutputSettingsReader } from "./outputSettings.js";
import { resolveOutputPlan } from "./outputCapabilities.js";
import { validateOutputInput } from "./outputInput.js";
import { createOutputColorTransform } from "./outputColorMath.js";
import { createOutputGpuResources } from "./outputGpuResources.js";
import { createLinearOutputResource, createEncodedOutputResource, describeOutputCapture } from "./outputMetadata.js";

function valueResource(value, frame) {
  return Object.freeze({ value, frameId: frame.frameId, viewId: frame.viewId, generation: frame.generation, provenance: "gpu" });
}

export function installDisplayOutput(services) {
  const { graph, pool, rendererAdapter: adapter, capabilities, report = () => {} } = services;
  if (!graph?.register || !pool?.acquire || !pool?.release || !pool?.releaseOwner || !adapter?.createMaterial || !adapter?.draw) throw new TypeError("CP-F28 requires graph, pool and renderer adapter services");
  const readSettings = createOutputSettingsReader();
  const initialSettings = readSettings(services.settings);
  resolveOutputPlan({ ...initialSettings, destination: "capture" }, { capabilities });
  const gpu = createOutputGpuResources(adapter, pool);
  const registrations = [];
  let lastReportSignature;
  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    gpu.dispose();
  }
  try {
    registrations.push(graph.register({
      id: `${OUTPUT_OWNER}.captureLinear`, owner: OUTPUT_OWNER, stage: "output", order: 2800,
      reads: ["$color"], writes: [OUTPUT_LINEAR_COLOR, OUTPUT_INPUT_STATE], transformsColor: false, dispose,
      execute(context) {
        if (disposed) throw new Error("CP-F28 has been disposed");
        const source = context.read("$color");
        const settings = readSettings(context.settings ?? services.settings);
        const plan = resolveOutputPlan(settings, { capabilities, outputSurface: adapter.outputSurface, generation: context.frame.generation });
        const info = validateOutputInput(source, context.frame, settings, plan);
        const transform = createOutputColorTransform(info, plan);
        const state = Object.freeze({ settings, plan, info, transform });
        const target = gpu.captureLinear(source, info, context.frame);
        context.publish(OUTPUT_LINEAR_COLOR, createLinearOutputResource(target, source, info, context.frame));
        context.publish(OUTPUT_INPUT_STATE, valueResource(state, context.frame));
      }
    }));
    registrations.push(graph.register({
      id: `${OUTPUT_OWNER}.encodeOutput`, owner: OUTPUT_OWNER, stage: "output", order: 2801,
      reads: ["$color", OUTPUT_LINEAR_COLOR, OUTPUT_INPUT_STATE], writes: [OUTPUT_COLOR, OUTPUT_STATE], transformsColor: true,
      execute(context) {
        if (disposed) throw new Error("CP-F28 has been disposed");
        const source = context.read("$color");
        const linear = context.read(OUTPUT_LINEAR_COLOR);
        const state = context.read(OUTPUT_INPUT_STATE).value;
        const target = gpu.encode(source, linear, state, context.frame);
        const color = createEncodedOutputResource(target, source, state, context.frame);
        const outputState = Object.freeze({ ...color.outputTransform, alphaModeAssumed: state.info.alphaModeAssumed, uiComposition: "external", linearCapture: describeOutputCapture(linear), displayCapture: describeOutputCapture(color) });
        context.publish(OUTPUT_COLOR, color);
        context.publish(OUTPUT_STATE, valueResource(outputState, context.frame));
        const signature = JSON.stringify([state.settings.enabled, state.plan.requestedMode, state.plan.mode, state.plan.destination, state.plan.fallbackReason]);
        if (signature !== lastReportSignature) {
          report({ phase: OUTPUT_OWNER, status: "implemented", profile: OUTPUT_PROFILE, plan: state.plan, oetfCount: color.outputTransform.oetfCount, appliedOetfCount: color.outputTransform.appliedOetfCount, uiComposition: "external", invalidPixelPolicy: "magenta diagnostic; no runtime readback" });
          lastReportSignature = signature;
        }
        return { color };
      }
    }));
  } catch (error) {
    for (const unregister of registrations.reverse()) unregister();
    dispose();
    throw error;
  }
  return () => { for (const unregister of registrations.splice(0).reverse()) unregister(); dispose(); };
}
