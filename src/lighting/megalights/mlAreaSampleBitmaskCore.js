export const AREA_SAMPLE_QUADRANT_COUNT = 4;
export const QUADRANT_BITS = Object.freeze([1, 2, 4, 8]);
export const ALL_QUADRANTS_ENABLED_MASK = 15;
export const NO_QUADRANT_ENABLED_MASK = 0;


export function quadrantRectangle(quadrantIndex) {
  const column = quadrantIndex - Math.floor(quadrantIndex / 2) * 2;
  const row = Math.floor(quadrantIndex / 2);
  return {
    minimumU1: column * 0.5,
    minimumU2: row * 0.5,
    maximumU1: column * 0.5 + 0.5,
    maximumU2: row * 0.5 + 0.5,
  };
}

export function quadrantIndexForUnitSquarePoint(u1, u2) {
  const column = u1 < 0.5 ? 0 : 1;
  const row = u2 < 0.5 ? 0 : 1;
  return column + 2 * row;
}


export function quadrantProbePoints(quadrantIndex) {
  const rectangle = quadrantRectangle(quadrantIndex);
  const middleU1 = (rectangle.minimumU1 + rectangle.maximumU1) * 0.5;
  const middleU2 = (rectangle.minimumU2 + rectangle.maximumU2) * 0.5;
  const columns = [rectangle.minimumU1, middleU1, rectangle.maximumU1];
  const rows = [rectangle.minimumU2, middleU2, rectangle.maximumU2];
  const probePoints = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    for (let columnIndex = 0; columnIndex < columns.length; columnIndex++) {
      probePoints.push({ u1: columns[columnIndex], u2: rows[rowIndex] });
    }
  }
  return probePoints;
}

export function isQuadrantEnabled(mask, quadrantIndex) {
  const shifted = Math.floor(mask / QUADRANT_BITS[quadrantIndex]);
  return shifted - Math.floor(shifted / 2) * 2 === 1;
}

export function enabledQuadrants(mask) {
  const indices = [];
  for (let quadrantIndex = 0; quadrantIndex < AREA_SAMPLE_QUADRANT_COUNT; quadrantIndex++) {
    if (isQuadrantEnabled(mask, quadrantIndex)) indices.push(quadrantIndex);
  }
  return indices;
}

export function enabledQuadrantCount(mask) {
  return enabledQuadrants(mask).length;
}


export function probabilityDensityScaleFor(mask) {
  const count = enabledQuadrantCount(mask);
  if (count === 0) return 1;
  return AREA_SAMPLE_QUADRANT_COUNT / count;
}


export function buildAreaSampleBitmask(canProbeContribute) {
  let mask = NO_QUADRANT_ENABLED_MASK;
  for (let quadrantIndex = 0; quadrantIndex < AREA_SAMPLE_QUADRANT_COUNT; quadrantIndex++) {
    const probePoints = quadrantProbePoints(quadrantIndex);
    for (let probeIndex = 0; probeIndex < probePoints.length; probeIndex++) {
      if (canProbeContribute(probePoints[probeIndex], quadrantIndex)) {
        mask += QUADRANT_BITS[quadrantIndex];
        break;
      }
    }
  }
  return mask;
}


export function remapUnitSquareWithBitmask(u1, u2, mask) {
  const enabled = enabledQuadrants(mask);

  if (enabled.length === 0) {
    return {
      u1: u1,
      u2: u2,
      quadrantIndex: quadrantIndexForUnitSquarePoint(u1, u2),
      probabilityDensityScale: 1,
      relaxedBecauseMaskIsEmpty: true,
    };
  }

  if (enabled.length === AREA_SAMPLE_QUADRANT_COUNT) {


    return {
      u1: u1,
      u2: u2,
      quadrantIndex: quadrantIndexForUnitSquarePoint(u1, u2),
      probabilityDensityScale: 1,
      relaxedBecauseMaskIsEmpty: false,
    };
  }

  const scaledU1 = u1 * enabled.length;
  const chosenSlot = Math.min(enabled.length - 1, Math.floor(scaledU1));
  const leftoverU1 = scaledU1 - chosenSlot;
  const chosenQuadrant = enabled[chosenSlot];
  const rectangle = quadrantRectangle(chosenQuadrant);

  return {
    u1: rectangle.minimumU1 + leftoverU1 * 0.5,
    u2: rectangle.minimumU2 + u2 * 0.5,
    quadrantIndex: chosenQuadrant,
    probabilityDensityScale: AREA_SAMPLE_QUADRANT_COUNT / enabled.length,
    relaxedBecauseMaskIsEmpty: false,
  };
}
