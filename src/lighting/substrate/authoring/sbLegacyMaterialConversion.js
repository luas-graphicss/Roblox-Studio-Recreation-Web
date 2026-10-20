import { sanitizeSlabParameters } from './sbSlabParameterValues.js';
import { legacyMaterialFor } from '../sbLegacyMaterialTable.js';

export const SB_LEGACY_CONVERSION_CONSTANTS = Object.freeze({
  anisotropyForBrushedMetal: 0.6, sheenFuzzAmount: 0.7, sheenFuzzRoughness: 0.4,
  coatRoughness: 0.2, coatF0: 0.04, coatThickness: 0.02,
  emissiveScaleForNeon: 4, verticalLayeringOperator: 'verticalLayering',
});

const neutralColor = Object.freeze([1, 1, 1]);

function toColorChannels(rawColor) {
  if (!Array.isArray(rawColor) || rawColor.length !== 3) return neutralColor.slice();
  return rawColor.map(channel => typeof channel === 'number' && Number.isFinite(channel) ? channel : 1);
}

function scaleColor(color, scale) {
  return color.map(channel => channel * scale);
}

function toFraction(rawValue) {
  if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) return 0;
  return Math.min(1, Math.max(0, rawValue));
}

function buildRequestedSlabParameters(entry, surfaceColor, transparency) {
  const constants = SB_LEGACY_CONVERSION_CONSTANTS;
  const color = toColorChannels(surfaceColor);
  const tint = scaleColor(color, entry.brightness);
  const isMetal = entry.metalness === 1;
  const requested = {
    albedo: isMetal ? [0, 0, 0] : tint,
    f0: isMetal ? tint : [entry.dielectricF0, entry.dielectricF0, entry.dielectricF0],
    roughness: entry.roughness,
    opacity: entry.opacity * (1 - toFraction(transparency)),
  };
  if (entry.features.anisotropic) requested.anisotropy = constants.anisotropyForBrushedMetal;
  if (entry.features.sheen) {
    requested.fuzzAmount = constants.sheenFuzzAmount;
    requested.fuzzRoughness = constants.sheenFuzzRoughness;
    requested.fuzzColor = neutralColor.slice();
  }
  if (entry.isEmissive) requested.emissive = scaleColor(color, constants.emissiveScaleForNeon);
  return requested;
}

function createCoatedTopology(baseSlab, opacity) {
  const constants = SB_LEGACY_CONVERSION_CONSTANTS;
  const coatSlab = sanitizeSlabParameters({ albedo: [0, 0, 0], f0: [constants.coatF0, constants.coatF0, constants.coatF0], roughness: constants.coatRoughness, opacity });
  return { operator: constants.verticalLayeringOperator, coverage: 1, thickness: constants.coatThickness, transmittanceColor: neutralColor.slice(), top: coatSlab, bottom: baseSlab };
}

export function convertLegacyMaterialToTopology(request = {}) {
  const { materialName, surfaceColor, transparency } = request;
  const entry = legacyMaterialFor(materialName);
  const requested = buildRequestedSlabParameters(entry, surfaceColor, transparency);
  const baseSlab = sanitizeSlabParameters(requested);
  return entry.features.coat ? createCoatedTopology(baseSlab, requested.opacity) : baseSlab;
}
