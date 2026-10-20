export function sameIdentifierSet(actual, expected) {
  return Array.isArray(actual) && new Set(actual).size === actual.length && actual.length === expected.length && actual.every((id) => expected.includes(id));
}

export function decodeEvidenceJson(bytes, label) {
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength) throw new Error(`${label}: missing evidence bytes`);
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

export function isText(value) { return typeof value === "string" && value.trim().length > 0; }
export function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
