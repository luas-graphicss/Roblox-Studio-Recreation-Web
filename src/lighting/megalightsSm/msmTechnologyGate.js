export const MSM_TECHNOLOGIES = Object.freeze(["ShadowMap", "Future"]);


export const LEGACY_MSM_TECHNOLOGIES = Object.freeze(["Voxel", "Compatibility"]);


export const DEFAULT_MSM_TECHNOLOGY = "ShadowMap";

const KNOWN_TECHNOLOGIES = Object.freeze([
  ...MSM_TECHNOLOGIES,
  ...LEGACY_MSM_TECHNOLOGIES,
]);

function readTechnologyText(value) {
  return typeof value === "string" ? value.trim() : "";
}


export function normalizeMsmTechnology(value) {
  const text = readTechnologyText(value);
  if (!text) return DEFAULT_MSM_TECHNOLOGY;
  const lowerCaseText = text.toLowerCase();
  const knownTechnology = KNOWN_TECHNOLOGIES.find(
    (candidate) => candidate.toLowerCase() === lowerCaseText,
  );
  return knownTechnology || "";
}


export function isMsmTechnology(value) {
  if (MSM_TECHNOLOGIES.indexOf(value) !== -1) return true;
  return MSM_TECHNOLOGIES.indexOf(normalizeMsmTechnology(value)) !== -1;
}


export function describeMsmTechnologyGate(value) {
  const raw = readTechnologyText(value);
  const technology = normalizeMsmTechnology(value);
  const informed = raw.length !== 0;

  if (!technology) {
    return {
      technology: "",
      raw,
      informed,
      allowed: false,
      reason:
        'Lighting.Technology "' +
        raw +
        '" is not part of the enum - the MSM only wakes on ' +
        MSM_TECHNOLOGIES.join(" or "),
    };
  }

  if (LEGACY_MSM_TECHNOLOGIES.indexOf(technology) !== -1) {
    return {
      technology,
      raw,
      informed,
      allowed: false,
      reason:
        "legacy Lighting.Technology " +
        technology +
        " - it must keep the image of today byte for byte, the MSM never wakes here",
    };
  }

  const defaultNote = informed ? "" : " (property absent, engine default applied)";
  const technologyNote =
    technology === "Future"
      ? "the original MegaLights-lite is blocked here on a weak GPU"
      : "home technology of the MSM";

  return {
    technology,
    raw,
    informed,
    allowed: true,
    reason: "Lighting.Technology " + technology + " - " + technologyNote + defaultNote,
  };
}
