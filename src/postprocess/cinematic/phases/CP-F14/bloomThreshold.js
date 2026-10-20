export function bloomContribution(brightness, threshold, softKnee) {
  if (!Number.isFinite(brightness) || brightness < 0) throw new TypeError("Bloom brightness must be finite and nonnegative");
  if (!Number.isFinite(threshold) || (threshold < 0 && threshold !== -1) || threshold > 65504) throw new TypeError("Invalid bloom threshold");
  if (!Number.isFinite(softKnee) || softKnee < 0 || softKnee > 1) throw new TypeError("Invalid bloom soft knee");
  if (brightness === 0) return 0;
  if (threshold === -1) return 1;
  const kneeWidth = threshold * softKnee;
  const hardExcess = Math.max(brightness - threshold, 0);
  const transition = Math.min(Math.max(brightness - threshold + kneeWidth, 0), 2 * kneeWidth);
  const softExcess = kneeWidth > 0 ? transition * transition / (4 * kneeWidth) : 0;
  return Math.min(1, Math.max(hardExcess, softExcess) / brightness);
}

export function extractBloomRadiance(color, settings, preExposure = 1) {
  if (!Number.isFinite(preExposure) || preExposure <= 0) throw new TypeError("Pre-exposure must be finite and positive");
  if (!color || color.length < 3 || !Array.from(color).every(Number.isFinite)) throw new TypeError("Bloom color must be finite RGB or RGBA");
  const positive = Array.from(color).slice(0, 3).map((channel) => Math.max(channel, 0));
  const brightness = Math.max(...positive) / preExposure;
  const contribution = bloomContribution(brightness, settings.threshold, settings.softKnee);
  return positive.map((channel) => channel * contribution);
}
