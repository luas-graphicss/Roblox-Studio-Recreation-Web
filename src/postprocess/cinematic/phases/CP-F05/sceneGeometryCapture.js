import { withRendererState } from "../../render/rendererState.js";
import { createGeometryMaterialCache } from "./geometryMaterialCache.js";
import { resolveSurfacePolicy } from "./surfacePolicy.js";

export function createSceneGeometryCapture(adapter) {
  const { THREE, renderer } = adapter;
  const materials = createGeometryMaterialCache(THREE);
  const invisible = new THREE.MeshBasicMaterial({ visible: false });
  const noOperation = () => {};

  function render(scene, camera, targets) {
    if (scene.overrideMaterial) throw new Error("CP-F05 cannot capture an unknown scene override material");
    const records = [];
    const summary = { primarySurfaces: 0, customSurfaces: 0, excludedSurfaces: 0, domains: {}, normalSemantics: {} };
    materials.beginFrame();
    scene.traverseVisible((object) => {
      if (!object.material || !object.layers.test(camera.layers)) return;
      const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
      const policies = sourceMaterials.map((material) => {
        if (!material || !material.visible) return null;
        const policy = resolveSurfacePolicy(object, material);
        if ((policy.primary || policy.customDepth) && !object.isMesh && !object.isPoints && !object.isSprite) throw new Error(`CP-F05 unsupported renderable type: ${object.type}`);
        if ((policy.primary || policy.customDepth) && object.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender && !object.isSprite) throw new Error("CP-F05 render callbacks require an explicit geometry input adapter");
        if (policy.primary) summary.primarySurfaces += 1;
        else summary.excludedSurfaces += 1;
        if (policy.customDepth) summary.customSurfaces += 1;
        summary.domains[policy.domain] = (summary.domains[policy.domain] ?? 0) + 1;
        summary.normalSemantics[policy.normalSemantics] = (summary.normalSemantics[policy.normalSemantics] ?? 0) + 1;
        return policy;
      });
      records.push({ object, sourceMaterials, policies, material: object.material, onBeforeRender: object.onBeforeRender, onAfterRender: object.onAfterRender });
    });
    const savedBackground = scene.background;
    const savedShadowUpdate = renderer.shadowMap.autoUpdate;
    try {
      withRendererState(THREE, renderer, () => {
        scene.background = null;
        renderer.shadowMap.autoUpdate = false;
        renderer.setScissorTest(false);
        renderer.autoClear = false;
        for (const [output, target] of [[0, targets.normal], [1, targets.objectId], [2, targets.materialId], [3, targets.customStencil]]) {
          for (const record of records) {
            const replacements = record.sourceMaterials.map((source, index) => {
              const policy = record.policies[index];
              const participates = policy && (output === 3 ? policy.customDepth : policy.primary);
              return participates ? materials.get(record.object, source, policy, output) : invisible;
            });
            record.object.material = Array.isArray(record.material) ? replacements : replacements[0];
            record.object.onBeforeRender = noOperation;
            record.object.onAfterRender = noOperation;
          }
          renderer.setRenderTarget(target);
          renderer.setViewport(0, 0, target.width, target.height);
          renderer.setClearColor(0, 0);
          renderer.clear(true, true, true);
          renderer.render(scene, camera);
          if (adapter.errors?.().length) throw new Error(`CP-F05 geometry shader failed: ${JSON.stringify(adapter.errors().at(-1))}`);
        }
      });
    } finally {
      for (const record of records) {
        record.object.material = record.material;
        record.object.onBeforeRender = record.onBeforeRender;
        record.object.onAfterRender = record.onAfterRender;
      }
      scene.background = savedBackground;
      renderer.shadowMap.autoUpdate = savedShadowUpdate;
      materials.endFrame();
    }
    return Object.freeze({ ...summary, cachedMaterials: materials.size() });
  }

  return Object.freeze({ render, dispose() { materials.dispose(); invisible.dispose(); } });
}
