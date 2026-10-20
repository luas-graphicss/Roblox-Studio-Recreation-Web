function refusal(reason) {
  return Object.freeze({ ok: false, reason });
}

export function promoteSubstrateSmPoolInstance({ pools, record, meshes } = {}) {
  if (!pools?.has(record?.id) || !Array.isArray(meshes) || meshes.length === 0
    || meshes.some(mesh => mesh.visible !== false)) {
    return refusal("SSM_PROMOTION_HIDDEN_CANDIDATES_REQUIRED");
  }
  const binding = pools.preparePromotion(record.id, meshes);
  if (!binding?.ok) return binding || refusal("SSM_PROMOTION_BINDING_UNAVAILABLE");
  if (!pools.remove(record.id)) {
    binding.release();
    return refusal("SSM_PROMOTION_SOURCE_CHANGED");
  }
  for (const mesh of meshes) mesh.visible = true;
  return Object.freeze({ ok: true, meshes: Object.freeze([...meshes]), binding });
}

export function demoteSubstrateSmPoolInstance({ pools, record, promotion } = {}) {
  if (!promotion?.ok || !promotion.binding.isActive() || pools?.has(record?.id)) {
    return refusal("SSM_DEMOTION_ACTIVE_PROMOTION_REQUIRED");
  }
  if (!pools.add(record)) return refusal("SSM_DEMOTION_DESTINATION_REFUSED");
  for (const mesh of promotion.meshes) mesh.visible = false;
  promotion.binding.release();
  return Object.freeze({ ok: true });
}
