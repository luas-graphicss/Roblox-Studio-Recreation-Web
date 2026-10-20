const sourceProperties = new Set([
  'SubstrateMaterial', 'SubstrateMaterialTree', 'Tree', 'Material', 'MaterialVariant', 'Color', 'Color3',
  'Transparency', 'Reflectance', 'ColorMap', 'NormalMap', 'RoughnessMap',
  'MetalnessMap', 'AlphaMode', 'TextureID', 'TextureId', 'Texture', 'MeshId',
  'MeshID', 'DoubleSided', 'RenderFidelity', 'Size',
]);

export function isSubstrateSmSourceProperty(property) {
  return sourceProperties.has(property);
}

export function findSubstrateSmHostOwner(mesh) {
  let current = mesh;
  let remaining = 256;
  while (current && remaining > 0) {
    if (current.userData?.rswId !== undefined) return current.userData.rswId;
    current = current.parent;
    remaining -= 1;
  }
  return null;
}

export function createSubstrateSmHostMaterialRegistry({ maxMaterials = 1024, onInvalidate, onRemove } = {}) {
  if (!Number.isSafeInteger(maxMaterials) || maxMaterials < 1 || maxMaterials > 2048) {
    throw new RangeError('SSM_HOST_MATERIAL_LIMIT_INVALID');
  }
  const records = new Map();
  const ownerIndex = new Map();
  let serial = 0;
  let disposed = false;
  let refused = 0;
  let references = 0;

  function addOwner(record, ownerId) {
    if (ownerId === null || record.ownerIds.has(ownerId)) return;
    let ownerRecords = ownerIndex.get(ownerId);
    if (!ownerRecords) {
      ownerRecords = new Set();
      ownerIndex.set(ownerId, ownerRecords);
    }
    ownerRecords.add(record);
    record.ownerIds.add(ownerId);
  }

  function remove(material, reason = 'SSM_HOST_MATERIAL_REMOVED') {
    const record = records.get(material);
    if (!record) return false;
    records.delete(material);
    material.removeEventListener('dispose', record.onDispose);
    for (const ownerId of record.ownerIds) {
      const ownerRecords = ownerIndex.get(ownerId);
      ownerRecords.delete(record);
      if (ownerRecords.size === 0) ownerIndex.delete(ownerId);
    }
    record.revision += 1;
    record.removed = true;
    references -= record.meshes.size;
    try { onRemove?.(record, reason); } finally {
      record.meshes.clear();
      record.ownerIds.clear();
    }
    return true;
  }

  function register(material, mesh, site = 'external') {
    if (disposed || !material || typeof material.addEventListener !== 'function'
      || typeof material.removeEventListener !== 'function') return null;
    let record = records.get(material);
    if (mesh && !record?.meshes.has(mesh) && references >= maxMaterials * 2) {
      refused += 1;
      return null;
    }
    if (!record) {
      if (records.size >= maxMaterials) { refused += 1; return null; }
      serial += 1;
      record = {
        id: `ssm-host-${serial}`, material, site, revision: 0, removed: false,
        meshes: new Set(), ownerIds: new Set(), onDispose: null,
      };
      record.onDispose = () => remove(material, 'SSM_HOST_MATERIAL_DISPOSED');
      material.addEventListener('dispose', record.onDispose);
      records.set(material, record);
    }
    if (mesh && !record.meshes.has(mesh)) {
      record.meshes.add(mesh);
      references += 1;
      addOwner(record, findSubstrateSmHostOwner(mesh));
    }
    return record;
  }

  function invalidateOwner(ownerId, property) {
    if (disposed || !isSubstrateSmSourceProperty(property)) return false;
    const affected = ownerIndex.get(ownerId);
    if (!affected) return false;
    for (const record of affected) {
      record.revision += 1;
      onInvalidate?.(record, 'SSM_HOST_SOURCE_CHANGED');
    }
    return true;
  }

  function removeOwner(ownerId) {
    const affected = ownerIndex.get(ownerId);
    if (!affected) return false;
    for (const record of affected) remove(record.material, 'SSM_HOST_OWNER_REMOVED');
    return true;
  }

  function invalidateAll(reason = 'SSM_HOST_STRUCTURE_CHANGED') {
    if (disposed || records.size === 0) return false;
    for (const record of records.values()) {
      record.revision += 1;
      onInvalidate?.(record, reason);
    }
    return true;
  }

  function clear(reason = 'SSM_HOST_REGISTRY_CLEARED') {
    for (const material of records.keys()) remove(material, reason);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    clear('SSM_HOST_REGISTRY_DISPOSED');
  }

  return Object.freeze({
    register, remove, invalidateOwner, removeOwner, invalidateAll, clear, dispose,
    get: material => records.get(material) ?? null,
    forEach: callback => records.forEach(callback),
    snapshot: () => ({ registered: records.size, owners: ownerIndex.size, references, refused, disposed }),
  });
}
