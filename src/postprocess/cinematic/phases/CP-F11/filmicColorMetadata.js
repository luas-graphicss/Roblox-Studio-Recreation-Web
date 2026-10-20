const REC709_PRIMARIES = [[0.64, 0.33], [0.30, 0.60], [0.15, 0.06]];
const D65_WHITE_POINT = [0.3127, 0.3290];
const COORDINATE_TOLERANCE = 1e-8;

function requireCoordinates(actual, expected, label) {
  if (!Array.isArray(actual) || actual.length !== expected.length || expected.some((value, index) => typeof actual[index] !== "number" || !Number.isFinite(actual[index]) || Math.abs(actual[index] - value) > COORDINATE_TOLERANCE)) {
    throw new TypeError(label + " contradicts the declared color space");
  }
}

function requireWhitePoint(value, label) {
  if (value === undefined || value === "D65") return;
  requireCoordinates(value, D65_WHITE_POINT, label + " white point");
}

function requireMetadata(metadata, label) {
  if (metadata === undefined) return {};
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new TypeError(label + " metadata must be an object");
  return metadata;
}

export function validateFilmicSourceColor(source) {
  const colorSpace = source.colorSpace;
  const name = typeof colorSpace === "string" ? colorSpace : colorSpace?.name;
  if (colorSpace !== undefined && name !== "rec709") throw new Error("CP-F11 requires explicit Rec709 source primaries");
  if (colorSpace?.primaries !== undefined) {
    if (!Array.isArray(colorSpace.primaries) || colorSpace.primaries.length !== 3) throw new TypeError("CP-F11 requires three Rec709 primaries");
    REC709_PRIMARIES.forEach((primary, index) => requireCoordinates(colorSpace.primaries[index], primary, "CP-F11 Rec709 primary"));
  }
  requireWhitePoint(colorSpace?.whitePoint, "CP-F11 Rec709");
  const metadata = requireMetadata(source.colorMetadata, "CP-F11");
  if (metadata.colorPrimaries !== undefined && metadata.colorPrimaries !== "rec709") throw new Error("CP-F11 source primaries contradict Rec709 encoding");
  if (metadata.transferFunction !== undefined && metadata.transferFunction !== "linear") throw new Error("CP-F11 source metadata requires linear transfer");
  requireWhitePoint(metadata.whitePoint, "CP-F11 Rec709");
}

export function resolveFilmicReplacementMetadata(encoding, authored) {
  const metadata = requireMetadata(authored, "Replacement");
  const colorPrimaries = encoding === "display-linear-rec2020" ? "rec2020" : "rec709";
  const transferFunction = encoding === "display-srgb" ? "srgb" : "linear";
  if (metadata.colorPrimaries !== undefined && metadata.colorPrimaries !== colorPrimaries) throw new Error("Replacement primaries contradict output encoding");
  if (metadata.transferFunction !== undefined && metadata.transferFunction !== transferFunction) throw new Error("Replacement transfer contradicts output encoding");
  requireWhitePoint(metadata.whitePoint, "Replacement");
  for (const key of ["referenceWhiteNits", "peakNits"]) {
    if (metadata[key] !== undefined && (typeof metadata[key] !== "number" || !Number.isFinite(metadata[key]) || metadata[key] <= 0)) throw new TypeError("Replacement luminance metadata must be positive and finite");
  }
  if (metadata.peakNits !== undefined && metadata.referenceWhiteNits !== undefined && metadata.peakNits < metadata.referenceWhiteNits) throw new Error("Replacement peak luminance cannot be below reference white");
  return Object.freeze({ ...metadata, colorPrimaries, transferFunction, whitePoint: "D65", referenceVerified: false });
}
