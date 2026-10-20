export const META_UPLOAD_GATE_SOURCE = "LL-F14";

function isArrayLike(value) {
  return value !== null && typeof value === "object" && typeof value.length === "number";
}

export function createAtlasMetaUploadGate() {

  let uploadedMeta = null;
  let uploadCount = 0;
  let skippedUploadCount = 0;
  let snapshotAllocationCount = 0;

  function differsFromUploaded(meta) {
    if (uploadedMeta === null) return true;
    if (uploadedMeta.length !== meta.length) return true;
    for (let index = 0; meta.length > index; index += 1) {

      if (uploadedMeta[index] !== meta[index]) return true;
    }
    return false;
  }

  function storeUploaded(meta) {
    if (uploadedMeta === null || uploadedMeta.length !== meta.length) {
      uploadedMeta = new Float32Array(meta.length);
      snapshotAllocationCount += 1;
    }
    uploadedMeta.set(meta);
  }


  function shouldUpload(meta) {


    if (!isArrayLike(meta)) return true;
    if (!differsFromUploaded(meta)) {
      skippedUploadCount += 1;
      return false;
    }
    storeUploaded(meta);
    uploadCount += 1;
    return true;
  }


  function markUploaded(meta) {
    if (!isArrayLike(meta)) return false;
    storeUploaded(meta);
    uploadCount += 1;
    return true;
  }


  function invalidate() {
    uploadedMeta = null;
    return true;
  }


  function stats() {
    return Object.freeze({
      uploads: uploadCount,
      skippedUploads: skippedUploadCount,
      snapshotAllocations: snapshotAllocationCount,
      hasSnapshot: uploadedMeta !== null,
      snapshotLength: uploadedMeta === null ? 0 : uploadedMeta.length,
    });
  }

  function resetCounters() {
    uploadCount = 0;
    skippedUploadCount = 0;
    snapshotAllocationCount = 0;
    return stats();
  }

  return Object.freeze({ shouldUpload, markUploaded, invalidate, stats, resetCounters });
}
