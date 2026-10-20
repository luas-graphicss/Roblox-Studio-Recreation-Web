import { assertDirtMaskAsset, copyDirtMaskPixels } from "./dirtMaskAsset.js";
import { MAX_MASK_BYTES } from "./dirtMaskContract.js";

export function createDirtMaskTextureCache(adapter, { maximumEntries = 2, maximumBytes = MAX_MASK_BYTES } = {}) {
  if (!Number.isInteger(maximumEntries) || maximumEntries < 1 || !Number.isFinite(maximumBytes) || maximumBytes < 16) throw new RangeError("Invalid dirt mask texture cache budget");
  const records = new Map();
  let uploads = 0;
  let disposals = 0;
  let residentBytes = 0;
  let disposed = false;

  function remove(asset) {
    const record = records.get(asset);
    if (!record) return;
    record.texture.dispose();
    records.delete(asset);
    residentBytes -= record.bytes;
    disposals += 1;
  }

  function acquire(asset) {
    if (disposed) throw new Error("Dirt mask texture cache is disposed");
    assertDirtMaskAsset(asset);
    const cached = records.get(asset);
    if (cached) {
      records.delete(asset);
      records.set(asset, cached);
      return cached;
    }
    const bytes = asset.width * asset.height * 16;
    if (bytes > maximumBytes || Math.max(asset.width, asset.height) > adapter.capabilities.maxTextureSize) throw new RangeError("Dirt mask exceeds device or cache texture budget");
    if (typeof adapter.THREE?.DataTexture !== "function") throw new Error("Dirt mask upload requires the Three DataTexture adapter");
    const { THREE } = adapter;
    const pixels = copyDirtMaskPixels(asset);
    const texture = new THREE.DataTexture(pixels, asset.width, asset.height, THREE.RGBAFormat, THREE.FloatType);
    try {
      texture.internalFormat = "RGBA32F";
      texture.minFilter = THREE.NearestFilter;
      texture.magFilter = THREE.NearestFilter;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.colorSpace = THREE.NoColorSpace;
      texture.generateMipmaps = false;
      texture.flipY = false;
      texture.unpackAlignment = 1;
      texture.name = `CP-F17.mask.${asset.id}`;
      texture.needsUpdate = true;
    } catch (error) {
      texture.dispose();
      throw error;
    }
    while (records.size >= maximumEntries || residentBytes + bytes > maximumBytes) remove(records.keys().next().value);
    const record = Object.freeze({ asset, texture, bytes });
    records.set(asset, record);
    residentBytes += bytes;
    uploads += 1;
    return record;
  }

  return Object.freeze({
    acquire,
    stats: () => ({ entries: records.size, uploads, disposals, declaredTextureBytes: residentBytes, retainedUploadCpuBytes: residentBytes, maximumBytes }),
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const asset of [...records.keys()]) remove(asset);
    }
  });
}
