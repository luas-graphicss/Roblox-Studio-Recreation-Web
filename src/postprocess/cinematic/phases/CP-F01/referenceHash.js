export function canonicalJson(value) {
  const visiting = new Set();
  function encode(item) {
    if (item === null || typeof item === "boolean" || typeof item === "string") return JSON.stringify(item);
    if (typeof item === "number") { if (!Number.isFinite(item)) throw new TypeError("Non-finite reference number"); return JSON.stringify(item); }
    if (typeof item !== "object" || ![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(item))) throw new TypeError("Reference data must contain only plain JSON values");
    if (visiting.has(item)) throw new TypeError("Cyclic reference data");
    visiting.add(item);
    let result;
    if (Array.isArray(item)) {
      if (Object.keys(item).length !== item.length) throw new TypeError("Sparse or extended arrays are not valid reference data");
      result = `[${item.map(encode).join(",")}]`;
    } else {
      const descriptors = Object.getOwnPropertyDescriptors(item);
      if (Reflect.ownKeys(item).some((key) => typeof key !== "string" || !Object.hasOwn(descriptors[key], "value") || !descriptors[key].enumerable)) throw new TypeError("Reference records must have enumerable data properties");
      result = `{${Object.keys(item).sort().map((key) => `${JSON.stringify(key)}:${encode(item[key])}`).join(",")}}`;
    }
    visiting.delete(item);
    return result;
  }
  return encode(value);
}

export function hexBytes(hex) {
  if (typeof hex !== "string" || hex.length % 2 || !/^[a-f0-9]+$/.test(hex)) throw new TypeError("Invalid lowercase hexadecimal bytes");
  return Uint8Array.from(hex.match(/../g), (byte) => Number.parseInt(byte, 16));
}

export function bytesHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Bytes(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError("Hash input must be bytes");
  if (!globalThis.crypto?.subtle) throw new Error("WebCrypto is unavailable; reference verification is blocked");
  return bytesHex(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes)));
}

export async function hashCanonicalJson(value) {
  return sha256Bytes(new TextEncoder().encode(canonicalJson(value)));
}
