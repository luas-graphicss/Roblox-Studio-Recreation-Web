import { COC_SETUP_FRAGMENT } from "./cocSetupShader.js";
import { COC_REDUCTION_FRAGMENT } from "./cocReductionShader.js";
import { COC_TILE_FRAGMENT } from "./cocTileShader.js";
import { COC_DILATION_FRAGMENT } from "./cocDilationShader.js";

function uniforms(values) {
  return Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { value }]));
}

export function createCocMaterials(adapter) {
  const created = [];
  function material(shader, values) {
    const result = adapter.createMaterial(shader, uniforms(values));
    created.push(result);
    return result;
  }
  try {
    const setup = material(COC_SETUP_FRAGMENT, {
      sourceDepth: null, sourceCoverage: null, cameraPlanesMeters: [0.1, 1000], maxOutputPixelsPerSensorMm: 1, renderRadiusPerOutputRadius: [1, 1],
      opticalRadiusScale: 1, focusDiopters: 1, maxRadiusOutputPixels: 32, cocEnabled: true, hardwareDepth: false, coverageInAlpha: false, skyPolicy: 0
    });
    const reduction = material(COC_REDUCTION_FRAGMENT, {
      sourceCoc: null, sourceColor: null, sourceSize: [1, 1], outputPerRenderPixel: [1, 1],
      downsampleFactor: 2, outputKind: 0, alphaMode: 0, focusThresholdOutputPixels: 0.5, smallRadiusOutputPixels: 4
    });
    const tiles = material(COC_TILE_FRAGMENT, { reducedRadii: null, reducedInfo: null, reducedSize: [1, 1], tileSize: 8 });
    const dilation = material(COC_DILATION_FRAGMENT, { sourceTiles: null, tileGridSize: [1, 1], dilationAxis: [1, 0], dilationReach: 0, tileExtentRenderPixels: 16 });
    let disposed = false;
    return Object.freeze({ setup, reduction, tiles, dilation, dispose() { if (disposed) return; disposed = true; for (const item of created) item.dispose(); } });
  } catch (error) {
    for (const item of created) item.dispose();
    throw error;
  }
}

export function assignCocUniforms(material, values) {
  for (const [name, value] of Object.entries(values)) material.uniforms[name].value = value;
}
