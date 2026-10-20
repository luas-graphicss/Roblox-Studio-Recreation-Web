import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { UniformsLib } from "three";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";

import {
  LTC_TABLE_VALUE_COUNT,
  LTC_TABLES_BINARY_BYTE_LENGTH,
  encodeLtcTablesBinary,
} from "../../src/lighting/ltcTablesBinary.js";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUTPUT_FILE = resolve(PROJECT_ROOT, "public", "lighting", "ltc-tables.bin");

function readHalfTable(uniformName) {
  const texture = UniformsLib[uniformName];
  const values = texture && texture.image && texture.image.data;
  if (!(values instanceof Uint16Array)) {
    throw new Error("generateLtcTablesBinary: " + uniformName + " is not a half float DataTexture");
  }
  if (values.length !== LTC_TABLE_VALUE_COUNT) {
    throw new Error(
      "generateLtcTablesBinary: " + uniformName + " holds " + values.length + " values, expected " + LTC_TABLE_VALUE_COUNT,
    );
  }
  return values;
}

RectAreaLightUniformsLib.init();

const binary = encodeLtcTablesBinary(readHalfTable("LTC_HALF_1"), readHalfTable("LTC_HALF_2"));
if (binary.byteLength !== LTC_TABLES_BINARY_BYTE_LENGTH) {
  throw new Error("generateLtcTablesBinary: unexpected size " + binary.byteLength);
}

mkdirSync(dirname(OUTPUT_FILE), { recursive: true });
writeFileSync(OUTPUT_FILE, Buffer.from(binary));

console.log("wrote " + OUTPUT_FILE);
console.log("bytes: " + binary.byteLength + " (" + (binary.byteLength / 1024).toFixed(2) + " kB)");
