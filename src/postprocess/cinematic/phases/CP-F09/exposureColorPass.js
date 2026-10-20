import { resolveColorPreExposure } from "./resolveColorPreExposure.js";
import { EXPOSURE_APPLICATION_FRAGMENT } from "./exposureApplicationShader.js";
import { EXPOSURE_PHASE_ID, EXPOSURE_RESOURCES } from "./exposureContract.js";
import { makeTextureResource } from "../../contracts/frameContract.js";

export function registerExposureColorPass(services, binding) {
  const uniforms = { sceneColorTexture: { value: null }, adaptationTexture: { value: null }, colorPreExposure: { value: 1 } };
  const material = services.rendererAdapter.createMaterial(EXPOSURE_APPLICATION_FRAGMENT, uniforms);
  let disposed = false;
  const dispose = () => { if (!disposed) { disposed = true; material.dispose(); } };
  try {
    return services.graph.register({
      id: "CP-F09.applyExposure",
      owner: EXPOSURE_PHASE_ID,
      stage: "metering",
      order: binding.order + 1,
      reads: ["$color", EXPOSURE_RESOURCES.adaptation],
      writes: [EXPOSURE_RESOURCES.color],
      transformsColor: true,
      execute(context) {
        const color = context.read("$color");
        const adaptation = context.read(EXPOSURE_RESOURCES.adaptation);
        if (color.encoding !== "scene-linear-rec709") throw new Error("Exposure application requires unexposed scene-linear-rec709; refusing double exposure");
        if (color.format !== "rgba16f") throw new Error("Exposure application requires HDR rgba16f color");
        const target = services.pool.acquire(EXPOSURE_PHASE_ID, `CP-F09.color.${encodeURIComponent(context.frame.viewId)}`, {
          width: color.width, height: color.height, format: "rgba16f", filter: "nearest"
        });
        if (color.texture === target.texture || adaptation.texture === target.texture) throw new Error("Exposure color texture feedback");
        uniforms.sceneColorTexture.value = color.texture;
        uniforms.adaptationTexture.value = adaptation.texture;
        uniforms.colorPreExposure.value = resolveColorPreExposure(color);
        services.rendererAdapter.draw(material, target);
        const output = Object.freeze({ ...makeTextureResource(target, context.frame, "scene-linear-rec709-exposed"), preExposure: 1, transfer: "linear", ...(color.colorSpace ? { colorSpace: color.colorSpace } : {}) });
        context.publish(EXPOSURE_RESOURCES.color, output);
        return { color: output };
      },
      dispose
    });
  } catch (error) { dispose(); throw error; }
}
