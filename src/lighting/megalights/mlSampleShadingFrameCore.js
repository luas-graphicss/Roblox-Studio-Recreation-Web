import {
  SHADED_SIGNAL_CHANNELS,
  shadePixelSamples,
  shadedDiffuseTexel,
  shadedSpecularTexel,
} from "./mlSampleShadingCore.js";
import { createSampleShadingStats } from "./mlSampleShadingStatsCore.js";

export const SHADED_TEXEL_CHANNEL_COUNT = SHADED_SIGNAL_CHANNELS.length;
export const MINIMUM_COVERAGE_TO_SHADE = 0.5;


export function isCoveredSurface(surface) {
  if (!surface) return false;
  if (surface.coverage === undefined || surface.coverage === null) return true;
  return Number(surface.coverage) >= MINIMUM_COVERAGE_TO_SHADE;
}

function createTexelStore(pixelCount, collectTexels) {
  return collectTexels ? new Float64Array(pixelCount * SHADED_TEXEL_CHANNEL_COUNT) : null;
}

function writeTexel(store, pixelIndex, texel) {
  if (!store) return;
  const base = pixelIndex * SHADED_TEXEL_CHANNEL_COUNT;
  for (let channel = 0; channel < SHADED_TEXEL_CHANNEL_COUNT; channel++) {
    store[base + channel] = texel[channel];
  }
}

function newTotals() {
  return {
    diffuse: { r: 0, g: 0, b: 0 },
    specular: { r: 0, g: 0, b: 0 },
    sampleWeightSum: 0,
  };
}

function accumulateTotals(totals, shading) {
  totals.diffuse.r += shading.diffuse.r;
  totals.diffuse.g += shading.diffuse.g;
  totals.diffuse.b += shading.diffuse.b;
  totals.specular.r += shading.specular.r;
  totals.specular.g += shading.specular.g;
  totals.specular.b += shading.specular.b;
  totals.sampleWeightSum += shading.sampleWeightSum;
}


export function shadeFrame(request) {
  const settings = request || {};
  const width = Math.max(0, Math.floor(Number(settings.width) || 0));
  const height = Math.max(0, Math.floor(Number(settings.height) || 0));
  const samplesPerPixel = Math.max(1, Math.floor(Number(settings.samplesPerPixel) || 1));
  const readSurface = typeof settings.readSurface === "function" ? settings.readSurface : () => null;
  const readSamples = typeof settings.readSamples === "function" ? settings.readSamples : () => [];
  const collectTexels = settings.collectTexels === true;
  const stats = settings.stats || createSampleShadingStats();

  const pixelCount = width * height;
  const diffuse = createTexelStore(pixelCount, collectTexels);
  const specular = createTexelStore(pixelCount, collectTexels);
  const totals = newTotals();

  for (let pixelY = 0; pixelY < height; pixelY++) {
    for (let pixelX = 0; pixelX < width; pixelX++) {
      const pixelIndex = pixelY * width + pixelX;
      const surface = readSurface(pixelX, pixelY);

      if (!isCoveredSurface(surface)) {
        stats.addSkyPixel();
        continue;
      }

      const shading = shadePixelSamples({
        surface,
        samples: readSamples(pixelX, pixelY) || [],
        drawnSampleCount: samplesPerPixel,
      });

      stats.addPixel(shading.counters);
      writeTexel(diffuse, pixelIndex, shadedDiffuseTexel(shading));
      writeTexel(specular, pixelIndex, shadedSpecularTexel(shading));
      accumulateTotals(totals, shading);
    }
  }

  return {
    width,
    height,
    samplesPerPixel,
    channels: SHADED_SIGNAL_CHANNELS,
    diffuse,
    specular,
    totals: Object.freeze({
      diffuse: Object.freeze(totals.diffuse),
      specular: Object.freeze(totals.specular),
      sampleWeightSum: totals.sampleWeightSum,
    }),
    stats: stats.summary(),
  };
}


export function readShadedTexel(frame, pixelX, pixelY) {
  if (!frame || !frame.diffuse || !frame.specular) return null;
  if (pixelX < 0 || pixelY < 0 || pixelX >= frame.width || pixelY >= frame.height) return null;
  const base = (pixelY * frame.width + pixelX) * SHADED_TEXEL_CHANNEL_COUNT;
  return {
    diffuse: { r: frame.diffuse[base], g: frame.diffuse[base + 1], b: frame.diffuse[base + 2] },
    specular: { r: frame.specular[base], g: frame.specular[base + 1], b: frame.specular[base + 2] },
    sampleWeightSum: frame.diffuse[base + 3],
  };
}


export function readShadedRadiance(frame, pixelX, pixelY) {
  const texel = readShadedTexel(frame, pixelX, pixelY);
  if (!texel) return null;
  return {
    r: texel.diffuse.r + texel.specular.r,
    g: texel.diffuse.g + texel.specular.g,
    b: texel.diffuse.b + texel.specular.b,
  };
}
