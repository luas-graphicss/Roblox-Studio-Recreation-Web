export const MAX_GEOMETRY_IDENTIFIER = 16777215;

export function validateIdentifier(value, label = "geometry ID", maximum = MAX_GEOMETRY_IDENTIFIER) {
  if (!Number.isInteger(value) || value < 0 || value > maximum) throw new TypeError(`${label} must be an integer in [0, ${maximum}]`);
  return value;
}

export function encodeIdentifier(value) {
  validateIdentifier(value);
  return [value & 255, (value >>> 8) & 255, (value >>> 16) & 255];
}

export function decodeIdentifier(channels) {
  if (!channels || channels.length < 3) throw new TypeError("Geometry ID requires three byte channels");
  for (let channel = 0; channel < 3; channel += 1) validateIdentifier(channels[channel], "ID byte", 255);
  return channels[0] + channels[1] * 256 + channels[2] * 65536;
}
