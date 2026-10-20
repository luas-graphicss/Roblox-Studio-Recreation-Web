import { requireFiniteNumber, validateSize } from "../../contracts/frameContract.js";
import { resolveVignetteSettings } from "./vignetteSettings.js";

export function resolveVignetteAxisScale(outputSize, aspectRatio = null) {
  validateSize(outputSize, "CP-F24 outputSize");
  const aspect = aspectRatio ?? outputSize.width / outputSize.height;
  requireFiniteNumber(aspect, "CP-F24 view aspect", 1 / 32, 32);
  const diagonal = Math.hypot(aspect, 1);
  return Object.freeze([aspect / diagonal, 1 / diagonal]);
}

export function evaluateVignetteFactor(uv, outputSize, authored) {
  if (!uv || uv.length !== 2) throw new TypeError("CP-F24 UV requires two normalized components");
  requireFiniteNumber(uv[0], "CP-F24 horizontal UV", 0, 1);
  requireFiniteNumber(uv[1], "CP-F24 vertical UV", 0, 1);
  const settings = resolveVignetteSettings(authored);
  const scale = resolveVignetteAxisScale(outputSize, settings.aspectRatio);
  if (!settings.enabled || settings.intensity === 0) return 1;
  const horizontal = (uv[0] * 2 - 1) * scale[0];
  const vertical = (uv[1] * 2 - 1) * scale[1];
  const radiusSquared = horizontal * horizontal + vertical * vertical;
  const transmission = Math.max(0, 1 - settings.intensity * radiusSquared);
  return transmission * transmission;
}

export function applyVignetteToColor(color, uv, outputSize, settings) {
  if (!color || ![3, 4].includes(color.length) || !Array.from(color).every((value) => typeof value === "number" && Number.isFinite(value))) throw new TypeError("CP-F24 color requires three or four finite components");
  const factor = evaluateVignetteFactor(uv, outputSize, settings);
  return Array.from(color, (value, channel) => channel === 3 ? value : value * factor);
}
