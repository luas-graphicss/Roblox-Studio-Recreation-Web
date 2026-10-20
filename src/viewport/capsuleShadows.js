import {
  RSW_CAP_MAX,
  RSW_CAP_FADE,
  buildCapsuleGlsl,
  patchLightsFragmentChunk,
} from "../lighting/capsuleShadowCore.js";

export function createCapsuleShadows({ THREE }) {
  const chunk = THREE && THREE.ShaderChunk ? THREE.ShaderChunk.lights_fragment_begin : null;
  const patched = patchLightsFragmentChunk(typeof chunk === "string" ? chunk : "");
  const supported = patched.ok;
  const glsl = buildCapsuleGlsl({ maxCapsules: RSW_CAP_MAX });
  let generation = 0;

  const uniforms = {
    uRswCapOn: { value: 0 },
    uRswCapCount: { value: 0 },
    uRswCapA: { value: new Float32Array(RSW_CAP_MAX * 4) },
    uRswCapB: { value: new Float32Array(RSW_CAP_MAX * 4) },
    uRswCapSunDir: { value: new Float32Array([0, 1, 0]) },
    uRswCapSunTan: { value: 0.02 },
    uRswCapAmbK: { value: 0.35 },
    uRswCapFade: { value: RSW_CAP_FADE },
  };

  function patchMaterial(mat) {
    if (!supported || !mat) return;
    const ud = mat.userData || (mat.userData = {});
    if (ud.__rswCaps) return;                                                
    ud.__rswCaps = true;
    const prevCompile = mat.onBeforeCompile;
    const prevKey = mat.customProgramCacheKey;
    mat.onBeforeCompile = function (shader, rendererArg) {
      if (typeof prevCompile === "function") prevCompile.call(this, shader, rendererArg);

      if (shader.fragmentShader.indexOf("#include <lights_pars_begin>") === -1) return;
      for (const nome of Object.keys(uniforms)) shader.uniforms[nome] = uniforms[nome];
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <lights_pars_begin>", "#include <lights_pars_begin>\n" + glsl);
      if (shader.fragmentShader.indexOf("#include <lights_fragment_begin>") !== -1) {
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <lights_fragment_begin>", patched.text);
      } else {


        const patched2 = patchLightsFragmentChunk(shader.fragmentShader);
        if (patched2.ok) shader.fragmentShader = patched2.text;
      }
    };
    mat.customProgramCacheKey = function () {
      const base = typeof prevKey === "function" ? String(prevKey.call(this)) : "";
      return base + "|rswCaps" + generation;
    };
    mat.needsUpdate = true;
  }

  function setEnabled(on) {
    uniforms.uRswCapOn.value = on ? 1 : 0;
  }

  function setSunTan(tan) {
    const t = Number(tan);
    uniforms.uRswCapSunTan.value = Number.isFinite(t) ? Math.min(Math.max(t, 0.001), 0.1) : 0.02;
  }

  function setSunDir(dir) {
    const v = uniforms.uRswCapSunDir.value;
    v[0] = Number(dir.x) || 0;
    v[1] = Number(dir.y) || 0;
    v[2] = Number(dir.z) || 0;
  }



  const va = THREE && THREE.Vector3 ? new THREE.Vector3() : null;
  const vb = THREE && THREE.Vector3 ? new THREE.Vector3() : null;
  function setCapsulesView(sel, viewMatrix) {
    if (!va || !vb) return 0;
    const n = Math.min(sel.length, RSW_CAP_MAX);
    const A = uniforms.uRswCapA.value;
    const B = uniforms.uRswCapB.value;
    for (let i = 0; i < n; i++) {
      const c = sel[i];
      va.set(c.ax, c.ay, c.az).applyMatrix4(viewMatrix);
      vb.set(c.bx, c.by, c.bz).applyMatrix4(viewMatrix);
      const o = i * 4;
      A[o] = va.x;
      A[o + 1] = va.y;
      A[o + 2] = va.z;
      A[o + 3] = c.r;
      B[o] = vb.x;
      B[o + 1] = vb.y;
      B[o + 2] = vb.z;
      B[o + 3] = c.w;
    }
    uniforms.uRswCapCount.value = n;
    return n;
  }

  function bumpGeneration() {
    generation++;
  }


  let blobParent = null;
  let blobGeo = null;
  let blobTex = null;
  const blobs = [];

  function attachBlobs(parent) {
    blobParent = parent || null;
  }

  function ensureBlobTex() {
    if (blobTex || typeof document === "undefined" || !THREE || !THREE.CanvasTexture) return blobTex;
    const cv = document.createElement("canvas");
    cv.width = cv.height = 64;
    const ctx = cv.getContext("2d");
    if (!ctx) return null;
    const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 31);
    g.addColorStop(0, "rgba(0,0,0,0.9)");
    g.addColorStop(0.6, "rgba(0,0,0,0.55)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    blobTex = new THREE.CanvasTexture(cv);
    return blobTex;
  }

  function ensureBlob(i) {
    if (blobs[i]) return blobs[i];
    if (!blobParent || !THREE || !THREE.Mesh || !THREE.CircleGeometry || !THREE.MeshBasicMaterial) return null;
    if (!blobGeo) blobGeo = new THREE.CircleGeometry(1, 24);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    const tex = ensureBlobTex();
    if (tex) mat.map = tex;                                           
    const mesh = new THREE.Mesh(blobGeo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.renderOrder = 2;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.visible = false;
    mesh.name = "rsw-cap-blob-" + i;
    blobParent.add(mesh);
    blobs[i] = mesh;
    return mesh;
  }

  function updateBlob(i, x, y, z, radius, opacity) {
    const b = ensureBlob(i);
    if (!b) return;
    b.visible = opacity > 0.01;
    b.position.set(x, y, z);
    b.scale.set(radius, radius, 1);
    b.material.opacity = opacity;
  }

  function hideBlobsFrom(n) {
    for (let i = n; i < blobs.length; i++) {
      if (blobs[i]) blobs[i].visible = false;
    }
  }

  function hideBlobs() {
    hideBlobsFrom(0);
  }

  function dispose() {
    for (const b of blobs) {
      if (!b) continue;
      if (b.parent) b.parent.remove(b);
      if (b.material) b.material.dispose();
    }
    blobs.length = 0;
    if (blobGeo) {
      blobGeo.dispose();
      blobGeo = null;
    }
    if (blobTex) {
      blobTex.dispose();
      blobTex = null;
    }
    blobParent = null;
  }

  function getDebugState() {
    let blobsVisiveis = 0;
    for (const b of blobs) if (b && b.visible) blobsVisiveis++;
    return {
      supported,
      anchors: patched.anchors,
      enabled: uniforms.uRswCapOn.value > 0.5,
      count: uniforms.uRswCapCount.value,
      sunTan: uniforms.uRswCapSunTan.value,
      blobsVisiveis,
      generation,
    };
  }

  const api = {
    supported,
    anchors: patched.anchors,
    uniforms,
    patchMaterial,
    setEnabled,
    setSunTan,
    setSunDir,
    setCapsulesView,
    bumpGeneration,
    attachBlobs,
    updateBlob,
    hideBlobsFrom,
    hideBlobs,
    dispose,
    getDebugState,
  };


  if (typeof window !== "undefined") {
    window.__rswCapsuleShadows = {
      get state() {
        return getDebugState();
      },
    };
  }

  return api;
}
