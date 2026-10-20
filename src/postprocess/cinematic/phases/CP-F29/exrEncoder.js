import { concatenateBytes, utf8, terminatedUtf8, encodeNumbers } from "./binaryWriter.js";
import { validateExportFrame } from "./validateExportFrame.js";

function attribute(name, type, bytes) {
  return concatenateBytes([terminatedUtf8(name), terminatedUtf8(type), encodeNumbers([bytes.length], "setUint32"), bytes]);
}

function chromaticities(color) {
  const profiles = {
    rec709: [0.64, 0.33, 0.30, 0.60, 0.15, 0.06, 0.3127, 0.3290],
    "display-p3": [0.68, 0.32, 0.265, 0.69, 0.15, 0.06, 0.3127, 0.3290],
    rec2020: [0.708, 0.292, 0.170, 0.797, 0.131, 0.046, 0.3127, 0.3290],
    acescg: [0.713, 0.293, 0.165, 0.830, 0.128, 0.044, 0.32168, 0.33767]
  };
  if (!profiles[color.primaries] || color.whitePoint !== (color.primaries === "acescg" ? "D60" : "D65")) throw new Error("EXR requires a supported explicit primaries/white-point pair");
  return encodeNumbers(profiles[color.primaries], "setFloat32");
}

export function encodeExrFrame(input) {
  const color = validateExportFrame({ ...input, format: "exr" });
  const { pixels, metadata } = input;
  const { width, height } = metadata;
  const channelNames = ["A", "B", "G", "R"];
  const channels = concatenateBytes([...channelNames.map((name) => concatenateBytes([terminatedUtf8(name), encodeNumbers([2], "setInt32"), new Uint8Array(4), encodeNumbers([1, 1], "setInt32")])), new Uint8Array(1)]);
  const bounds = encodeNumbers([0, 0, width - 1, height - 1], "setInt32");
  const header = concatenateBytes([
    encodeNumbers([20000630, 2], "setUint32"),
    attribute("channels", "chlist", channels), attribute("compression", "compression", new Uint8Array([0])),
    attribute("dataWindow", "box2i", bounds), attribute("displayWindow", "box2i", bounds),
    attribute("lineOrder", "lineOrder", new Uint8Array([0])), attribute("pixelAspectRatio", "float", encodeNumbers([1], "setFloat32")),
    attribute("screenWindowCenter", "v2f", encodeNumbers([0, 0], "setFloat32")), attribute("screenWindowWidth", "float", encodeNumbers([1], "setFloat32")),
    attribute("chromaticities", "chromaticities", chromaticities(color)), attribute("cinematicMetadata", "string", utf8(JSON.stringify(metadata))), new Uint8Array(1)
  ]);
  const scanlineBytes = width * 16;
  const chunkBytes = scanlineBytes + 8;
  const output = new Uint8Array(header.length + height * 8 + height * chunkBytes);
  output.set(header);
  const view = new DataView(output.buffer);
  const chunksStart = header.length + height * 8;
  for (let y = 0; y < height; y += 1) {
    let position = chunksStart + y * chunkBytes;
    view.setBigUint64(header.length + y * 8, BigInt(position), true);
    view.setInt32(position, y, true);
    view.setUint32(position + 4, scanlineBytes, true);
    position += 8;
    for (const channel of [3, 2, 1, 0]) {
      for (let x = 0; x < width; x += 1) {
        view.setFloat32(position, pixels[((height - y - 1) * width + x) * 4 + channel], true);
        position += 4;
      }
    }
  }
  return output;
}
