function getMaterialIndex(mesh, material) {
  if (mesh.material === material) return -1;
  if (!Array.isArray(mesh.material)) return null;
  const index = mesh.material.indexOf(material);
  if (index < 0 || mesh.material.lastIndexOf(material) !== index) return null;
  return index;
}

export function createSubstrateSmHostMaterialSlot({ mesh, material, isCurrent = () => true } = {}) {
  if (!mesh || !material) throw new TypeError('SSM_HOST_SLOT_REQUIRED');
  const index = getMaterialIndex(mesh, material);
  if (index === null) throw new TypeError('SSM_HOST_SLOT_AMBIGUOUS');
  const originalContainer = mesh.material;
  const originalCompile = material.onBeforeCompile;
  const originalKey = material.customProgramCacheKey;
  let candidate = null;
  let disposed = false;

  function read() {
    if (index === -1) return Array.isArray(mesh.material) ? null : mesh.material;
    return mesh.material === originalContainer ? mesh.material[index] : null;
  }

  function write(next) {
    if (index === -1) mesh.material = next;
    else originalContainer[index] = next;
  }

  function canCommit() {
    return !disposed && isCurrent() === true && read() === (candidate ?? material)
      && material.onBeforeCompile === originalCompile && material.customProgramCacheKey === originalKey;
  }

  function commit(next) {
    if (!next || next === material || candidate !== null || !canCommit()) return false;
    candidate = next;
    write(next);
    return true;
  }

  function restore() {
    if (candidate === null) return false;
    const restored = read() === candidate;
    if (restored) write(material);
    candidate = null;
    return restored;
  }

  function dispose() {
    if (disposed) return;
    restore();
    disposed = true;
  }

  return Object.freeze({
    canCommit, commit, restore, dispose,
    isSelected: () => !disposed && candidate !== null && read() === candidate,
    getOriginal: () => material,
    getCandidate: () => candidate,
  });
}
