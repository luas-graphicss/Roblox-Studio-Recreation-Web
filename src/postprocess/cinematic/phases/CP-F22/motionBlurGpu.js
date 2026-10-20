import { resolveMotionDepthCamera } from "./motionBlurDepth.js";
import { FLATTEN_VELOCITY_FRAGMENT } from "./flattenVelocityShader.js";
import { TILE_MAXIMUM_FRAGMENT } from "./tileMaximumShader.js";
import { NEIGHBOR_MAXIMUM_FRAGMENT } from "./neighborMaximumShader.js";
import { MOTION_GATHER_FRAGMENT } from "./motionGatherShader.js";
import { createMotionBlurTargets } from "./motionBlurTargets.js";
import { resolveMotionGeometrySampling } from "./motionBlurGeometry.js";

function uniforms(values) {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, { value }]),
  );
}
function assign(material, values) {
  for (const [key, value] of Object.entries(values))
    material.uniforms[key].value = value;
}

export function createMotionBlurGpu(adapter, pool) {
  const targets = createMotionBlurTargets(pool);
  const materials = new Map();
  const surface = adapter.renderer?.domElement;
  let disposed = false;
  let deviceLost = false;
  function clear() {
    targets.clear();
    for (const material of materials.values()) material.dispose();
    materials.clear();
  }
  function onContextLost() {
    deviceLost = true;
    clear();
  }
  function onContextRestored() {
    deviceLost = false;
  }
  surface?.addEventListener("webglcontextlost", onContextLost);
  surface?.addEventListener("webglcontextrestored", onContextRestored);
  function material(name, fragment, values) {
    if (!materials.has(name))
      materials.set(name, adapter.createMaterial(fragment, uniforms(values)));
    const instance = materials.get(name);
    assign(instance, values);
    return instance;
  }
  function draw(name, fragment, values, target) {
    if (disposed || deviceLost || adapter.context?.isContextLost?.())
      throw new Error("CP-F22 GPU is disposed or context is lost");
    if (!target) throw new Error(`CP-F22 missing target for ${name}`);
    for (const value of Object.values(values))
      if (value === target.texture)
        throw new Error(`CP-F22 texture feedback in ${name}`);
    adapter.draw(material(name, fragment, values), target);
  }
  return Object.freeze({
    prepare(frame, plan) {
      if (disposed || deviceLost || adapter.context?.isContextLost?.())
        throw new Error("CP-F22 context is lost or disposed");
      if (
        plan.size.width > adapter.capabilities?.maxTextureSize ||
        plan.size.height > adapter.capabilities?.maxTextureSize
      )
        throw new RangeError("CP-F22 output exceeds GPU texture limits");
      targets.prepare(frame.viewId, plan);
    },
    flatten(frame, plan, inputs) {
      const settings = plan.settings;
      const target = targets.get(frame.viewId, "flattened");
      draw(
        "flatten",
        FLATTEN_VELOCITY_FRAGMENT,
        {
          colorTexture: inputs.color.texture,
          velocityTexture: inputs.velocity.texture,
          depthTexture: inputs.depth.texture,
          validityTexture: inputs.validity?.texture ?? inputs.velocity.texture,
          objectSizeTexture: inputs.objectSize?.texture ?? inputs.depth.texture,
          cameraVelocityTexture:
            inputs.cameraVelocity?.texture ?? inputs.velocity.texture,
          outputSize: [plan.size.width, plan.size.height],
          velocityScale: plan.shutter.velocityScale,
          geometryJitterPixels: resolveMotionGeometrySampling(
            inputs.depth,
            frame,
            settings,
          ),
          maximumLength: plan.shutter.maximumLength,
          nearMeters:
            inputs.depth.nearMeters ?? frame.camera?.nearMeters ?? 0.1,
          farMeters: inputs.depth.farMeters ?? frame.camera?.farMeters ?? 1000,
          orthographicDepth: resolveMotionDepthCamera(inputs.depth, frame)
            .orthographicDepth,
          objectSizeThreshold: settings.perObjectSizePercent / 100,
          linearDepth: Number(
            inputs.depth.encoding !== "hardware-depth-opengl",
          ),
          hasValidity: Number(Boolean(inputs.validity)),
          preserveSky: Number(settings.skyPolicy === "preserve"),
          preserveTranslucency: Number(
            settings.translucencyPolicy === "preserve",
          ),
          filterObjectSize: Number(settings.perObjectSizePercent > 0),
        },
        target,
      );
      return target;
    },
    tiles(frame, flattened) {
      const target = targets.get(frame.viewId, "tiles");
      draw(
        "tiles",
        TILE_MAXIMUM_FRAGMENT,
        { flattenedTexture: flattened.texture },
        target,
      );
      return target;
    },
    neighbors(frame, plan, tiles) {
      const target = targets.get(frame.viewId, "neighbors");
      draw(
        "neighbors",
        NEIGHBOR_MAXIMUM_FRAGMENT,
        { tileTexture: tiles.texture, neighborRadius: plan.neighborRadius },
        target,
      );
      return target;
    },
    gather(frame, plan, source, flattened, neighbors) {
      const target = targets.get(frame.viewId, "color");
      draw(
        "gather",
        MOTION_GATHER_FRAGMENT,
        {
          colorTexture: source.texture,
          flattenedTexture: flattened?.texture ?? source.texture,
          neighborTexture: neighbors?.texture ?? source.texture,
          shutterInterval: plan.shutter.interval,
          logDepthTolerance: Math.log2(1 + plan.settings.depthTolerance),
          motionTolerance: plan.settings.motionTolerancePixels,
          sampleCount: plan.sampleCount,
          blurEnabled: Number(plan.shutter.active),
        },
        target,
      );
      return target;
    },
    stats: targets.stats,
    releaseView: targets.releaseView,
    dispose() {
      if (disposed) return;
      disposed = true;
      surface?.removeEventListener("webglcontextlost", onContextLost);
      surface?.removeEventListener("webglcontextrestored", onContextRestored);
      clear();
    },
  });
}
