export function physicalCameraEv100(camera) {
  if (!camera || typeof camera !== "object") throw new TypeError("CP-F08 physical exposure requires a camera");
  for (const name of ["apertureFNumber", "shutterSeconds", "iso"]) {
    if (typeof camera[name] !== "number" || !Number.isFinite(camera[name]) || camera[name] <= 0) {
      throw new TypeError(`CP-F08 camera.${name} must be positive and finite`);
    }
  }
  const ev100 = 2 * Math.log2(camera.apertureFNumber) - Math.log2(camera.shutterSeconds) + Math.log2(100 / camera.iso);
  if (ev100 < -32 || ev100 > 32) throw new RangeError("CP-F08 physical camera EV100 is outside [-32, 32]");
  return ev100;
}

export function resolveManualEv100(settings, camera) {
  return settings.applyPhysicalCameraExposure ? physicalCameraEv100(camera) : settings.manualEv100;
}
