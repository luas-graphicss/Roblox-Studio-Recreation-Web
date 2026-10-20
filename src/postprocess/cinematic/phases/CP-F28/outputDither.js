export function outputDitherOffset(x, y, seed = 0) {
  if (![x, y, seed].every(Number.isInteger) || seed < 0) throw new TypeError("CP-F28 dither coordinates and seed must be integers");
  let column = ((x + seed % 8) % 8 + 8) % 8;
  let row = ((y + Math.floor(seed / 8) % 8) % 8 + 8) % 8;
  let rank = 0;
  for (let bit = 0; bit < 3; bit += 1) {
    const columnBit = column % 2;
    const rowBit = row % 2;
    rank = rank * 4 + (columnBit !== rowBit ? 2 : 0) + rowBit;
    column = Math.floor(column / 2);
    row = Math.floor(row / 2);
  }
  return ((rank + 0.5) / 64 - 0.5) / 255;
}
