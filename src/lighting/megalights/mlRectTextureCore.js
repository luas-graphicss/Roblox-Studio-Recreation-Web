import {
  LIGHT_FUNCTION_CHANNEL_COUNT,
  LIGHT_FUNCTION_INTERIOR_SIZE,
  mipLevelForProjectedFootprint,
  readInteriorTexel,
  sampleSlotColorBilinear,
  writeColorCellIntoSlot,
} from "./mlLightFunctionAtlasCore.js";

export function rectSourcePointToFunctionUv(sourcePointU, sourcePointV) {
  const u = Number(sourcePointU);
  const v = Number(sourcePointV);
  return {
    u: Number.isFinite(u) ? Math.min(Math.max(u, 0), 1) : 0.5,
    v: Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : 0.5,
  };
}


export function resampleRectTextureToCell(image) {
  const width = image && Number.isInteger(image.width) ? image.width : 0;
  const height = image && Number.isInteger(image.height) ? image.height : 0;
  const pixels = image ? image.pixels : null;
  if (width <= 0 || height <= 0 || !pixels || pixels.length < width * height * LIGHT_FUNCTION_CHANNEL_COUNT) {
    throw new Error("ML-F6: rect texture needs width, height and width*height*4 bytes");
  }
  const size = LIGHT_FUNCTION_INTERIOR_SIZE;
  const cell = new Uint8Array(size * size * LIGHT_FUNCTION_CHANNEL_COUNT);
  for (let y = 0; y < size; y++) {
    const sourceY0 = Math.floor((y * height) / size);
    const sourceY1 = Math.max(sourceY0 + 1, Math.floor(((y + 1) * height) / size));
    for (let x = 0; x < size; x++) {
      const sourceX0 = Math.floor((x * width) / size);
      const sourceX1 = Math.max(sourceX0 + 1, Math.floor(((x + 1) * width) / size));
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      let count = 0;
      for (let sy = sourceY0; sy < sourceY1 && sy < height; sy++) {
        for (let sx = sourceX0; sx < sourceX1 && sx < width; sx++) {
          const from = (sy * width + sx) * LIGHT_FUNCTION_CHANNEL_COUNT;
          red += pixels[from];
          green += pixels[from + 1];
          blue += pixels[from + 2];
          alpha += pixels[from + 3];
          count++;
        }
      }
      const at = (y * size + x) * LIGHT_FUNCTION_CHANNEL_COUNT;
      cell[at] = Math.round(red / count);
      cell[at + 1] = Math.round(green / count);
      cell[at + 2] = Math.round(blue / count);
      cell[at + 3] = Math.round(alpha / count);
    }
  }
  return cell;
}

export function writeRectTextureIntoSlot(atlasPixels, slot, image) {
  const cell = resampleRectTextureToCell(image);
  writeColorCellIntoSlot(atlasPixels, slot, cell);
  return cell;
}


export function sampleRectTextureAtSourcePoint(atlasPixels, slot, sourcePointU, sourcePointV, mipLevel = 0) {
  const functionUv = rectSourcePointToFunctionUv(sourcePointU, sourcePointV);
  return sampleSlotColorBilinear(atlasPixels, slot, functionUv.u, functionUv.v, mipLevel);
}


export function mipLevelForRectSampleDensity(options) {
  const sampleCountPerPixel = Number(options && options.sampleCountPerPixel);
  const projectedRectPixels = Number(options && options.projectedRectPixels);
  if (!Number.isFinite(sampleCountPerPixel) || !Number.isFinite(projectedRectPixels)) return 0;
  const totalSamples = Math.max(sampleCountPerPixel, 0) * Math.max(projectedRectPixels, 0);
  return mipLevelForProjectedFootprint(Math.sqrt(totalSamples));
}


export function averageRectTextureColor(atlasPixels, slot, mipLevel = 0) {
  const size = LIGHT_FUNCTION_INTERIOR_SIZE >> mipLevel;
  let red = 0;
  let green = 0;
  let blue = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      red += readInteriorTexel(atlasPixels, slot, x, y, 0, mipLevel);
      green += readInteriorTexel(atlasPixels, slot, x, y, 1, mipLevel);
      blue += readInteriorTexel(atlasPixels, slot, x, y, 2, mipLevel);
    }
  }
  const texelCount = size * size;
  return { red: red / texelCount / 255, green: green / texelCount / 255, blue: blue / texelCount / 255 };
}
