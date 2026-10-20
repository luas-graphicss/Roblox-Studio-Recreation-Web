const FNV_OFFSET_BASIS_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;

function mixByte(hash, byte) {
  return Math.imul(hash ^ byte, FNV_PRIME_32) >>> 0;
}


export function hashImageText(text) {
  const value = String(text === undefined || text === null ? "" : text);
  let hash = FNV_OFFSET_BASIS_32;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    hash = mixByte(hash, code & 0xff);
    hash = mixByte(hash, (code >>> 8) & 0xff);
  }
  return ("00000000" + hash.toString(16)).slice(-8);
}

export function createImageFingerprint(capture) {
  const source = capture || {};
  const text = typeof source.dataUrl === "string" ? source.dataUrl : "";
  return Object.freeze({
    hash: text ? hashImageText(text) : "",
    length: text.length,
    meanLuminance: Number.isFinite(source.meanLuminance) ? source.meanLuminance : null,
    width: Number.isFinite(source.width) ? source.width : null,
    height: Number.isFinite(source.height) ? source.height : null,
  });
}

export function compareImageFingerprints(baseline, current) {
  const left = baseline || {};
  const right = current || {};
  const bothHaveLuminance = Number.isFinite(left.meanLuminance) && Number.isFinite(right.meanLuminance);
  return {
    identical: !!left.hash && left.hash === right.hash,
    baselineHash: left.hash || "",
    currentHash: right.hash || "",
    luminanceDelta: bothHaveLuminance ? Math.abs(left.meanLuminance - right.meanLuminance) : null,
    lengthDelta: Number.isFinite(left.length) && Number.isFinite(right.length) ? right.length - left.length : null,
  };
}
