export const CONTACT_FADE_AT_FULL_REACH = 0.35;


export function contactShadowFalloff(marchFraction) {
  const fraction = Number(marchFraction);
  const reached = Number.isFinite(fraction) ? Math.min(Math.max(fraction, 0), 1) : 1;
  return 1 - CONTACT_FADE_AT_FULL_REACH * reached;
}
