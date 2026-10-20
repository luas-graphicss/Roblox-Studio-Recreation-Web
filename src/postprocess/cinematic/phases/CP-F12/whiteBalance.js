import { requireFinite } from "./gradingSettings.js";

export const IDENTITY_MATRIX = Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, 1]);
const d65 = Object.freeze([0.3127, 0.329]);
const rgbToXyz = [0.4123907993, 0.3575843394, 0.1804807884, 0.2126390059, 0.7151686788, 0.0721923154, 0.0193308187, 0.1191947798, 0.9505321522];
const xyzToRgb = [3.2409699419, -1.5373831776, -0.4986107603, -0.9692436363, 1.8759675015, 0.0415550574, 0.0556300797, -0.2039769589, 1.0569715142];
const bradford = [0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296];
const inverseBradford = [0.9869929055, -0.1470542564, 0.1599626517, 0.4323052697, 0.5183602715, 0.0492912282, -0.0085286646, 0.0400428217, 0.9684866958];

export function transformRgb(matrix, color) {
  return [0, 1, 2].map((row) => matrix[row * 3] * color[0] + matrix[row * 3 + 1] * color[1] + matrix[row * 3 + 2] * color[2]);
}

function multiplyMatrices(left, right) {
  return Array.from({ length: 9 }, (_, index) => {
    const row = Math.floor(index / 3);
    const column = index % 3;
    return left[row * 3] * right[column] + left[row * 3 + 1] * right[3 + column] + left[row * 3 + 2] * right[6 + column];
  });
}

function planckianChromaticity(temperature) {
  const inverse = 1 / temperature;
  const x = temperature <= 4000
    ? -266123900 * inverse ** 3 - 234358 * inverse ** 2 + 877.6956 * inverse + 0.17991
    : -3025846900 * inverse ** 3 + 2107037.9 * inverse ** 2 + 222.6347 * inverse + 0.24039;
  const y = temperature <= 2222
    ? -1.1063814 * x ** 3 - 1.3481102 * x ** 2 + 2.18555832 * x - 0.20219683
    : temperature <= 4000
      ? -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867
      : 3.081758 * x ** 3 - 5.8733867 * x ** 2 + 3.75112997 * x - 0.37001483;
  return [x, y];
}

export function temperatureChromaticity(temperature, tint = 0) {
  requireFinite(temperature, "temperature", 1667, 25000);
  requireFinite(tint, "tint", -1, 1);
  const neutral = planckianChromaticity(6500);
  const locus = planckianChromaticity(temperature);
  const x = locus[0] + d65[0] - neutral[0];
  const y = locus[1] + d65[1] - neutral[1];
  const denominator = -2 * x + 12 * y + 3;
  const u = 4 * x / denominator;
  const v = 6 * y / denominator + tint * 0.02;
  const divisor = 2 * u - 8 * v + 4;
  return [3 * u / divisor, 2 * v / divisor];
}

function chromaticityToXyz([x, y]) {
  return [x / y, 1, (1 - x - y) / y];
}

export function createWhiteBalanceMatrix({ mode, temperature, tint }) {
  temperatureChromaticity(temperature, tint);
  if (!["whiteBalance", "temperature", "disabled"].includes(mode)) throw new TypeError("Unknown white balance mode");
  if (mode === "disabled" || (temperature === 6500 && tint === 0)) return IDENTITY_MATRIX;
  const illuminant = chromaticityToXyz(temperatureChromaticity(temperature, tint));
  const reference = chromaticityToXyz(d65);
  const source = transformRgb(bradford, mode === "whiteBalance" ? illuminant : reference);
  const destination = transformRgb(bradford, mode === "whiteBalance" ? reference : illuminant);
  const scale = [destination[0] / source[0], 0, 0, 0, destination[1] / source[1], 0, 0, 0, destination[2] / source[2]];
  return Object.freeze(multiplyMatrices(xyzToRgb, multiplyMatrices(inverseBradford, multiplyMatrices(scale, multiplyMatrices(bradford, rgbToXyz)))));
}
