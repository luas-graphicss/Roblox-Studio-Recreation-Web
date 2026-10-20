export const SHADOW_PAGE_TILE_SIZE = 256;
export const SINGLE_FACE_INDEX = 0;

function positiveIntegerOr(value, fallback) {
  const asInteger = Math.floor(Number(value));
  return Number.isFinite(asInteger) && asInteger > 0 ? asInteger : fallback;
}

function clampToUnitRange(value) {
  return Math.min(1, Math.max(0, Number(value)));
}

function isFiniteUvRect(uvRect) {
  if (!uvRect) return false;
  return [uvRect.minU, uvRect.minV, uvRect.maxU, uvRect.maxV].every((value) => Number.isFinite(Number(value)));
}

export function pagesPerAxisFor(mapSize, tileSize) {
  const resolvedMapSize = positiveIntegerOr(mapSize, SHADOW_PAGE_TILE_SIZE);
  const resolvedTileSize = positiveIntegerOr(tileSize, SHADOW_PAGE_TILE_SIZE);
  return Math.max(1, Math.ceil(resolvedMapSize / resolvedTileSize));
}

export function pageCountFor(mapSize, tileSize) {
  const pagesPerAxis = pagesPerAxisFor(mapSize, tileSize);
  return pagesPerAxis * pagesPerAxis;
}

export function pageKeyFor(lightKey, faceIndex, pageIndex) {
  return String(lightKey) + "|face" + Number(faceIndex) + "|page" + Number(pageIndex);
}

export function pageIndexFor(pagesPerAxis, pageX, pageY) {
  return pageY * pagesPerAxis + pageX;
}

export function pageUvRectFor(pagesPerAxis, pageX, pageY) {
  const pageSizeInUv = 1 / pagesPerAxis;
  return {
    minU: pageX * pageSizeInUv,
    minV: pageY * pageSizeInUv,
    maxU: (pageX + 1) * pageSizeInUv,
    maxV: (pageY + 1) * pageSizeInUv,
  };
}


export function buildShadowPageGrid(descriptor) {
  const source = descriptor || {};
  const lightKey = String(source.lightKey === undefined ? "light" : source.lightKey);
  const faceIndex = Number.isFinite(Number(source.faceIndex)) ? Number(source.faceIndex) : SINGLE_FACE_INDEX;
  const mapSize = positiveIntegerOr(source.mapSize, SHADOW_PAGE_TILE_SIZE);
  const tileSize = positiveIntegerOr(source.tileSize, SHADOW_PAGE_TILE_SIZE);
  const pagesPerAxis = pagesPerAxisFor(mapSize, tileSize);
  const pages = [];
  for (let pageY = 0; pagesPerAxis > pageY; pageY++) {
    for (let pageX = 0; pagesPerAxis > pageX; pageX++) {
      const pageIndex = pageIndexFor(pagesPerAxis, pageX, pageY);
      pages.push({
        pageKey: pageKeyFor(lightKey, faceIndex, pageIndex),
        lightKey: lightKey,
        faceIndex: faceIndex,
        pageIndex: pageIndex,
        pageX: pageX,
        pageY: pageY,
        uvRect: pageUvRectFor(pagesPerAxis, pageX, pageY),
      });
    }
  }
  return {
    lightKey: lightKey,
    faceIndex: faceIndex,
    mapSize: mapSize,
    tileSize: tileSize,
    pagesPerAxis: pagesPerAxis,
    pageCount: pages.length,
    pages: pages,
  };
}


export function pageRangeForUvRect(pagesPerAxis, uvRect) {
  if (!isFiniteUvRect(uvRect)) return null;
  const minU = Number(uvRect.minU);
  const minV = Number(uvRect.minV);
  const maxU = Number(uvRect.maxU);
  const maxV = Number(uvRect.maxV);
  const outsideTheMap = minU > 1 || minV > 1 || 0 > maxU || 0 > maxV || minU > maxU || minV > maxV;
  if (outsideTheMap) return null;
  const lastPage = pagesPerAxis - 1;
  const pageOf = (uvCoordinate) => Math.min(lastPage, Math.floor(clampToUnitRange(uvCoordinate) * pagesPerAxis));
  return {
    firstPageX: pageOf(minU),
    lastPageX: pageOf(maxU),
    firstPageY: pageOf(minV),
    lastPageY: pageOf(maxV),
  };
}

export function pageIndicesForUvRect(grid, uvRect) {
  if (!grid) return [];
  const range = pageRangeForUvRect(grid.pagesPerAxis, uvRect);
  if (!range) return [];
  const pageIndices = [];
  for (let pageY = range.firstPageY; range.lastPageY >= pageY; pageY++) {
    for (let pageX = range.firstPageX; range.lastPageX >= pageX; pageX++) {
      pageIndices.push(pageIndexFor(grid.pagesPerAxis, pageX, pageY));
    }
  }
  return pageIndices;
}

export function pageKeysForUvRect(grid, uvRect) {
  if (!grid) return [];
  return pageIndicesForUvRect(grid, uvRect).map((pageIndex) => pageKeyFor(grid.lightKey, grid.faceIndex, pageIndex));
}

export function uvRectsOverlap(first, second) {
  if (!isFiniteUvRect(first) || !isFiniteUvRect(second)) return false;
  return second.maxU >= first.minU && first.maxU >= second.minU && second.maxV >= first.minV && first.maxV >= second.minV;
}

export function unionOfUvRects(first, second) {
  if (!isFiniteUvRect(first)) return isFiniteUvRect(second) ? Object.assign({}, second) : null;
  if (!isFiniteUvRect(second)) return Object.assign({}, first);
  return {
    minU: Math.min(first.minU, second.minU),
    minV: Math.min(first.minV, second.minV),
    maxU: Math.max(first.maxU, second.maxU),
    maxV: Math.max(first.maxV, second.maxV),
  };
}
