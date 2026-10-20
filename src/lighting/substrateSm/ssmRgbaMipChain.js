export function throwIfSubstrateSmBakeAborted(signal) {
  if (signal?.aborted) {
    const error = new Error('Substrate SM bake was cancelled');
    error.name = 'AbortError';
    throw error;
  }
}

export function yieldSubstrateSmBakeTask() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

export async function buildSubstrateSmRgbaMipChain(baseData, layout, {
  signal, yieldControl = yieldSubstrateSmBakeTask, rowsPerSlice = 8,
} = {}) {
  if (!(baseData instanceof Uint8Array) || baseData.byteLength !== layout.levels[0].byteLength) {
    throw new TypeError('Mip generation requires exact RGBA8 base data');
  }
  if (!Number.isSafeInteger(rowsPerSlice) || rowsPerSlice < 1 || rowsPerSlice > 64) throw new RangeError('Invalid mip work slice');
  const levels = [{ width: layout.levels[0].width, height: layout.levels[0].height, data: baseData }];
  for (let levelIndex = 1; levelIndex < layout.levels.length; levelIndex += 1) {
    throwIfSubstrateSmBakeAborted(signal);
    const source = levels[levelIndex - 1];
    const description = layout.levels[levelIndex];
    const data = new Uint8Array(description.byteLength);
    const scaleX = source.width / description.width;
    const scaleY = source.height / description.height;
    for (let y = 0; y < description.height; y += 1) {
      if (y % rowsPerSlice === 0) {
        await yieldControl();
        throwIfSubstrateSmBakeAborted(signal);
      }
      const startY = y * scaleY;
      const endY = (y + 1) * scaleY;
      for (let x = 0; x < description.width; x += 1) {
        const startX = x * scaleX;
        const endX = (x + 1) * scaleX;
        const targetOffset = (y * description.width + x) * 4;
        for (let channel = 0; channel < 4; channel += 1) {
          let sum = 0;
          for (let sourceY = Math.floor(startY); sourceY < Math.ceil(endY); sourceY += 1) {
            const weightY = Math.min(endY, sourceY + 1) - Math.max(startY, sourceY);
            for (let sourceX = Math.floor(startX); sourceX < Math.ceil(endX); sourceX += 1) {
              const weightX = Math.min(endX, sourceX + 1) - Math.max(startX, sourceX);
              sum += source.data[(sourceY * source.width + sourceX) * 4 + channel] * weightX * weightY;
            }
          }
          const average = sum / (scaleX * scaleY);
          const lower = Math.floor(average);
          data[targetOffset + channel] = average - lower === 0.5 ? lower + lower % 2 : Math.round(average);
        }
      }
    }
    levels.push({ width: description.width, height: description.height, data });
  }
  return levels;
}
