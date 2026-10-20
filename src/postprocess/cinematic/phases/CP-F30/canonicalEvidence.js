export function canonicalJson(value) {
  const active = new Set();
  function normalize(item) {
    if (item === null || typeof item === "string" || typeof item === "boolean") return item;
    if (typeof item === "number" && Number.isFinite(item)) return item;
    if (typeof item !== "object" || ArrayBuffer.isView(item) || active.has(item)) throw new TypeError("Evidence state must contain finite, acyclic JSON values");
    active.add(item);
    const result = Array.isArray(item) ? item.map(normalize) : Object.fromEntries(Object.keys(item).sort().map((key) => [key, normalize(item[key])]));
    active.delete(item);
    return result;
  }
  return JSON.stringify(normalize(value));
}

export function copyEvidenceState(value) {
  return JSON.parse(canonicalJson(value));
}

export async function sha256(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new TypeError("Hashing requires nonempty bytes");
  if (!globalThis.crypto?.subtle) throw new Error("SHA-256 requires a secure WebCrypto context");
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (value) => value.toString(16).padStart(2, "0")).join("");
}

export function float32LittleEndian(pixels) {
  const bytes = new Uint8Array(pixels.length * 4);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < pixels.length; index += 1) view.setFloat32(index * 4, pixels[index], true);
  return bytes;
}
