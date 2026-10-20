import { parseHdr, parseExrAsync, downsampleEquirect, rgbToRgbaHalf, hdriLumStats } from "../lighting/hdriCore.js";

const MAX_BAKED_INTENSITY = 8;
const DEFAULT_BAKED_INTENSITY = 1;


export function inflateWithDecompressionStream(compressedBytes) {
  if (typeof DecompressionStream === "undefined" || typeof Response === "undefined" || typeof Blob === "undefined") {
    return Promise.reject(new Error("exr: ZIP precisa de DecompressionStream (navegador sem suporte) — converta para .hdr"));
  }
  const inflatedStream = new Blob([compressedBytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Response(inflatedStream).arrayBuffer().then(function (inflatedBuffer) {
    return new Uint8Array(inflatedBuffer);
  });
}


function clampBakedIntensity(intensity) {
  const requested = Number(intensity);
  if (!Number.isFinite(requested)) return DEFAULT_BAKED_INTENSITY;
  return Math.min(MAX_BAKED_INTENSITY, Math.max(0, requested));
}

export async function decodeHdriJob(bytes, kind, maxSize, intensity) {
  const parsed = kind === "exr" ? await parseExrAsync(bytes, inflateWithDecompressionStream) : parseHdr(bytes);
  const sized = downsampleEquirect(parsed.data, parsed.width, parsed.height, maxSize);
  const bakedIntensity = clampBakedIntensity(intensity);
  const rawStats = hdriLumStats(sized.data);
  const stats = { avg: rawStats.avg * bakedIntensity, max: rawStats.max * bakedIntensity };
  const half = rgbToRgbaHalf(sized.data, intensity);
  return { width: sized.width, height: sized.height, half: half, stats: stats };
}
