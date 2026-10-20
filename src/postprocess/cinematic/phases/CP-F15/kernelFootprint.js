export function buildKernelFootprint(kernel, settings, resolutionRatio = [1, 1]) {
  const samples = new Map();
  const scaleX = settings.scale * settings.anamorphicRatio * resolutionRatio[0];
  const scaleY = settings.scale * resolutionRatio[1];
  const centerX = settings.center[0] * (kernel.width - 1);
  const centerY = settings.center[1] * (kernel.height - 1);
  function accumulate(horizontal, vertical, weight, sourceIndex) {
    if (weight === 0) return;
    const key = `${horizontal},${vertical}`;
    let sample = samples.get(key);
    if (!sample) { sample = { x: horizontal, y: vertical, weight: [0, 0, 0] }; samples.set(key, sample); }
    for (let channel = 0; channel < 3; channel += 1) sample.weight[channel] += kernel.data[sourceIndex + channel] * weight;
  }
  for (let vertical = 0; vertical < kernel.height; vertical += 1) {
    for (let horizontal = 0; horizontal < kernel.width; horizontal += 1) {
      const sourceIndex = (vertical * kernel.width + horizontal) * 3;
      if (kernel.data[sourceIndex] + kernel.data[sourceIndex + 1] + kernel.data[sourceIndex + 2] === 0) continue;
      const offsetX = (horizontal - centerX) * scaleX;
      const offsetY = (vertical - centerY) * scaleY;
      const left = Math.floor(offsetX);
      const bottom = Math.floor(offsetY);
      const fractionX = offsetX - left;
      const fractionY = offsetY - bottom;
      accumulate(left, bottom, (1 - fractionX) * (1 - fractionY), sourceIndex);
      accumulate(left + 1, bottom, fractionX * (1 - fractionY), sourceIndex);
      accumulate(left, bottom + 1, (1 - fractionX) * fractionY, sourceIndex);
      accumulate(left + 1, bottom + 1, fractionX * fractionY, sourceIndex);
    }
  }
  const taps = [...samples.values()].sort((left, right) => left.y - right.y || left.x - right.x);
  if (!taps.length || taps.length > 4096) throw new RangeError("Convolution footprint must contain 1..4096 nonzero taps; no automatic truncation is permitted");
  const minimumX = Math.min(0, ...taps.map((tap) => tap.x));
  const minimumY = Math.min(0, ...taps.map((tap) => tap.y));
  const maximumX = Math.max(0, ...taps.map((tap) => tap.x));
  const maximumY = Math.max(0, ...taps.map((tap) => tap.y));
  return Object.freeze({ taps: Object.freeze(taps.map((tap) => Object.freeze({ ...tap, weight: Object.freeze(tap.weight) }))), minimumX, minimumY, maximumX, maximumY });
}
