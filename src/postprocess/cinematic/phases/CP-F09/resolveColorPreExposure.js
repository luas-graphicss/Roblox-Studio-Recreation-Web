export function resolveColorPreExposure(color) {
  const transport = color.preExposure ?? 1;
  if (typeof transport !== "number" || !Number.isFinite(transport) || transport <= 0) {
    throw new TypeError("Exposure color input requires a positive finite transport preExposure");
  }
  return transport;
}
