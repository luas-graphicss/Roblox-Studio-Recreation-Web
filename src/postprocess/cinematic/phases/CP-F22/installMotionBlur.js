import {
  MOTION_BLUR_OWNER,
  MOTION_BLUR_RESOURCES as resources,
  MOTION_BLUR_LAYOUT,
  resolveMotionBlurBindings,
} from "./motionBlurContract.js";
import { createMotionBlurSettingsReader } from "./motionBlurSettings.js";
import { resolveMotionBlurShutter } from "./motionBlurShutter.js";
import { createMotionBlurPlan } from "./motionBlurPlan.js";
import {
  validateMotionBlurInputs,
  motionBlurValue,
  motionBlurTexture,
  motionBlurColor,
} from "./motionBlurInputs.js";
import { createMotionBlurGpu } from "./motionBlurGpu.js";
import { resolveMotionBlurCapture } from "./motionBlurCapture.js";

export function installMotionBlur(services) {
  const {
    rendererAdapter: adapter,
    graph,
    pool,
    settings,
    capabilities,
  } = services;
  if (!capabilities?.webgl2 || !capabilities?.floatColorBuffer)
    throw new Error("CP-F22 requires WebGL2 and floating-point color targets");
  for (const method of ["createMaterial", "draw"])
    if (typeof adapter?.[method] !== "function")
      throw new TypeError(`CP-F22 renderer adapter requires ${method}`);
  if (
    typeof pool?.release !== "function" ||
    typeof pool?.acquire !== "function" ||
    typeof settings?.get !== "function"
  )
    throw new TypeError("CP-F22 requires pool and settings services");
  const bindings = resolveMotionBlurBindings(settings.get("CP-F22.bindings"));
  const readSettings = createMotionBlurSettingsReader(settings);
  const gpu = createMotionBlurGpu(adapter, pool);
  const unregister = [];
  let disposed = false;
  function register(id, order, reads, writes, transformsColor, execute) {
    unregister.push(
      graph.register({
        id: `${MOTION_BLUR_OWNER}.${id}`,
        owner: MOTION_BLUR_OWNER,
        stage: "motionBlur",
        order,
        reads: [...new Set(reads)],
        writes,
        transformsColor,
        execute,
      }),
    );
  }
  function cleanup() {
    if (disposed) return;
    disposed = true;
    for (const remove of unregister.splice(0).reverse()) remove();
    gpu.dispose();
  }
  try {
    register(
      "flattenVelocity",
      2200,
      ["$color", ...Object.values(bindings).filter(Boolean)],
      [resources.plan, resources.flattened],
      false,
      (context) => {
        const { frame } = context;
        const configuration = readSettings(frame.viewId);
        const inputs = { color: context.read("$color") };
        for (const [key, name] of Object.entries(bindings))
          inputs[key] = name ? context.read(name) : null;
        const capture = resolveMotionBlurCapture(
          settings.get("CP-F22.capture"),
        );
        const resolvedShutter = resolveMotionBlurShutter(
          configuration,
          frame,
          inputs.camera?.value ?? null,
        );
        const shutter =
          capture.motionBlurOwner === "capture"
            ? Object.freeze({
                ...resolvedShutter,
                velocityScale: 0,
                active: false,
                bypassReason: "capture-owned-shutter",
              })
            : resolvedShutter;
        if (shutter.active && frame.referenceMode)
          throw new Error(
            "CP-F22 BLOCKED_REFERENCE: this engineering gather is not UE5.9 certified",
          );
        validateMotionBlurInputs(inputs, frame, configuration);
        const plan = createMotionBlurPlan(
          frame.outputSize,
          configuration,
          shutter,
        );
        gpu.prepare(frame, plan);
        const flattened = shutter.active
          ? motionBlurTexture(
              gpu.flatten(frame, plan, inputs),
              frame,
              MOTION_BLUR_LAYOUT.encoding,
            )
          : motionBlurValue({ bypass: shutter.bypassReason }, frame);
        context.publish(resources.plan, motionBlurValue(plan, frame));
        context.publish(resources.flattened, flattened);
      },
    );
    register(
      "reduceVelocityTiles",
      2201,
      [resources.plan, resources.flattened],
      [resources.tiles],
      false,
      (context) => {
        const plan = context.read(resources.plan).value;
        const output = plan.shutter.active
          ? motionBlurTexture(
              gpu.tiles(context.frame, context.read(resources.flattened)),
              context.frame,
              MOTION_BLUR_LAYOUT.encoding,
            )
          : motionBlurValue(
              { bypass: plan.shutter.bypassReason },
              context.frame,
            );
        context.publish(resources.tiles, output);
      },
    );
    register(
      "dilateNeighborMaximum",
      2202,
      [resources.plan, resources.tiles],
      [resources.neighbors],
      false,
      (context) => {
        const plan = context.read(resources.plan).value;
        const output = plan.shutter.active
          ? motionBlurTexture(
              gpu.neighbors(context.frame, plan, context.read(resources.tiles)),
              context.frame,
              MOTION_BLUR_LAYOUT.encoding,
            )
          : motionBlurValue(
              { bypass: plan.shutter.bypassReason },
              context.frame,
            );
        context.publish(resources.neighbors, output);
      },
    );
    register(
      "gatherMotion",
      2203,
      ["$color", resources.plan, resources.flattened, resources.neighbors],
      [resources.color, resources.diagnostics],
      true,
      (context) => {
        const plan = context.read(resources.plan).value;
        const source = context.read("$color");
        const output = gpu.gather(
          context.frame,
          plan,
          source,
          context.read(resources.flattened),
          context.read(resources.neighbors),
        );
        const color = motionBlurColor(output, source, context.frame);
        context.publish(resources.color, color);
        context.publish(
          resources.diagnostics,
          motionBlurValue(
            Object.freeze({
              algorithm: "two-direction-depth-aware-shutter-gather",
              active: plan.shutter.active,
              bypassReason: plan.shutter.bypassReason,
              shutter: plan.shutter,
              bindings,
              layout: MOTION_BLUR_LAYOUT,
              intermediateBytes: plan.intermediateBytes,
              sampleCount: plan.sampleCount,
              neighborRadius: plan.neighborRadius,
              ...gpu.stats(),
              invalidPixels:
                "inspect flattenedVelocity alpha < 0; invalid samples preserve source and never enter tiles",
              geometryResampling: plan.settings.geometrySampling,
              history: "none",
              referenceVerified: false,
              integration: "CP-F21/CP-F27 full-chain validation required",
            }),
            context.frame,
          ),
        );
        return { color };
      },
    );
  } catch (error) {
    cleanup();
    throw error;
  }
  cleanup.releaseView = (viewId) => {
    if (!disposed) gpu.releaseView(viewId);
  };
  return cleanup;
}
