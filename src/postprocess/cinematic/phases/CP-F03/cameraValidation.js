export function finiteNumber(value, name, minimum = -Number.MAX_VALUE, maximum = Number.MAX_VALUE) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new TypeError(`${name} must be a finite number in [${minimum}, ${maximum}]`);
  }
  return value;
}

export function positiveNumber(value, name) {
  return finiteNumber(value, name, Number.MIN_VALUE);
}

export function enumValue(value, name, choices) {
  if (!choices.includes(value)) throw new TypeError(`${name} must be one of ${choices.join(", ")}`);
  return value;
}

export function plainRecord(value, name) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${name} must be a plain object`);
  return value;
}

export function vector3(value, name) {
  if (!Array.isArray(value) || value.length !== 3) throw new TypeError(`${name} requires three numeric coordinates`);
  return value.map((component, index) => finiteNumber(component, `${name}[${index}]`));
}

export function inheritedValue(value, fallback) {
  return value === null || value === undefined ? fallback : value;
}
