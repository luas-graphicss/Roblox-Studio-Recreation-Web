import { validateFrame, validateResource } from "../../contracts/frameContract.js";
import { BRIDGE_VERSION } from "./bridgeContract.js";
import { requireBridgeConfiguration } from "./bridgeProfile.js";
import { copyControlValue, freezeData } from "./bridgeValidation.js";

function routePlan(configuration, settingsResource, frame) {
  validateResource(settingsResource, frame, "CP-F27 resolved settings");
  const values = settingsResource.value?.values;
  if (!values || settingsResource.value.viewId !== frame.viewId) throw new Error("CP-F27 resolved settings need same-view values");
  const groups = new Map();
  for (const route of configuration.routes) {
    if (!Object.hasOwn(values, route.property)) throw new Error(`CP-F27 BLOCKED_CONTROL: ${route.property}`);
    const adapter = configuration.adapters.get(route.feature);
    if (!adapter || typeof adapter.applyControls !== "function") throw new Error(`CP-F27 BLOCKED_CONTROL_OWNER: ${route.feature}`);
    if (!groups.has(route.feature)) groups.set(route.feature, { adapter, parameters: {} });
    groups.get(route.feature).parameters[route.parameter] = copyControlValue(values[route.property], route.property);
  }
  return [...groups].map(([feature, { adapter, parameters }]) => ({ feature, adapter, parameters: Object.freeze(parameters) }));
}

function stampFor(configuration, frame, plan) {
  return JSON.stringify([BRIDGE_VERSION, configuration.id, frame.viewId, frame.frameId, frame.generation, plan.map(({ feature, adapter, parameters }) => [feature, adapter.owner, Object.entries(parameters).sort(([left], [right]) => left.localeCompare(right))])]);
}

export function dispatchBridgeControls(configuration, { frame, settingsResource, capturePhase }) {
  requireBridgeConfiguration(configuration);
  validateFrame(frame);
  if (capturePhase !== "before-scene-capture") throw new Error("CP-F27 lighting controls must be routed before scene capture, never from a post pass");
  const plan = routePlan(configuration, settingsResource, frame);
  const stamp = stampFor(configuration, frame, plan);
  const applications = [];
  for (const { feature, adapter, parameters } of plan) {
    const response = adapter.applyControls(Object.freeze({ frame: Object.freeze({ viewId: frame.viewId, frameId: frame.frameId, generation: frame.generation }), parameters, stamp, capturePhase }));
    if (response?.then || response?.accepted !== true || response.owner !== adapter.owner) throw new Error(`CP-F27 control owner did not acknowledge ${feature}`);
    applications.push({ feature, owner: adapter.owner, parameters });
  }
  return Object.freeze({ value: freezeData({ version: BRIDGE_VERSION, profileId: configuration.id, status: "applied-before-capture", stamp, applications }), frameId: frame.frameId, viewId: frame.viewId, generation: frame.generation, provenance: settingsResource.provenance });
}

export function validateBridgeControlReceipt(configuration, frame, settingsResource, receipt, lightingState) {
  validateResource(receipt, frame, "CP-F27 control receipt");
  const plan = routePlan(configuration, settingsResource, frame);
  const stamp = stampFor(configuration, frame, plan);
  const value = receipt.value;
  const expected = plan.map(({ feature, adapter, parameters }) => ({ feature, owner: adapter.owner, parameters }));
  if (value?.version !== BRIDGE_VERSION || value.profileId !== configuration.id || value.status !== "applied-before-capture" || value.stamp !== stamp || lightingState.controlStamp !== stamp || JSON.stringify(value.applications) !== JSON.stringify(expected)) throw new Error("CP-F27 stale, missing or unacknowledged lighting controls in captured scene");
  return stamp;
}
