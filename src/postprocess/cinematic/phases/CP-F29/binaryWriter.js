export function concatenateBytes(parts) {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

export const utf8 = (text) => new TextEncoder().encode(text);
export const terminatedUtf8 = (text) => concatenateBytes([utf8(text), new Uint8Array(1)]);

export function encodeNumbers(values, method, littleEndian = true) {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view[method](index * 4, value, littleEndian));
  return bytes;
}
