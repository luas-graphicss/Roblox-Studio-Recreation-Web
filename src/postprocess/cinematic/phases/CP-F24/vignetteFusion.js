import { VIGNETTE_GLSL } from "./vignetteShader.js";
import { createVignetteUniforms, updateVignetteUniforms } from "./vignetteUniforms.js";
import { resolveVignetteSettings } from "./vignetteSettings.js";
import { validateVignetteInput, createVignetteMetadata } from "./vignetteInput.js";
import { VIGNETTE_OWNER, VIGNETTE_PROFILE, VIGNETTE_ORDER, VIGNETTE_PRECISION } from "./vignetteContract.js";

export function createVignetteFusion() {
  const uniforms = createVignetteUniforms();
  return Object.freeze({
    id: `${VIGNETTE_OWNER}.fusion`,
    profile: VIGNETTE_PROFILE,
    declarations: VIGNETTE_GLSL,
    functionName: "cp24ApplyVignette",
    stage: "filmFinish",
    order: VIGNETTE_ORDER,
    precision: VIGNETTE_PRECISION,
    inputDomain: "post-film-display-linear",
    before: Object.freeze(["filmGrain", "outputTransfer"]),
    samplerCount: 0,
    uniforms,
    update({ source, frame, settings: authored, inheritedIntensity = 0 }) {
      const settings = resolveVignetteSettings(authored, inheritedIntensity);
      validateVignetteInput(source, frame, settings);
      updateVignetteUniforms(uniforms, settings, frame);
      return Object.freeze(createVignetteMetadata(source, settings));
    }
  });
}
