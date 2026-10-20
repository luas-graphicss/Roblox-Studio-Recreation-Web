export const INVISIBLE_TRANSPARENCY = 0.99;


function readTransparencyValue(value) {
  const transparency = Number(value);
  if (!Number.isFinite(transparency)) return 0;
  if (transparency <= 0) return 0;
  if (transparency >= 1) return 1;
  return transparency;
}


export function composeLocalTransparency(transparency, localTransparencyModifier) {
  const replicated = readTransparencyValue(transparency);
  const localModifier = readTransparencyValue(localTransparencyModifier);
  return replicated + (1 - replicated) * localModifier;
}


export function isLocallyInvisible(transparency, localTransparencyModifier) {
  return composeLocalTransparency(transparency, localTransparencyModifier) >= INVISIBLE_TRANSPARENCY;
}
