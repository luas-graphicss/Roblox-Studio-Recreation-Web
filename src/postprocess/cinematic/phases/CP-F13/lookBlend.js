import { assertLookAsset, LOOK_ENCODINGS } from "./lookAsset.js";
import { requireFinite } from "./lutTable.js";
import { sampleLut } from "./lutSampling.js";

export const MAX_ACTIVE_LOOKS = 4;
export const LOOK_SETTINGS_KEY = "CP-F13.looks";

function unitValue(value, fallback, label) {
  const resolved = value === null || value === undefined ? fallback : requireFinite(value, label);
  if (resolved < 0 || resolved > 1) throw new RangeError(`${label} must be in [0, 1]`);
  return resolved;
}

export function resolveLookBlend(configuration = {}) {
  const config = configuration ?? {};
  if (typeof config !== "object" || Array.isArray(config)) throw new TypeError("Look configuration must be an object or AUTO/null");
  if (config.enabled !== undefined && config.enabled !== null && typeof config.enabled !== "boolean") throw new TypeError("Look enabled must be boolean or AUTO/null");
  const intensity = unitValue(config.intensity, 1, "Look intensity");
  const backend = config.backend ?? "atlas";
  if (!["atlas", "3d"].includes(backend)) throw new TypeError("LUT backend must be atlas or 3d");
  const entries = config.looks ?? [];
  if (!Array.isArray(entries)) throw new TypeError("Resolved volume looks must be an array");
  const merged = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") throw new TypeError("A look contribution must be an object");
    const look = assertLookAsset(entry.look);
    const weight = unitValue(entry.weight, 1, "Look weight") * unitValue(entry.intensity, 1, "Contribution intensity");
    if (weight > 0) merged.set(look, (merged.get(look) ?? 0) + weight);
  }
  const active = config.enabled === false || intensity === 0 ? [] : [...merged].map(([look, weight]) => ({ look, weight }));
  if (active.length > MAX_ACTIVE_LOOKS) throw new RangeError(`At most ${MAX_ACTIVE_LOOKS} distinct active looks fit this shader; pre-bake a larger blend explicitly`);
  const totalWeight = active.reduce((sum, entry) => sum + entry.weight, 0);
  const normalization = Math.max(1, totalWeight);
  const looks = active.map(({ look, weight }) => Object.freeze({ look, weight: weight / normalization }));
  const first = looks[0]?.look;
  for (const { look } of looks) if (look.inputEncoding !== first.inputEncoding || look.outputEncoding !== first.outputEncoding) throw new TypeError("All blended looks must share input and output encodings");
  const changesEncoding = Boolean(first && first.inputEncoding !== first.outputEncoding);
  if (changesEncoding && (looks.length !== 1 || looks[0].weight !== 1 || intensity !== 1)) throw new TypeError("Cross-domain transforms require exactly one fully weighted look and full intensity");
  return Object.freeze({ looks: Object.freeze(looks), intensity, backend, inputEncoding: first?.inputEncoding ?? null, outputEncoding: first?.outputEncoding ?? null, changesEncoding, neutralWeight: 1 - Math.min(1, totalWeight), enabled: looks.length > 0 });
}

export function validateLookInput(plan, inputEncoding, preExposure = 1) {
  if (!plan.enabled) return;
  if (!Object.hasOwn(LOOK_ENCODINGS, inputEncoding)) throw new TypeError(`Unsupported color encoding ${inputEncoding}`);
  requireFinite(preExposure, "preExposure");
  if (preExposure < 2 ** -126 || preExposure > 2 ** 126) throw new RangeError("preExposure must be positive and float32-representable together with its inverse");
  if (plan.enabled && plan.inputEncoding !== inputEncoding) throw new TypeError(`LUT expects ${plan.inputEncoding}, received ${inputEncoding}; an explicit color transform is required`);
}

export function applyLookBlend(plan, storedColor, { inputEncoding = "scene-linear-rec709", preExposure = 1 } = {}) {
  validateLookInput(plan, inputEncoding, preExposure);
  if (!storedColor || storedColor.length !== 3 || Array.from(storedColor).some((value) => typeof value !== "number" || !Number.isFinite(value))) throw new TypeError("Look input must be finite RGB");
  if (!plan.enabled) return [...storedColor];
  const inputScale = LOOK_ENCODINGS[inputEncoding] === "scene" ? preExposure : 1;
  const outputScale = LOOK_ENCODINGS[inputEncoding] === "scene" && LOOK_ENCODINGS[plan.outputEncoding] === "scene" ? preExposure : 1;
  const source = Array.from(storedColor, (value) => value / inputScale);
  if (plan.changesEncoding) return sampleLut(plan.looks[0].look.table, source, plan.looks[0].look).map((value) => value * outputScale);
  const result = [...source];
  for (const { look, weight } of plan.looks) {
    const transformed = sampleLut(look.table, source, look);
    for (let channel = 0; channel < 3; channel += 1) result[channel] += weight * (transformed[channel] - source[channel]);
  }
  return result.map((value, channel) => (source[channel] + plan.intensity * (value - source[channel])) * outputScale);
}

export function configureLooks(settings, configuration) {
  const plan = resolveLookBlend(configuration);
  const canonical = Object.freeze({ enabled: plan.enabled, intensity: plan.intensity, backend: plan.backend, looks: Object.freeze(plan.looks.map(({ look, weight }) => Object.freeze({ look, weight }))) });
  settings.set(LOOK_SETTINGS_KEY, canonical);
  return plan;
}
