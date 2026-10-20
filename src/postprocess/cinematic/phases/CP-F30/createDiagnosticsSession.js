import { DIAGNOSTIC_LIMITS } from "./diagnosticsContract.js";
import { validateBindings, validateTexture, sameFrame, requireFinite } from "./diagnosticValidation.js";
import { createDiagnosticReadback } from "./createDiagnosticReadback.js";
import { createDiagnosticSnapshot } from "./diagnosticSnapshot.js";
import { resolveDiagnosticDomain } from "./diagnosticDomain.js";
import { validateFrame } from "../../contracts/frameContract.js";
import { canonicalJson, copyEvidenceState } from "./canonicalEvidence.js";

export function createDiagnosticsSession({ rendererAdapter, pool, bindings, maxPixels = DIAGNOSTIC_LIMITS.maxPixels, maxSnapshotBytes = DIAGNOSTIC_LIMITS.maxSnapshotBytes }) {
  const registeredBindings = validateBindings(bindings);
  requireFinite(maxPixels, "maxPixels", 1, DIAGNOSTIC_LIMITS.maxPixels);
  requireFinite(maxSnapshotBytes, "maxSnapshotBytes", 16, DIAGNOSTIC_LIMITS.maxSnapshotBytes);
  const reader = createDiagnosticReadback(rendererAdapter, pool);
  let current = null;
  let failure = null;
  let disposed = false;
  let captures = 0;

  function assertActive() {
    if (disposed) throw new Error("Diagnostics session is disposed");
  }

  function describe(frame) {
      assertActive();
      if (failure) return { status: "blocked", reason: failure.message, frame: failure.frame, buffers: [] };
      if (!current || !sameFrame(current.frame, frame)) return { status: "blocked", reason: "No observed resources for the requested frame", buffers: [] };
      return { status: "unmeasured", frame: copyEvidenceState(current.frame), buffers: current.entries.map(({ descriptor }) => copyEvidenceState(descriptor)), readback: "on-demand-only", captures, referenceCertified: false };
  }

  return Object.freeze({
    bindings: registeredBindings,
    beginFrame(frame) {
      assertActive();
      current = null;
      failure = null;
      validateFrame(frame);
    },
    observe(frame, resources) {
      assertActive();
      current = null;
      failure = null;
      try {
        validateFrame(frame);
        const entries = registeredBindings.map((binding) => {
          const resource = resources[binding.resource];
          validateTexture(resource, frame, binding);
          const domain = resolveDiagnosticDomain(resource, binding, frame);
          return { binding, resource, descriptor: { id: binding.id, label: binding.label, resource: binding.resource, width: resource.width, height: resource.height, format: resource.format, ...domain, sourceProvenance: resource.sourceProvenance ?? resource.provenance, status: "unmeasured" } };
        });
        current = { frame: copyEvidenceState(frame), entries };
        return describe(frame);
      } catch (error) { failure = { frame: copyEvidenceState(frame), message: error.message }; throw error; }
    },
    recordFailure(frame, error) {
      assertActive();
      current = null;
      failure = { frame: copyEvidenceState(frame), message: error instanceof Error ? error.message : String(error) };
    },
    describe,
    capture(bindingId, expectedFrame, state = {}) {
      assertActive();
      if (failure) throw new Error(`Capture blocked: ${failure.message}`);
      if (!current || !sameFrame(current.frame, expectedFrame) || canonicalJson(current.frame) !== canonicalJson(expectedFrame)) throw new Error("Capture requested for an unobserved, stale or cross-view frame");
      const entry = current.entries.find(({ binding }) => binding.id === bindingId);
      if (!entry) throw new Error(`Unknown buffer binding: ${bindingId}`);
      const { resource, binding } = entry;
      validateTexture(resource, expectedFrame, binding);
      const pixelCount = resource.width * resource.height;
      if (pixelCount > maxPixels || pixelCount * 16 > maxSnapshotBytes) throw new RangeError("Diagnostic capture exceeds its explicit pixel or snapshot budget");
      try {
        const rawPixels = reader.read(resource);
        const snapshot = createDiagnosticSnapshot({ resource, binding, frame: current.frame, rawPixels, state, acquisition: "gpu-r32f-per-channel-synchronous-diagnostic-readback" });
        captures += 1;
        return snapshot;
      } catch (error) { current = null; failure = { frame: copyEvidenceState(expectedFrame), message: error.message }; throw error; }
    },
    reset() { assertActive(); current = null; failure = null; },
    dispose() {
      if (disposed) return;
      disposed = true;
      current = null;
      failure = null;
      reader.dispose();
    }
  });
}
