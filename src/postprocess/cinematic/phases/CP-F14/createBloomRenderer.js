import { readBloomPreExposure } from "./bloomInputExposure.js";
import { createBloomGpuResources } from "./bloomGpuResources.js";
import { createBloomPyramidPlan } from "./bloomPyramidPlan.js";
import { BLOOM_DOWNSAMPLE_FRAGMENT } from "./bloomDownsample.glsl.js";
import { BLOOM_BLUR_FRAGMENT } from "./bloomBlur.glsl.js";
import { BLOOM_UPSAMPLE_FRAGMENT } from "./bloomUpsample.glsl.js";
import { BLOOM_GLARE_FRAGMENT, BLOOM_BLACK_FRAGMENT } from "./bloomGlare.glsl.js";
import { BLOOM_RANGE_FRAGMENT, BLOOM_COMPOSITION_FRAGMENT } from "./bloomComposition.glsl.js";
import { validateBloomInput, validateBloomServices } from "./validateBloomInput.js";

export function createBloomRenderer(services) {
  validateBloomServices(services);
  const gpu = createBloomGpuResources(services.pool, services.rendererAdapter);
  let cachedSettings;
  let cachedWidth;
  let cachedHeight;
  let cachedPlan;

  function planFor(source, settings) {
    if (settings !== cachedSettings || source.width !== cachedWidth || source.height !== cachedHeight) {
      cachedPlan = createBloomPyramidPlan(source.width, source.height, settings);
      cachedSettings = settings;
      cachedWidth = source.width;
      cachedHeight = source.height;
    }
    return cachedPlan;
  }

  function renderGlare(source, frame, settings) {
    validateBloomInput(source, frame, services.capabilities);
    const plan = planFor(source, settings);
    const acquire = gpu.begin(frame, source, plan);
    if (!plan.active) {
      const target = acquire("glare", 1, 1);
      gpu.draw("black", BLOOM_BLACK_FRAGMENT, {}, target);
      return { target, plan };
    }
    const bands = [];
    let previousTexture = source.texture;
    for (const level of plan.levels) {
      const outputSize = [level.width, level.height];
      const downsample = acquire(`downsample.${level.index}`, ...outputSize);
      gpu.draw("downsample", BLOOM_DOWNSAMPLE_FRAGMENT, {
        sourceTexture: previousTexture,
        outputSize,
        threshold: settings.threshold,
        softKnee: settings.softKnee,
        preExposure: readBloomPreExposure(source),
        extractHighlights: level.index === 0
      }, downsample);
      const horizontal = acquire(`horizontal.${level.index}`, ...outputSize);
      gpu.draw("blur", BLOOM_BLUR_FRAGMENT, { sourceTexture: downsample.texture, axis: [1, 0], filterScale: level.scale }, horizontal);
      const band = acquire(`band.${level.index}`, ...outputSize);
      gpu.draw("blur", BLOOM_BLUR_FRAGMENT, { sourceTexture: horizontal.texture, axis: [0, 1], filterScale: level.scale }, band);
      bands.push(band);
      previousTexture = band.texture;
    }
    let lower = null;
    for (let index = plan.levels.length - 1; index >= 0; index -= 1) {
      const level = plan.levels[index];
      const accumulation = acquire(`accumulation.${index}`, level.width, level.height);
      gpu.draw("upsample", BLOOM_UPSAMPLE_FRAGMENT, {
        bandTexture: bands[index].texture,
        lowerTexture: lower?.texture ?? bands[index].texture,
        outputSize: [level.width, level.height],
        bandGain: level.gain,
        hasLowerBand: lower !== null
      }, accumulation);
      lower = accumulation;
    }
    const target = acquire("glare", source.width, source.height);
    gpu.draw("glare", BLOOM_GLARE_FRAGMENT, {
      sourceTexture: lower.texture,
      outputSize: [source.width, source.height],
      intensity: settings.intensity,
      tintNormalization: plan.tintNormalization
    }, target);
    return { target, plan };
  }

  function compose(source, glare, frame, plan) {
    const acquire = gpu.begin(frame, source, plan);
    const values = { sourceTexture: source.texture, glareTexture: glare.texture, bloomActive: plan.active };
    const rangeMask = acquire("rangeMask", source.width, source.height, "r16f");
    gpu.draw("range", BLOOM_RANGE_FRAGMENT, values, rangeMask);
    const output = acquire("output", source.width, source.height);
    gpu.draw("composition", BLOOM_COMPOSITION_FRAGMENT, values, output);
    return { output, rangeMask };
  }

  return Object.freeze({ renderGlare, compose, materialCount: gpu.materialCount, dispose: gpu.dispose });
}
