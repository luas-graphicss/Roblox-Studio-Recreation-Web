import { createCocMaterials, assignCocUniforms } from "./createCocMaterials.js";
import { createCocTargets } from "./cocTargets.js";

export function createCocRenderer({ rendererAdapter: adapter, pool, capabilities }) {
  if (!capabilities?.webgl2 || !capabilities.floatColorBuffer) throw new Error("CP-F18 requires WebGL2 and floating-point color targets");
  if (!Number.isInteger(capabilities.maxTextureSize) || capabilities.maxTextureSize < 1) throw new Error("CP-F18 requires an explicit texture-size capability");
  for (const method of ["createMaterial", "draw"]) if (typeof adapter?.[method] !== "function") throw new TypeError(`CP-F18 requires rendererAdapter.${method}`);
  for (const method of ["acquire", "release", "stats"]) if (typeof pool?.[method] !== "function") throw new TypeError(`CP-F18 requires pool.${method}`);
  const targets = createCocTargets(pool, capabilities);
  const materials = createCocMaterials(adapter);
  let disposed = false;
  function draw(material, target) {
    if (disposed) throw new Error("CP-F18 renderer is disposed");
    if (adapter.context?.isContextLost()) throw new Error("CP-F18 WebGL context is lost; restore and advance the frame generation");
    for (const uniform of Object.values(material.uniforms)) if (uniform.value === target.texture) throw new Error("CP-F18 texture feedback is forbidden");
    adapter.draw(material, target);
  }
  return Object.freeze({
    setup(frame, plan, depth, coverage, policy) {
      if (adapter.context?.isContextLost()) throw new Error("CP-F18 WebGL context is lost; restore and advance the frame generation");
      const owned = targets.acquire(frame, plan);
      assignCocUniforms(materials.setup, {
        sourceDepth: depth.texture, sourceCoverage: coverage.texture, cameraPlanesMeters: [plan.camera.nearMeters, plan.camera.farMeters],
        maxOutputPixelsPerSensorMm: plan.maxOutputPixelsPerSensorMm, renderRadiusPerOutputRadius: plan.renderRadiusPerOutputRadius,
        opticalRadiusScale: plan.optics.radiusScaleMmMeters, focusDiopters: plan.optics.focusDiopters,
        maxRadiusOutputPixels: plan.settings.maxRadiusOutputPixels, cocEnabled: plan.settings.enabled,
        hardwareDepth: policy.hardwareDepth, coverageInAlpha: policy.coverageChannel === "a", skyPolicy: ["infinity", "focus", "exclude"].indexOf(plan.settings.skyPolicy)
      });
      draw(materials.setup, owned.fullResolution);
      return owned.fullResolution;
    },
    reduce(frame, plan, sourceCoc, sourceColor, policy) {
      const owned = targets.acquire(frame, plan);
      assignCocUniforms(materials.reduction, {
        sourceCoc: sourceCoc.texture, sourceColor: sourceColor.texture, sourceSize: [plan.renderSize.width, plan.renderSize.height], outputPerRenderPixel: plan.outputPerRenderPixel,
        downsampleFactor: plan.settings.downsampleFactor, alphaMode: ["straight", "premultiplied", "opaque"].indexOf(policy.alphaMode),
        focusThresholdOutputPixels: plan.settings.focusThresholdOutputPixels, smallRadiusOutputPixels: plan.settings.smallRadiusOutputPixels
      });
      for (const [outputKind, name] of ["reducedRadii", "nearColor", "farColor", "reducedInfo"].entries()) {
        materials.reduction.uniforms.outputKind.value = outputKind;
        draw(materials.reduction, owned[name]);
      }
      return owned;
    },
    classify(frame, plan, reducedRadii, reducedInfo) {
      const owned = targets.acquire(frame, plan);
      assignCocUniforms(materials.tiles, { reducedRadii: reducedRadii.texture, reducedInfo: reducedInfo.texture, reducedSize: [plan.reducedSize.width, plan.reducedSize.height], tileSize: plan.settings.tileSize });
      draw(materials.tiles, owned.tiles);
      return owned.tiles;
    },
    dilate(frame, plan, sourceTiles) {
      const owned = targets.acquire(frame, plan);
      assignCocUniforms(materials.dilation, { sourceTiles: sourceTiles.texture, tileGridSize: [plan.tileGridSize.width, plan.tileGridSize.height], dilationAxis: [1, 0], dilationReach: plan.dilationReach, tileExtentRenderPixels: plan.tileExtentRenderPixels });
      draw(materials.dilation, owned.horizontalTiles);
      assignCocUniforms(materials.dilation, { sourceTiles: owned.horizontalTiles.texture, dilationAxis: [0, 1] });
      draw(materials.dilation, owned.dilatedTiles);
      return owned.dilatedTiles;
    },
    dispose() { if (disposed) return; disposed = true; materials.dispose(); targets.dispose(); }
  });
}
