import { makeTextureResource } from "../../contracts/frameContract.js";
import { CHROMATIC_OWNER, CHROMATIC_PROFILE } from "./chromaticContract.js";

const TRANSPORT_FIELDS = Object.freeze([
  "colorSpace",
  "transfer",
  "preExposure",
  "samplerDecoded",
  "alphaMode",
  "outputTransform",
  "displayEncoded",
]);

export function createChromaticColor(source, rendered, frame, settings, geometry) {
  const transport = {};
  for (const key of TRANSPORT_FIELDS) if (source[key] !== undefined) transport[key] = source[key];
  const colorMetadata = { ...(source.colorMetadata ?? {}) };
  const applied = settings.enabled && settings.intensity > 0 && settings.startOffset < 1;
  if (applied)
    colorMetadata.chromaticAberration = Object.freeze({
      owner: CHROMATIC_OWNER,
      profile: CHROMATIC_PROFILE,
      applied: true,
      intensity: settings.intensity,
      startOffset: settings.startOffset,
      referenceVerified: false,
    });
  if (geometry.cropped)
    colorMetadata.lensCrop = Object.freeze({
      owner: CHROMATIC_OWNER,
      applied: true,
      cropUv: geometry.crop,
      sourceSize: Object.freeze([source.width, source.height]),
    });
  if (applied || geometry.cropped) colorMetadata.referenceVerified = false;
  return Object.freeze({
    ...makeTextureResource(rendered.target, frame, source.encoding),
    ...transport,
    colorMetadata: Object.freeze(colorMetadata),
    sourceProvenance: source.provenance,
    isAlive: rendered.isAlive,
  });
}
