import { measureLightScreenFootprint } from "./llShadowScreenSizeCore.js";
import { rankByShadowPriority } from "./llShadowPriorityCore.js";

export const CONTACT_SHADOW_PRIORITY_SOURCE = "LL-F12";
export const DEFAULT_RECENCY_WEIGHT = 1;

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function recencyOf(recencyByName, name) {
  const provided = recencyByName ? recencyByName[name] : undefined;
  return isFiniteNumber(Number(provided)) ? Number(provided) : DEFAULT_RECENCY_WEIGHT;
}


export function contactShadowScreenPriority(request) {
  const input = request || {};
  const lights = Array.isArray(input.lights) ? input.lights : [];
  const coverageByName = {};
  const entries = lights.map((light) => {
    const source = light || {};
    const footprint = measureLightScreenFootprint({
      view: input.view,
      camera: input.camera,
      light: { worldPosition: source.worldPosition, influenceRadius: source.influenceRadius },
    });
    coverageByName[source.name] = footprint.coverage;
    return {
      key: String(source.name),
      coverage: footprint.coverage,
      intensity: source.intensity,
      recency: recencyOf(input.recencyByName, source.name),
    };
  });
  const ranked = rankByShadowPriority(entries);
  const priorityByName = {};
  ranked.forEach((item) => {
    priorityByName[item.key] = item.priority;
  });
  return Object.freeze({
    fonte: CONTACT_SHADOW_PRIORITY_SOURCE,
    priorityByName,
    coverageByName,
    ranked: Object.freeze(
      ranked.map((item) =>
        Object.freeze({
          nome: item.key,
          rank: item.rank,
          prioridade: item.priority,
          cobertura: item.coverage,
          pesoIntensidade: item.intensityWeight,
          recencia: item.recency,
        }),
      ),
    ),
  });
}
