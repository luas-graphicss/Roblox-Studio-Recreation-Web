import { createLutTable, assertLutTable, validateLutSize } from "./lutTable.js";
import { sampleLut } from "./lutSampling.js";

export function bakeLut({ size = 17, domainMin = [0, 0, 0], domainMax = [1, 1, 1], title = "Baked LUT", evaluate }) {
  validateLutSize(size, 3);
  if (typeof evaluate !== "function") throw new TypeError("LUT baking requires an explicit transform evaluator");
  const probe = createLutTable({ size: 2, domainMin, domainMax, values: new Array(24).fill(0) });
  const values = new Float32Array(3 * size ** 3);
  let offset = 0;
  for (let blue = 0; blue < size; blue += 1) for (let green = 0; green < size; green += 1) for (let red = 0; red < size; red += 1) {
    const input = [red, green, blue].map((coordinate, channel) => probe.domainMin[channel] + (probe.domainMax[channel] - probe.domainMin[channel]) * coordinate / (size - 1));
    const output = evaluate(Object.freeze(input));
    if (!output || output.length !== 3 || Array.from(output).some((value) => typeof value !== "number" || !Number.isFinite(value))) throw new TypeError(`Invalid transform output at LUT grid ${red},${green},${blue}`);
    values.set(output, offset);
    offset += 3;
  }
  return createLutTable({ size, values, domainMin, domainMax, title });
}

export function resampleLut(table, { size = 17, interpolation = "trilinear", domainMin = table.domainMin, domainMax = table.domainMax, boundary = "extrapolate" } = {}) {
  assertLutTable(table);
  return bakeLut({ size, domainMin, domainMax, title: table.title, evaluate: (color) => sampleLut(table, color, { interpolation, boundary }) });
}

export function serializeCubeLut(table) {
  assertLutTable(table);
  const lines = [`TITLE "${table.title.replace(/["\r\n]/g, " ")}"`, `LUT_${table.dimension}D_SIZE ${table.size}`, `DOMAIN_MIN ${table.domainMin.join(" ")}`, `DOMAIN_MAX ${table.domainMax.join(" ")}`];
  for (let offset = 0; offset < table.values.length; offset += 3) lines.push(table.values.slice(offset, offset + 3).join(" "));
  return `${lines.join("\n")}\n`;
}
