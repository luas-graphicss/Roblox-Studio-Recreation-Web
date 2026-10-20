import { requireFinite } from "./diagnosticValidation.js";

export function resolveDiagnosticDomain(resource, binding, frame) {
  const encoding = resource.encoding;
  const kind = binding.kind;
  const channel = binding.channel ?? 0;
  if (kind === "color" || kind === "bloom") {
    const linear = /^scene-linear-(rec709|display-p3|rec2020|acescg)$/.exec(encoding);
    if (linear) {
      const primaries = linear[1];
      const namedSpace = typeof resource.colorSpace === "object" ? resource.colorSpace?.name : resource.colorSpace;
      if (namedSpace && namedSpace !== primaries) throw new Error("Color metadata disagrees with encoding");
      if (resource.transfer && resource.transfer !== "linear") throw new Error("Scene color must be linear");
      if (resource.preExposure === null) throw new Error("preExposure cannot be null");
      const preExposure = requireFinite(resource.preExposure ?? 1, "preExposure", Number.MIN_VALUE);
      if (resource.preExposure === undefined && !(encoding === "scene-linear-rec709" && binding.resource === "sceneColor")) throw new Error("Unspecified pre-exposure for a non-B00 color source");
      return { kind, encoding, domain: `scene-linear-${primaries}`, unit: "scene-radiance", channels: [0, 1, 2, 3], preExposure, channel, decode: "radiance", display: primaries === "rec709" ? "diagnostic-reinhard-srgb" : "diagnostic-components-no-gamut-conversion" };
    }
    if (encoding === "display-srgb") return { kind, encoding, domain: "display-srgb", unit: "normalized-display-code", channels: [0, 1, 2, 3], preExposure: 1, channel, decode: "identity", display: "already-srgb" };
    throw new Error(`Unsupported color domain: ${encoding}; bind an explicitly supported output`);
  }
  if (kind === "depth") {
    if (encoding === "hardware-depth-opengl") {
      const nearMeters = requireFinite(resource.nearMeters ?? frame.camera?.nearMeters, "nearMeters", Number.MIN_VALUE);
      const farMeters = requireFinite(resource.farMeters ?? frame.camera?.farMeters, "farMeters", nearMeters + Number.EPSILON);
      return { kind, encoding, domain: "positive-view-depth", unit: "meters", channels: [0], channel, decode: "hardware-depth", nearMeters, farMeters };
    }
    if (encoding === "linear-depth-meters") return { kind, encoding, domain: "positive-view-depth", unit: "meters", channels: [0], channel, decode: "scalar" };
  }
  if (kind === "motion" && encoding === "uv-current-minus-previous") return { kind, encoding, domain: "current-minus-previous-no-jitter", unit: "uv/frame", channels: [0, 1], channel, decode: "identity" };
  if (kind === "normal" && ["view-normal-encoded", "view-normal-xyz"].includes(encoding)) return { kind, encoding, domain: "view-space-normal", unit: "unit-vector", channels: [0, 1, 2], channel, decode: encoding === "view-normal-encoded" ? "normal" : "identity" };
  const scalarKinds = { coc: ["signed-circle-of-confusion", "output-pixels"], rejection: ["history-rejection", "rejection-weight"], histogram: ["histogram-bin-weights", "weighted-samples"], gain: ["local-exposure-gain", "multiplier"] };
  if (scalarKinds[kind]) {
    if (!binding.encoding || !binding.unit || !binding.domain) throw new Error(`${kind} needs an explicit encoding, unit and domain; producer aliases are not guessed`);
    return { kind, encoding, domain: binding.domain, unit: binding.unit, channels: [0], channel, decode: "scalar" };
  }
  if (kind === "scalar" && binding.unit && binding.domain && binding.encoding) return { kind, encoding, domain: binding.domain, unit: binding.unit, channels: [0], channel, decode: "scalar" };
  throw new Error(`Unsupported ${kind} encoding: ${encoding}`);
}

export function decodeDiagnosticPixels(rawPixels, domain) {
  const pixels = new Float32Array(rawPixels);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (domain.decode === "radiance") {
      for (let channel = 0; channel < 3; channel += 1) pixels[offset + channel] /= domain.preExposure;
    } else if (domain.decode === "normal") {
      for (let channel = 0; channel < 3; channel += 1) pixels[offset + channel] = pixels[offset + channel] * 2 - 1;
    } else if (domain.decode === "hardware-depth") {
      const depth = rawPixels[offset + domain.channel];
      if (depth < 0 || depth > 1) throw new Error("Hardware depth is outside 0..1");
      pixels[offset] = domain.nearMeters * domain.farMeters / (domain.farMeters - depth * (domain.farMeters - domain.nearMeters));
    } else if (domain.decode === "scalar") pixels[offset] = rawPixels[offset + domain.channel];
  }
  return pixels;
}
