import { validateResource } from "../../contracts/frameContract.js";
import { BRIDGE_FEATURES, BRIDGE_VERSION, BRIDGE_OWNER } from "./bridgeContract.js";
import { requireFeatureAdapter } from "./bridgeAdapters.js";
import { validateBridgeColor } from "./bridgeInputs.js";
import { validateBridgeControlReceipt } from "./bridgeControlRouting.js";
import { freezeData, requireName } from "./bridgeValidation.js";

export function validateLightingBoundary(configuration, context) {
  if (context.frame.referenceMode) throw new Error("CP-F27 BLOCKED_REFERENCE: verified reference profile is unavailable");
  validateBridgeColor(context.read("$color"), context.frame);
  const declaration = context.read(configuration.boundaryResource);
  validateResource(declaration, context.frame, "CP-F27 host lighting declaration");
  const state = declaration.value;
  if (!state || state.version !== BRIDGE_VERSION || state.profileId !== configuration.id || state.inputKind !== configuration.inputKind || state.lightingComplete !== true) throw new Error("CP-F27 incomplete or incompatible lighting boundary");
  if (state.tonemapped !== false || state.displayEncoded !== false) throw new Error("CP-F27 double tonemapping/output is forbidden at the lighting boundary");
  if (!Array.isArray(state.primaryDomains) || new Set(state.primaryDomains).size !== state.primaryDomains.length || configuration.primaryDomains.some((domain) => !state.primaryDomains.includes(domain))) throw new Error("CP-F27 missing primary material domains");
  if (!Array.isArray(state.effects)) throw new Error("CP-F27 lighting ownership ledger is required");
  const effects = new Map();
  for (const effect of state.effects) {
    if (!BRIDGE_FEATURES.includes(effect.feature) || effects.has(effect.feature) || effect.applications !== 1 || effect.owner === BRIDGE_OWNER) throw new Error("CP-F27 duplicate or invalid lighting application; AO/fog/lighting are not post filters");
    requireFeatureAdapter(configuration.adapters, effect.feature, effect.mode, effect.owner);
    effects.set(effect.feature, effect);
  }
  for (const requirement of configuration.requirements) {
    requireFeatureAdapter(configuration.adapters, requirement.feature, requirement.mode, requirement.owner);
    const applied = effects.get(requirement.feature);
    if (!applied || applied.owner !== requirement.owner || applied.mode !== requirement.mode) throw new Error(`CP-F27 BLOCKED_SIGNAL: ${requirement.feature}/${requirement.mode}`);
  }
  if (!Array.isArray(state.compositedLayerIds) || new Set(state.compositedLayerIds).size !== state.compositedLayerIds.length) throw new Error("CP-F27 requires a unique scene composition ledger");
  for (const id of state.compositedLayerIds) requireName(id, "composited layer id");
  for (const layer of configuration.stages.flatMap((stage) => stage.layers)) if (state.compositedLayerIds.includes(layer.id)) throw new Error(`CP-F27 layer already included by the scene: ${layer.id}`);
  if (configuration.routes.length) validateBridgeControlReceipt(configuration, context.frame, context.read(configuration.settingsResource), context.read(configuration.controlReceiptResource), state);
  return freezeData({ status: "ready-isolated", profileId: configuration.id, effects: [...effects.values()].map((effect) => ({ ...effect })), primaryDomains: [...state.primaryDomains], compositedLayerIds: [...state.compositedLayerIds], controlStamp: state.controlStamp ?? null, referenceStatus: "BLOCKED_REFERENCE", providerEvidence: "host-declared-not-reference-certified" });
}
