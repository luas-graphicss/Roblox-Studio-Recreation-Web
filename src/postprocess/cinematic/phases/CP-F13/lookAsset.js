import { assertLutTable } from "./lutTable.js";
import { validateSampling } from "./lutSampling.js";

export const LOOK_ENCODINGS = Object.freeze({ "scene-linear-rec709": "scene", "scene-linear-rec2020": "scene", "scene-linear-acescg": "scene", "display-srgb": "display" });
const validatedLooks = new WeakSet();

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} requires explicit non-empty text`);
  return value;
}

function copyProvenance(provenance) {
  if (!provenance || !["synthetic", "authored", "external"].includes(provenance.type)) throw new TypeError("Look provenance must be explicit");
  return Object.freeze({ type: provenance.type, source: requireText(provenance.source, "Provenance source"), version: requireText(provenance.version, "Provenance version") });
}

export function createLookAsset({ id, table, kind, inputEncoding, outputEncoding, interpolation = "trilinear", boundary = "extrapolate", provenance, externalTransform = null }) {
  requireText(id, "Look id");
  assertLutTable(table);
  if (table.dimension !== 3) throw new TypeError("Bake a 1D table into a 3D table explicitly before creating a GPU look");
  if (!["scene-linear-hdr", "creative-ldr", "external-transform"].includes(kind)) throw new TypeError("Look kind must distinguish HDR, creative LDR, and external transforms");
  if (!Object.hasOwn(LOOK_ENCODINGS, inputEncoding) || !Object.hasOwn(LOOK_ENCODINGS, outputEncoding)) throw new TypeError("Unsupported or missing explicit color encoding");
  if (kind === "creative-ldr" && (inputEncoding !== "display-srgb" || outputEncoding !== "display-srgb")) throw new TypeError("A creative LDR LUT requires display-srgb input and output; it cannot grade scene HDR implicitly");
  if (kind === "scene-linear-hdr" && (LOOK_ENCODINGS[inputEncoding] !== "scene" || inputEncoding !== outputEncoding)) throw new TypeError("A scene HDR look must preserve its declared scene-linear encoding");
  validateSampling(interpolation, boundary);
  const source = copyProvenance(provenance);
  let transform = null;
  if (kind === "external-transform") {
    if (source.type !== "external" || !externalTransform) throw new TypeError("External transforms require external provenance and processor metadata");
    transform = Object.freeze(Object.fromEntries(["processor", "version", "config", "configHash", "transform", "source"].map((field) => [field, requireText(externalTransform[field], `External ${field}`)])));
  } else if (externalTransform !== null) {
    throw new TypeError("Processor metadata belongs only to external-transform looks");
  }
  const look = Object.freeze({ id, table, kind, inputEncoding, outputEncoding, interpolation, boundary, provenance: source, externalTransform: transform, schemaVersion: 1 });
  validatedLooks.add(look);
  return look;
}

export function assertLookAsset(look) {
  if (!validatedLooks.has(look)) throw new TypeError("Look must be created by createLookAsset");
  return look;
}
