import { INTENSITY_UNITS, ev100FromCandela, resolveLocalLightIntensity } from "./llUnitsCore.js";

const KELVIN_MATCH_TOLERANCE = 60;
const LUMEN_MATCH_TOLERANCE_RATIO = 0.02;

export const PHOTOMETRIC_PRESETS = Object.freeze([
  Object.freeze({ id: "bulb60w", label: "Lampada incandescente 60 W", lumens: 800, kelvin: 2700, note: "filamento domestico: quente e pouco eficiente" }),
  Object.freeze({ id: "led800", label: "LED 800 lm", lumens: 800, kelvin: 4000, note: "mesmo fluxo da 60 W, luz neutra" }),
  Object.freeze({ id: "sodium", label: "Poste de sodio", lumens: 10000, kelvin: 2000, note: "iluminacao publica alaranjada" }),
  Object.freeze({ id: "candle", label: "Vela", lumens: 12, kelvin: 1900, note: "referencia baixa: prova o fundo da escala" }),
]);

const PRESET_BY_ID = new Map(PHOTOMETRIC_PRESETS.map((preset) => [preset.id, preset]));

export function photometricPresetIds() {
  return PHOTOMETRIC_PRESETS.map((preset) => preset.id);
}

export function findPhotometricPreset(id) {
  return PRESET_BY_ID.get(id) || null;
}


export function presetPropertyPatch(id) {
  const preset = findPhotometricPreset(id);
  if (!preset) return null;
  return Object.freeze({
    IntensityUnits: INTENSITY_UNITS.LUMENS,
    Intensity: preset.lumens,
    Temperature: preset.kelvin,
  });
}

function asObject(value) {
  return value && typeof value === "object" ? value : {};
}

function kelvinOf(props) {
  const temperature = Number(props.Temperature);
  return Number.isFinite(temperature) && temperature > 0 ? temperature : null;
}


export function describeIntensityInAllUnits(request) {
  const source = asObject(request);
  const props = asObject(source.props);
  const intensity = resolveLocalLightIntensity({
    kind: source.kind,
    angleDeg: props.Angle,
    brightness: props.Brightness,
    intensity: props.Intensity,
    intensityUnits: props.IntensityUnits,
    presetLumens: source.presetLumens,
    iesBrightness: source.iesBrightness,
  });
  return Object.freeze({
    units: intensity.units,
    source: intensity.source,
    candela: intensity.candela,
    lumens: intensity.lumens,
    ev100: intensity.ev100,
    kelvin: kelvinOf(props),
    halfAngleDeg: intensity.halfAngleDeg,
    apertureSr: intensity.apertureSr,
  });
}

function roundTo(value, decimals) {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}


export function formatIntensityReadout(description) {
  const source = asObject(description);
  const parts = [roundTo(Number(source.lumens) || 0, 1) + " lm", roundTo(Number(source.candela) || 0, 2) + " cd", "EV " + roundTo(Number(source.ev100) || 0, 2)];
  if (Number.isFinite(source.kelvin) && source.kelvin > 0) parts.push(Math.round(source.kelvin) + " K");
  return parts.join(" - ");
}


export function ev100Of(candela) {
  return ev100FromCandela(candela);
}


export function matchPhotometricPreset(props) {
  const source = asObject(props);
  if (source.IntensityUnits !== INTENSITY_UNITS.LUMENS) return null;
  const lumens = Number(source.Intensity);
  if (!Number.isFinite(lumens) || lumens <= 0) return null;
  const kelvin = kelvinOf(source);
  const match = PHOTOMETRIC_PRESETS.find((preset) => {
    const lumensClose = Math.abs(preset.lumens - lumens) <= preset.lumens * LUMEN_MATCH_TOLERANCE_RATIO;
    const kelvinClose = kelvin === null || Math.abs(preset.kelvin - kelvin) <= KELVIN_MATCH_TOLERANCE;
    return lumensClose && kelvinClose;
  });
  return match ? match.id : null;
}
