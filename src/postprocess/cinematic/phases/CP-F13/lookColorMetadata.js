import { resolveWorkingColorSpace } from "../CP-F04/workingColorSpace.js";

const encodingSpaces = Object.freeze({
  "scene-linear-rec709": "rec709",
  "scene-linear-rec2020": "rec2020",
  "scene-linear-acescg": "acescg",
  "display-srgb": "rec709"
});
const descriptors = new Map();

export function describeLookColor(encoding) {
  if (!Object.hasOwn(encodingSpaces, encoding)) throw new TypeError(`Unsupported LUT color encoding: ${encoding}`);
  if (!descriptors.has(encoding)) {
    descriptors.set(encoding, Object.freeze({
      colorSpace: resolveWorkingColorSpace(encodingSpaces[encoding]),
      transfer: encoding === "display-srgb" ? "srgb" : "linear",
      samplerDecoded: false
    }));
  }
  return descriptors.get(encoding);
}

export function validateLookColorMetadata(input) {
  const expected = describeLookColor(input.encoding);
  if (input.transfer !== undefined && input.transfer !== expected.transfer) throw new TypeError("CP-F13 source transfer contradicts its encoding");
  if (input.samplerDecoded !== undefined && input.samplerDecoded !== false) throw new TypeError("CP-F13 requires raw buffer sampling without implicit decoding");
  if (input.alphaMode !== undefined && !["straight", "opaque"].includes(input.alphaMode)) throw new TypeError("CP-F13 requires straight or opaque alpha; unpremultiply explicitly upstream");
  if (input.colorSpace === undefined) return expected;
  if (typeof input.colorSpace === "string") {
    if (input.colorSpace !== expected.colorSpace.name) throw new TypeError("CP-F13 source primaries contradict its encoding");
    return expected;
  }
  const actual = resolveWorkingColorSpace(input.colorSpace);
  const expectedValues = [...expected.colorSpace.primaries.flat(), ...expected.colorSpace.whitePoint];
  const actualValues = [...actual.primaries.flat(), ...actual.whitePoint];
  if (actual.name !== expected.colorSpace.name || actualValues.some((value, index) => Math.abs(value - expectedValues[index]) > 1e-8)) throw new TypeError("CP-F13 source color-space metadata contradicts its encoding");
  if (input.colorSpace.rgbToXyz !== undefined) {
    const matrix = input.colorSpace.rgbToXyz;
    if ((!Array.isArray(matrix) && !ArrayBuffer.isView(matrix)) || matrix.length !== 9 || Array.from(matrix).some((value, index) => !Number.isFinite(value) || Math.abs(value - expected.colorSpace.rgbToXyz[index]) > 1e-7)) throw new TypeError("CP-F13 source color matrix contradicts its primaries");
  }
  return expected;
}
