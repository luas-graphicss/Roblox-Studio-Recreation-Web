import { createFilmicCurveParameters } from "./filmicCurve.js";
import { getFilmicOutput } from "./filmicSettings.js";
import { REC709_TO_AP1, AP1_TO_REC709, AP1_TO_REC2020, REC709_LUMINANCE, REC2020_LUMINANCE } from "./filmicColorSpaces.js";

export function toColumnMajor(matrix) {
  return [matrix[0], matrix[3], matrix[6], matrix[1], matrix[4], matrix[7], matrix[2], matrix[5], matrix[8]];
}

export function createFilmicUniforms() {
  return {
    cp11InputTexture: { value: null },
    cp11InversePreExposure: { value: 1 },
    cp11Bypass: { value: 0 },
    cp11CurveLow: { value: [0, 0, 0, 0] },
    cp11CurveHigh: { value: [0, 0, 0, 0] },
    cp11Headroom: { value: 1 },
    cp11BlueCorrection: { value: 0 },
    cp11ExpandGamut: { value: 0 },
    cp11InputMatrix: { value: toColumnMajor(REC709_TO_AP1) },
    cp11OutputMatrix: { value: toColumnMajor(AP1_TO_REC709) },
    cp11OutputLuminance: { value: [...REC709_LUMINANCE] }
  };
}

export function updateFilmicUniforms(uniforms, settings) {
  const curve = createFilmicCurveParameters(settings);
  const hdr = settings.outputMode === "hdr";
  uniforms.cp11CurveLow.value = [curve.slope, curve.toeScale, curve.shoulderScale, curve.toeMatch];
  uniforms.cp11CurveHigh.value = [curve.shoulderMatch, curve.straightOffset, curve.blackClip, curve.whiteLimit];
  uniforms.cp11Headroom.value = getFilmicOutput(settings).headroom;
  uniforms.cp11BlueCorrection.value = settings.blueCorrection;
  uniforms.cp11ExpandGamut.value = settings.expandGamut;
  uniforms.cp11Bypass.value = settings.mode === "bypass" ? 1 : 0;
  uniforms.cp11OutputMatrix.value = toColumnMajor(hdr ? AP1_TO_REC2020 : AP1_TO_REC709);
  uniforms.cp11OutputLuminance.value = [...(hdr ? REC2020_LUMINANCE : REC709_LUMINANCE)];
}
