import { makeTextureResource } from "../../contracts/frameContract.js";
import { DIRT_OWNER, DIRT_BINDINGS_KEY, DIRT_PROFILE, DIRT_RESOURCES } from "./dirtMaskContract.js";
import { createDirtMaskSettingsReader, isDirtMaskRequested } from "./dirtMaskSettings.js";
import { assertDirtMaskAsset } from "./dirtMaskAsset.js";
import { resolveDirtMaskBindings, dirtBindingSignature } from "./dirtMaskBindings.js";
import { readDirtColorDomain } from "./dirtColorDomain.js";
import { resolveDirtGlareInput } from "./dirtGlareInputs.js";
import { resolveDirtMaskMapping } from "./dirtMaskMapping.js";
import { createDirtMaskGpu } from "./dirtMaskGpu.js";

export function installDirtMask(services) {
  const bindings = resolveDirtMaskBindings(services.settings?.get?.(DIRT_BINDINGS_KEY));
  const signature = dirtBindingSignature(bindings);
  const readSettings = createDirtMaskSettingsReader(services.settings);
  const gpu = createDirtMaskGpu(services);
  let unregister;
  let disposed = false;
  try {
    unregister = services.graph.register({
      id: "CP-F17.composeDirt", owner: DIRT_OWNER, stage: "lensDirt", order: 1700,
      reads: ["$color", ...bindings.flatMap((binding) => [binding.resource, binding.metadata])],
      writes: Object.values(DIRT_RESOURCES), transformsColor: true,
      execute(context) {
        const currentBindings = resolveDirtMaskBindings(services.settings?.get?.(DIRT_BINDINGS_KEY));
        if (dirtBindingSignature(currentBindings) !== signature) throw new Error("CP-F17 glare bindings changed; reinstall the phase to update graph dependencies");
        const source = context.read("$color");
        const preExposure = readDirtColorDomain(source, context.frame, "CP-F17 current color", true);
        const settings = readSettings();
        const active = isDirtMaskRequested(settings);
        if (active && context.frame.referenceMode) throw new Error("CP-F17 BLOCKED_REFERENCE: no verified UE5.9 dirt profile");
        if (active && !bindings.length) throw new Error("CP-F17 missing explicit glare provider; scene color is not a substitute");
        if (active) assertDirtMaskAsset(settings.mask);
        const glareInputs = active ? bindings.map((binding) => resolveDirtGlareInput(binding, context.read(binding.resource), context.read(binding.metadata), source, context.frame)) : [];
        if (glareInputs.length === 2 && glareInputs[0].texture === glareInputs[1].texture) throw new Error("CP-F17 duplicate glare textures would double energy");
        const mapping = active ? resolveDirtMaskMapping(settings.mask, context.frame.outputSize, settings.fit, settings.outputRect) : null;
        const result = gpu.draw(source, context.frame, settings, mapping, glareInputs, active);
        const metadata = {
          ...(source.colorSpace === undefined ? {} : { colorSpace: source.colorSpace }),
          ...(source.formatPolicy ? { formatPolicy: Object.freeze({ ...source.formatPolicy, exactHdrEligible: false }) } : {}),
          transfer: "linear", samplerDecoded: false, preExposure, sourceProvenance: source.sourceProvenance ?? source.provenance,
          rangeValidation: DIRT_RESOURCES.rangeMask, isAlive: result.isAlive
        };
        const color = Object.freeze({ ...makeTextureResource(result.color, context.frame, source.encoding), ...metadata });
        context.publish(DIRT_RESOURCES.color, color);
        context.publish(DIRT_RESOURCES.rangeMask, Object.freeze({ ...makeTextureResource(result.rangeMask, context.frame, "dirt-fp16-range-invalid"), isAlive: result.isAlive }));
        context.publish(DIRT_RESOURCES.diagnostics, Object.freeze({
          frameId: context.frame.frameId, viewId: context.frame.viewId, generation: context.frame.generation, provenance: "gpu",
          value: Object.freeze({ profile: DIRT_PROFILE, active, referenceVerified: false, preExposure,
            composition: "currentColor + nonnegativeGlare * linearPremultipliedMask * linearTint * intensity",
            providers: bindings, providerExposureScales: glareInputs.map((input) => input.exposureScale),
            maskId: active ? settings.mask.id : null, maskProvenance: active ? settings.mask.provenance : null,
            mapping, rangePolicy: "finite-fp16-saturation-with-explicit-range-mask", alpha: "preserve-current-color", hud: "host-composites-after-post-process",
            resourceStats: gpu.stats(), drawCalls: 2, runtimeReadbacks: 0
          })
        }));
        return { color };
      }
    });
    services.report?.({ phase: DIRT_OWNER, status: "implemented", profile: DIRT_PROFILE, referenceVerified: false, bindings });
  } catch (error) {
    unregister?.();
    gpu.dispose();
    throw error;
  }
  return () => {
    if (disposed) return;
    disposed = true;
    unregister();
    gpu.dispose();
  };
}
