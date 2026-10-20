export const LUT_LIMITS = Object.freeze({ maximum3dSize: 65, maximum1dSize: 4096, maximumTextLength: 32 * 1024 * 1024 });
const validatedTables = new WeakSet();

export function requireFinite(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${label} must be a finite number`);
  return value;
}

export function validateLutSize(size, dimension = 3) {
  const maximum = dimension === 1 ? LUT_LIMITS.maximum1dSize : LUT_LIMITS.maximum3dSize;
  if (![1, 3].includes(dimension) || !Number.isInteger(size) || size < 2 || size > maximum) throw new RangeError(`LUT size must be an integer in [2, ${maximum}] for dimension ${dimension}`);
  return size;
}

export function createLutTable({ dimension = 3, size, values, domainMin = [0, 0, 0], domainMax = [1, 1, 1], title = "Untitled LUT" }) {
  validateLutSize(size, dimension);
  const expectedValues = 3 * size ** dimension;
  if ((!Array.isArray(values) && !ArrayBuffer.isView(values)) || values.length !== expectedValues) throw new RangeError(`LUT requires exactly ${expectedValues} RGB values`);
  const minimum = Array.from(domainMin ?? []);
  const maximum = Array.from(domainMax ?? []);
  if (minimum.length !== 3 || maximum.length !== 3) throw new TypeError("LUT domains require three channels");
  for (let channel = 0; channel < 3; channel += 1) {
    requireFinite(minimum[channel], "DOMAIN_MIN");
    requireFinite(maximum[channel], "DOMAIN_MAX");
    minimum[channel] = Math.fround(minimum[channel]);
    maximum[channel] = Math.fround(maximum[channel]);
    if (!Number.isFinite(minimum[channel]) || !Number.isFinite(maximum[channel])) throw new RangeError("LUT domain endpoints exceed float32");
    if (maximum[channel] <= minimum[channel]) throw new RangeError("LUT domain maximum must exceed minimum on every channel");
    if (!Number.isFinite(Math.fround(maximum[channel] - minimum[channel])) || Math.fround(maximum[channel] - minimum[channel]) === 0) throw new RangeError("LUT domain is not representable in float32");
  }
  const ownedValues = Array.from(values, (value, index) => {
    const rounded = Math.fround(requireFinite(value, `LUT sample ${index}`));
    if (!Number.isFinite(rounded)) throw new RangeError(`LUT sample ${index} exceeds float32`);
    return rounded;
  });
  const table = Object.freeze({ dimension, size, title: String(title), domainMin: Object.freeze(minimum), domainMax: Object.freeze(maximum), values: Object.freeze(ownedValues), ordering: "red-fastest" });
  validatedTables.add(table);
  return table;
}

export function assertLutTable(table) {
  if (!validatedTables.has(table)) throw new TypeError("Use createLutTable or parseCubeLut to construct a validated LUT");
  return table;
}
