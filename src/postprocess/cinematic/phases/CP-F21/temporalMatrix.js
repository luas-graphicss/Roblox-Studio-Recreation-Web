export function multiplyTemporalMatrices(left, right) {
  return Array.from({ length: 16 }, (_, index) => {
    const row = index % 4;
    const column = Math.floor(index / 4);
    return [0, 1, 2, 3].reduce((sum, component) => sum + left[component * 4 + row] * right[column * 4 + component], 0);
  });
}

export function invertTemporalMatrix(matrix) {
  const rows = Array.from({ length: 4 }, (_, row) => [0, 1, 2, 3].map((column) => matrix[column * 4 + row]).concat([0, 1, 2, 3].map((column) => row === column ? 1 : 0)));
  for (let column = 0; column < 4; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 4; row += 1) if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    if (!Number.isFinite(rows[pivot][column]) || Math.abs(rows[pivot][column]) < 1e-20) throw new Error("CP-F21 projection is singular");
    [rows[pivot], rows[column]] = [rows[column], rows[pivot]];
    const divisor = rows[column][column];
    rows[column] = rows[column].map((value) => value / divisor);
    for (let row = 0; row < 4; row += 1) {
      if (row === column) continue;
      const scale = rows[row][column];
      rows[row] = rows[row].map((value, index) => value - scale * rows[column][index]);
    }
  }
  const inverse = Array.from({ length: 16 }, (_, index) => rows[index % 4][Math.floor(index / 4) + 4]);
  if (!inverse.every((value) => Number.isFinite(value) && Number.isFinite(Math.fround(value)))) throw new Error("CP-F21 projection inverse is unrepresentable");
  return inverse;
}
