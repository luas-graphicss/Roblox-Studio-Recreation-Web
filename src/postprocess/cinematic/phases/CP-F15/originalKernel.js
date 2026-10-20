export function createOriginalAnamorphicKernel() {
  const width = 17;
  const height = 7;
  const data = new Array(width * height * 3).fill(0);
  for (let horizontal = 0; horizontal < width; horizontal += 1) {
    const distance = Math.abs(horizontal - 8);
    const strength = distance === 0 ? 32 : 4 / (1 + distance);
    const index = (3 * width + horizontal) * 3;
    data[index] = strength * (horizontal < 8 ? 0.75 : 1);
    data[index + 1] = strength;
    data[index + 2] = strength * (horizontal > 8 ? 0.65 : 1.2);
  }
  for (const [horizontal, vertical, strength] of [[8, 1, 1], [8, 5, 1.5], [5, 2, 0.5], [11, 4, 0.8]]) {
    const index = (vertical * width + horizontal) * 3;
    data[index] = strength;
    data[index + 1] = strength * 0.8;
    data[index + 2] = strength * 0.6;
  }
  return { width, height, data, encoding: "scene-linear-rec709", origin: "bottom-left", provenance: { kind: "original", author: "CP-F15", license: "CC0-1.0", source: "CP-F15 procedural asymmetric diffraction fixture v1" } };
}
