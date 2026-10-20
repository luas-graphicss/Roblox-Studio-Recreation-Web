import { GRADING_CONTROLS, normalizeGradingSettings, requireFinite } from "./gradingSettings.js";
import { createWhiteBalanceMatrix, IDENTITY_MATRIX, transformRgb } from "./whiteBalance.js";

export const LUMINANCE_WEIGHTS = Object.freeze([0.2126, 0.7152, 0.0722]);
export const MAX_HALF_FLOAT = 65504;

function effectiveControl(region, name) {
  const vector = region[name];
  return vector.slice(0, 3).map((component) => name === "offset" ? component + vector[3] : component * vector[3]);
}

export function compileGrading(input) {
  const settings = normalizeGradingSettings(input);
  const whiteBalanceMatrix = createWhiteBalanceMatrix(settings.whiteBalance);
  const zones = ["shadows", "midtones", "highlights"].map((name) => Object.freeze(Object.fromEntries(GRADING_CONTROLS.map((control) => {
    const globalValue = effectiveControl(settings.global, control);
    const zoneValue = effectiveControl(settings[name], control);
    return [control, Object.freeze(globalValue.map((value, index) => control === "offset" ? value + zoneValue[index] : value * zoneValue[index]))];
  }))));
  const controlsNeutral = zones.every((zone) => GRADING_CONTROLS.every((control) => zone[control].every((value) => value === (control === "offset" ? 0 : 1))));
  const whiteBalanceNeutral = whiteBalanceMatrix === IDENTITY_MATRIX;
  const uniformZones = zones.every((zone) => GRADING_CONTROLS.every((control) => zone[control].every((value, index) => value === zones[0][control][index])));
  return Object.freeze({ settings, zones: Object.freeze(zones), whiteBalanceMatrix, whiteBalanceNeutral, uniformZones, neutral: !settings.enabled || (controlsNeutral && whiteBalanceNeutral) });
}

export function sceneLuminance(color) {
  return color[0] * LUMINANCE_WEIGHTS[0] + color[1] * LUMINANCE_WEIGHTS[1] + color[2] * LUMINANCE_WEIGHTS[2];
}

function smoothTransition(lower, upper, value) {
  const weight = Math.max(0, Math.min(1, (value - lower) / (upper - lower)));
  return weight * weight * (3 - 2 * weight);
}

export function tonalWeights(luminance, ranges) {
  const shadowWeight = 1 - smoothTransition(ranges.shadowStart, ranges.shadowEnd, luminance);
  const highlightWeight = smoothTransition(ranges.highlightStart, ranges.highlightEnd, luminance);
  return [shadowWeight, 1 - shadowWeight - highlightWeight, highlightWeight];
}

function signedPower(value, exponent) {
  if (exponent === 1 || value === 0) return value;
  return Math.sign(value) * 2 ** Math.max(-120, Math.min(100, Math.log2(Math.abs(value)) * exponent));
}

export function applyTonalGrade(color, controls) {
  const luminance = sceneLuminance(color);
  return color.map((channel, index) => {
    const saturated = controls.saturation[index] === 1 ? channel : luminance + (channel - luminance) * controls.saturation[index];
    const contrasted = controls.contrast[index] === 1 ? saturated : signedPower(saturated / 0.18, controls.contrast[index]) * 0.18;
    return signedPower(contrasted, 1 / controls.gamma[index]) * controls.gain[index] + controls.offset[index];
  });
}

export function applySceneGrade(color, compiled) {
  if (!color || color.length !== 3 || !Array.from(color).every((value) => typeof value === "number" && Number.isFinite(value))) throw new TypeError("Scene color requires three finite components");
  const source = Array.from(color);
  if (compiled.neutral) return source;
  const balanced = compiled.whiteBalanceNeutral ? source : transformRgb(compiled.whiteBalanceMatrix, source);
  if (compiled.uniformZones) return applyTonalGrade(balanced, compiled.zones[0]);
  const weights = tonalWeights(sceneLuminance(balanced), compiled.settings.ranges);
  const gradedZones = compiled.zones.map((controls) => applyTonalGrade(balanced, controls));
  return balanced.map((channel, index) => channel + weights.reduce((delta, weight, zone) => delta + weight * (gradedZones[zone][index] - channel), 0));
}

export function gradeStoredColor(color, compiled, preExposure = 1) {
  requireFinite(preExposure, "preExposure", 2 ** -64, 2 ** 64);
  if (!color || color.length !== 4 || !Array.from(color).every((value) => typeof value === "number" && Number.isFinite(value))) throw new TypeError("Stored color requires four finite components");
  if (compiled.neutral) return Array.from(color);
  const sceneColor = Array.from(color).slice(0, 3).map((value) => value / preExposure);
  const graded = applySceneGrade(sceneColor, compiled).map((value) => Math.max(-MAX_HALF_FLOAT, Math.min(MAX_HALF_FLOAT, value * preExposure)));
  return [...graded, color[3]];
}
