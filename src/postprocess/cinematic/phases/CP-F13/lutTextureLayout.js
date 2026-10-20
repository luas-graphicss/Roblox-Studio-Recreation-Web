import { assertLutTable, validateLutSize } from "./lutTable.js";

export function describeLutTexture(size, backend = "atlas") {
  validateLutSize(size, 3);
  if (!["atlas", "3d"].includes(backend)) throw new TypeError("Unknown LUT texture backend");
  const columns = backend === "atlas" ? Math.ceil(Math.sqrt(size)) : 1;
  const width = backend === "atlas" ? size * columns : size;
  const height = backend === "atlas" ? size * Math.ceil(size / columns) : size;
  const depth = backend === "3d" ? size : 1;
  return Object.freeze({ backend, size, width, height, depth, columns, bytes: width * height * depth * 16, format: "rgba32f", filtering: "nearest-manual-interpolation", origin: "bottom-left" });
}

export function packLutTexture(table, backend = "atlas") {
  assertLutTable(table);
  if (table.dimension !== 3) throw new TypeError("Texture packing requires a baked 3D LUT");
  const layout = describeLutTexture(table.size, backend);
  const data = new Float32Array(layout.width * layout.height * layout.depth * 4);
  for (let blue = 0; blue < table.size; blue += 1) for (let green = 0; green < table.size; green += 1) for (let red = 0; red < table.size; red += 1) {
    const sourceOffset = 3 * (red + table.size * (green + table.size * blue));
    const texel = backend === "3d" ? red + table.size * (green + table.size * blue) : red + (blue % layout.columns) * table.size + layout.width * (green + Math.floor(blue / layout.columns) * table.size);
    for (let channel = 0; channel < 3; channel += 1) data[4 * texel + channel] = table.values[sourceOffset + channel];
    data[4 * texel + 3] = 1;
  }
  return { layout, data };
}
