import { buildMsmTemporalPassShader, buildMsmMomentPassShader, buildMsmSpatialPassShader } from '../lighting/megalightsSm/msmDenoisePassGlsl.js';
import { MSM_REPROJECTION_MATRIX_UNIFORM_NAME } from '../lighting/megalightsSm/msmTemporalReprojectionCore.js';
import { buildSamplePassVertexShader } from '../lighting/megalightsSm/msmSamplePassGlsl.js';
import { compileMsmMaterial } from './msmShaderPreparation.js';

export function createMsmDenoisePasses({ THREE, FullScreenQuad }) {
  const uniforms = {
    tMsmIrradianceCurrent: { value: null }, tMsmIrradianceHistory: { value: null },
    tMsmPreviousMoments: { value: null }, tMsmTemporalResult: { value: null },
    tMsmSpatialSource: { value: null }, tMsmVarianceMoments: { value: null },
    uMsmIrradianceTexel: { value: new THREE.Vector2() },
    uMsmSpatialTexel: { value: new THREE.Vector2() },
    [MSM_REPROJECTION_MATRIX_UNIFORM_NAME]: { value: new THREE.Matrix4() },
    uMsmPreviousViewFromCurrentView: { value: new THREE.Matrix4() },
    uMsmTemporalAlpha: { value: 1 }, uMsmHistoryValid: { value: 0 },
    uMsmCoarseHistoryValid: { value: 0 },
    uMsmSignalLuminance: { value: new THREE.Vector3(1, 0, 0) },
    uMsmRelativeVarianceThreshold: { value: 0.04 },
    uMsmSpatialDepthTolerance: { value: 0.001 },
  };
  const materials = [buildMsmTemporalPassShader, buildMsmMomentPassShader, buildMsmSpatialPassShader].map((build, index) =>
    new THREE.ShaderMaterial({ name: ['MSM temporal', 'MSM moments', 'MSM spatial'][index],
      uniforms, vertexShader: buildSamplePassVertexShader(), fragmentShader: build(),
      depthTest: false, depthWrite: false, blending: THREE.NoBlending }));
  const quad = new FullScreenQuad(null);
  const previousViewProjection = new THREE.Matrix4();
  const previousView = new THREE.Matrix4();
  let renderedFrames = 0, primedPrograms = 0;
  const drawCounts = { temporal: 0, moments: 0, spatial: 0 };

  function draw(renderer, index, target) {
    quad.material = materials[index];
    renderer.setRenderTarget(target);
    quad.render(renderer);
  }

  function bindUniforms(request) {
    const { targets, camera, sceneUniforms, alpha, threshold, mode, valid, mipmapped } = request;
    for (const [name, uniform] of Object.entries(sceneUniforms)) uniforms[name] = uniform;
    for (const material of materials) material.uniforms = uniforms;
    uniforms.tMsmIrradianceCurrent.value = targets.sample.texture;
    uniforms.tMsmIrradianceHistory.value = targets.history.texture;
    uniforms.tMsmPreviousMoments.value = targets.previousMoments.texture;
    uniforms.tMsmTemporalResult.value = targets.temporal.texture;
    uniforms.tMsmSpatialSource.value = targets.temporal.texture;
    uniforms.tMsmVarianceMoments.value = targets.nextMoments.texture;
    uniforms.uMsmIrradianceTexel.value.set(1 / targets.sample.width, 1 / targets.sample.height);
    uniforms.uMsmSpatialTexel.value.copy(uniforms.uMsmIrradianceTexel.value);
    uniforms[MSM_REPROJECTION_MATRIX_UNIFORM_NAME].value.multiplyMatrices(previousViewProjection, camera.matrixWorld);
    uniforms.uMsmPreviousViewFromCurrentView.value.multiplyMatrices(previousView, camera.matrixWorld);
    uniforms.uMsmTemporalAlpha.value = alpha;
    uniforms.uMsmHistoryValid.value = valid ? 1 : 0;
    uniforms.uMsmCoarseHistoryValid.value = valid && mipmapped ? 1 : 0;
    uniforms.uMsmSignalLuminance.value.set(...(mode === 'B' ? [0.2126, 0.7152, 0.0722] : [1, 0, 0]));
    uniforms.uMsmRelativeVarianceThreshold.value = threshold;
    uniforms.uMsmSpatialDepthTolerance.value = 2 / (Math.max(1, targets.sample.height) * camera.projectionMatrix.elements[5]);
  }

  function render(renderer, request) {
    bindUniforms(request);
    const { targets, camera, spatial } = request;
    const measure = request.measure || ((id, work) => work());
    measure('msm-temporal', () => draw(renderer, 0, targets.temporal)); drawCounts.temporal += 1;
    measure('msm-moments', () => draw(renderer, 1, targets.nextMoments)); drawCounts.moments += 1;
    if (spatial) { measure('msm-spatial', () => draw(renderer, 2, targets.sample)); drawCounts.spatial += 1; }
    previousViewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    previousView.copy(camera.matrixWorldInverse);
    renderedFrames += 1;
  }

  return { render,
    previousViewProjection: () => previousViewProjection,
    warmupProgram: (renderer, index) => compileMsmMaterial({ THREE, renderer, material: materials[index] }),
    primeGpuProgram: (renderer, request, index) => {
      bindUniforms(request);
      draw(renderer, index, [request.targets.temporal, request.targets.nextMoments, request.targets.sample][index]);
      primedPrograms += 1;
    },
    describe: () => ({ renderedFrames, ...drawCounts, primedPrograms, historyLagFrames: 1,
      cameraReprojection: true, geometryRejection: true, relativeVariance: true }),
    dispose: () => { materials.forEach(material => material.dispose()); quad.dispose(); },
  };
}
