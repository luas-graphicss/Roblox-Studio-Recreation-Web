import { validateResource } from "../../contracts/frameContract.js";

const COPY_SHADER = `
uniform sampler2D cp28PresentSource;
varying vec2 vUv;
void main() { gl_FragColor = texture2D(cp28PresentSource, vUv); }
`;

export function createOutputPresenter(adapter) {
  const uniforms = { cp28PresentSource: { value: null } };
  let material;
  let disposed = false;
  const lastFrameKeys = new Map();
  return Object.freeze({
    present(resource, frame) {
      if (disposed) throw new Error("CP-F28 presenter is disposed");
      validateResource(resource, frame, "CP-F28 presentation");
      const plan = resource.outputTransform?.plan;
      if (!plan?.presentationAllowed) throw new Error("CP-F28 capture-only or disabled output cannot be presented as a verified display output");
      const key = JSON.stringify([frame.generation, frame.frameId]);
      if (key === lastFrameKeys.get(frame.viewId)) throw new Error("CP-F28 refuses duplicate presentation of the same frame");
      if (resource.encoding === "display-srgb") {
        if (adapter.context?.drawingBufferColorSpace && adapter.context.drawingBufferColorSpace !== "srgb") throw new Error("CP-F28 sRGB output requires an sRGB drawing buffer");
        material ??= adapter.createMaterial(COPY_SHADER, uniforms);
        uniforms.cp28PresentSource.value = resource.texture;
        adapter.draw(material, null);
      } else {
        const surface = adapter.outputSurface;
        const evidence = surface?.describe?.();
        if (!plan.surfaceAttestationId || evidence?.id !== plan.surfaceAttestationId || evidence?.generation !== frame.generation || evidence?.encoding !== resource.encoding || typeof surface.present !== "function") throw new Error("CP-F28 output surface changed or is unavailable");
        const result = surface.present(resource, frame);
        if (result && typeof result.then === "function") throw new Error("CP-F28 presentation must be synchronous");
      }
      lastFrameKeys.set(frame.viewId, key);
    },
    dispose() { if (disposed) return; disposed = true; material?.dispose(); lastFrameKeys.clear(); }
  });
}
