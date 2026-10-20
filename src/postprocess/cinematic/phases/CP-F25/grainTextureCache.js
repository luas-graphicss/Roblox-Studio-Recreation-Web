import { prepareGrainTexture } from "./grainTextureAsset.js";

export function createGrainTextureCache(THREE, maximumTextureSize = 1024) {
  let authored = null;
  let resident = null;
  let allocations = 0;
  let disposals = 0;
  let disposed = false;
  function release() {
    if (resident) { resident.texture.dispose(); resident = null; disposals += 1; }
    authored = null;
  }
  return Object.freeze({
    resolve(nextAsset) {
      if (disposed) throw new Error("CP-F25 texture cache is disposed");
      if (nextAsset === authored) return resident;
      if (nextAsset == null) { release(); return null; }
      const asset = prepareGrainTexture(nextAsset);
      if (asset.width > maximumTextureSize || asset.height > maximumTextureSize) throw new RangeError("CP-F25 grain texture exceeds the device limit");
      if (!THREE?.DataTexture) throw new Error("CP-F25 authored grain requires an injected texture uploader");
      const texture = new THREE.DataTexture(asset.samples, asset.width, asset.height, THREE.RedFormat, THREE.FloatType);
      texture.minFilter = THREE.NearestFilter;
      texture.magFilter = THREE.NearestFilter;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.colorSpace = THREE.NoColorSpace;
      texture.generateMipmaps = false;
      texture.flipY = false;
      texture.needsUpdate = true;
      release();
      resident = Object.freeze({ asset, texture });
      authored = nextAsset;
      allocations += 1;
      return resident;
    },
    release,
    stats: () => ({ allocations, disposals, liveTextures: resident ? 1 : 0, bytes: resident?.asset.bytes ?? 0 }),
    dispose() { if (disposed) return; release(); disposed = true; }
  });
}
