import { CONTACT_SHADOW_LIGHT_SLOTS, CONTACT_SHADOW_MAX_MARCHING_LIGHTS } from "./llContactShadowContract.js";
import { clampContactShadowLengthStuds } from "./llContactShadowCore.js";

export const SPOT_LIGHT_TYPE = "SpotLight";
export const CONTACT_SHADOW_POINT_KIND = "point";
export const CONTACT_SHADOW_SPOT_KIND = "spot";
export const CONTACT_SHADOW_SKIP_REASON = Object.freeze({
  NO_LENGTH: "sem ContactShadowLength",
  OVER_BUDGET: "fora do orcamento de " + CONTACT_SHADOW_MAX_MARCHING_LIGHTS + " luzes",
  CHANNEL_FULL: "cena tem mais luzes deste tipo do que os " + CONTACT_SHADOW_LIGHT_SLOTS + " slots do canal",
});

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}


export function contactShadowLightKind(lightType) {
  return lightType === SPOT_LIGHT_TYPE ? CONTACT_SHADOW_SPOT_KIND : CONTACT_SHADOW_POINT_KIND;
}


export function contactShadowPriority(light) {
  const candidate = light || {};
  const intensity = Math.max(isFiniteNumber(Number(candidate.intensity)) ? Number(candidate.intensity) : 0, 0);
  const distanceToCamera = Math.max(isFiniteNumber(Number(candidate.distanceToCamera)) ? Number(candidate.distanceToCamera) : 0, 0.001);
  return intensity / (distanceToCamera * distanceToCamera);
}

function resolvePriority(light, screenCoveragePriorityByName) {
  const provided = screenCoveragePriorityByName ? screenCoveragePriorityByName[light.name] : undefined;
  if (isFiniteNumber(Number(provided))) return { priority: Number(provided), prioritySource: "LL-F12" };
  return { priority: contactShadowPriority(light), prioritySource: "LL-F15" };
}


function byPriorityThenName(a, b) {
  if (b.priority !== a.priority) return b.priority - a.priority;
  return String(a.name).localeCompare(String(b.name));
}


export function planContactShadowBudget(request) {
  const input = request || {};
  const lights = Array.isArray(input.lights) ? input.lights : [];
  const slotCount = isFiniteNumber(Number(input.slotCount)) ? Number(input.slotCount) : CONTACT_SHADOW_LIGHT_SLOTS;
  const maxMarchingLights = isFiniteNumber(Number(input.maxMarchingLights)) ? Number(input.maxMarchingLights) : CONTACT_SHADOW_MAX_MARCHING_LIGHTS;
  const pointLengths = new Array(slotCount).fill(0);
  const spotLengths = new Array(slotCount).fill(0);

  let pointLightCount = 0;
  let spotLightCount = 0;
  const candidates = lights.map((light) => {
    const source = light || {};
    const kind = contactShadowLightKind(source.type);
    const shaderIndex = kind === CONTACT_SHADOW_SPOT_KIND ? spotLightCount++ : pointLightCount++;
    const priority = resolvePriority(source, input.screenCoveragePriorityByName);
    return {
      name: String(source.name === undefined ? "?" : source.name),
      type: String(source.type === undefined ? "?" : source.type),
      kind,
      shaderIndex,
      marchLengthStuds: clampContactShadowLengthStuds(source.contactShadowLengthStuds),
      coneGateHalfAngleDeg: isFiniteNumber(Number(source.coneGateHalfAngleDeg)) ? Number(source.coneGateHalfAngleDeg) : 0,
      priority: priority.priority,
      prioritySource: priority.prioritySource,
    };
  });


  const pointChannelAvailable = pointLightCount <= slotCount;
  const spotChannelAvailable = spotLightCount <= slotCount;

  const marching = [];
  const skipped = [];
  candidates
    .slice()
    .sort(byPriorityThenName)
    .forEach((candidate) => {
      if (candidate.marchLengthStuds <= 0) {
        skipped.push(Object.freeze(Object.assign({}, candidate, { reason: CONTACT_SHADOW_SKIP_REASON.NO_LENGTH })));
        return;
      }
      const channelAvailable = candidate.kind === CONTACT_SHADOW_SPOT_KIND ? spotChannelAvailable : pointChannelAvailable;
      if (!channelAvailable) {
        skipped.push(Object.freeze(Object.assign({}, candidate, { reason: CONTACT_SHADOW_SKIP_REASON.CHANNEL_FULL })));
        return;
      }
      if (marching.length >= maxMarchingLights) {
        skipped.push(Object.freeze(Object.assign({}, candidate, { reason: CONTACT_SHADOW_SKIP_REASON.OVER_BUDGET })));
        return;
      }
      const lengths = candidate.kind === CONTACT_SHADOW_SPOT_KIND ? spotLengths : pointLengths;
      lengths[candidate.shaderIndex] = candidate.marchLengthStuds;
      marching.push(Object.freeze(Object.assign({}, candidate, { slot: candidate.shaderIndex })));
    });

  return Object.freeze({
    marching: Object.freeze(marching),
    skipped: Object.freeze(skipped),
    pointLengths,
    spotLengths,
    pointLightCount,
    spotLightCount,
    pointChannelAvailable,
    spotChannelAvailable,
    slotCount,
    maxMarchingLights,
    marchingCount: marching.length,
    prioritySource: marching.length && marching[0].prioritySource === "LL-F12" ? "LL-F12" : "LL-F15",
  });
}
