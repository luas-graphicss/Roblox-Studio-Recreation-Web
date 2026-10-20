export const METERING_RESOURCES = Object.freeze({
  exposure: "CP-F08.exposure",
  histogram: "CP-F08.histogram",
  statistics: "CP-F08.statistics",
  metadata: "CP-F08.metadata"
});

export function createMeteringLayout(width, height, maximumTextureSize, mode, includeHistogram) {
  if (![width, height, maximumTextureSize].every(Number.isInteger) || width < 1 || height < 1 || maximumTextureSize < 64 || width > maximumTextureSize || height > maximumTextureSize) throw new RangeError("CP-F08 invalid or unsupported texture extent");
  const statisticsLevels = [];
  if (mode !== "manual") {
    let columns = width;
    let rows = height;
    do {
      columns = Math.ceil(columns / 4);
      rows = Math.ceil(rows / 4);
      if (columns * 4 > maximumTextureSize) throw new RangeError("CP-F08 packed reduction exceeds maximum texture width");
      statisticsLevels.push({ width: columns * 4, height: rows, columns, rows });
    } while (columns > 1 || rows > 1);
  }
  const histogramLevels = [];
  if (includeHistogram) {
    let rows = Math.ceil(width * height / 256);
    if (rows > maximumTextureSize) throw new RangeError("CP-F08 histogram extent exceeds the GPU limit; use an explicit upstream resolution policy");
    histogramLevels.push({ width: 64, height: rows });
    while (rows > 1) { rows = Math.ceil(rows / 16); histogramLevels.push({ width: 64, height: rows }); }
  }
  const textureBytes = [...statisticsLevels, ...histogramLevels].reduce((sum, level) => sum + level.width * level.height * 4, 0) + 16 + (statisticsLevels.length ? 0 : 16) + (histogramLevels.length ? 0 : 256);
  return { statisticsLevels, histogramLevels, textureBytes, inputPixelCount: width * height };
}
