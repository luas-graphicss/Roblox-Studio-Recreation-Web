export function readCaptureSample(view, offset, channelBytes, floating) {
  if (!floating) return view.getUint8(offset);
  if (channelBytes === 4) return view.getFloat32(offset, true);
  const bits = view.getUint16(offset, true);
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >>> 10) & 31;
  const fraction = bits & 1023;
  if (exponent === 31) return fraction ? NaN : sign * Infinity;
  return sign * (exponent === 0 ? fraction * 2 ** -24 : (1 + fraction / 1024) * 2 ** (exponent - 15));
}
