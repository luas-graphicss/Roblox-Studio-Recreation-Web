import { validateSize } from "../../contracts/frameContract.js";

function integer(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new TypeError(`Invalid capture ${label}`);
  return value;
}

export function createDofCapturePlan(frame, settings, input) {
  const scale = settings.workingScale;
  if (input != null) {
    for (const jitter of [frame.jitterPixels ?? [0, 0], frame.previousJitterPixels ?? [0, 0]]) {
      if (!Array.isArray(jitter) || jitter.length !== 2 || jitter.some((value) => !Number.isFinite(value) || Math.abs(value) > 0.5)) throw new Error("CP-F20 capture requires jitter bounded to half a pixel per axis");
    }
  }
  const spatialSupportPixels = 2 * scale + 2;
  if (input == null) return Object.freeze({ key: "interactive", sampleIndex: null, fullSize: Object.freeze({ ...frame.renderSize }), origin: Object.freeze([0, 0]), interior: Object.freeze({ x: 0, y: 0, ...frame.renderSize }), requiredOverlapPixels: spatialSupportPixels, maximumMotionPixels: settings.maximumMotionPixels, tiled: false });
  if (typeof input !== "object" || Array.isArray(input)) throw new TypeError("CP-F20 capture requires an object");
  const allowed = ["sequenceId", "sampleIndex", "sampleCount", "fullSize", "origin", "interior", "maximumMotionPixels", "upstreamSupportPixels"];
  for (const key of Object.keys(input)) if (!allowed.includes(key)) throw new TypeError(`Unknown capture field: ${key}`);
  if (settings.mode !== "cinematic") throw new Error("Tiled/sample capture requires cinematic mode");
  if (typeof input.sequenceId !== "string" || !input.sequenceId.trim()) throw new TypeError("Capture sequenceId is required");
  const sampleCount = integer(input.sampleCount, "sampleCount", 1);
  const sampleIndex = integer(input.sampleIndex, "sampleIndex");
  if (sampleCount > settings.maximumSamples || sampleIndex >= sampleCount) throw new RangeError("Capture samples exceed the declared accumulation budget");
  validateSize(input.fullSize, "capture fullSize");
  const fullSize = { width: integer(input.fullSize.width, "fullSize.width", 1), height: integer(input.fullSize.height, "fullSize.height", 1) };
  const origin = input.origin;
  if (!Array.isArray(origin) || origin.length !== 2) throw new TypeError("Capture origin requires two pixel coordinates");
  origin.forEach((value) => integer(value, "origin"));
  if (origin.some((value) => value % scale !== 0)) throw new Error("Capture origins must align to the global reduction lattice");
  const interior = { x: input.interior?.x, y: input.interior?.y, width: input.interior?.width, height: input.interior?.height };
  integer(interior.x, "interior.x"); integer(interior.y, "interior.y");
  validateSize(interior, "capture interior");
  integer(interior.width, "interior.width", 1); integer(interior.height, "interior.height", 1);
  const motion = input.maximumMotionPixels;
  const support = input.upstreamSupportPixels;
  if (![motion, support].every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0)) throw new TypeError("Capture requires explicit finite motion and upstream support bounds");
  if (motion > settings.maximumMotionPixels) throw new RangeError("Capture motion exceeds CP-F20 motion policy");
  const requiredOverlapPixels = spatialSupportPixels + Math.ceil(support) + Math.ceil(motion * Math.max(sampleCount - 1, 0));
  integer(requiredOverlapPixels, "overlap", 1);
  const extents = [frame.renderSize.width, frame.renderSize.height];
  const fullExtents = [fullSize.width, fullSize.height];
  const interiorOffsets = [interior.x, interior.y];
  const interiorExtents = [interior.width, interior.height];
  for (let axis = 0; axis < 2; axis += 1) {
    if (origin[axis] + extents[axis] > fullExtents[axis] || interiorOffsets[axis] + interiorExtents[axis] > extents[axis]) throw new RangeError("Capture tile or interior lies outside its extent");
    const before = interiorOffsets[axis];
    const after = extents[axis] - before - interiorExtents[axis];
    if ((origin[axis] > 0 && before < requiredOverlapPixels) || (origin[axis] + extents[axis] < fullExtents[axis] && after < requiredOverlapPixels)) throw new Error(`Insufficient capture overlap; CP-F20 requires ${requiredOverlapPixels} pixels`);
  }
  return Object.freeze({ key: JSON.stringify([input.sequenceId, origin, fullSize, extents, interior, sampleCount, motion, support]), sampleIndex, sampleCount, fullSize: Object.freeze(fullSize), origin: Object.freeze([...origin]), interior: Object.freeze(interior), requiredOverlapPixels, maximumMotionPixels: motion, tiled: origin.some(Boolean) || extents.some((value, axis) => value !== fullExtents[axis]) });
}
