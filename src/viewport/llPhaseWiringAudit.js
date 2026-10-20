import { LOCAL_LIGHT_PHASES } from "../lighting/llPhaseInventoryCore.js";
import { listLocalLightFlags } from "../lighting/llFeatureFlags.js";
import { llQa } from "../lighting/llTelemetry.js";
import {
  auditLocalLightPhaseWiring,
  describeDormantPhases,
} from "../lighting/llPhaseWiringAuditCore.js";


const AUDIT_GLOBAL_NAME = "__llWiringAudit";

let lastAudit = null;


export function auditLocalLightWiring(input) {
  const settings = input && typeof input === "object" ? input : {};
  const registry = settings.registry;
  const registryState =
    registry && typeof registry.getState === "function" ? registry.getState() : null;
  const telemetry = llQa.getMutableState();

  lastAudit = auditLocalLightPhaseWiring({
    phases: LOCAL_LIGHT_PHASES,
    phaseHandles: settings.phaseHandles,
    registeredFlagIds: listLocalLightFlags().map((flag) => flag.id),
    registryState,
    telemetryPhases: telemetry ? telemetry.phases : null,
  });
  return lastAudit;
}








export function publishLocalLightWiringAudit(input) {
  const audit = auditLocalLightWiring(input);

  for (const row of audit.rows) {
    llQa.setPhase(row.id, {
      wiring: row.state,
      wiringReason: row.reason,
      wiringFlagId: row.flagId,
      wiringPatchId: row.patchId,
      wiringPatchAppliedThisSession: row.appliedThisSession,
    });
  }

  if (audit.dormantCount > 0) {
    llQa.addError(
      "local lights: " +
        audit.dormantCount +
        "/" +
        audit.total +
        " phases are DORMANT (" +
        audit.dormantIds.join(", ") +
        ")",
      "llPhaseWiringAudit",
    );
  }


  const awakeCount = audit.total - audit.dormantCount;
  if (typeof console !== "undefined" && typeof console.log === "function") {
    console.log(
      "[Local lights] wiring: " +
        awakeCount +
        "/" +
        audit.total +
        " phases AWAKE" +
        (audit.dormantCount > 0 ? " | DORMANT: " + audit.dormantIds.join(", ") : " | none dormant"),
    );
  }

  if (typeof window !== "undefined") {
    window[AUDIT_GLOBAL_NAME] = () => lastAudit;
  }
  return audit;
}


export function getLastLocalLightWiringAudit() {
  return lastAudit;
}


export function describeLocalLightDormantPhases() {
  return lastAudit ? describeDormantPhases(lastAudit.rows) : [];
}
