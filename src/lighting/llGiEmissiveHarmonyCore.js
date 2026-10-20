export const HARMONY_REFUSAL = Object.freeze({
  LIGHT_PROXY: "light-proxy",
  EMISSIVE_ALREADY_INJECTED: "emissive-gi",
  NO_AREA: "no-area",
  BLACK_ALBEDO: "black-albedo",
});


export const EMISSIVE_GI_OWNED_SHARE = 1;
export const MIN_SURFEL_AREA = 1e-6;
export const MIN_ALBEDO_SUM = 1e-6;

function albedoSumOf(surfel) {
  const albedo = surfel && surfel.albedo;
  if (!albedo) return 0;
  return Math.max(Number(albedo[0]) || 0, 0) + Math.max(Number(albedo[1]) || 0, 0) + Math.max(Number(albedo[2]) || 0, 0);
}


export function harmonyRefusalFor(surfel, emissiveGiActive) {
  if (surfel && surfel.isLightProxy === true) return HARMONY_REFUSAL.LIGHT_PROXY;
  if (emissiveGiActive === true && Number(surfel && surfel.emissiveStrength) > 0) {
    return HARMONY_REFUSAL.EMISSIVE_ALREADY_INJECTED;
  }
  if (!(Number(surfel && surfel.area) > MIN_SURFEL_AREA)) return HARMONY_REFUSAL.NO_AREA;
  if (!(albedoSumOf(surfel) > MIN_ALBEDO_SUM)) return HARMONY_REFUSAL.BLACK_ALBEDO;
  return null;
}


export function harmonizeSurfels(options) {
  const input = options || {};
  const surfels = Array.isArray(input.surfels) ? input.surfels : [];
  const emissiveGiActive = input.emissiveGiActive === true;
  const kept = [];
  const dropped = [];
  const byReason = {};
  let keptArea = 0;
  let droppedArea = 0;

  for (let index = 0; index !== surfels.length; index += 1) {
    const surfel = surfels[index];
    const reason = harmonyRefusalFor(surfel, emissiveGiActive);
    const area = Math.max(Number(surfel && surfel.area) || 0, 0);
    if (reason) {
      byReason[reason] = (byReason[reason] || 0) + 1;
      dropped.push({ key: surfel && surfel.key !== undefined ? surfel.key : "surfel-" + index, reason: reason });
      droppedArea += area;
      continue;
    }
    kept.push(surfel);
    keptArea += area;
  }

  return {
    surfels: kept,
    dropped: dropped,
    byReason: byReason,
    keptArea: keptArea,
    droppedArea: droppedArea,
    emissiveGiActive: emissiveGiActive,
  };
}
