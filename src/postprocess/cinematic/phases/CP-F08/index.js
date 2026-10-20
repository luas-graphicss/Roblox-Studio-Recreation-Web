import { CONTRACT_VERSION } from "../../contracts/phaseManifest.js";
import { createMeteringGpu } from "./createMeteringGpu.js";
import { resolveMeteringSettings } from "./meteringSettings.js";
import { METERING_RESOURCES } from "./meteringLayout.js";

export function installMetering(services) {
  const sourceName = services.settings?.get("CP-F08.sourceResource") ?? "sceneColor";
  const maskName = services.settings?.get("CP-F08.maskResource") ?? null;
  if (typeof sourceName !== "string" || !sourceName || sourceName.startsWith("CP-F08.")) throw new TypeError("CP-F08 invalid source resource name");
  if (maskName !== null && (typeof maskName !== "string" || !maskName || maskName.startsWith("CP-F08."))) throw new TypeError("CP-F08 invalid mask resource name");
  const gpu = createMeteringGpu(services);
  let previousInput;
  let settings = resolveMeteringSettings();
  let disposed = false;
  let unregister;
  try {
    unregister = services.graph.register({
      id: "CP-F08.metering", owner: "CP-F08", stage: "metering", order: 800,
      reads: [...new Set([sourceName, ...(maskName ? [maskName] : [])])],
      writes: Object.values(METERING_RESOURCES), transformsColor: false,
      execute(context) {
        if (disposed) throw new Error("CP-F08 phase is disposed");
        if ((services.settings?.get("CP-F08.sourceResource") ?? "sceneColor") !== sourceName || (services.settings?.get("CP-F08.maskResource") ?? null) !== maskName) throw new Error("CP-F08 resource bindings changed; reinstall to declare the new graph reads");
        const input = context.settings?.get("CP-F08.settings");
        if (input !== previousInput) { settings = resolveMeteringSettings(input); previousInput = input; }
        const outputs = gpu.execute(context.frame, context.read(sourceName), maskName ? context.read(maskName) : null, settings);
        for (const [name, resource] of Object.entries(outputs)) context.publish(name, resource);
      }
    });
    services.report?.({ phase: "CP-F08", status: "implemented", referenceVerified: false, sourceResource: sourceName, maskResource: maskName, reads: "GPU-only scene radiance; no glare feedback or hot-path readback", floatBlendAvailable: gpu.floatBlendAvailable });
  } catch (error) { unregister?.(); gpu.dispose(); throw error; }
  return () => {
    if (disposed) return;
    disposed = true;
    unregister();
    gpu.dispose();
  };
}

export default Object.freeze({ id: "CP-F08", contractVersion: CONTRACT_VERSION, status: "implemented", install: installMetering });
