import { TRANSLUCENCY_FRAGMENT } from "./translucencyShader.js";
import { createBridgeTargetManager } from "./bridgeGpuTargets.js";
import { readBridgePreExposure } from "./bridgeInputs.js";
import { requireNumber } from "./bridgeValidation.js";

const samplerBindings = Object.freeze({ uBackgroundColor: ["background", "color"], uForegroundColor: ["foreground", "color"], uBackgroundCoverage: ["background", "coverage"], uForegroundCoverage: ["foreground", "coverage"], uBackgroundReactive: ["background", "reactive"], uForegroundReactive: ["foreground", "reactive"], uBackgroundVelocity: ["background", "velocity"], uForegroundVelocity: ["foreground", "velocity"] });

export function createBridgeGpuRenderer(services, configuration) {
  const adapter = services.rendererAdapter;
  const capabilities = services.capabilities ?? adapter?.capabilities;
  if (!capabilities?.webgl2 || !capabilities.floatColorBuffer || !Number.isInteger(capabilities.maxTextureUnits) || capabilities.maxTextureUnits < 9 || !Number.isInteger(capabilities.maxTextureSize)) throw new Error("CP-F27 requires WebGL2, float color buffers and nine texture units");
  if (!["createMaterial", "draw"].every((name) => typeof adapter?.[name] === "function") || configuration.gpuValidation === "readback" && typeof adapter.readTarget !== "function") throw new TypeError("CP-F27 requires a compatible GPU adapter");
  const targetManager = createBridgeTargetManager(services.pool, configuration.maxViews);
  let material = null;
  let disposed = false;
  function render(frame, stage, slot, background, foreground, enabled) {
    if (disposed) throw new Error("CP-F27 GPU renderer is disposed");
    if (adapter.context?.isContextLost()) throw new Error("CP-F27 context lost; reinstall after device restoration");
    if (background.color.width > capabilities.maxTextureSize || background.color.height > capabilities.maxTextureSize) throw new Error("CP-F27 texture extent exceeds device capability");
    if (!material) {
      const uniforms = Object.fromEntries(Object.keys(samplerBindings).map((name) => [name, { value: null }]));
      Object.assign(uniforms, { uPreviousValidation: { value: null }, uHasPreviousValidation: { value: false }, uExposureScale: { value: 1 }, uEnabled: { value: true }, uOutputKind: { value: 0 } });
      material = adapter.createMaterial(TRANSLUCENCY_FRAGMENT, uniforms);
    }
    const groups = { background, foreground };
    for (const [name, [group, kind]] of Object.entries(samplerBindings)) material.uniforms[name].value = groups[group][kind].texture;
    material.uniforms.uPreviousValidation.value = background.validation?.texture ?? background.color.texture;
    material.uniforms.uHasPreviousValidation.value = Boolean(background.validation);
    const exposureScale = readBridgePreExposure(background.color) / readBridgePreExposure(foreground.color);
    requireNumber(exposureScale, "layer exposure ratio", Number.MIN_VALUE, 3.402823466e38);
    if (Math.fround(exposureScale) === 0) throw new RangeError("CP-F27 exposure ratio underflows a GPU float");
    material.uniforms.uExposureScale.value = exposureScale;
    material.uniforms.uEnabled.value = enabled;
    const targets = targetManager.acquire(frame, stage, slot, background.color);
    const inputTextures = new Set(Object.values(groups).flatMap((group) => Object.values(group).map((resource) => resource.texture)));
    for (const target of Object.values(targets)) if (inputTextures.has(target.texture)) throw new Error("CP-F27 texture feedback rejected before drawing");
    material.uniforms.uOutputKind.value = 4;
    adapter.draw(material, targets.validation);
    if (configuration.gpuValidation === "readback") {
      const pixels = adapter.readTarget(targets.validation);
      if (!pixels || pixels.length !== targets.validation.width * targets.validation.height * 4) throw new Error("CP-F27 validation readback is incomplete");
      for (let index = 0; index < pixels.length; index += 4) if (pixels[index] !== 0) throw new Error(`CP-F27 invalid GPU sample at pixel ${index / 4}: alpha, coverage, motion, nonfinite radiance or FP16 overflow`);
    }
    ["color", "coverage", "reactive", "velocity"].forEach((kind, index) => {
      material.uniforms.uOutputKind.value = index;
      adapter.draw(material, targets[kind]);
    });
    return targets;
  }
  return Object.freeze({ render, releaseView: targetManager.releaseView, dispose() { if (disposed) return; disposed = true; targetManager.dispose(); material?.dispose(); material = null; } });
}
