import {
  LL_MAX_SHAPED_LIGHTS,
  diffuseSourceRadius,
  hasSourceShape,
} from "./llSourceShapeCore.js";


export const SHAPED_LIGHT_LOCAL_AXIS = Object.freeze({ x: 0, y: 1, z: 0 });


export const SHAPED_LIGHT_BUDGET_BY_TIER = Object.freeze({
  fraco: 0,
  medio: 4,
  forte: LL_MAX_SHAPED_LIGHTS,
});

const NUMERIC_EPSILON = 1e-8;


export function shapedLightBudgetForTier(tier) {
  const budget = SHAPED_LIGHT_BUDGET_BY_TIER[tier];
  const allowed = Number.isFinite(budget) ? budget : SHAPED_LIGHT_BUDGET_BY_TIER.medio;
  return Math.max(0, Math.min(allowed, LL_MAX_SHAPED_LIGHTS));
}


export function readSourceShapeProperties(authored) {
  const properties = authored && typeof authored === "object" ? authored : {};
  return {
    sourceRadius: Number(properties.SourceRadius) || 0,
    softSourceRadius: Number(properties.SoftSourceRadius) || 0,
    sourceLength: Number(properties.SourceLength) || 0,
  };
}


export function describeShapedLight(entry) {
  const candidate = entry && typeof entry === "object" ? entry : {};
  const shape = readSourceShapeProperties(candidate.authored);
  if (!hasSourceShape(shape)) return null;
  return {
    id: String(candidate.id || candidate.name || ""),
    radius: diffuseSourceRadius(shape),
    halfLength: Math.max(0, shape.sourceLength) * 0.5,
    matrixWorldElements: candidate.matrixWorldElements || null,
  };
}


export function selectShapedLights(entries, budget) {
  const candidates = (Array.isArray(entries) ? entries : [])
    .map(describeShapedLight)
    .filter((row) => row !== null);
  candidates.sort(
    (first, second) =>
      second.radius + second.halfLength - (first.radius + first.halfLength) ||
      (first.id < second.id ? -1 : first.id > second.id ? 1 : 0),
  );
  const allowed = Math.max(0, Math.min(Number(budget) || 0, LL_MAX_SHAPED_LIGHTS));
  const selected = candidates.slice(0, allowed);
  return {
    selected: selected,
    skippedCount: candidates.length - selected.length,
    signature: selected
      .map((row) => row.id + ":" + row.radius.toFixed(3) + ":" + row.halfLength.toFixed(3))
      .join("|"),
  };
}


export function transformPointByMatrix4(point, matrixElements) {
  const e = matrixElements;
  const x = point.x;
  const y = point.y;
  const z = point.z;
  const inverseW = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15] || 1);
  return {
    x: (e[0] * x + e[4] * y + e[8] * z + e[12]) * inverseW,
    y: (e[1] * x + e[5] * y + e[9] * z + e[13]) * inverseW,
    z: (e[2] * x + e[6] * y + e[10] * z + e[14]) * inverseW,
  };
}


export function transformDirectionByMatrix4(direction, matrixElements) {
  const e = matrixElements;
  const x = direction.x;
  const y = direction.y;
  const z = direction.z;
  const rotatedX = e[0] * x + e[4] * y + e[8] * z;
  const rotatedY = e[1] * x + e[5] * y + e[9] * z;
  const rotatedZ = e[2] * x + e[6] * y + e[10] * z;
  const length = Math.sqrt(rotatedX * rotatedX + rotatedY * rotatedY + rotatedZ * rotatedZ);
  if (length <= NUMERIC_EPSILON) return { x: 0, y: 0, z: 0 };
  return { x: rotatedX / length, y: rotatedY / length, z: rotatedZ / length };
}


export function readWorldPosition(matrixElements) {
  return { x: matrixElements[12], y: matrixElements[13], z: matrixElements[14] };
}


export function writeViewSpaceTable(target) {
  const settings = target && typeof target === "object" ? target : {};
  const rows = Array.isArray(settings.selected) ? settings.selected : [];
  const viewElements = settings.cameraMatrixWorldInverseElements;
  const centers = settings.centerViewArray;
  const halfAxes = settings.halfAxisViewArray;
  const radii = settings.radiusArray;
  if (!viewElements || !centers || !halfAxes || !radii) return 0;

  let writtenCount = 0;
  for (let index = 0; index !== rows.length && index !== LL_MAX_SHAPED_LIGHTS; index++) {
    const row = rows[index];
    if (!row || !row.matrixWorldElements) continue;
    const centerView = transformPointByMatrix4(readWorldPosition(row.matrixWorldElements), viewElements);
    const axisWorld = transformDirectionByMatrix4(SHAPED_LIGHT_LOCAL_AXIS, row.matrixWorldElements);
    const axisView = transformDirectionByMatrix4(axisWorld, viewElements);
    const slot = writtenCount * 3;
    centers[slot] = centerView.x;
    centers[slot + 1] = centerView.y;
    centers[slot + 2] = centerView.z;
    halfAxes[slot] = axisView.x * row.halfLength;
    halfAxes[slot + 1] = axisView.y * row.halfLength;
    halfAxes[slot + 2] = axisView.z * row.halfLength;
    radii[writtenCount] = row.radius;
    writtenCount++;
  }


  for (let index = writtenCount; index !== LL_MAX_SHAPED_LIGHTS; index++) {
    const slot = index * 3;
    centers[slot] = 0;
    centers[slot + 1] = 0;
    centers[slot + 2] = 0;
    halfAxes[slot] = 0;
    halfAxes[slot + 1] = 0;
    halfAxes[slot + 2] = 0;
    radii[index] = 0;
  }
  return writtenCount;
}
