export function createSubstrateSmHostQa(pipeline) {
  function getSnapshot() {
    const host = pipeline.snapshot();
    const diagnostics = pipeline.getDiagnostics();
    const materials = Array.isArray(diagnostics.materials) ? diagnostics.materials : [];
    const live = host.runtimeReady === true && host.hostEvidenceAvailable === true;
    return {
      schemaVersion: 2,
      availability: live ? 'host-live' : 'host-only',
      counts: {
        registered: host.registered ?? 0,
        shaderCommitted: live ? host.shaderCommitted ?? 0 : null,
        programConfirmed: live ? host.appliedCount ?? 0 : null,
        preparing: live ? host.preparing ?? 0 : null,
        fallback: live ? host.fallback ?? 0 : null,
        renderedInLastCapture: null,
        drawCallsInLastCapture: null,
      },
      materials,
      providers: { host },
      lastCapture: null,
      events: [],
    };
  }

  return Object.freeze({
    get: getSnapshot,
    getSnapshot,
    getHostState: () => pipeline.snapshot(),
    getDiagnostics: () => pipeline.getDiagnostics(),
    capture: async () => ({ ok: false, reason: 'SSM_HOST_CAPTURE_NOT_CONNECTED', report: null, pixels: null }),
  });
}
