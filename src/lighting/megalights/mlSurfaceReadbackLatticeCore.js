export const UNMAPPED_LATTICE_INDEX = -1;

const CHANNELS_PER_TEXEL = 4;

export function createSurfaceReadbackLattice() {
  let fullWidth = 0;
  let fullHeight = 0;
  let latticeKey = "";


  let columnIsRequested = new Uint8Array(0);
  let rowIsRequested = new Uint8Array(0);

  let latticeColumnOfFullX = new Int32Array(0);
  let latticeRowOfFullY = new Int32Array(0);

  let sourceColumnCapacity = new Int32Array(0);
  let sourceRowCapacity = new Int32Array(0);
  let sourceColumnsView = null;
  let sourceRowsView = null;

  let columnCount = 0;
  let rowCount = 0;
  let isBuilt = false;
  let isDeclaring = false;
  let revision = 0;
  let offLatticeRequestCount = 0;

  function growTo(requestedFullWidth, requestedFullHeight) {
    if (columnIsRequested.length < requestedFullWidth) {
      columnIsRequested = new Uint8Array(requestedFullWidth);
      latticeColumnOfFullX = new Int32Array(requestedFullWidth);
      sourceColumnCapacity = new Int32Array(requestedFullWidth);
      sourceColumnsView = null;
    }
    if (rowIsRequested.length < requestedFullHeight) {
      rowIsRequested = new Uint8Array(requestedFullHeight);
      latticeRowOfFullY = new Int32Array(requestedFullHeight);
      sourceRowCapacity = new Int32Array(requestedFullHeight);
      sourceRowsView = null;
    }
  }


  function beginFrame(request) {
    const input = request || {};
    const requestedFullWidth = Math.max(0, Math.floor(Number(input.fullWidth) || 0));
    const requestedFullHeight = Math.max(0, Math.floor(Number(input.fullHeight) || 0));
    const requestedKey = String(input.latticeKey === undefined ? "" : input.latticeKey);
    offLatticeRequestCount = 0;

    const isStillValid =
      isBuilt &&
      requestedFullWidth === fullWidth &&
      requestedFullHeight === fullHeight &&
      requestedKey === latticeKey;
    if (isStillValid) {
      isDeclaring = false;
      return { declarationNeeded: false };
    }

    fullWidth = requestedFullWidth;
    fullHeight = requestedFullHeight;
    latticeKey = requestedKey;
    growTo(fullWidth, fullHeight);
    columnIsRequested.fill(0, 0, fullWidth);
    rowIsRequested.fill(0, 0, fullHeight);
    columnCount = 0;
    rowCount = 0;
    isBuilt = false;
    isDeclaring = true;
    return { declarationNeeded: true };
  }


  function requestColumn(fullX) {
    if (!isDeclaring) return false;
    const column = Math.floor(Number(fullX));
    if (!(column >= 0) || column >= fullWidth) return false;
    columnIsRequested[column] = 1;
    return true;
  }


  function requestRow(fullY) {
    if (!isDeclaring) return false;
    const row = Math.floor(Number(fullY));
    if (!(row >= 0) || row >= fullHeight) return false;
    rowIsRequested[row] = 1;
    return true;
  }


  function finishDeclaration() {
    if (!isDeclaring) return isBuilt;
    isDeclaring = false;

    columnCount = 0;
    for (let fullX = 0; fullX !== fullWidth; fullX += 1) {
      if (!columnIsRequested[fullX]) {
        latticeColumnOfFullX[fullX] = UNMAPPED_LATTICE_INDEX;
        continue;
      }
      latticeColumnOfFullX[fullX] = columnCount;
      sourceColumnCapacity[columnCount] = fullX;
      columnCount += 1;
    }

    rowCount = 0;
    for (let fullY = fullHeight - 1; fullY >= 0; fullY -= 1) {
      if (!rowIsRequested[fullY]) {
        latticeRowOfFullY[fullY] = UNMAPPED_LATTICE_INDEX;
        continue;
      }
      latticeRowOfFullY[fullY] = rowCount;
      sourceRowCapacity[rowCount] = fullHeight - 1 - fullY;
      rowCount += 1;
    }

    sourceColumnsView = columnCount > 0 ? sourceColumnCapacity.subarray(0, columnCount) : null;
    sourceRowsView = rowCount > 0 ? sourceRowCapacity.subarray(0, rowCount) : null;
    isBuilt = columnCount > 0 && rowCount > 0;

    revision += 1;
    return isBuilt;
  }


  function texelOffsetForFullPixel(fullX, fullY) {
    if (!isBuilt) return UNMAPPED_LATTICE_INDEX;
    if (!(fullX >= 0) || !(fullY >= 0) || fullX >= fullWidth || fullY >= fullHeight) {
      return UNMAPPED_LATTICE_INDEX;
    }
    const latticeColumn = latticeColumnOfFullX[fullX];
    const latticeRow = latticeRowOfFullY[fullY];
    if (latticeColumn === UNMAPPED_LATTICE_INDEX || latticeRow === UNMAPPED_LATTICE_INDEX) {


      offLatticeRequestCount += 1;
      return UNMAPPED_LATTICE_INDEX;
    }
    return (latticeRow * columnCount + latticeColumn) * CHANNELS_PER_TEXEL;
  }

  return {
    beginFrame,
    requestColumn,
    requestRow,
    finishDeclaration,
    texelOffsetForFullPixel,
    isBuilt: () => isBuilt,
    columnCount: () => columnCount,
    rowCount: () => rowCount,
    revision: () => revision,

    sourceColumns: () => sourceColumnsView,

    sourceRows: () => sourceRowsView,
    offLatticeRequestCount: () => offLatticeRequestCount,
    describe() {
      const gatheredTexelCount = columnCount * rowCount;
      const fullTexelCount = fullWidth * fullHeight;
      return {
        built: isBuilt,
        fullWidth,
        fullHeight,
        columnCount,
        rowCount,
        gatheredTexelCount,
        fullTexelCount,

        gatheredShareOfScreen: fullTexelCount > 0 ? gatheredTexelCount / fullTexelCount : 0,
        revision,
        offLatticeRequestCount,
        mustStayZero: "offLatticeRequestCount",
      };
    },
  };
}
