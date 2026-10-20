import { makeTextureResource } from "../contracts/frameContract.js";
import { withRendererState } from "./rendererState.js";
import { createRigidVelocityPass } from "./rigidVelocityPass.js";

export function createSceneInputs(adapter, pool) {
  const { THREE, renderer } = adapter;
  const normalMaterial = new THREE.MeshNormalMaterial({ blending: THREE.NoBlending, side: THREE.DoubleSide });
  const velocityPass = createRigidVelocityPass(THREE);
  let currentTargets = null;
  return Object.freeze({
    render(scene, camera, frame) {
      const descriptor = { ...frame.renderSize, depth: true, filter: "nearest" };
      const color = pool.acquire("B00", "B00.sceneColor", { ...descriptor, format: "rgba16f" });
      const normal = pool.acquire("B00", "B00.sceneNormal", { ...descriptor, format: "rgba8" });
      const velocity = pool.acquire("B00", "B00.sceneVelocity", { ...descriptor, format: "rgba16f" });
      currentTargets = { color, normal, velocity };
      const savedBackground = scene.background;
      const savedOverride = scene.overrideMaterial;
      withRendererState(THREE, renderer, () => {
        try {
          renderer.setScissorTest(false);
          renderer.setRenderTarget(color);
          renderer.setClearColor(0x020408, 1);
          renderer.clear();
          renderer.render(scene, camera);
          scene.background = null;
          scene.overrideMaterial = normalMaterial;
          renderer.setRenderTarget(normal);
          renderer.setClearColor(0, 0);
          renderer.clear();
          renderer.render(scene, camera);
          scene.overrideMaterial = savedOverride;
          velocityPass.render(renderer, scene, camera, velocity, frame);
        } finally {
          scene.background = savedBackground;
          scene.overrideMaterial = savedOverride;
        }
      });
      if (adapter.errors().length) throw new Error("Geometry shader failed to compile");
      return {
        sceneColor: makeTextureResource(color, frame, "scene-linear-rec709"),
        sceneDepth: Object.freeze({ texture: color.depthTexture, width: color.width, height: color.height, format: "depth24", encoding: "hardware-depth-opengl", origin: "bottom-left", frameId: frame.frameId, viewId: frame.viewId, generation: frame.generation, provenance: "gpu" }),
        sceneNormal: makeTextureResource(normal, frame, "view-normal-encoded"),
        sceneVelocity: makeTextureResource(velocity, frame, "uv-current-minus-previous")
      };
    },
    targets: () => currentTargets,
    reset() { velocityPass.reset(); currentTargets = null; },
    dispose() { normalMaterial.dispose(); velocityPass.dispose(); pool.releaseOwner("B00"); currentTargets = null; }
  });
}
