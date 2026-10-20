import { radianceFrom } from "./mlTemporalAccumulationCore.js";

export const HISTORY_TEXEL_FIELDS = Object.freeze([
  "diffuse",
  "specular",
  "diffuseSecondMoment",
  "specularSecondMoment",
  "accumulatedFrameCount",
  "depth",
  "normal",
]);

function finiteNumberOrFallback(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalFrom(value) {
  if (Array.isArray(value)) {
    return Object.freeze({
      x: finiteNumberOrFallback(value[0], 0),
      y: finiteNumberOrFallback(value[1], 0),
      z: finiteNumberOrFallback(value[2], 1),
    });
  }
  const source = value || {};
  return Object.freeze({
    x: finiteNumberOrFallback(source.x, 0),
    y: finiteNumberOrFallback(source.y, 0),
    z: finiteNumberOrFallback(source.z, 1),
  });
}


export function createHistoryTexel(request) {
  const input = request || {};
  return Object.freeze({
    diffuse: radianceFrom(input.diffuse),
    specular: radianceFrom(input.specular),
    diffuseSecondMoment: finiteNumberOrFallback(input.diffuseSecondMoment, 0),
    specularSecondMoment: finiteNumberOrFallback(input.specularSecondMoment, 0),
    accumulatedFrameCount: Math.max(0, Math.floor(finiteNumberOrFallback(input.accumulatedFrameCount, 0))),
    depth: finiteNumberOrFallback(input.depth, 0),
    normal: normalFrom(input.normal),
  });
}


export function createTemporalHistoryStore(request) {
  const input = request || {};
  let width = 0;
  let height = 0;
  let readTexels = [];
  let writeTexels = [];
  let writtenTexelCount = 0;
  let promotedFrameCount = 0;

  function texelCount() {
    return width * height;
  }




  function allocateSurface() {
    return new Array(texelCount()).fill(null);
  }


  function clearSurfaceInPlace(surface) {
    surface.fill(null);
    return surface;
  }

  function indexOf(pixelX, pixelY) {
    const x = Math.floor(finiteNumberOrFallback(pixelX, -1));
    const y = Math.floor(finiteNumberOrFallback(pixelY, -1));
    if (x < 0 || y < 0 || x >= width || y >= height) return -1;
    return y * width + x;
  }


  function resize(nextWidth, nextHeight) {
    const requestedWidth = Math.max(0, Math.floor(finiteNumberOrFallback(nextWidth, 0)));
    const requestedHeight = Math.max(0, Math.floor(finiteNumberOrFallback(nextHeight, 0)));
    if (requestedWidth === width && requestedHeight === height) return false;
    width = requestedWidth;
    height = requestedHeight;
    readTexels = allocateSurface();
    writeTexels = allocateSurface();
    writtenTexelCount = 0;
    return true;
  }

  resize(input.width, input.height);

  return {
    size: () => ({ width, height }),
    resize,

    clear() {
      clearSurfaceInPlace(readTexels);
      clearSurfaceInPlace(writeTexels);
      writtenTexelCount = 0;
    },


    readTexel(pixelX, pixelY) {
      const index = indexOf(pixelX, pixelY);
      return index < 0 ? null : readTexels[index];
    },


    writeTexel(pixelX, pixelY, texel) {
      const index = indexOf(pixelX, pixelY);
      if (index < 0) return false;
      if (writeTexels[index] === null) writtenTexelCount++;
      writeTexels[index] = createHistoryTexel(texel);
      return true;
    },

    writtenTexelCount: () => writtenTexelCount,


    swap() {


      const promotedSurface = writeTexels;
      writeTexels = clearSurfaceInPlace(readTexels);
      readTexels = promotedSurface;
      writtenTexelCount = 0;
      promotedFrameCount++;
      return promotedFrameCount;
    },

    promotedFrameCount: () => promotedFrameCount,

    describe() {
      let populatedReadTexelCount = 0;
      for (let index = 0; index < readTexels.length; index++) {
        if (readTexels[index] !== null) populatedReadTexelCount++;
      }
      return {
        width,
        height,
        texelCount: texelCount(),
        populatedReadTexelCount,
        writtenTexelCount,
        promotedFrameCount,
      };
    },
  };
}
