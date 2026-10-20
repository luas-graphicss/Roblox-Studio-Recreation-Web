import { deriveRgbToXyz, deriveBradfordAdaptation, invertMatrix, multiplyMatrices } from "./colorMatrix.js";

const D65 = [0.3127, 0.3290];
const D60 = [0.32168, 0.33767];
const rec709ToXyz = deriveRgbToXyz([[0.64, 0.33], [0.30, 0.60], [0.15, 0.06]], D65);
const rec2020ToXyz = deriveRgbToXyz([[0.708, 0.292], [0.170, 0.797], [0.131, 0.046]], D65);
const ap1ToXyz = deriveRgbToXyz([[0.713, 0.293], [0.165, 0.830], [0.128, 0.044]], D60);
const d65ToD60 = deriveBradfordAdaptation(D65, D60);
const d60ToD65 = deriveBradfordAdaptation(D60, D65);

export const REC709_TO_AP1 = Object.freeze(multiplyMatrices(invertMatrix(ap1ToXyz), multiplyMatrices(d65ToD60, rec709ToXyz)));
export const AP1_TO_REC709 = Object.freeze(multiplyMatrices(invertMatrix(rec709ToXyz), multiplyMatrices(d60ToD65, ap1ToXyz)));
export const AP1_TO_REC2020 = Object.freeze(multiplyMatrices(invertMatrix(rec2020ToXyz), multiplyMatrices(d60ToD65, ap1ToXyz)));
export const AP1_LUMINANCE = Object.freeze(ap1ToXyz.slice(3, 6));
export const REC709_LUMINANCE = Object.freeze(rec709ToXyz.slice(3, 6));
export const REC2020_LUMINANCE = Object.freeze(rec2020ToXyz.slice(3, 6));
