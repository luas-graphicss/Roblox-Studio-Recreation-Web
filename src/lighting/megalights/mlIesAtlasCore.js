import {
  RSW_IESCK_CELL,
  cookiePresetCell,
  iesPresetProfile,
  iesProfileToCell,
  parseIesText,
  sampleCellBilinear,
} from "../iesCookieCore.js";
import {
  LIGHT_FUNCTION_CHANNEL_INDEX,
  LIGHT_FUNCTION_INTERIOR_SIZE,
  sampleSlotBilinear,
  writeMonochromeCellIntoSlot,
} from "./mlLightFunctionAtlasCore.js";


export const IES_ATLAS_PARITY_GATE = 1e-3;


export const IES_ATLAS_ENCODING = Object.freeze({
  horizontalAxis: "u = verticalAngleDegrees / 180",
  verticalAxis: "v = azimuthDegrees / 360",
  channels: "grayscale candela normalized by the profile peak, replicated over rgb",
});


export function assertEngineCellFitsSlotInterior() {
  if (LIGHT_FUNCTION_INTERIOR_SIZE !== RSW_IESCK_CELL) {
    throw new Error(
      "ML-F6: slot interior (" + LIGHT_FUNCTION_INTERIOR_SIZE + ") must equal the engine cell (" + RSW_IESCK_CELL + ")",
    );
  }
  return true;
}

export function parseIesProfile(text) {
  return parseIesText(text);
}

export function iesProfileFromPreset(presetName) {
  return iesPresetProfile(presetName);
}


export function iesDirectionToFunctionUv(verticalAngleDegrees, azimuthDegrees) {
  const vertical = Number(verticalAngleDegrees);
  const azimuth = Number(azimuthDegrees);
  const safeVertical = Number.isFinite(vertical) ? vertical : 0;
  const safeAzimuth = Number.isFinite(azimuth) ? azimuth : 0;
  const wrappedAzimuth = ((safeAzimuth % 360) + 360) % 360;
  return {
    u: Math.min(Math.max(safeVertical / 180, 0), 1),
    v: Math.min(Math.max(wrappedAzimuth / 360, 0), 1),
  };
}

export function iesProfileToAtlasCell(profile) {
  assertEngineCellFitsSlotInterior();
  return iesProfileToCell(profile);
}

export function writeIesProfileIntoSlot(atlasPixels, slot, profile) {
  const cell = iesProfileToAtlasCell(profile);
  writeMonochromeCellIntoSlot(atlasPixels, slot, cell);
  return cell;
}

export function writeIesPresetIntoSlot(atlasPixels, slot, presetName) {
  const profile = iesPresetProfile(presetName);
  if (!profile.ok) throw new Error("ML-F6: " + profile.error);
  return writeIesProfileIntoSlot(atlasPixels, slot, profile);
}

export function writeCookiePresetIntoSlot(atlasPixels, slot, presetName) {
  const cell = cookiePresetCell(presetName);
  if (!cell) throw new Error("ML-F6: unknown cookie preset: " + String(presetName));
  writeMonochromeCellIntoSlot(atlasPixels, slot, cell);
  return cell;
}


export function sampleIesFromAtlas(atlasPixels, slot, verticalAngleDegrees, azimuthDegrees, mipLevel = 0) {
  const functionUv = iesDirectionToFunctionUv(verticalAngleDegrees, azimuthDegrees);
  return sampleSlotBilinear(atlasPixels, slot, functionUv.u, functionUv.v, LIGHT_FUNCTION_CHANNEL_INDEX.red, mipLevel);
}


export function sampleIesFromEnginePerLightPath(engineCell, verticalAngleDegrees, azimuthDegrees) {
  const functionUv = iesDirectionToFunctionUv(verticalAngleDegrees, azimuthDegrees);
  return sampleCellBilinear(engineCell, functionUv.u, functionUv.v);
}


export function evaluateIesAtlasParity(options) {
  const { atlasPixels, slot, engineCell } = options;
  const verticalSteps = Number.isInteger(options.verticalSteps) ? options.verticalSteps : 37;
  const azimuthSteps = Number.isInteger(options.azimuthSteps) ? options.azimuthSteps : 25;
  let maxAbsoluteError = 0;
  let totalAbsoluteError = 0;
  let sampleCount = 0;
  let worstDirection = { verticalAngleDegrees: 0, azimuthDegrees: 0 };
  for (let vi = 0; vi < verticalSteps; vi++) {
    const verticalAngleDegrees = (vi / (verticalSteps - 1)) * 180;
    for (let ai = 0; ai < azimuthSteps; ai++) {
      const azimuthDegrees = (ai / (azimuthSteps - 1)) * 360;
      const fromAtlas = sampleIesFromAtlas(atlasPixels, slot, verticalAngleDegrees, azimuthDegrees);
      const fromEngine = sampleIesFromEnginePerLightPath(engineCell, verticalAngleDegrees, azimuthDegrees);
      const absoluteError = Math.abs(fromAtlas - fromEngine);
      if (absoluteError > maxAbsoluteError) {
        maxAbsoluteError = absoluteError;
        worstDirection = { verticalAngleDegrees, azimuthDegrees };
      }
      totalAbsoluteError += absoluteError;
      sampleCount++;
    }
  }
  return {
    sampleCount,
    maxAbsoluteError,
    meanAbsoluteError: sampleCount > 0 ? totalAbsoluteError / sampleCount : 0,
    worstDirection,
    gate: IES_ATLAS_PARITY_GATE,
    withinGate: maxAbsoluteError <= IES_ATLAS_PARITY_GATE,
  };
}
