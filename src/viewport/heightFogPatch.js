import { buildHeightFogGlsl } from "../lighting/heightFogCore.js";

export function createHeightFogPatch({ THREE }) {
  const fogFragChunk =
    THREE && THREE.ShaderChunk && typeof THREE.ShaderChunk.fog_fragment === "string"
      ? THREE.ShaderChunk.fog_fragment
      : "";

  const supported = fogFragChunk.indexOf("fogFactor") !== -1;
  let generation = 0;
  let patchedTotal = 0;

  const uniforms = {
    uRswHFogOn: { value: 0 },
    uRswHFogSigma: { value: 0 },
    uRswHFogFalloff: { value: 0.014 },
    uRswHFogBaseY: { value: 0 },
    uRswHFogSunK: { value: 10 },
    uRswHFogSunAmp: { value: 0.45 },
    uRswHFogSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uRswHFogSunColor: { value: new THREE.Color(1, 1, 1) },
  };

  const VERT_PARS = "\n#ifdef USE_FOG\nvarying vec3 vRswHFWorld;\n#endif\n";


  const VERT_BODY = [
    "#ifdef USE_FOG",
    "vec4 rswHFW = vec4( transformed, 1.0 );",
    "#ifdef USE_INSTANCING",
    "rswHFW = instanceMatrix * rswHFW;",
    "#endif",
    "vRswHFWorld = ( modelMatrix * rswHFW ).xyz;",
    "#endif",
  ].join("\n");
  const FRAG_PARS = [
    "#ifdef USE_FOG",
    "varying vec3 vRswHFWorld;",
    "uniform float uRswHFogOn;",
    "uniform float uRswHFogSigma;",
    "uniform float uRswHFogFalloff;",
    "uniform float uRswHFogBaseY;",
    "uniform float uRswHFogSunK;",
    "uniform float uRswHFogSunAmp;",
    "uniform vec3 uRswHFogSunDir;",
    "uniform vec3 uRswHFogSunColor;",
    buildHeightFogGlsl(),
    "#endif",
  ].join("\n");
  const FRAG_BODY = [
    "#ifdef USE_FOG",
    "if ( uRswHFogOn > 0.5 ) {",
    "vec3 rswHFd = vRswHFWorld - cameraPosition;",
    "float rswHFdist = length( rswHFd );",
    "vec3 rswHFdir = rswHFd / max( rswHFdist, 1e-4 );",
    "float rswHFf = rswHFogFactor( cameraPosition.y, rswHFdir.y, rswHFdist, uRswHFogSigma, uRswHFogFalloff, uRswHFogBaseY );",
    "float rswHFw = uRswHFogSunAmp * rswHFogSunW( dot( rswHFdir, uRswHFogSunDir ), uRswHFogSunK );",
    "vec3 rswHFcol = mix( fogColor, uRswHFogSunColor, clamp( rswHFw, 0.0, 1.0 ) );",
    "gl_FragColor.rgb = mix( gl_FragColor.rgb, rswHFcol, clamp( rswHFf, 0.0, 1.0 ) );",
    "} else {",


    fogFragChunk,
    "}",
    "#endif",
  ].join("\n");

  function patchMaterial(mat) {
    if (!supported || !mat) return;
    const ud = mat.userData || (mat.userData = {});
    if (ud.__rswHFog) return;                                                
    ud.__rswHFog = true;
    patchedTotal++;
    const prevCompile = mat.onBeforeCompile;
    const prevKey = mat.customProgramCacheKey;
    mat.onBeforeCompile = function (shader, rendererArg) {
      if (typeof prevCompile === "function") prevCompile.call(this, shader, rendererArg);


      if (shader.fragmentShader.indexOf("#include <fog_fragment>") === -1) return;
      if (shader.fragmentShader.indexOf("#include <fog_pars_fragment>") === -1) return;
      if (shader.vertexShader.indexOf("#include <fog_vertex>") === -1) return;
      if (shader.vertexShader.indexOf("#include <fog_pars_vertex>") === -1) return;




      if (shader.vertexShader.indexOf("#include <begin_vertex>") === -1) return;
      for (const nome of Object.keys(uniforms)) shader.uniforms[nome] = uniforms[nome];
      shader.vertexShader = shader.vertexShader
        .replace("#include <fog_pars_vertex>", "#include <fog_pars_vertex>" + VERT_PARS)
        .replace("#include <fog_vertex>", "#include <fog_vertex>\n" + VERT_BODY);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <fog_pars_fragment>", "#include <fog_pars_fragment>\n" + FRAG_PARS)
        .replace("#include <fog_fragment>", FRAG_BODY);
    };
    mat.customProgramCacheKey = function () {
      const base = typeof prevKey === "function" ? String(prevKey.call(this)) : "";
      return base + "|rswHFog" + generation;
    };
    mat.needsUpdate = true;
  }

  function setEnabled(on) {
    uniforms.uRswHFogOn.value = on ? 1 : 0;
  }



  function setParams(p) {
    const o = p || {};
    uniforms.uRswHFogSigma.value = Number.isFinite(o.sigma) ? Math.max(o.sigma, 0) : 0;
    uniforms.uRswHFogFalloff.value = Number.isFinite(o.falloff) ? Math.max(o.falloff, 1e-6) : 0.014;
    uniforms.uRswHFogBaseY.value = Number.isFinite(o.baseY) ? o.baseY : 0;
    uniforms.uRswHFogSunK.value = Number.isFinite(o.sunK) ? Math.max(o.sunK, 1) : 10;
    uniforms.uRswHFogSunAmp.value = Number.isFinite(o.sunAmp) ? Math.min(Math.max(o.sunAmp, 0), 1) : 0.45;
  }

  function setSun(dir, color) {
    if (dir) {
      const v = uniforms.uRswHFogSunDir.value;
      v.set(Number(dir.x) || 0, Number(dir.y) || 0, Number(dir.z) || 0);
      if (v.lengthSq() < 1e-8) v.set(0, 1, 0);
      v.normalize();
    }
    if (color) {
      uniforms.uRswHFogSunColor.value.setRGB(
        Number(color.r) || 0,
        Number(color.g) || 0,
        Number(color.b) || 0
      );
    }
  }


  function bumpGeneration() {
    generation++;
  }


  function getState() {
    return {
      supported,
      on: uniforms.uRswHFogOn.value > 0.5,
      sigma: uniforms.uRswHFogSigma.value,
      falloff: uniforms.uRswHFogFalloff.value,
      sunK: uniforms.uRswHFogSunK.value,
      sunAmp: uniforms.uRswHFogSunAmp.value,
      patchedTotal,
      generation,
    };
  }

  return {
    supported,
    uniforms,
    patchMaterial,
    setEnabled,
    setParams,
    setSun,
    bumpGeneration,
    getState,
  };
}
