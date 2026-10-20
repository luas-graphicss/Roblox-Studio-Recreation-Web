import { requireNumber } from "./bridgeValidation.js";

function requireSample(sample, label) {
  for (const kind of ["color", "velocity"]) {
    if (!sample[kind] || sample[kind].length !== 4) throw new TypeError(`CP-F27 ${label}.${kind} requires four channels`);
    for (const value of sample[kind]) requireNumber(value, `${label}.${kind}`, -65504, 65504);
  }
  for (const kind of ["coverage", "reactive"]) requireNumber(sample[kind], `${label}.${kind}`, 0, 1);
  requireNumber(sample.color[3], `${label}.alpha`, 0, 1);
  requireNumber(sample.velocity[3], `${label}.motionValidity`, 0, 1);
  if (sample.color[3] === 0 && sample.color.slice(0, 3).some((value) => value !== 0)) throw new Error(`CP-F27 inconsistent premultiplication: ${label}`);
}

export function compositeBridgeSample(background, foreground, exposureScale = 1) {
  requireSample(background, "background");
  requireSample(foreground, "foreground");
  requireNumber(exposureScale, "exposure scale", Number.MIN_VALUE, Number.MAX_VALUE);
  const alpha = foreground.color[3];
  const remaining = 1 - alpha;
  const color = [...background.color].map((value, channel) => channel === 3 ? alpha + value * remaining : foreground.color[channel] * exposureScale + value * remaining);
  for (const value of color) requireNumber(value, "composited channel", -65504, 65504);
  const hasForeground = alpha > 0;
  const selected = hasForeground ? foreground : background;
  const valid = (selected.coverage > 0 || selected.color[3] > 0) && selected.velocity[3] > 0.5;
  const velocity = valid ? [...selected.velocity] : [0, 0, 0, 0];
  const coverage = foreground.coverage + background.coverage * (1 - foreground.coverage);
  const reactive = Math.max(background.reactive, foreground.reactive, (coverage > 0 || color[3] > 0) && !valid ? 1 : 0);
  return { color, coverage, reactive, velocity };
}
