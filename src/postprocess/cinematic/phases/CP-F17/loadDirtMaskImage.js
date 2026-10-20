import { createDirtMaskAsset } from "./dirtMaskAsset.js";
import { decodeDirtMaskImage } from "./decodeDirtMaskImage.js";
import { readBoundedImageBlob } from "./readBoundedImageBlob.js";

export async function loadDirtMaskImage(url, { id = url, signal, fetchImage = globalThis.fetch, decodeImage = decodeDirtMaskImage, maximumDownloadBytes = 16777216 } = {}) {
  if (typeof url !== "string" || !url.trim() || /^(?:javascript|vbscript|file):/i.test(url)) throw new TypeError("Dirt mask URL must be a fetchable image URL");
  if (!Number.isInteger(maximumDownloadBytes) || maximumDownloadBytes < 1) throw new RangeError("Dirt mask download budget must be positive");
  if (typeof fetchImage !== "function" || typeof decodeImage !== "function") throw new TypeError("Dirt loader requires fetch and image-decoding services");
  signal?.throwIfAborted();
  const response = await fetchImage(url, { signal, credentials: "omit" });
  if (!response.ok) throw new Error(`Dirt mask download failed: HTTP ${response.status}`);
  const contentType = (response.headers.get("content-type") ?? "").split(";")[0];
  if (!["image/png", "image/jpeg", "image/webp"].includes(contentType)) throw new TypeError("Dirt mask loader accepts PNG, JPEG or WebP only");
  const declaredBytes = Number(response.headers.get("content-length"));
  if (declaredBytes > maximumDownloadBytes) {
    await response.body?.cancel?.().catch(() => {});
    throw new RangeError("Dirt mask download exceeds its byte budget");
  }
  const blob = await readBoundedImageBlob(response, { maximumBytes: maximumDownloadBytes, signal });
  signal?.throwIfAborted();
  const decoded = await decodeImage(blob);
  signal?.throwIfAborted();
  return createDirtMaskAsset({ ...decoded, id, provenance: "authored", source: url });
}
