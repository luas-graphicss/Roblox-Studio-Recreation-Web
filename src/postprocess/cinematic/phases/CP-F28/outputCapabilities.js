import { OUTPUT_MODES } from "./outputContract.js";

function inspectSurface(profile, surface, generation) {
  const failures = [];
  if (!surface || typeof surface.present !== "function" || typeof surface.describe !== "function") return { failures: ["No explicit output-surface presenter"], evidence: null };
  const evidence = surface.describe();
  if (!evidence || evidence.provenance !== "measured-device" || evidence.generation !== generation) failures.push("Missing current-generation measured surface evidence");
  if (evidence?.encoding !== profile.encoding || evidence?.gamut !== profile.gamut || evidence?.transfer !== profile.transfer || evidence?.whitePoint !== "D65") failures.push("Surface encoding, gamut, transfer or white point does not match");
  for (const name of ["id", "backend", "displayId", "operatingSystem", "browser", "capturedAt"]) if (typeof evidence?.[name] !== "string" || !evidence[name].trim()) failures.push(`Missing surface ${name}`);
  if (!Array.isArray(evidence?.artifacts) || !evidence.artifacts.length || evidence.artifacts.some((entry) => typeof entry?.path !== "string" || !entry.path || !/^[a-f0-9]{64}$/.test(entry.sha256 ?? ""))) failures.push("Surface evidence requires artifact paths and SHA-256 hashes");
  if (profile.hdr) {
    for (const name of ["monitorHdrEnabled", "operatingSystemHdrEnabled", "browserHdrEnabled"]) if (evidence?.[name] !== true) failures.push(`HDR requires ${name}`);
    if (typeof evidence?.measurementDevice !== "string" || !evidence.measurementDevice.trim()) failures.push("HDR requires a measurement device");
    if (!Number.isFinite(evidence?.measuredPeakNits) || evidence.measuredPeakNits <= 0 || !Number.isFinite(evidence?.measuredBlackNits) || evidence.measuredBlackNits < 0) failures.push("HDR requires measured luminance limits");
    if (!Number.isInteger(evidence?.bitsPerChannel) || evidence.bitsPerChannel < (profile.transfer === "pq" ? 10 : 16)) failures.push("HDR requires adequate surface precision");
    if (profile.transfer === "linear" && evidence?.pixelRepresentation !== "float") failures.push("scRGB requires a floating-point surface");
  }
  return { failures, evidence };
}

export function resolveOutputPlan(settings, { capabilities, outputSurface = null, generation = 0 } = {}) {
  if (!capabilities?.webgl2 || !capabilities.floatColorBuffer) throw new Error("CP-F28 requires WebGL2 and float color buffers; no hidden RGBA8 transport fallback");
  let mode = settings.outputMode;
  let profile = OUTPUT_MODES[mode];
  let fallbackReason = null;
  let attestationId = null;
  if (settings.enabled && settings.destination === "display" && mode !== "srgb") {
    const inspected = inspectSurface(profile, outputSurface, generation);
    if (profile.hdr && inspected.evidence?.measuredPeakNits < settings.peakNits) inspected.failures.push("Requested peak exceeds measured display peak");
    if (inspected.failures.length) {
      if (settings.fallback === "block") throw new Error(`CP-F28 BLOCKED_OUTPUT: ${inspected.failures.join("; ")}`);
      fallbackReason = inspected.failures.join("; ");
      mode = "srgb";
      profile = OUTPUT_MODES.srgb;
    } else attestationId = inspected.evidence.id;
  }
  const gamut = mode === "linear" && settings.outputGamut !== "auto" ? settings.outputGamut : profile.gamut;
  const extended = mode === "scrgb" || mode === "linear";
  const mapping = settings.gamutMapping === "auto" || fallbackReason ? (extended ? "preserve" : "compress") : settings.gamutMapping;
  return Object.freeze({
    ...profile, mode, requestedMode: settings.outputMode, destination: settings.destination, gamut,
    encoding: mode === "linear" ? `display-linear-${gamut}` : profile.encoding,
    whitePoint: fallbackReason ? "D65" : settings.outputWhitePoint,
    paperWhiteNits: settings.paperWhiteNits, peakNits: profile.hdr ? settings.peakNits : settings.paperWhiteNits,
    blackNits: settings.blackNits, maximum: profile.hdr ? settings.peakNits / settings.paperWhiteNits : 1,
    mapping, dither: fallbackReason ? "none" : settings.dither, ditherSeed: settings.ditherSeed,
    fallback: Boolean(fallbackReason), fallbackReason, surfaceAttestationId: attestationId,
    presentationAllowed: settings.enabled && settings.destination === "display",
    nativeHdrVerified: false, referenceVerified: false,
    capabilityStatus: settings.destination === "capture" ? "offscreen-only" : attestationId ? "host-attested-not-certified" : "sdr-browser-path",
    certification: "BLOCKED_REFERENCE"
  });
}
