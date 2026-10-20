import { validatePixels, validateTexture } from "./diagnosticValidation.js";
import { resolveDiagnosticDomain, decodeDiagnosticPixels } from "./diagnosticDomain.js";
import { copyEvidenceState } from "./canonicalEvidence.js";

export function createDiagnosticSnapshot({ resource, binding, frame, rawPixels, state = {}, acquisition = "provided-float32-pixels" }) {
  validateTexture(resource, frame, binding);
  validatePixels(rawPixels, resource.width, resource.height);
  const domain = resolveDiagnosticDomain(resource, binding, frame);
  const pixels = decodeDiagnosticPixels(rawPixels, domain);
  validatePixels(pixels, resource.width, resource.height);
  let nonzeroPixels = 0;
  let coveredPixels = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (domain.channels.some((channel) => channel !== 3 && pixels[offset + channel] !== 0)) nonzeroPixels += 1;
    if (pixels[offset + 3] > 0) coveredPixels += 1;
  }
  const metadata = {
    bindingId: binding.id, resource: binding.resource, label: binding.label ?? binding.id,
    width: resource.width, height: resource.height, format: resource.format, origin: "bottom-left",
    ...domain, sourceProvenance: resource.sourceProvenance ?? resource.provenance, acquisitionProvenance: resource.provenance,
    acquisition,
    frame: copyEvidenceState(frame), state: copyEvidenceState(state),
    statistics: { pixels: pixels.length / 4, nonzeroPixels, coveredPixels },
    range: binding.range ? [...binding.range] : null,
    referenceCertified: false, performanceCertified: false, uiIncluded: false
  };
  return Object.freeze({ metadata: Object.freeze(metadata), pixels });
}
