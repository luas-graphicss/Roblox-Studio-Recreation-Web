export function resolveFuturePostProcessRoute({ technology, enabled, safeMode, capabilities }) {
  if (safeMode) return { active: false, reason: "safe-mode" };
  if (technology !== "Future") return { active: false, reason: "legacy-technology" };
  if (enabled !== true) return { active: false, reason: "feature-not-promoted" };
  if (!capabilities?.webgl2 || !capabilities?.floatColorBuffer) return { active: false, reason: "unsupported-hdr-backend" };
  return { active: true, reason: "future-enabled" };
}

export function createFutureHostBoundary({ pipeline, renderLegacy, present }) {
  if (!pipeline || typeof renderLegacy !== "function" || typeof present !== "function") throw new TypeError("Complete host callbacks are required");
  return Object.freeze({
    render({ frame, inputs, ...options }) {
      const route = resolveFuturePostProcessRoute(options);
      if (!route.active) { renderLegacy(); return { presented: true, route }; }
      let result;
      try { result = pipeline.render(frame, inputs); }
      catch (error) { renderLegacy(); return { presented: true, route: { active: false, reason: "pipeline-failed", error: error.message } }; }
      present(result.color, frame);
      return { presented: true, route, result };
    }
  });
}
