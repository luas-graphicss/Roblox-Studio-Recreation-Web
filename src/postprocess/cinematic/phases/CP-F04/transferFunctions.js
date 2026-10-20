function requireChannel(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError("Color channels must be finite numbers");
  return value;
}

export function decodeSrgbChannel(value) {
  requireChannel(value);
  const magnitude = Math.abs(value);
  return Math.sign(value) * (magnitude <= 0.04045 ? magnitude / 12.92 : ((magnitude + 0.055) / 1.055) ** 2.4);
}

export function encodeSrgbChannel(value) {
  requireChannel(value);
  const magnitude = Math.abs(value);
  return Math.sign(value) * (magnitude <= 0.0031308 ? 12.92 * magnitude : 1.055 * magnitude ** (1 / 2.4) - 0.055);
}

export function resolveTransferDecode(transfer, samplerDecoded = false) {
  if (!["linear", "srgb"].includes(transfer) || typeof samplerDecoded !== "boolean") throw new TypeError("Explicit linear/srgb transfer and boolean sampler decode are required");
  if (transfer === "linear" && samplerDecoded) throw new Error("A linear buffer cannot declare an sRGB sampler decode");
  return transfer === "srgb" && !samplerDecoded;
}
