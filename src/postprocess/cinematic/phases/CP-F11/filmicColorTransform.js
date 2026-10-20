import { resolveFilmicSettings, getFilmicOutput } from "./filmicSettings.js";
import { createFilmicCurveParameters, evaluateFilmicCurveUnchecked } from "./filmicCurve.js";
import { multiplyMatrixVector } from "./colorMatrix.js";
import { REC709_TO_AP1, AP1_TO_REC709, AP1_TO_REC2020, AP1_LUMINANCE, REC709_LUMINANCE, REC2020_LUMINANCE } from "./filmicColorSpaces.js";
import { prepareFilmicGamut, compressOutputGamut, luminance } from "./filmicGamut.js";

export function createFilmicColorTransform(authored = {}) {
  const settings = resolveFilmicSettings(authored);
  const output = getFilmicOutput(settings);
  const parameters = createFilmicCurveParameters(settings);
  const outputMatrix = settings.outputMode === "hdr" ? AP1_TO_REC2020 : AP1_TO_REC709;
  const outputWeights = settings.outputMode === "hdr" ? REC2020_LUMINANCE : REC709_LUMINANCE;
  return (color, preExposure = 1) => {
    if ((!Array.isArray(color) && !ArrayBuffer.isView(color)) || ![3, 4].includes(color.length) || !Array.from(color).every(Number.isFinite)) throw new TypeError("Color must contain three or four finite components");
    if (typeof preExposure !== "number" || !Number.isFinite(preExposure) || preExposure <= 0) throw new RangeError("preExposure must be finite and positive");
    if (settings.mode === "replace") throw new Error("Replacement requires a GPU provider; no CPU approximation is implied");
    if (settings.mode === "bypass") return Array.from(color);
    const sceneLinear = Array.from(color).slice(0, 3).map((channel) => channel / preExposure);
    if (!sceneLinear.every(Number.isFinite)) throw new RangeError("De-pre-exposed radiance overflow");
    const working = prepareFilmicGamut(multiplyMatrixVector(REC709_TO_AP1, sceneLinear), settings);
    const film = working.map((channel) => evaluateFilmicCurveUnchecked(channel, parameters));
    const gray = luminance(film, AP1_LUMINANCE);
    const desaturated = film.map((channel) => gray + (channel - gray) * 0.93);
    const mapped = compressOutputGamut(multiplyMatrixVector(outputMatrix, desaturated), outputWeights, output.headroom);
    return color.length === 4 ? [...mapped, color[3]] : mapped;
  };
}
