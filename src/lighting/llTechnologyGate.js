export const LOCAL_LIGHT_TECHNOLOGIES = Object.freeze(["ShadowMap", "Future"]);


export const LEGACY_LOCAL_LIGHT_TECHNOLOGIES = Object.freeze(["Voxel", "Compatibility"]);


export const DEFAULT_LIGHTING_TECHNOLOGY = "ShadowMap";

function matchKnownTechnology(text) {
  const wanted = text.toLowerCase();
  const known = LOCAL_LIGHT_TECHNOLOGIES.concat(LEGACY_LOCAL_LIGHT_TECHNOLOGIES);
  for (const technology of known) {
    if (technology.toLowerCase() === wanted) return technology;
  }
  return "";
}


export function normalizeLightingTechnology(value) {
  if (value === null || value === undefined) return DEFAULT_LIGHTING_TECHNOLOGY;
  const text = String(value).trim();
  if (!text) return DEFAULT_LIGHTING_TECHNOLOGY;
  return matchKnownTechnology(text);
}


export function isLocalLightTechnology(value) {
  return LOCAL_LIGHT_TECHNOLOGIES.indexOf(normalizeLightingTechnology(value)) !== -1;
}


export function describeLocalLightTechnologyGate(value) {
  const technology = normalizeLightingTechnology(value);

  if (!technology) {
    return {
      technology: String(value).trim(),
      allowed: false,
      reason:
        "unknown Lighting.Technology \"" + String(value).trim() + "\" - refused, local lights need ShadowMap or Future",
    };
  }

  if (LOCAL_LIGHT_TECHNOLOGIES.indexOf(technology) !== -1) {
    return {
      technology,
      allowed: true,
      reason: "Technology " + technology + " - local-light phases are the local lights of this technology",
    };
  }

  return {
    technology,
    allowed: false,
    reason: "Technology " + technology + " keeps the legacy local-light path byte for byte",
  };
}
