import { concatenateBytes, utf8, encodeNumbers } from "./binaryWriter.js";
import { crc32, adler32 } from "./pngChecksums.js";
import { validateExportFrame } from "./validateExportFrame.js";

function pngChunk(type, data) {
  const body = concatenateBytes([utf8(type), data]);
  return concatenateBytes([encodeNumbers([data.length], "setUint32", false), body, encodeNumbers([crc32(body)], "setUint32", false)]);
}

function uncompressedZlib(data) {
  const blockCount = Math.ceil(data.length / 65535);
  const output = new Uint8Array(2 + blockCount * 5 + data.length + 4);
  output.set([0x78, 0x01]);
  const view = new DataView(output.buffer);
  let position = 2;
  for (let offset = 0; offset < data.length; offset += 65535) {
    const length = Math.min(65535, data.length - offset);
    output[position++] = offset + length === data.length ? 1 : 0;
    view.setUint16(position, length, true);
    view.setUint16(position + 2, 65535 ^ length, true);
    position += 4;
    output.set(data.subarray(offset, offset + length), position);
    position += length;
  }
  view.setUint32(position, adler32(data), false);
  return output;
}

export function encodePngFrame(input) {
  validateExportFrame({ ...input, format: "png" });
  const { pixels, metadata } = input;
  const { width, height } = metadata;
  const rows = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    const destination = y * (width * 4 + 1) + 1;
    const source = (height - y - 1) * width * 4;
    for (let column = 0; column < width * 4; column += 1) rows[destination + column] = Math.round(pixels[source + column] * 255);
  }
  const header = concatenateBytes([encodeNumbers([width, height], "setUint32", false), new Uint8Array([8, 6, 0, 0, 0])]);
  const description = concatenateBytes([utf8("cinematic"), new Uint8Array(5), utf8(JSON.stringify(metadata))]);
  return concatenateBytes([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", header), pngChunk("sRGB", new Uint8Array([0])), pngChunk("iTXt", description), pngChunk("IDAT", uncompressedZlib(rows)), pngChunk("IEND", new Uint8Array())]);
}
