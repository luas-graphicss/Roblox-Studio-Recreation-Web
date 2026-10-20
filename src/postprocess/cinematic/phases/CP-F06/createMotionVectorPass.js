import { MOTION_PHASE_ID, MOTION_LAYOUT, MOTION_RESOURCES, motionResource } from "./motionContract.js";
import { readMotionCamera } from "./motionProjection.js";
import { createMotionHistory } from "./motionHistory.js";
import { captureMotionGeometry } from "./motionGeometrySnapshot.js";
import { createMotionProxyRenderer } from "./motionProxyRenderer.js";
import { createMotionTargets } from "./motionTargets.js";
import {
  MOTION_BINDINGS_SETTING,
  MOTION_ENABLED_SETTING,
  resolveMotionBindings,
  resolveMotionEnabled,
  validateMotionInput,
  validateMotionCameraAlignment,
} from "./motionInputs.js";

export function createMotionVectorPass(services) {
  const { rendererAdapter: adapter, pool, history, settings, report = () => {} } = services;
  if (
    !adapter?.THREE ||
    (!adapter?.host?.scene && typeof adapter?.host?.sceneForView !== "function") ||
    (!adapter?.host?.camera && typeof adapter?.host?.cameraForView !== "function")
  )
    throw new Error("CP-F06 requires host scene/camera or per-view providers");
  if (!services.capabilities?.webgl2 || !services.capabilities?.floatColorBuffer)
    throw new Error("CP-F06 requires WebGL2 and floating-point render targets");
  const bindings = resolveMotionBindings(settings?.get?.(MOTION_BINDINGS_SETTING));
  const motionHistory = createMotionHistory(history);
  const targetsByView = createMotionTargets(pool);
  let renderer = createMotionProxyRenderer(adapter);
  let disposed = false;
  const canvas = adapter.renderer.domElement;
  function invalidateGraphics() {
    renderer?.dispose();
    renderer = null;
    motionHistory.clear();
    targetsByView.dispose();
  }
  canvas?.addEventListener?.("webglcontextlost", invalidateGraphics);
  canvas?.addEventListener?.("webglcontextrestored", invalidateGraphics);

  function execute(context) {
    const { frame } = context;
    if (disposed) throw new Error("CP-F06 pass is disposed");
    const sceneDepth = validateMotionInput(
      context.read(bindings.depth),
      frame,
      "scene depth",
      "hardware-depth-opengl",
    );
    if (bindings.coverage)
      validateMotionInput(context.read(bindings.coverage), frame, "coverage", "coverage-unorm");
    if (bindings.camera && !context.read(bindings.camera)?.value)
      throw new Error("CP-F06 missing prepared camera state");
    if (adapter.renderer.getContext().isContextLost?.()) throw new Error("CP-F06 graphics context is lost");
    const scene =
      typeof adapter.host.sceneForView === "function"
        ? adapter.host.sceneForView(frame.viewId)
        : adapter.host.scene;
    const camera =
      typeof adapter.host.cameraForView === "function"
        ? adapter.host.cameraForView(frame.viewId)
        : adapter.host.camera;
    if (!scene?.isScene) throw new Error("CP-F06 missing host scene for this view");
    validateMotionCameraAlignment(frame, camera);
    const cameraState = readMotionCamera(frame);
    const enabled = resolveMotionEnabled(settings?.get?.(MOTION_ENABLED_SETTING));
    const candidate = motionHistory.read(frame);
    const previous =
      enabled &&
      candidate?.enabled &&
      candidate.sceneIdentity === scene.uuid &&
      targetsByView.isAlive(candidate.targets.identity)
        ? candidate
        : null;
    const targets = targetsByView.acquire(frame, previous);
    const captured = enabled
      ? captureMotionGeometry(adapter.THREE, scene, camera, frame)
      : { objects: [], excluded: [], vertexCount: 0 };
    const objects = captured.objects.map((snapshot) => motionHistory.pair(snapshot, previous));
    validateMotionCameraAlignment(frame, camera);
    const sky = enabled ? (adapter.host.motionSky ?? "invalid") : "invalid";
    if (!["invalid", "infinite"].includes(sky)) throw new Error("CP-F06 unknown sky policy");
    if (sky === "infinite" && !camera.isPerspectiveCamera)
      throw new Error("CP-F06 infinite sky requires a perspective projection");
    if (!renderer) renderer = createMotionProxyRenderer(adapter);
    renderer.render(objects, targets, camera, cameraState, previous, sky, sceneDepth);
    const metadata = Object.freeze({
      layout: MOTION_LAYOUT,
      enabled,
      bindings,
      objectCount: objects.length,
      vertexCount: captured.vertexCount,
      historyValidObjects: objects.filter((object) => object.historyValid).length,
      domains: [...new Set(objects.map((object) => object.domain))],
      excluded: captured.excluded,
      sky,
      backend: "cpu-sampled-world-vertices-and-gpu-rasterization",
      estimatedMaterialSubmissions: objects.reduce(
        (sum, object) => sum + object.materials.filter((material) => material.included).length * 3,
        0,
      ),
      previousVisibility: previous ? "previous-frame-owned-target" : "invalid",
      depthRejection: "current-source-depth + previous-identity24 + previous-depth24 + local-slope-footprint",
      declaredTargetBytesPerPixelPerView: 36,
      retainedViews: targetsByView.viewCount(),
      nativeSceneVelocityReplaced: false,
      referenceVerified: false,
      performanceCertified: false,
    });
    context.publish(
      MOTION_RESOURCES.velocity,
      motionResource(targets.velocity, frame, MOTION_LAYOUT.encoding),
    );
    context.publish(
      MOTION_RESOURCES.validity,
      motionResource(targets.validity, frame, "motion-history-visibility-and-coverage"),
    );
    context.publish(
      MOTION_RESOURCES.identity,
      motionResource(targets.identity, frame, "surface-id24-coverage"),
    );
    context.publish(MOTION_RESOURCES.metadata, {
      value: metadata,
      frameId: frame.frameId,
      viewId: frame.viewId,
      generation: frame.generation,
      provenance: "gpu",
    });
    motionHistory.commit(frame, cameraState, objects, targets, sky, scene.uuid, enabled);
    report({
      phase: MOTION_PHASE_ID,
      status: "submitted",
      frameId: frame.frameId,
      objectCount: objects.length,
      resources: MOTION_RESOURCES,
    });
  }

  function releaseView(viewId) {
    const released = targetsByView.releaseView(viewId);
    if (released) motionHistory.releaseView(viewId);
    return released;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    canvas?.removeEventListener?.("webglcontextlost", invalidateGraphics);
    canvas?.removeEventListener?.("webglcontextrestored", invalidateGraphics);
    invalidateGraphics();
  }

  return Object.freeze({
    id: "CP-F06.completeMotion",
    owner: MOTION_PHASE_ID,
    stage: "beforeDof",
    order: 600,
    reads: Object.values(bindings).filter(Boolean),
    writes: Object.values(MOTION_RESOURCES),
    transformsColor: false,
    execute,
    releaseView,
    dispose,
  });
}
