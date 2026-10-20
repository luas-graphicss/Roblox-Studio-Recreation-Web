import { integer, finite, object } from "./captureValidation.js";

function greatestCommonDivisor(left, right) {
  while (right) [left, right] = [right, left % right];
  return left;
}

export function resolveCaptureSupport(effects) {
  if (!Array.isArray(effects)) throw new TypeError("Capture effects must declare their complete spatial support");
  let horizontal = 0;
  let vertical = 0;
  let alignment = 1;
  const owners = new Set();
  for (const effect of effects) {
    object(effect, "effect support", ["id", "radiusX", "radiusY", "alignment", "bounded", "scope"]);
    if (typeof effect.id !== "string" || !effect.id || owners.has(effect.id)) throw new Error("Effect support identifiers must be unique");
    owners.add(effect.id);
    if (effect.bounded !== true || effect.scope !== "serial-path") throw new Error(`Unbounded or unknown tile support: ${effect.id}`);
    horizontal += finite(effect.radiusX, "radiusX", 0, 32768);
    vertical += finite(effect.radiusY, "radiusY", 0, 32768);
    const lattice = integer(effect.alignment, "alignment", 1, 256);
    alignment = alignment * lattice / greatestCommonDivisor(alignment, lattice);
    if (alignment > 1024) throw new RangeError("Capture reduction lattice exceeds 1024 pixels");
  }
  return Object.freeze({ horizontal: Math.ceil(horizontal), vertical: Math.ceil(vertical), alignment, effects: Object.freeze(effects.map((effect) => Object.freeze({ ...effect }))), policy: "sum-of-serial-path-support-not-maximum" });
}

export function createCaptureTilePlan(options, support, maximumTextureSize) {
  integer(maximumTextureSize, "maximumTextureSize", 1, 65536);
  const width = Math.ceil(options.width * options.overscan);
  const height = Math.ceil(options.height * options.overscan);
  const crop = Object.freeze({ x: Math.floor((width - options.width) / 2), y: Math.floor((height - options.height) / 2), width: options.width, height: options.height });
  const alignment = support.alignment;
  const stepX = Math.floor(Math.min(options.tileWidth, maximumTextureSize) / alignment) * alignment;
  const stepY = Math.floor(Math.min(options.tileHeight, maximumTextureSize) / alignment) * alignment;
  if (stepX < 1 || stepY < 1) throw new RangeError("Tile size is smaller than the required lattice");
  const tiles = [];
  const floorAligned = (value) => Math.floor(value / alignment) * alignment;
  const ceilAligned = (value) => Math.ceil(value / alignment) * alignment;
  for (let y = 0; y < height; y += stepY) {
    for (let x = 0; x < width; x += stepX) {
      const right = Math.min(x + stepX, width);
      const top = Math.min(y + stepY, height);
      const leftBound = Math.max(0, floorAligned(x - support.horizontal - 1));
      const bottomBound = Math.max(0, floorAligned(y - support.vertical - 1));
      const rightBound = Math.min(width, ceilAligned(right + support.horizontal + 1));
      const topBound = Math.min(height, ceilAligned(top + support.vertical + 1));
      const renderWidth = rightBound - leftBound;
      const renderHeight = topBound - bottomBound;
      if (Math.max(renderWidth, renderHeight) > maximumTextureSize) throw new RangeError("Tile plus overlap exceeds GPU extent; reduce the tile interior");
      tiles.push(Object.freeze({ index: tiles.length, origin: Object.freeze([leftBound, bottomBound]), width: renderWidth, height: renderHeight, interior: Object.freeze({ x: x - leftBound, y: y - bottomBound, width: right - x, height: top - y }), destination: Object.freeze({ x, y, width: right - x, height: top - y }) }));
      if (tiles.length > 65536) throw new RangeError("Capture exceeds 65536 tiles");
    }
  }
  return Object.freeze({ fullSize: Object.freeze({ width, height }), crop, tiles: Object.freeze(tiles), support });
}
