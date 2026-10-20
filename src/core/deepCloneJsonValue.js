const supportsStructuredClone = typeof structuredClone === "function";


export function isPrimitiveJsonValue(value) {
  return value === null || typeof value !== "object";
}

export function deepCloneJsonValue(value) {
  if (isPrimitiveJsonValue(value)) return value;
  if (supportsStructuredClone) {
    try {
      return structuredClone(value);
    } catch (_error) {


      return JSON.parse(JSON.stringify(value));
    }
  }
  return JSON.parse(JSON.stringify(value));
}
