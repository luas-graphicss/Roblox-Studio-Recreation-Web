import { MAX_MASK_PIXELS } from "./dirtMaskContract.js";

export async function decodeDirtMaskImage(blob) {
  if (typeof globalThis.createImageBitmap !== "function" || typeof globalThis.OffscreenCanvas !== "function") throw new Error("Dirt image decoding requires createImageBitmap and OffscreenCanvas or an injected decoder");
  const bitmap = await globalThis.createImageBitmap(blob, { premultiplyAlpha: "none", imageOrientation: "none" });
  try {
    if (bitmap.width * bitmap.height > MAX_MASK_PIXELS) throw new RangeError("Decoded dirt mask exceeds the pixel budget");
    const canvas = new globalThis.OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d", { colorSpace: "srgb", willReadFrequently: true });
    if (!context) throw new Error("Dirt image decoder could not create an sRGB surface");
    context.drawImage(bitmap, 0, 0);
    const image = context.getImageData(0, 0, bitmap.width, bitmap.height, { colorSpace: "srgb" });
    return { width: image.width, height: image.height, data: image.data, encoding: "srgb", origin: "top-left" };
  } finally {
    bitmap.close();
  }
}
