const crcTable = new Uint32Array(256);
for (let index = 0; index < crcTable.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
  crcTable[index] = value;
}

export function crc32(bytes) {
  let checksum = 0xffffffff;
  for (const byte of bytes) checksum = crcTable[(checksum ^ byte) & 255] ^ checksum >>> 8;
  return (checksum ^ 0xffffffff) >>> 0;
}

export function adler32(bytes) {
  let first = 1;
  let second = 0;
  for (const byte of bytes) { first = (first + byte) % 65521; second = (second + first) % 65521; }
  return (second * 65536 + first) >>> 0;
}
