const SSM_MAXIMUM_FLOAT32 = 3.4028234663852886e38;
const SSM_BASE_PARAMETER_NAMES = new Set([
  "diffuseReflectance",
  "perceptualRoughness",
  "specularF0",
  "coverage",
  "emissiveRadiance",
  "opacity",
  "extinctionCoefficient",
  "layerThickness",
  "extensionWeight",
  "extensionRoughness",
  "anisotropy",
  "anisotropyRotation",
  "extensionTint",
  "diffuseWrap",
  "specularF90",
  "reflectionRoughness",
  "thinTransmissionWeight",
  "reserved",
  "reservedVector",
]);

export function isSubstrateSmFiniteScalar(value, minimum = 0, maximum = 1) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

export function isSubstrateSmFiniteColor(value, maximum = 1) {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    [0, 1, 2].every((channel) => isSubstrateSmFiniteScalar(value[channel], 0, maximum))
  );
}

export function copySubstrateSmReductionValue(value) {
  const ancestors = new Set();
  let copiedObjects = 0;
  function copy(entry, depth) {
    if (entry === null || typeof entry !== "object") return entry;
    copiedObjects += 1;
    if (ancestors.has(entry)) throw new TypeError("Reduction values must not contain cycles");
    if (depth > 64 || copiedObjects > 16384)
      throw new TypeError("Reduction value copy exceeded its safety bound");
    ancestors.add(entry);
    const result = Array.isArray(entry)
      ? entry.map((child) => copy(child, depth + 1))
      : Object.fromEntries(Object.entries(entry).map(([name, child]) => [name, copy(child, depth + 1)]));
    ancestors.delete(entry);
    return result;
  }
  return copy(value, 0);
}

export function freezeSubstrateSmReductionValue(value) {
  const visited = new Set();
  function freeze(entry) {
    if (entry === null || typeof entry !== "object" || visited.has(entry)) return entry;
    visited.add(entry);
    for (const child of Object.values(entry)) freeze(child);
    return Object.freeze(entry);
  }
  return freeze(value);
}

export function findSubstrateSmReductionSurfaceProblem(surface) {
  if (!surface || surface.family !== "base" || !surface.parameters || Array.isArray(surface.parameters))
    return "Only resolved base surfaces can be reduced by SSM-F06";
  const parameters = surface.parameters;
  if (Object.keys(parameters).some((name) => !SSM_BASE_PARAMETER_NAMES.has(name)))
    return "Unknown surface fields must be audited by their owning phase";
  for (const name of ["diffuseReflectance", "specularF0", "extensionTint"]) {
    if (!isSubstrateSmFiniteColor(parameters[name]))
      return `${name} must contain three finite reflectance channels in [0, 1]`;
  }
  if (!isSubstrateSmFiniteScalar(parameters.specularF90))
    return "specularF90 must be a finite scalar in [0, 1]";
  for (const name of ["perceptualRoughness", "reflectionRoughness"]) {
    if (!isSubstrateSmFiniteScalar(parameters[name], 0.02, 1)) return `${name} must be in [0.02, 1]`;
  }
  if (!isSubstrateSmFiniteColor(parameters.emissiveRadiance, SSM_MAXIMUM_FLOAT32))
    return "emissiveRadiance must contain three finite nonnegative float32 channels";
  if (parameters.opacity !== 1 || parameters.coverage !== 1)
    return "SSM-F06 does not flatten leaf transparency or hidden coverage weights";
  for (const name of [
    "extensionWeight",
    "anisotropy",
    "thinTransmissionWeight",
    "diffuseWrap",
    "layerThickness",
    "reserved",
  ]) {
    if (parameters[name] !== 0) return `${name} needs its owning optical phase`;
  }
  if (
    !isSubstrateSmFiniteScalar(parameters.extensionRoughness) ||
    !isSubstrateSmFiniteScalar(parameters.anisotropyRotation, 0, Math.PI)
  )
    return "Inactive extension parameters must remain finite";
  if (
    !isSubstrateSmFiniteColor(parameters.extinctionCoefficient) ||
    parameters.extinctionCoefficient.some((channel) => channel !== 0)
  )
    return "Leaf absorption needs an explicit verticalLayering operator";
  if (
    !Array.isArray(parameters.reservedVector) ||
    parameters.reservedVector.length !== 4 ||
    [0, 1, 2, 3].some((index) => parameters.reservedVector[index] !== 0)
  )
    return "Reserved recipe channels must remain zero";
  return null;
}

export function createSubstrateSmReductionRefusal(code, sourcePath, reason) {
  return { code, sourcePath, reason };
}

export function createSubstrateSmReductionLoss(
  sourcePath,
  operation,
  classification,
  reason,
  estimatedLoss = null,
) {
  const replacement =
    classification === "exact"
      ? "Preserved resolved response"
      : classification === "fitted"
        ? "One effective base response"
        : "Retain the previously working backend";
  return {
    sourcePath,
    operation,
    classification,
    replacement,
    reason,
    estimatedLoss,
    measuredLoss: null,
    evidenceStatus: "unmeasured",
  };
}
