import { CONTRACT_VERSION, PHASE_MANIFEST } from "../contracts/phaseManifest.js";
import { importRegisteredPhase } from "./phaseRegistry.js";

export async function loadPhaseModules(importModule = importRegisteredPhase) {
  return Promise.all(PHASE_MANIFEST.map(async (definition) => {
    try {
      const imported = await importModule(definition.entry);
      const phase = imported.default;
      if (!phase || phase.id !== definition.id || phase.contractVersion !== CONTRACT_VERSION) throw new Error("Phase identity or contract mismatch");
      if (!["planned", "implemented"].includes(phase.status) || typeof phase.install !== "function") throw new Error("Invalid phase status or installer");
      return { id: definition.id, title: definition.title, status: phase.status, module: phase };
    } catch (error) {
      return { id: definition.id, title: definition.title, status: "failed", error: error.message, module: null };
    }
  }));
}
