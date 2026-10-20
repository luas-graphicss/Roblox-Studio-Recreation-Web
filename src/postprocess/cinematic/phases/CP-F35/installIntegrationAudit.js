import {
  QA_OWNER,
  QA_RESOURCE,
  QA_SCHEMA_VERSION,
  QA_SETTINGS_KEY,
  resolveAuditSettings,
} from "./qaContract.js";
import { inspectResource } from "./resourceAudit.js";

export function installIntegrationAudit(services) {
  if (!services.graph?.register || !services.settings?.get)
    throw new TypeError("CP-F35 requires graph and settings services");
  const settings = resolveAuditSettings(services.settings.get(QA_SETTINGS_KEY));
  const reads = ["$color", ...settings.resourceNames];
  let disposed = false;
  const unregister = services.graph.register({
    id: "CP-F35.inspectFrame",
    owner: QA_OWNER,
    stage: "debug",
    order: 3500,
    reads,
    writes: [QA_RESOURCE],
    transformsColor: false,
    execute(context) {
      if (disposed) throw new Error("CP-F35 audit has been disposed");
      const resources = [];
      const failures = [];
      for (const name of reads) {
        try {
          resources.push(
            inspectResource(
              context.read(name),
              context.frame,
              name,
              services.rendererAdapter,
              settings.capturePixels,
            ),
          );
        } catch (error) {
          failures.push({ name, message: error.message });
        }
      }
      const status = failures.length
        ? "failed"
        : resources.some((resource) => resource.status === "blocked-value")
          ? "blocked"
          : settings.capturePixels
            ? "readback-observed"
            : "metadata-only";
      const value = Object.freeze({
        schemaVersion: QA_SCHEMA_VERSION,
        status,
        evidenceType: "derived-diagnostic-audit",
        resources: Object.freeze(resources),
        failures: Object.freeze(failures),
        referenceVerified: false,
        integrationCertified: false,
        productionTimingCertified: false,
      });
      const { frameId, viewId, generation } = context.frame;
      context.publish(
        QA_RESOURCE,
        Object.freeze({
          frameId,
          viewId,
          generation,
          provenance: "synthetic",
          value,
        }),
      );
      services.report?.({
        phase: QA_OWNER,
        type: "frame-audit",
        frameId,
        viewId,
        generation,
        ...value,
      });
      if (settings.strict && failures.length)
        throw new Error(
          `CP-F35 rejected frame: ${failures.map((failure) => failure.message).join("; ")}`,
        );
    },
  });
  return () => {
    if (disposed) return;
    disposed = true;
    unregister();
  };
}
