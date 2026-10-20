import { CONTRACT_VERSION } from "../../contracts/phaseManifest.js";
import { installDiagnostics } from "./installDiagnostics.js";

export { createDiagnosticsSession } from "./createDiagnosticsSession.js";
export { compareSnapshots } from "./compareSnapshots.js";
export { probePixel, probeUv } from "./pixelProbe.js";
export { renderDiagnosticImage } from "./diagnosticVisualization.js";
export { buildDiagnosticGraph } from "./diagnosticGraph.js";
export { createEvidenceBundle, verifyEvidenceBundle } from "./diagnosticEvidence.js";
export { DIAGNOSTICS_SESSION, DIAGNOSTICS_RESOURCE } from "./diagnosticsContract.js";

export default Object.freeze({ id: "CP-F30", contractVersion: CONTRACT_VERSION, status: "implemented", install: installDiagnostics });
