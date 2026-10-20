const displayDomains = Object.freeze({
  "display-linear-rec709": Object.freeze({ primaries: "rec709", luminance: Object.freeze([0.2126, 0.7152, 0.0722]), mode: "sdr" }),
  "display-linear-rec2020": Object.freeze({ primaries: "rec2020", luminance: Object.freeze([0.2627, 0.6780, 0.0593]), mode: "hdr" })
});

export function validateGrainColor(source, frame, applying, capture) {
  if (source.format !== "rgba16f") throw new TypeError("CP-F25 requires an RGBA16F input; no hidden byte fallback");
  if (!applying) return null;
  const domain = displayDomains[source.encoding];
  if (!domain) throw new Error(`CP-F25 requires display-linear film output, not ${source.encoding}`);
  if (source.preExposure !== 1) throw new Error("CP-F25 display-linear input must declare preExposure 1");
  if (source.transfer !== "linear") throw new Error("CP-F25 requires explicit linear transfer before the output transform");
  const primaries = source.colorMetadata?.colorPrimaries ?? (typeof source.colorSpace === "string" ? source.colorSpace : source.colorSpace?.name);
  if (primaries !== domain.primaries) throw new Error("CP-F25 input primaries disagree with the encoding");
  if (source.filmGrain?.applied === true) throw new Error("CP-F25 refuses to apply film grain twice");
  if (domain.mode === "hdr") {
    const white = source.colorMetadata?.referenceWhiteNits;
    const peak = source.colorMetadata?.peakNits;
    if (!Number.isFinite(white) || white <= 0 || !Number.isFinite(peak) || peak < white) throw new TypeError("CP-F25 HDR requires referenceWhiteNits and peakNits metadata");
  }
  if (!capture && (source.width !== frame.outputSize.width || source.height !== frame.outputSize.height)) throw new Error("CP-F25 must run at output resolution after temporal reconstruction");
  return domain;
}

export function preserveGrainColorMetadata(source) {
  const metadata = {};
  for (const name of ["colorSpace", "colorMetadata", "preExposure", "transfer", "samplerDecoded", "alphaMode", "formatPolicy", "displayVerified", "referenceVerified"]) if (source[name] !== undefined) metadata[name] = source[name];
  return metadata;
}
