import {
  ML_TEX_WIDTH,
  ML_MAX_LIGHTS,
  ML_WEIGHT_MIN,
  ML_GOLDEN,
  buildMegaLightsFrag,
  packMegaLights,
  sanitizeMegaSettings,
} from "../lighting/megaLightsCore.js";
import {
  CL_Z,
  CL_TEX_CLUSTER,
  CL_IDX_TEX_W,
  CL_IDX_TEX_H,
  CL_MAX_INDEX_ENTRIES,
  CL_DEFAULTS,
  sanitizeClusterSettings,
  packClusterBuffers,
  buildClusterFrag,
} from "../lighting/lightClusterCore.js";          


import {
  SA_META_TEX_W,
  SA_TOP_MAX,
  SA_DEFAULT_BIAS,
  SA_DEFAULT_SAMPLES,
  SA_K_OFFSET,
  buildAtlasGlsl,
} from "../lighting/shadowAtlasCore.js";


import { MEGA_LIGHTS_PERF_DEFAULTS } from "../lighting/megaLightsPerf/megaLightsPerfOptions.js";
import {
  createViewSpaceLightBounds,
  computeViewSpaceLightBounds,
} from "../lighting/megaLightsPerf/megaLightsLightBoundsCore.js";
import {
  createDepthSliceScaleBias,
  computeDepthSliceScaleBias,
} from "../lighting/megaLightsPerf/megaLightsDepthSliceCore.js";
import { createMegaLightsUploadTracker } from "../lighting/megaLightsPerf/megaLightsUploadTrackerCore.js";

const VERT = [
  "varying vec2 vUv;",
  "void main() {",
  "  vUv = uv;",
  "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
  "}",
].join("\n");

export function createMegaLightsPass({ THREE, camera, FullScreenQuad, sharedDepth }) {
  if (!sharedDepth) throw new Error("createMegaLightsPass: sharedDepth é obrigatório");
  const settings = sanitizeMegaSettings();
  const clSettings = sanitizeClusterSettings();


  const data = new Float32Array(ML_TEX_WIDTH * 4);
  const tex = new THREE.DataTexture(data, ML_TEX_WIDTH, 1, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;


  const clusterData = new Float32Array(CL_TEX_CLUSTER * 4);
  const clusterTex = new THREE.DataTexture(clusterData, CL_TEX_CLUSTER, 1, THREE.RGBAFormat, THREE.FloatType);
  clusterTex.minFilter = THREE.NearestFilter;
  clusterTex.magFilter = THREE.NearestFilter;
  clusterTex.generateMipmaps = false;
  clusterTex.needsUpdate = true;

  const lightIdxData = new Float32Array(CL_MAX_INDEX_ENTRIES * 4);


  const lightIdxTex = new THREE.DataTexture(lightIdxData, CL_IDX_TEX_W, CL_IDX_TEX_H, THREE.RGBAFormat, THREE.FloatType);
  lightIdxTex.minFilter = THREE.NearestFilter;
  lightIdxTex.magFilter = THREE.NearestFilter;
  lightIdxTex.generateMipmaps = false;
  lightIdxTex.needsUpdate = true;


  const transMin = [];
  const transMax = [];
  const transTint = [];
  for (let i = 0; i < 8; i++) {
    transMin.push(new THREE.Vector4(0, 0, 0, 0));
    transMax.push(new THREE.Vector4(0, 0, 0, 0));
    transTint.push(new THREE.Vector4(1, 1, 1, 0));
  }
  const quad = new FullScreenQuad(null);


  const mat = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse:     { value: null },
      tDepth:       { value: null },
      uDepthTexel:  { value: new THREE.Vector2(1, 1) },
      tLights:      { value: tex },
      uClusterTex:  { value: clusterTex },            
      uLightIdxTex: { value: lightIdxTex },           
      uCount:       { value: 0 },
      uBase:        { value: 1 },
      uStrength:    { value: settings.strength },
      uSteps:       { value: settings.steps },
      uDistance:    { value: settings.distance },
      uThickness:   { value: settings.thickness },
      uFrame:       { value: 0 },
      uProj:        { value: new THREE.Matrix4() },
      uInvProj:     { value: new THREE.Matrix4() },
      uNear:        { value: 0.1 },
      uFar:         { value: 1000 },
      uClusterOn:   { value: 0 },                                          
      uSpecStrength: { value: clSettings.specStrength },          
      uProjM00:     { value: 0 },                              
      uProjM11:     { value: 0 },                              


      uLightBoundsCenter:   { value: new THREE.Vector3(0, 0, 0) },
      uLightBoundsRadiusSq: { value: 0 },
      uLightBoundsOn:       { value: 0 },
      uDepthSliceScale:     { value: 0 },
      uDepthSliceBias:      { value: 0 },


      uAtlasTex:    { value: null },
      uAtlasMeta:   { value: null },
      uAtlasOn:     { value: 0 },
      uAtlasBias:   { value: SA_DEFAULT_BIAS },
      uAtlasTexel:  { value: 0 },
      uSamplesK:    { value: SA_DEFAULT_SAMPLES },
      uTopCount:    { value: 0 },
      uCamWorld:    { value: new THREE.Matrix4() },
      uTransCount:  { value: 0 },
      uTransMin:    { value: transMin },
      uTransMax:    { value: transMax },
      uTransTint:   { value: transTint },
    },
    vertexShader: VERT,


    fragmentShader: buildClusterFrag(ML_MAX_LIGHTS, ML_TEX_WIDTH, ML_WEIGHT_MIN, ML_GOLDEN, {
      atlasGlsl: buildAtlasGlsl(SA_META_TEX_W),
      kOffset: SA_K_OFFSET,


      perf: MEGA_LIGHTS_PERF_DEFAULTS,
    }),
    depthTest: false,
    depthWrite: false,
  });
  let count = 0;
  let clusterOn = false;                                        


  const uploadTracker = createMegaLightsUploadTracker();
  const lightBounds = createViewSpaceLightBounds();
  const depthSlice = createDepthSliceScaleBias();
  let clusterBuffersPacked = false;

  const pass = {
    enabled: false,
    needsSwap: true,
    clear: false,
    renderToScreen: false,
    setSize() {

    },


    applyState(state) {
      const s = state || {};
      const persp = !!camera && camera.projectionMatrix.elements[15] === 0;
      if (!s.active || !persp || !Array.isArray(s.lights) || s.lights.length === 0) {
        pass.enabled = false;
        count = 0;
        clusterOn = false;
        mat.uniforms.uClusterOn.value = 0;
        mat.uniforms.uAtlasOn.value = 0;                                        


        mat.uniforms.uLightBoundsOn.value = 0;
        uploadTracker.invalidate();
        clusterBuffersPacked = false;
        return;
      }


      const projectionElements = camera.projectionMatrix.elements;
      const lightUploadChanged = uploadTracker.shouldRebuild({
        lights: s.lights,
        viewElements: camera.matrixWorldInverse.elements,
        projM00: projectionElements[0],
        projM11: projectionElements[5],
        near: camera.near,
        far: camera.far,
      });
      if (lightUploadChanged) {
        count = packMegaLights(s.lights, camera.matrixWorldInverse.elements, data);
        tex.needsUpdate = true;


        computeViewSpaceLightBounds(data, count, lightBounds);
        mat.uniforms.uLightBoundsCenter.value.set(lightBounds.centerX, lightBounds.centerY, lightBounds.centerZ);
        mat.uniforms.uLightBoundsRadiusSq.value = lightBounds.radiusSquared;
        mat.uniforms.uLightBoundsOn.value = lightBounds.valid ? 1 : 0;
      }
      mat.uniforms.uCount.value = count;
      mat.uniforms.uBase.value = Math.max(0.001, Number(s.baseLum) || 1);
      mat.uniforms.uFrame.value = (Number(s.frame) || 0) % 64;

      const wantCluster = !!(s.clusterWanted) && count > 0;
      clusterOn = wantCluster;
      mat.uniforms.uClusterOn.value = wantCluster ? 1 : 0;


      mat.uniforms.uSpecStrength.value = wantCluster
        ? Math.min(1, Math.max(0, Number(s.specStrength) || 0))
        : 0;
      if (wantCluster && camera.projectionMatrix) {
        mat.uniforms.uProjM00.value = projectionElements[0];
        mat.uniforms.uProjM11.value = projectionElements[5];


        if (lightUploadChanged || !clusterBuffersPacked) {
          packClusterBuffers(
            s.lights,
            camera.matrixWorldInverse.elements,
            projectionElements[0], projectionElements[5],
            camera.near, camera.far,
            clusterData, lightIdxData,
            ML_MAX_LIGHTS
          );
          clusterTex.needsUpdate = true;
          lightIdxTex.needsUpdate = true;
          clusterBuffersPacked = true;
        }
      } else {
        clusterBuffersPacked = false;
      }


      const at = s.atlas || null;
      const atOn = !!(at && at.on && at.tex && at.metaTex && at.size > 0 && count > 0);
      mat.uniforms.uAtlasOn.value = atOn ? 1 : 0;
      mat.uniforms.uAtlasTex.value = atOn ? at.tex : null;
      mat.uniforms.uAtlasMeta.value = atOn ? at.metaTex : null;
      if (atOn) {
        mat.uniforms.uAtlasTexel.value = 1 / at.size;
        mat.uniforms.uAtlasBias.value = Number(at.bias) > 0 ? Number(at.bias) : SA_DEFAULT_BIAS;
        const kRaw = Math.floor(Number(at.samplesK) || SA_DEFAULT_SAMPLES);
        mat.uniforms.uSamplesK.value = Math.min(4, Math.max(1, kRaw));
        mat.uniforms.uTopCount.value = Math.min(SA_TOP_MAX, Math.max(0, Number(at.topCount) || 0));
      }
      pass.enabled = count > 0;
    },
    debugState() {
      return {
        enabled: pass.enabled,
        count,
        clusterOn,

        perf: {
          lightBoundsOn: mat.uniforms.uLightBoundsOn.value === 1,
          lightBoundsRadius: lightBounds.radius,
          upload: uploadTracker.stats(),
        },
      };
    },

    render(r, writeBuffer, readBuffer) {
      const pw = Math.max(1, readBuffer.width | 0);
      const ph = Math.max(1, readBuffer.height | 0);
      const u = mat.uniforms;
      u.tDepth.value = sharedDepth.acquire(r, pw, ph);
      const depthImage = u.tDepth.value && u.tDepth.value.image;
      const depthWidth = Math.max(1, (depthImage && depthImage.width) || pw);
      const depthHeight = Math.max(1, (depthImage && depthImage.height) || ph);
      u.uDepthTexel.value.set(1 / depthWidth, 1 / depthHeight);
      u.tDiffuse.value = readBuffer.texture;
      u.uProj.value.copy(camera.projectionMatrix);


      u.uInvProj.value.copy(camera.projectionMatrixInverse);
      u.uCamWorld.value.copy(camera.matrixWorld);                                        
      u.uNear.value = camera.near;
      u.uFar.value = camera.far;


      computeDepthSliceScaleBias(camera.near, camera.far, CL_Z, depthSlice);
      u.uDepthSliceScale.value = depthSlice.scale;
      u.uDepthSliceBias.value = depthSlice.bias;
      quad.material = mat;
      r.setRenderTarget(this.renderToScreen ? null : writeBuffer);
      quad.render(r);
    },
    dispose() {
      tex.dispose();
      clusterTex.dispose();            
      lightIdxTex.dispose();          
      mat.dispose();
      quad.dispose();
    },
  };
  return pass;
}
