import { MAX_BOKEH_SIDE } from "./lensFlareContract.js";
import { DEFAULT_BOKEH_SHAPE } from "./defaultBokehShape.js";
import { requireRecord, requireScalar } from "./lensFlareValidation.js";

const validatedShapes = new WeakSet();

export function resolveBokehShape(authored) {
  const shape = authored === undefined || authored === null || authored === "AUTO" ? DEFAULT_BOKEH_SHAPE : authored;
  if (validatedShapes.has(shape)) return shape;
  requireRecord(shape, "Bokeh shape", ["id", "revision", "width", "height", "origin", "encoding", "provenance", "license", "data"]);
  if (typeof shape.id !== "string" || !shape.id.length || shape.id.length > 160) throw new TypeError("Bokeh shape requires an explicit asset id");
  if (!Number.isSafeInteger(shape.revision) || shape.revision < 0) throw new TypeError("Bokeh shape requires a nonnegative revision");
  for (const dimension of [shape.width, shape.height]) {
    if (!Number.isInteger(dimension) || dimension < 1 || dimension > MAX_BOKEH_SIDE || dimension % 2 !== 1) throw new RangeError("Bokeh shape dimensions must be odd integers from 1 to 9; no implicit resampling");
  }
  if (shape.origin !== "bottom-left" || shape.encoding !== "linear-mask") throw new TypeError("Bokeh shape requires bottom-left linear-mask data");
  if (!["authored", "synthetic"].includes(shape.provenance) || typeof shape.license !== "string" || !shape.license.length) throw new TypeError("Bokeh shape requires provenance and license metadata");
  if ((!Array.isArray(shape.data) && !ArrayBuffer.isView(shape.data)) || shape.data.length !== shape.width * shape.height) throw new TypeError("Bokeh shape data length does not match its extent");
  const data = Array.from(shape.data, (value) => requireScalar(value, "Bokeh mask sample", 0, 1));
  const sum = data.reduce((total, value) => total + value, 0);
  if (!(sum > 0)) throw new RangeError("Bokeh shape must contain positive energy");
  const weights = Object.freeze(data.map((value) => value / sum));
  const signature = JSON.stringify([shape.width, shape.height, weights]);
  const result = Object.freeze({ ...shape, data: Object.freeze(data), weights, signature });
  validatedShapes.add(result);
  return result;
}

export function resolveBokehLayers(base, authoredLayers = []) {
  if (authoredLayers === null || authoredLayers === "AUTO") authoredLayers = [];
  if (!Array.isArray(authoredLayers) || authoredLayers.length > 32) throw new TypeError("Bokeh layers must be an ordered array of at most 32 overrides");
  let selected = resolveBokehShape(base);
  for (const layer of authoredLayers) {
    requireRecord(layer, "Bokeh layer", ["shape", "weight"]);
    const weight = requireScalar(layer.weight, "Bokeh layer weight", 0, 1);
    if (weight > 0) selected = resolveBokehShape(layer.shape);
  }
  return selected;
}
