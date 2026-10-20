export const MATERIAL_OWNER = "CP-F26";
export const MATERIAL_SESSION_KEY = "CP-F26.materialSession";
export const MATERIAL_QUALITY_TIERS = Object.freeze(["diagnostic", "low", "medium", "high", "cinematic"]);
export const MATERIAL_LOCATIONS = Object.freeze({
  beforeDof: Object.freeze({ stage: "beforeDof", order: 2600, domain: "scene-linear", source: "$color", branch: false }),
  afterDof: Object.freeze({ stage: "afterDof", order: 2600, domain: "scene-linear", source: "$color", branch: false }),
  translucencyAfterDof: Object.freeze({ stage: "afterDof", order: 3600, domain: "any", source: "translucencyAfterDof", branch: true }),
  ssrInput: Object.freeze({ stage: "afterTemporal", order: 2600, domain: "scene-linear", source: "ssrInput", branch: true }),
  beforeBloom: Object.freeze({ stage: "beforeBloom", order: 2600, domain: "scene-linear", source: "$color", branch: false }),
  replacingTonemapper: Object.freeze({ stage: "toneMapping", order: 2600, domain: "scene-linear", source: "$color", branch: false }),
  afterTonemapping: Object.freeze({ stage: "afterOutput", order: 2600, domain: "display", source: "$color", branch: false })
});
export const MATERIAL_FORMAT_BYTES = Object.freeze({ rgba16f: 8, rgba8: 4, rg16f: 4, r16f: 2, r32f: 4 });
export const DISPLAY_ENCODINGS = Object.freeze(["display-linear-rec709", "display-linear-rec2020", "display-srgb"]);
