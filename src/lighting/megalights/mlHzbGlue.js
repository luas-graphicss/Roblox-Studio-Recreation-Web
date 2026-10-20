import {
  hierarchicalDepthLevelCount,
  hierarchicalDepthLevelSize,
} from "./mlHzbCore.js";
import {
  buildHierarchicalDepthSeedFragmentShader,
  buildHierarchicalDepthReductionFragmentShader,
} from "./mlHzbGlsl.js";
import { createFullScreenQuad, FULL_SCREEN_VERTEX_SHADER } from "./mlFullScreenQuad.js";

export function createHierarchicalDepthPass(dependencies) {
  const THREE = dependencies.THREE;
  const renderer = dependencies.renderer;

  const fullScreenQuad = createFullScreenQuad(THREE);
  const levels = [];
  let baseWidth = 0;
  let baseHeight = 0;
  let seedMaterial = null;
  let reductionMaterial = null;
  let built = false;


  let pendingSeed = null;
  let levelsAreCurrent = false;
  let textureWasHandedOut = false;

  function createLevelTarget(width, height) {
    return new THREE.WebGLRenderTarget(width, height, {
      type: THREE.FloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });
  }

  function disposeLevels() {
    while (levels.length) {
      const level = levels.pop();
      if (level.target) level.target.dispose();
    }
  }

  function ensureMaterials() {
    if (!seedMaterial) {
      seedMaterial = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        uniforms: { uSceneDepth: { value: null }, uFarPlane: { value: 600 } },
        vertexShader: FULL_SCREEN_VERTEX_SHADER,
        fragmentShader: buildHierarchicalDepthSeedFragmentShader(),
        depthTest: false,
        depthWrite: false,
      });
    }
    if (!reductionMaterial) {
      reductionMaterial = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        uniforms: {
          uSourceLevel: { value: null },
          uSourceSize: { value: new THREE.Vector2(1, 1) },
          uDestinationSize: { value: new THREE.Vector2(1, 1) },
        },
        vertexShader: FULL_SCREEN_VERTEX_SHADER,
        fragmentShader: buildHierarchicalDepthReductionFragmentShader(),
        depthTest: false,
        depthWrite: false,
      });
    }
  }

  function ensureLevels(width, height) {
    if (levels.length > 0 && width === baseWidth && height === baseHeight) return;
    disposeLevels();
    baseWidth = width;
    baseHeight = height;
    const levelCount = hierarchicalDepthLevelCount(width, height);
    for (let levelIndex = 0; levelIndex < levelCount; levelIndex++) {
      const size = hierarchicalDepthLevelSize(width, height, levelIndex);
      levels.push({
        levelIndex,
        width: size.width,
        height: size.height,
        target: createLevelTarget(size.width, size.height),
      });
    }
    built = false;
    levelsAreCurrent = false;
  }


  function buildLevels() {
    if (levelsAreCurrent) return true;
    if (!pendingSeed || !pendingSeed.sceneDepthTexture) return false;
    if (levels.length === 0 || !seedMaterial || !reductionMaterial) return false;


    const renderInfo = renderer.info && renderer.info.render ? renderer.info.render : null;
    const frameCountBeforeBuild = renderInfo ? renderInfo.frame : 0;

    seedMaterial.uniforms.uSceneDepth.value = pendingSeed.sceneDepthTexture;
    seedMaterial.uniforms.uFarPlane.value = pendingSeed.farPlane;
    fullScreenQuad.render(renderer, seedMaterial, levels[0].target);

    for (let levelIndex = 1; levelIndex !== levels.length; levelIndex++) {
      const sourceLevel = levels[levelIndex - 1];
      const destinationLevel = levels[levelIndex];
      reductionMaterial.uniforms.uSourceLevel.value = sourceLevel.target.texture;
      reductionMaterial.uniforms.uSourceSize.value.set(sourceLevel.width, sourceLevel.height);
      reductionMaterial.uniforms.uDestinationSize.value.set(destinationLevel.width, destinationLevel.height);
      fullScreenQuad.render(renderer, reductionMaterial, destinationLevel.target);
    }

    if (renderInfo) renderInfo.frame = frameCountBeforeBuild;
    levelsAreCurrent = true;
    return true;
  }


  function execute(request) {
    if (!request || !request.sceneDepthTexture) {
      built = false;
      pendingSeed = null;
      levelsAreCurrent = false;
      return { built: false, reason: "no depth attachment to seed from", levelCount: levels.length, width: baseWidth, height: baseHeight };
    }
    ensureLevels(Math.max(1, Math.floor(request.width)), Math.max(1, Math.floor(request.height)));
    ensureMaterials();

    pendingSeed = {
      sceneDepthTexture: request.sceneDepthTexture,
      farPlane: Number(request.farPlane) || 600,
    };
    levelsAreCurrent = false;
    if (textureWasHandedOut) buildLevels();

    built = true;
    return {
      built: true,
      reason: "",
      levelCount: levels.length,
      width: baseWidth,
      height: baseHeight,
      levelsBuiltThisFrame: levelsAreCurrent,
    };
  }


  function readLevel(levelIndex, rectangle) {
    const level = levels[levelIndex];
    if (!level) return null;


    buildLevels();
    const request = rectangle || {};
    const x = Math.max(0, Math.floor(request.x || 0));
    const y = Math.max(0, Math.floor(request.y || 0));
    const width = Math.max(1, Math.min(Math.floor(request.width || level.width), level.width - x));
    const height = Math.max(1, Math.min(Math.floor(request.height || level.height), level.height - y));
    const pixels = new Float32Array(width * height * 4);
    renderer.readRenderTargetPixels(level.target, x, y, width, height, pixels);
    return { levelIndex, x, y, width, height, pixels };
  }

  return {
    execute,
    readLevel,
    isBuilt: () => built,
    levelCount: () => levels.length,
    levelSize: (levelIndex) => (levels[levelIndex] ? { width: levels[levelIndex].width, height: levels[levelIndex].height } : null),
    textureFor: (levelIndex) => {
      if (!levels[levelIndex]) return null;

      textureWasHandedOut = true;
      buildLevels();
      return levels[levelIndex].target.texture;
    },
    describe() {
      return {
        owner: "ML-F3",
        built,
        levelCount: levels.length,
        baseWidth,
        baseHeight,
        format: "RGBA float, min in R and max in G",
        levelsBuiltThisFrame: levelsAreCurrent,
        builtOnDemandOnly: !textureWasHandedOut,
        levels: levels.map((level) => ({ levelIndex: level.levelIndex, width: level.width, height: level.height })),
      };
    },
    dispose() {
      disposeLevels();
      if (seedMaterial) seedMaterial.dispose();
      seedMaterial = null;
      if (reductionMaterial) reductionMaterial.dispose();
      reductionMaterial = null;
      fullScreenQuad.dispose();
      built = false;
      pendingSeed = null;
      levelsAreCurrent = false;
    },
  };
}
