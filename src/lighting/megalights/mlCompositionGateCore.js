export const COMPOSITION_REFUSAL = Object.freeze({
  none: "none",
  flagOff: "flagOff",
  baselineFrozen: "baselineFrozen",
  signalMissing: "signalMissing",
  emptySignal: "emptySignal",
  visibilityUnresolved: "visibilityUnresolved",
  everySampleRefused: "everySampleRefused",
});

export const COMPOSITION_REFUSAL_IN_PLAIN_WORDS = Object.freeze({
  none: "the denoised signal replaces direct lighting",
  flagOff: "the composition flag is off for this tier: no GLSL is injected at all",
  baselineFrozen: "MegaLightsBaseline freezes the legacy path: no MegaLights patch may be injected",
  signalMissing: "no phase published a denoised signal to compose",
  emptySignal: "the denoised signal has no pixels",
  visibilityUnresolved:
    "samples left the trace cascade still unknown, and the estimator refuses every one of them: composing now would blacken the screen",
  everySampleRefused:
    "the estimator shaded zero of the samples it was given: composing now would blacken the screen",
});

function countOrZero(value) {
  const asNumber = Math.floor(Number(value));
  return Number.isFinite(asNumber) && asNumber > 0 ? asNumber : 0;
}


export function evaluateCompositionReadiness(request) {
  const input = request || {};
  const drawnSampleCount = countOrZero(input.drawnSampleCount);
  const shadedSampleCount = countOrZero(input.shadedSampleCount);
  const unresolvedSampleCount = countOrZero(input.unresolvedSampleCount);
  const signalWidth = countOrZero(input.signalWidth);
  const signalHeight = countOrZero(input.signalHeight);
  const shadedSampleRatio = drawnSampleCount > 0 ? shadedSampleCount / drawnSampleCount : 0;

  function verdict(refusal, wouldBlackenTheScreen) {
    return Object.freeze({
      mayCompose: refusal === COMPOSITION_REFUSAL.none,
      refusal,
      refusalInPlainWords: COMPOSITION_REFUSAL_IN_PLAIN_WORDS[refusal] || "",
      wouldBlackenTheScreen: !!wouldBlackenTheScreen,
      drawnSampleCount,
      shadedSampleCount,
      unresolvedSampleCount,
      shadedSampleRatio,
      signalWidth,
      signalHeight,
    });
  }

  if (input.baselineFrozen === true) return verdict(COMPOSITION_REFUSAL.baselineFrozen, false);
  if (input.flagOn !== true) return verdict(COMPOSITION_REFUSAL.flagOff, false);
  if (input.signalPublished !== true) return verdict(COMPOSITION_REFUSAL.signalMissing, false);
  if (!(signalWidth >= 1) || !(signalHeight >= 1)) return verdict(COMPOSITION_REFUSAL.emptySignal, true);
  if (unresolvedSampleCount > 0) return verdict(COMPOSITION_REFUSAL.visibilityUnresolved, true);
  if (drawnSampleCount > 0 && shadedSampleCount === 0) {
    return verdict(COMPOSITION_REFUSAL.everySampleRefused, true);
  }
  return verdict(COMPOSITION_REFUSAL.none, false);
}

export function describeCompositionGate() {
  return {
    replaces: "the direct lighting loop at slot 160 of MGL_PATCH_ORDER (lightsFragmentBegin)",
    refusals: COMPOSITION_REFUSAL,
    refusalsInPlainWords: COMPOSITION_REFUSAL_IN_PLAIN_WORDS,
    rule:
      "a frame that cannot prove every sample left the cascade defined, and that the estimator shaded at least one of them, keeps the legacy image instead of blackening the screen",
  };
}
