export function readCameraWorldPosition(frame, output) {
  const view = frame.matrices?.view;
  if ((!Array.isArray(view) && !ArrayBuffer.isView(view)) || view.length !== 16) throw new TypeError("CP-F02 bound volumes require a finite column-major view matrix");
  for (let index = 0; index < 16; index += 1) if (typeof view[index] !== "number" || !Number.isFinite(view[index])) throw new TypeError("CP-F02 view matrix must be finite");
  if (view[3] !== 0 || view[7] !== 0 || view[11] !== 0 || view[15] !== 1) throw new TypeError("CP-F02 view matrix must be affine");
  const firstCofactor = view[5] * view[10] - view[9] * view[6];
  const secondCofactor = view[9] * view[2] - view[1] * view[10];
  const thirdCofactor = view[1] * view[6] - view[5] * view[2];
  const determinant = view[0] * firstCofactor + view[4] * secondCofactor + view[8] * thirdCofactor;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < Number.EPSILON) throw new TypeError("CP-F02 view matrix is singular");
  output[0] = -(firstCofactor * view[12] + (view[8] * view[6] - view[4] * view[10]) * view[13] + (view[4] * view[9] - view[8] * view[5]) * view[14]) / determinant;
  output[1] = -(secondCofactor * view[12] + (view[0] * view[10] - view[8] * view[2]) * view[13] + (view[8] * view[1] - view[0] * view[9]) * view[14]) / determinant;
  output[2] = -(thirdCofactor * view[12] + (view[4] * view[2] - view[0] * view[6]) * view[13] + (view[0] * view[5] - view[4] * view[1]) * view[14]) / determinant;
  if (!Number.isFinite(output[0]) || !Number.isFinite(output[1]) || !Number.isFinite(output[2])) throw new TypeError("CP-F02 camera world position is not finite");
  return output;
}
