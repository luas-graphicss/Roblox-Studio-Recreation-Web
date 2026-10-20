import { makeTextureResource } from "../../contracts/frameContract.js";
import { GRADING_SETTINGS_KEY, GRADING_LAYERS_KEY, GRADING_CONTROLS } from "./gradingSettings.js";
import { resolveGradingLayers } from "./gradingBlend.js";
import { compileGrading } from "./gradingCore.js";
import { GRADING_FRAGMENT_SHADER } from "./gradingShader.js";
import { resolveGradingInput } from "./gradingInput.js";

export function installGradingPass(services) {
  const { graph, pool, settings, rendererAdapter, capabilities, report = () => {} } = services;
  if (!capabilities?.webgl2 || !capabilities?.floatColorBuffer) throw new Error("CP-F12 requires WebGL2 and floating-point color targets");
  if (!pool?.acquire || !settings?.get || !rendererAdapter?.createMaterial) throw new TypeError("CP-F12 requires pool, settings and a renderer adapter");
  const { THREE } = rendererAdapter;
  const uniforms = {
    uSceneColor: { value: null }, uNeutral: { value: true }, uWhiteBalanceNeutral: { value: true }, uUniformZones: { value: true },
    uWhiteBalance: { value: new THREE.Matrix3() }, uRanges: { value: new THREE.Vector4() }, uPreExposure: { value: 1 }
  };
  for (const control of GRADING_CONTROLS) uniforms[`u${control[0].toUpperCase()}${control.slice(1)}`] = { value: Array.from({ length: 3 }, () => new THREE.Vector3()) };
  const material = rendererAdapter.createMaterial(GRADING_FRAGMENT_SHADER, uniforms);
  let compiled;
  let lastRevision;
  let lastBase;
  let lastLayers;
  let disposed = false;
  let unregister = () => {};

  function updateControls() {
    const base = settings.get(GRADING_SETTINGS_KEY);
    const layers = settings.get(GRADING_LAYERS_KEY);
    const revision = settings.revision?.();
    if (compiled && revision === lastRevision && base === lastBase && layers === lastLayers) return;
    const next = compileGrading(resolveGradingLayers(base, layers ?? []));
    uniforms.uNeutral.value = next.neutral;
    uniforms.uWhiteBalanceNeutral.value = next.whiteBalanceNeutral;
    uniforms.uUniformZones.value = next.uniformZones;
    uniforms.uWhiteBalance.value.set(...next.whiteBalanceMatrix);
    const ranges = next.settings.ranges;
    uniforms.uRanges.value.set(ranges.shadowStart, ranges.shadowEnd, ranges.highlightStart, ranges.highlightEnd);
    for (const control of GRADING_CONTROLS) {
      const vectors = uniforms[`u${control[0].toUpperCase()}${control.slice(1)}`].value;
      next.zones.forEach((zone, index) => vectors[index].set(...zone[control]));
    }
    compiled = next;
    lastRevision = revision;
    lastBase = base;
    lastLayers = layers;
  }

  function cleanup() {
    if (disposed) return;
    disposed = true;
    unregister();
    material.dispose();
    pool.releaseOwner("CP-F12");
  }

  try {
    updateControls();
    unregister = graph.register({
      id: "CP-F12.sceneGrading", owner: "CP-F12", stage: "grading", order: 0,
      reads: ["$color"], writes: ["CP-F12.gradedColor"], transformsColor: true,
      execute(context) {
        if (disposed) throw new Error("CP-F12 is disposed");
        const input = context.read("$color");
        const frame = context.frame;
        if (frame.referenceMode) throw new Error("CP-F12 BLOCKED_REFERENCE: UE5.9 grading is not certified");
        const colorMetadata = resolveGradingInput(input);
        if (rendererAdapter.context?.isContextLost()) throw new Error("CP-F12 WebGL context is lost");
        updateControls();
        const descriptor = { width: input.width, height: input.height, format: "rgba16f", filter: "nearest" };
        let target = pool.acquire("CP-F12", "CP-F12.color", descriptor);
        if (target.texture === input.texture) target = pool.acquire("CP-F12", "CP-F12.alternateColor", descriptor);
        if (target.texture === input.texture) throw new Error("CP-F12 refuses texture feedback");
        uniforms.uSceneColor.value = input.texture;
        uniforms.uPreExposure.value = colorMetadata.preExposure;
        rendererAdapter.draw(material, target);
        const output = Object.freeze({ ...makeTextureResource(target, frame, "scene-linear-rec709", input.provenance), ...colorMetadata });
        context.publish("CP-F12.gradedColor", output);
        return { color: output };
      }
    });
    report({ phase: "CP-F12", status: "implemented", model: "scene-referred-bradford-sop-v1", referenceCertified: false, overflowPolicy: "signed-fp16-saturation-at-65504", settingsKeys: [GRADING_SETTINGS_KEY, GRADING_LAYERS_KEY] });
    return cleanup;
  } catch (error) {
    cleanup();
    throw error;
  }
}
