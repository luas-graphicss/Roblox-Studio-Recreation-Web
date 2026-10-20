import { assertLookAsset } from "./lookAsset.js";
import { describeLutTexture, packLutTexture } from "./lutTextureLayout.js";

export function createLutTextureCache(adapter, { maximumEntries = 8, budgetBytes = 32 * 1024 * 1024 } = {}) {
  if (!Number.isInteger(maximumEntries) || maximumEntries < 1 || !Number.isFinite(budgetBytes) || budgetBytes <= 0) throw new TypeError("Invalid LUT cache budget");
  const records = [];
  let clock = 0;
  let builds = 0;
  let disposals = 0;
  let disposed = false;
  const totalBytes = () => records.reduce((sum, record) => sum + record.layout.bytes, 0);
  function remove(record) {
    record.texture.dispose();
    records.splice(records.indexOf(record), 1);
    disposals += 1;
  }
  function clear() {
    while (records.length) remove(records[0]);
  }
  function makeRecord(look, backend) {
    const { layout, data } = packLutTexture(look.table, backend);
    const { THREE } = adapter;
    const texture = backend === "3d" ? new THREE.Data3DTexture(data, layout.width, layout.height, layout.depth) : new THREE.DataTexture(data, layout.width, layout.height, THREE.RGBAFormat, THREE.FloatType);
    texture.format = THREE.RGBAFormat;
    texture.type = THREE.FloatType;
    texture.internalFormat = "RGBA32F";
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.wrapR = THREE.ClampToEdgeWrapping;
    texture.colorSpace = THREE.NoColorSpace;
    texture.generateMipmaps = false;
    texture.flipY = false;
    texture.unpackAlignment = 1;
    texture.name = `CP-F13.${look.id}.${backend}`;
    texture.needsUpdate = true;
    const record = { look, backend, layout, texture, lastUsed: ++clock };
    records.push(record);
    builds += 1;
    return record;
  }
  return Object.freeze({
    acquire(looks, backend) {
      if (disposed) throw new Error("LUT cache is disposed");
      const unique = [...new Set(looks)].map(assertLookAsset);
      const layouts = unique.map((look) => describeLutTexture(look.table.size, backend));
      const requestedBytes = layouts.reduce((sum, layout) => sum + layout.bytes, 0);
      const max3dSize = backend === "3d" ? adapter.context.getParameter(adapter.context.MAX_3D_TEXTURE_SIZE) : Infinity;
      if (unique.length > maximumEntries || requestedBytes > budgetBytes) throw new RangeError("Active LUT set exceeds the explicit texture cache budget");
      for (const layout of layouts) if (layout.width > adapter.capabilities.maxTextureSize || layout.height > adapter.capabilities.maxTextureSize || layout.depth > max3dSize) throw new RangeError("LUT dimensions exceed the device texture capability");
      const protectedRecords = records.filter((record) => record.backend === backend && unique.includes(record.look));
      const missing = unique.filter((look) => !protectedRecords.some((record) => record.look === look));
      const missingBytes = missing.reduce((sum, look) => sum + describeLutTexture(look.table.size, backend).bytes, 0);
      while (records.length + missing.length > maximumEntries || totalBytes() + missingBytes > budgetBytes) {
        const oldest = records.filter((record) => !protectedRecords.includes(record)).sort((left, right) => left.lastUsed - right.lastUsed)[0];
        if (!oldest) throw new RangeError("Cannot evict an active LUT");
        remove(oldest);
      }
      for (const look of missing) makeRecord(look, backend);
      return unique.map((look) => {
        const record = records.find((entry) => entry.look === look && entry.backend === backend);
        record.lastUsed = ++clock;
        return record;
      });
    },
    stats: () => ({ entries: records.length, textureBuilds: builds, textureDisposals: disposals, declaredGpuBytes: totalBytes(), retainedPackedCpuBytes: totalBytes(), budgetBytes, accounting: "declared RGBA32F storage; driver overhead excluded" }),
    clear,
    dispose() { if (disposed) return; disposed = true; clear(); }
  });
}
