import { buildGBufferVertexShader, buildGBufferFragmentShader, buildAttachmentBlitFragmentShader } from "./mlGBufferGlsl.js";
import { createFullScreenQuad, FULL_SCREEN_VERTEX_SHADER } from "./mlFullScreenQuad.js";
import { sceneInputAttachmentNames } from "./mlSceneInputsCore.js";
import { createAttachmentPixelBufferCache } from "./mlAttachmentPixelBufferCache.js";
import { createWorldNormalMatrixCache } from "./mlWorldNormalMatrixCache.js";
import { createAttachmentGatherReadback } from "./mlAttachmentGatherReadback.js";

export function createGBufferFillPass(dependencies) {
  const THREE = dependencies.THREE;
  const renderer = dependencies.renderer;
  const gBuffer = dependencies.gBuffer;

  const fillMaterialByMesh = new WeakMap();
  const ownedFillMaterials = new Set();
  const previousModelMatrixByMesh = new WeakMap();
  const previousViewProjectionMatrix = new THREE.Matrix4();
  const currentViewProjectionMatrix = new THREE.Matrix4();
  const preservedClearColor = new THREE.Color();
  const drawingBufferSize = new THREE.Vector2();


  const meshesToDraw = [];
  const originalMaterials = [];
  const objectsHiddenForThisPass = [];


  const worldNormalMatrices = createWorldNormalMatrixCache(THREE);
  const attachmentPixelBuffers = createAttachmentPixelBufferCache();

  let hasPreviousFrame = false;
  let fullScreenQuad = null;
  let attachmentBlitMaterial = null;
  let readbackTarget = null;


  let attachmentGatherReadback = null;

  const report = {
    filled: false,
    reason: "",
    width: 0,
    height: 0,
    meshCount: 0,
    skippedTransparentMeshCount: 0,
    skippedSkinnedMeshCount: 0,
    instancedMeshCount: 0,
    hiddenObjectCount: 0,
    velocityValid: false,
  };

  function createFillMaterial() {
    return new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        uAlbedo: { value: new THREE.Color(1, 1, 1) },
        uRoughness: { value: 1 },
        uMetalness: { value: 0 },
        uCameraNear: { value: 0.05 },
        uCameraFar: { value: 600 },
        uVelocityValidity: { value: 0 },
        uPreviousModelMatrix: { value: new THREE.Matrix4() },
        uPreviousViewProjectionMatrix: { value: new THREE.Matrix4() },
        uWorldNormalMatrix: { value: new THREE.Matrix3() },
      },
      vertexShader: buildGBufferVertexShader(),
      fragmentShader: buildGBufferFragmentShader(),
    });
  }

  function resolveFrameSize(frameContext) {
    const contextSize = frameContext ? frameContext.drawingBufferSize : null;
    if (contextSize && Number(contextSize.x) > 0 && Number(contextSize.y) > 0) {
      return { width: Math.floor(contextSize.x), height: Math.floor(contextSize.y) };
    }
    renderer.getDrawingBufferSize(drawingBufferSize);
    return { width: Math.max(1, Math.floor(drawingBufferSize.x)), height: Math.max(1, Math.floor(drawingBufferSize.y)) };
  }


  function visitDrawCandidate(node) {
    if (!node.visible) return;
    const isRenderable = !!(node.isMesh || node.isLine || node.isPoints || node.isSprite);
    if (!isRenderable) return;

    if (!node.isMesh || !node.material) {
      objectsHiddenForThisPass.push(node);
      return;
    }
    const sourceMaterial = Array.isArray(node.material) ? node.material[0] : node.material;
    if (node.isSkinnedMesh) {
      report.skippedSkinnedMeshCount++;
      objectsHiddenForThisPass.push(node);
      return;
    }
    if (sourceMaterial && sourceMaterial.transparent === true) {
      report.skippedTransparentMeshCount++;
      objectsHiddenForThisPass.push(node);
      return;
    }
    if (node.isInstancedMesh) report.instancedMeshCount++;
    meshesToDraw.push(node);
  }

  function collectDrawList(scene) {
    meshesToDraw.length = 0;
    objectsHiddenForThisPass.length = 0;
    report.skippedTransparentMeshCount = 0;
    report.skippedSkinnedMeshCount = 0;
    report.instancedMeshCount = 0;

    scene.traverse(visitDrawCandidate);

    report.meshCount = meshesToDraw.length;
    report.hiddenObjectCount = objectsHiddenForThisPass.length;
  }

  function applyFillMaterials(camera) {
    originalMaterials.length = 0;
    for (let meshIndex = 0; meshIndex < meshesToDraw.length; meshIndex++) {
      const mesh = meshesToDraw[meshIndex];
      const sourceMaterial = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      let fillMaterial = fillMaterialByMesh.get(mesh);
      if (!fillMaterial) {
        fillMaterial = createFillMaterial();
        ownedFillMaterials.add(fillMaterial);
        fillMaterialByMesh.set(mesh, fillMaterial);
      }

      const uniforms = fillMaterial.uniforms;
      if (sourceMaterial && sourceMaterial.color) uniforms.uAlbedo.value.copy(sourceMaterial.color);
      else uniforms.uAlbedo.value.setRGB(1, 1, 1);
      uniforms.uRoughness.value = typeof (sourceMaterial && sourceMaterial.roughness) === "number" ? sourceMaterial.roughness : 1;
      uniforms.uMetalness.value = typeof (sourceMaterial && sourceMaterial.metalness) === "number" ? sourceMaterial.metalness : 0;
      uniforms.uCameraNear.value = camera.near;
      uniforms.uCameraFar.value = camera.far;
      uniforms.uWorldNormalMatrix.value.copy(worldNormalMatrices.matrixFor(mesh));

      const previousModelMatrix = previousModelMatrixByMesh.get(mesh);
      const canReproject = !!previousModelMatrix && hasPreviousFrame && !mesh.isInstancedMesh;
      if (canReproject) {
        uniforms.uPreviousModelMatrix.value.copy(previousModelMatrix);
        uniforms.uPreviousViewProjectionMatrix.value.copy(previousViewProjectionMatrix);
      }
      uniforms.uVelocityValidity.value = canReproject ? 1 : 0;


      if (sourceMaterial && sourceMaterial.side !== undefined) fillMaterial.side = sourceMaterial.side;

      originalMaterials.push(mesh.material);
      mesh.material = fillMaterial;
    }
  }

  function restoreOriginalMaterials() {
    for (let meshIndex = 0; meshIndex < meshesToDraw.length; meshIndex++) {
      if (meshIndex < originalMaterials.length) meshesToDraw[meshIndex].material = originalMaterials[meshIndex];
    }
    originalMaterials.length = 0;
  }

  function rememberFrameState(camera) {
    previousViewProjectionMatrix.copy(currentViewProjectionMatrix);
    hasPreviousFrame = true;
    for (let meshIndex = 0; meshIndex < meshesToDraw.length; meshIndex++) {
      const mesh = meshesToDraw[meshIndex];
      let storedMatrix = previousModelMatrixByMesh.get(mesh);
      if (!storedMatrix) {
        storedMatrix = new THREE.Matrix4();
        previousModelMatrixByMesh.set(mesh, storedMatrix);
      }
      storedMatrix.copy(mesh.matrixWorld);
    }
  }

  function failWith(reason) {
    report.filled = false;
    report.reason = reason;
    return report;
  }

  function execute(frameContext) {
    const scene = frameContext ? frameContext.scene : null;
    const camera = frameContext ? frameContext.camera : null;
    if (!scene || !camera) return failWith("the frame context carries no scene or camera");
    if (!gBuffer || typeof gBuffer.isAvailable !== "function" || !gBuffer.isAvailable()) {
      return failWith("labGBuffer reports no multiple render target support");
    }
    const renderTarget = gBuffer.target();
    if (!renderTarget) return failWith("the G-buffer has no render target");

    const frameSize = resolveFrameSize(frameContext);
    const currentSize = gBuffer.size();
    if (currentSize.width !== frameSize.width || currentSize.height !== frameSize.height) {
      gBuffer.resize(frameSize.width, frameSize.height);
      if (readbackTarget) readbackTarget.setSize(frameSize.width, frameSize.height);
    }
    report.width = frameSize.width;
    report.height = frameSize.height;


    scene.updateMatrixWorld();
    camera.updateMatrixWorld();
    currentViewProjectionMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);

    collectDrawList(scene);

    const previousRenderTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    const previousClearAlpha = renderer.getClearAlpha();
    const previousShadowAutoUpdate = renderer.shadowMap.autoUpdate;
    const previousBackground = scene.background;
    renderer.getClearColor(preservedClearColor);

    try {


      scene.background = null;


      renderer.shadowMap.autoUpdate = false;
      renderer.autoClear = false;

      for (let hiddenIndex = 0; hiddenIndex < objectsHiddenForThisPass.length; hiddenIndex++) {
        objectsHiddenForThisPass[hiddenIndex].visible = false;
      }
      applyFillMaterials(camera);

      renderer.setRenderTarget(renderTarget);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, true, true);
      renderer.render(scene, camera);
    } finally {
      restoreOriginalMaterials();
      for (let hiddenIndex = 0; hiddenIndex < objectsHiddenForThisPass.length; hiddenIndex++) {
        objectsHiddenForThisPass[hiddenIndex].visible = true;
      }
      scene.background = previousBackground;
      renderer.setRenderTarget(previousRenderTarget);
      renderer.setClearColor(preservedClearColor, previousClearAlpha);
      renderer.autoClear = previousAutoClear;
      renderer.shadowMap.autoUpdate = previousShadowAutoUpdate;
    }

    rememberFrameState(camera);
    report.filled = true;
    report.reason = "";
    report.velocityValid = hasPreviousFrame;
    return report;
  }

  function ensureReadbackResources() {
    const size = gBuffer.size();
    if (!fullScreenQuad) fullScreenQuad = createFullScreenQuad(THREE);
    if (!attachmentBlitMaterial) {
      attachmentBlitMaterial = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        uniforms: { uSourceAttachment: { value: null } },
        vertexShader: FULL_SCREEN_VERTEX_SHADER,
        fragmentShader: buildAttachmentBlitFragmentShader(),
        depthTest: false,
        depthWrite: false,
      });
    }
    if (!readbackTarget) {
      readbackTarget = new THREE.WebGLRenderTarget(size.width, size.height, {
        type: THREE.FloatType,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        depthBuffer: false,
        stencilBuffer: false,
        generateMipmaps: false,
      });
    } else if (readbackTarget.width !== size.width || readbackTarget.height !== size.height) {
      readbackTarget.setSize(size.width, size.height);
    }
    return size;
  }


  function readGatheredAttachmentPixels(attachmentName, sourceTexture, gather, request) {
    const columnCount = Math.floor(Number(gather.columnCount) || 0);
    const rowCount = Math.floor(Number(gather.rowCount) || 0);
    if (!(columnCount >= 1) || !(rowCount >= 1)) return null;

    if (!attachmentGatherReadback) {
      attachmentGatherReadback = createAttachmentGatherReadback({ THREE, renderer });
    }

    const floatCount = columnCount * rowCount * 4;
    const pixelBuffer =
      request.reusePixelBuffer === true
        ? attachmentPixelBuffers.bufferFor(attachmentName, floatCount)
        : new Float32Array(floatCount);
    const gathered = attachmentGatherReadback.read({
      sourceTexture,
      sourceColumns: gather.sourceColumns,
      columnCount,
      sourceRows: gather.sourceRows,
      rowCount,
      latticeRevision: gather.latticeRevision,
      pixelBuffer,
    });
    if (!gathered) return null;
    return {
      attachmentName,
      x: 0,
      y: 0,
      width: columnCount,
      height: rowCount,
      pixels: gathered.pixels,
      gathered: true,
    };
  }


  function readAttachmentPixels(request) {
    const attachmentName = request ? request.attachmentName : null;
    if (sceneInputAttachmentNames().indexOf(attachmentName) < 0) return null;
    const sourceTexture = gBuffer.textureFor(attachmentName);
    if (!sourceTexture) return null;


    const gather = request.gather || null;
    if (gather) return readGatheredAttachmentPixels(attachmentName, sourceTexture, gather, request);

    const size = ensureReadbackResources();
    attachmentBlitMaterial.uniforms.uSourceAttachment.value = sourceTexture;
    fullScreenQuad.render(renderer, attachmentBlitMaterial, readbackTarget);

    const x = Math.max(0, Math.floor(request.x || 0));
    const y = Math.max(0, Math.floor(request.y || 0));
    const width = Math.max(1, Math.min(Math.floor(request.width || 1), size.width - x));
    const height = Math.max(1, Math.min(Math.floor(request.height || 1), size.height - y));


    const floatCount = width * height * 4;
    const pixels =
      request.reusePixelBuffer === true
        ? attachmentPixelBuffers.bufferFor(attachmentName, floatCount)
        : new Float32Array(floatCount);
    renderer.readRenderTargetPixels(readbackTarget, x, y, width, height, pixels);
    return { attachmentName, x, y, width, height, pixels };
  }

  function releaseReadbackResources() {
    attachmentPixelBuffers.release();
    if (attachmentGatherReadback) attachmentGatherReadback.dispose();
    attachmentGatherReadback = null;
    if (readbackTarget) readbackTarget.dispose();
    readbackTarget = null;
    if (attachmentBlitMaterial) attachmentBlitMaterial.dispose();
    attachmentBlitMaterial = null;
    if (fullScreenQuad) fullScreenQuad.dispose();
    fullScreenQuad = null;
  }

  return {
    execute,
    lastReport: () => report,
    readAttachmentPixels,
    releaseReadbackResources,
    dispose() {
      releaseReadbackResources();
      for (const material of ownedFillMaterials) material.dispose();
      ownedFillMaterials.clear();
      hasPreviousFrame = false;
    },
  };
}
