import { makeTextureResource } from "../postprocess/cinematic/contracts/frameContract.js";
import { withRendererState } from "../postprocess/cinematic/render/rendererState.js";
import { createRigidVelocityPass } from "../postprocess/cinematic/render/rigidVelocityPass.js";
import { createFullscreenTriangle, FULLSCREEN_VERTEX } from "../postprocess/cinematic/render/fullscreenTriangle.js";

const B00_OWNER = "B00";
const EXCLUDED_GEOMETRY = Object.freeze({ mode: "exclude" });
const PRESENT_FRAGMENT = `
uniform sampler2D sourceColor;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(sourceColor, vUv);
}`;

export function createCinematicSceneCapture({ THREE, renderer, scene, camera }) {
  const normalMaterial = new THREE.MeshNormalMaterial({ blending: THREE.NoBlending, side: THREE.DoubleSide });
  const velocityPass = createRigidVelocityPass(THREE);
  const triangle = createFullscreenTriangle(THREE);
  const presentMaterial = new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERTEX,
    fragmentShader: PRESENT_FRAGMENT,
    uniforms: { sourceColor: { value: null } },
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
    toneMapped: false,
  });
  const prototypeBeforeRender = THREE.Object3D.prototype.onBeforeRender;
  const prototypeAfterRender = THREE.Object3D.prototype.onAfterRender;
  const cssSize = new THREE.Vector2();
  const strippedHooks = [];
  const hiddenObjects = [];
  let currentTargets = null;

  function isGeometryCandidate(object) {
    return object.isMesh === true || object.isPoints === true || object.isSprite === true;
  }

  function materialBreaksPrimaryPolicy(material) {
    if (!material || material.visible === false) return false;
    if (material.userData?.cinematicGeometry?.mode) return false;
    if (material.transparent === true || material.transmission > 0) return false;
    return material.depthWrite === false || material.depthTest === false;
  }

  function prepareSceneForGeometry() {
    scene.traverse((object) => {
      if (!object.material) return;
      if (!object.userData.cinematicGeometry) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        if (!isGeometryCandidate(object) || materials.some(materialBreaksPrimaryPolicy)) {
          object.userData.cinematicGeometry = EXCLUDED_GEOMETRY;
        }
      }
      if (object.isSprite) return;
      if (object.onBeforeRender !== prototypeBeforeRender || object.onAfterRender !== prototypeAfterRender) {
        strippedHooks.push({ object, before: object.onBeforeRender, after: object.onAfterRender });
        object.onBeforeRender = prototypeBeforeRender;
        object.onAfterRender = prototypeAfterRender;
      }
    });
  }

  function hideUnsupportedForVelocity() {
    scene.traverse((object) => {
      if (object.visible && (object.isInstancedMesh || object.isSkinnedMesh)) {
        object.visible = false;
        hiddenObjects.push(object);
      }
    });
  }

  function unhideVelocityObjects() {
    for (const object of hiddenObjects) object.visible = true;
    hiddenObjects.length = 0;
  }

  function restoreScene() {
    for (const { object, before, after } of strippedHooks) {
      object.onBeforeRender = before;
      object.onAfterRender = after;
    }
    strippedHooks.length = 0;
    unhideVelocityObjects();
  }

  function render(frame, pool) {
    const descriptor = { ...frame.renderSize, depth: true, filter: "nearest" };
    const color = pool.acquire(B00_OWNER, "B00.sceneColor", { ...descriptor, format: "rgba16f" });
    const normal = pool.acquire(B00_OWNER, "B00.sceneNormal", { ...descriptor, format: "rgba8" });
    const velocity = pool.acquire(B00_OWNER, "B00.sceneVelocity", { ...descriptor, format: "rgba16f" });
    currentTargets = { color, normal, velocity };
    const savedBackground = scene.background;
    const savedOverride = scene.overrideMaterial;
    const savedShadowAutoUpdate = renderer.shadowMap.autoUpdate;
    withRendererState(THREE, renderer, () => {
      try {
        renderer.setScissorTest(false);
        renderer.setRenderTarget(color);
        renderer.setViewport(0, 0, color.width, color.height);
        renderer.clear();
        renderer.render(scene, camera);
        prepareSceneForGeometry();
        renderer.shadowMap.autoUpdate = false;
        scene.background = null;
        scene.overrideMaterial = normalMaterial;
        renderer.setRenderTarget(normal);
        renderer.setViewport(0, 0, normal.width, normal.height);
        renderer.setClearColor(0, 0);
        renderer.clear();
        renderer.render(scene, camera);
        scene.overrideMaterial = savedOverride;
        hideUnsupportedForVelocity();
        renderer.setViewport(0, 0, velocity.width, velocity.height);
        velocityPass.render(renderer, scene, camera, velocity, frame);
      } finally {
        scene.background = savedBackground;
        scene.overrideMaterial = savedOverride;
        renderer.shadowMap.autoUpdate = savedShadowAutoUpdate;
        unhideVelocityObjects();
      }
    });
    return {
      sceneColor: Object.freeze({
        ...makeTextureResource(color, frame, "scene-linear-rec709"),
        preExposure: 1,
        transfer: "linear",
        colorSpace: "rec709",
      }),
      sceneDepth: Object.freeze({
        texture: color.depthTexture,
        width: color.width,
        height: color.height,
        format: "depth24",
        encoding: "hardware-depth-opengl",
        origin: "bottom-left",
        frameId: frame.frameId,
        viewId: frame.viewId,
        generation: frame.generation,
        provenance: "gpu",
      }),
      sceneNormal: makeTextureResource(normal, frame, "view-normal-encoded"),
      sceneVelocity: makeTextureResource(velocity, frame, "uv-current-minus-previous"),
    };
  }

  function present(color) {
    withRendererState(THREE, renderer, () => {
      renderer.getSize(cssSize);
      renderer.setRenderTarget(null);
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, cssSize.x, cssSize.y);
      presentMaterial.uniforms.sourceColor.value = color.texture;
      triangle.render(renderer, presentMaterial);
    });
    presentMaterial.uniforms.sourceColor.value = null;
    return true;
  }

  return Object.freeze({
    render,
    present,
    restoreScene,
    targets: () => currentTargets,
    reset() {
      velocityPass.reset();
      currentTargets = null;
    },
    dispose() {
      restoreScene();
      normalMaterial.dispose();
      presentMaterial.dispose();
      velocityPass.dispose();
      triangle.dispose();
      currentTargets = null;
    },
  });
}
