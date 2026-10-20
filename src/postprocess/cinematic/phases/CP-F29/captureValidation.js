export function integer(value, name, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new TypeError(`${name} must be an integer in [${minimum}, ${maximum}]`);
  return value;
}

export function finite(value, name, minimum, maximum) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) throw new TypeError(`${name} must be finite in [${minimum}, ${maximum}]`);
  return value;
}

export function object(value, name, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new TypeError(`Unknown ${name} field: ${key}`);
  return value;
}

export function choice(value, name, choices) {
  if (!choices.includes(value)) throw new TypeError(`Unsupported ${name}: ${value}`);
  return value;
}

export function throwIfAborted(signal) {
  if (signal?.aborted) {
    const error = new Error("Capture cancelled");
    error.name = "AbortError";
    throw error;
  }
}
