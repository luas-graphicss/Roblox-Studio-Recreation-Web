export const MAX_PALETTE_BONES = 128;                                                                          
export const MAX_PALETTE_INSTANCES = 1024;                                              

const DEG2RAD = Math.PI / 180;
const EPS = 1e-4;


export function quatFromEulerDegYXZ(out, exDeg, eyDeg, ezDeg) {
  const x = exDeg * DEG2RAD * 0.5;
  const y = eyDeg * DEG2RAD * 0.5;
  const z = ezDeg * DEG2RAD * 0.5;
  const c1 = Math.cos(x), c2 = Math.cos(y), c3 = Math.cos(z);
  const s1 = Math.sin(x), s2 = Math.sin(y), s3 = Math.sin(z);

  out[0] = s1 * c2 * c3 + c1 * s2 * s3;
  out[1] = c1 * s2 * c3 - s1 * c2 * s3;
  out[2] = c1 * c2 * s3 - s1 * s2 * c3;
  out[3] = c1 * c2 * c3 + s1 * s2 * s3;
  return out;
}


export function quatMultiply(out, a, b) {
  const ax = a[0], ay = a[1], az = a[2], aw = a[3];
  const bx = b[0], by = b[1], bz = b[2], bw = b[3];
  out[0] = ax * bw + aw * bx + ay * bz - az * by;
  out[1] = ay * bw + aw * by + az * bx - ax * bz;
  out[2] = az * bw + aw * bz + ax * by - ay * bx;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}


export function mat4Compose(te, px, py, pz, q, sx, sy, sz) {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  te[0] = (1 - (yy + zz)) * sx;
  te[1] = (xy + wz) * sx;
  te[2] = (xz - wy) * sx;
  te[3] = 0;
  te[4] = (xy - wz) * sy;
  te[5] = (1 - (xx + zz)) * sy;
  te[6] = (yz + wx) * sy;
  te[7] = 0;
  te[8] = (xz + wy) * sz;
  te[9] = (yz - wx) * sz;
  te[10] = (1 - (xx + yy)) * sz;
  te[11] = 0;
  te[12] = px;
  te[13] = py;
  te[14] = pz;
  te[15] = 1;
  return te;
}


export function mat4Multiply(te, ae, be) {
  const a11 = ae[0], a12 = ae[4], a13 = ae[8], a14 = ae[12];
  const a21 = ae[1], a22 = ae[5], a23 = ae[9], a24 = ae[13];
  const a31 = ae[2], a32 = ae[6], a33 = ae[10], a34 = ae[14];
  const a41 = ae[3], a42 = ae[7], a43 = ae[11], a44 = ae[15];
  const b11 = be[0], b12 = be[4], b13 = be[8], b14 = be[12];
  const b21 = be[1], b22 = be[5], b23 = be[9], b24 = be[13];
  const b31 = be[2], b32 = be[6], b33 = be[10], b34 = be[14];
  const b41 = be[3], b42 = be[7], b43 = be[11], b44 = be[15];
  te[0] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41;
  te[4] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42;
  te[8] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43;
  te[12] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44;
  te[1] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41;
  te[5] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42;
  te[9] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43;
  te[13] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44;
  te[2] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41;
  te[6] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42;
  te[10] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43;
  te[14] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44;
  te[3] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41;
  te[7] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42;
  te[11] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43;
  te[15] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44;
  return te;
}


export function mat4Invert(te, me) {
  const n11 = me[0], n21 = me[1], n31 = me[2], n41 = me[3];
  const n12 = me[4], n22 = me[5], n32 = me[6], n42 = me[7];
  const n13 = me[8], n23 = me[9], n33 = me[10], n43 = me[11];
  const n14 = me[12], n24 = me[13], n34 = me[14], n44 = me[15];
  const t11 = n23 * n34 * n42 - n24 * n33 * n42 + n24 * n32 * n43 - n22 * n34 * n43 - n23 * n32 * n44 + n22 * n33 * n44;
  const t12 = n14 * n33 * n42 - n13 * n34 * n42 - n14 * n32 * n43 + n12 * n34 * n43 + n13 * n32 * n44 - n12 * n33 * n44;
  const t13 = n13 * n24 * n42 - n14 * n23 * n42 + n14 * n22 * n43 - n12 * n24 * n43 - n13 * n22 * n44 + n12 * n23 * n44;
  const t14 = n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34;
  const det = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14;
  if (det === 0) return false;
  const d = 1 / det;
  te[0] = t11 * d;
  te[1] = (n24 * n33 * n41 - n23 * n34 * n41 - n24 * n31 * n43 + n21 * n34 * n43 + n23 * n31 * n44 - n21 * n33 * n44) * d;
  te[2] = (n22 * n34 * n41 - n24 * n32 * n41 + n24 * n31 * n42 - n21 * n34 * n42 - n22 * n31 * n44 + n21 * n32 * n44) * d;
  te[3] = (n23 * n32 * n41 - n22 * n33 * n41 - n23 * n31 * n42 + n21 * n33 * n42 + n22 * n31 * n43 - n21 * n32 * n43) * d;
  te[4] = t12 * d;
  te[5] = (n13 * n34 * n41 - n14 * n33 * n41 + n14 * n31 * n43 - n11 * n34 * n43 - n13 * n31 * n44 + n11 * n33 * n44) * d;
  te[6] = (n14 * n32 * n41 - n12 * n34 * n41 - n14 * n31 * n42 + n11 * n34 * n42 + n12 * n31 * n44 - n11 * n32 * n44) * d;
  te[7] = (n12 * n33 * n41 - n13 * n32 * n41 + n13 * n31 * n42 - n11 * n33 * n42 - n12 * n31 * n43 + n11 * n32 * n43) * d;
  te[8] = t13 * d;
  te[9] = (n14 * n23 * n41 - n13 * n24 * n41 - n14 * n21 * n43 + n11 * n24 * n43 + n13 * n21 * n44 - n11 * n23 * n44) * d;
  te[10] = (n12 * n24 * n41 - n14 * n22 * n41 + n14 * n21 * n42 - n11 * n24 * n42 - n12 * n21 * n44 + n11 * n22 * n44) * d;
  te[11] = (n13 * n22 * n41 - n12 * n23 * n41 - n13 * n21 * n42 + n11 * n23 * n42 + n12 * n21 * n43 - n11 * n22 * n43) * d;
  te[12] = t14 * d;
  te[13] = (n13 * n24 * n31 - n14 * n23 * n31 + n14 * n21 * n33 - n11 * n24 * n33 - n13 * n21 * n34 + n11 * n23 * n34) * d;
  te[14] = (n14 * n22 * n31 - n12 * n24 * n31 - n14 * n21 * n32 + n11 * n24 * n32 + n12 * n21 * n34 - n11 * n22 * n34) * d;
  te[15] = (n12 * n23 * n31 - n13 * n22 * n31 + n13 * n21 * n32 - n11 * n23 * n32 - n12 * n21 * n33 + n11 * n22 * n33) * d;
  return true;
}

const IDENT16 = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

export function mat4IsIdentity(m, eps = EPS) {
  if (!m || m.length !== 16) return false;
  for (let i = 0; i < 16; i++) {
    if (Math.abs(m[i] - IDENT16[i]) > eps) return false;
  }
  return true;
}

function mat4NearlyEqual(a, b, eps = EPS) {
  for (let i = 0; i < 16; i++) {
    if (Math.abs(a[i] - b[i]) > eps) return false;
  }
  return true;
}


export function writeIdentityRow(out, off, boneCount) {
  for (let b = 0; b < boneCount; b++) {
    const o = off + b * 16;
    for (let i = 0; i < 16; i++) out[o + i] = IDENT16[i];
  }
}


export function paletteRowIsIdentity(out, off, boneCount, eps = 1e-5) {
  for (let b = 0; b < boneCount; b++) {
    const o = off + b * 16;
    for (let i = 0; i < 16; i++) {
      if (Math.abs(out[o + i] - IDENT16[i]) > eps) return false;
    }
  }
  return true;
}


function copy16(elementsLike) {
  const src = elementsLike && elementsLike.elements ? elementsLike.elements : elementsLike;
  if (!src || src.length !== 16) return null;
  const o = new Float64Array(16);
  for (let i = 0; i < 16; i++) o[i] = src[i];
  return o;
}


export function extractPosePaletteMeta(scene, opts = {}) {
  const maxBones = opts.maxBones == null ? MAX_PALETTE_BONES : opts.maxBones;
  try {
    if (!scene) return null;
    if (typeof scene.updateMatrixWorld === "function") {
      try { scene.updateMatrixWorld(true); } catch (_) {                          }
    }

    const meshNodes = [];
    const stack = [scene];
    let guard = 0;
    while (stack.length) {
      const node = stack.pop();
      guard += 1;
      if (guard > 8192) return null;                  
      if (node !== scene && node.isMesh) meshNodes.push(node);
      const kids = node.children;
      if (Array.isArray(kids)) for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
    }
    if (!meshNodes.length) return null;


    for (const node of meshNodes) {
      if (!node.isSkinnedMesh || !node.skeleton) return null;
      const geo = node.geometry;
      const getAttr = geo && typeof geo.getAttribute === "function" ? (n) => geo.getAttribute(n) : null;
      if (!getAttr || !getAttr("skinIndex") || !getAttr("skinWeight")) return null;
    }

    const skel = meshNodes[0].skeleton;
    const bones = skel.bones;
    if (!Array.isArray(bones) || bones.length === 0) return null;
    if (bones.length > maxBones) return null;
    for (const node of meshNodes) {
      const b2 = node.skeleton.bones;
      if (b2 === bones) continue;
      if (!Array.isArray(b2) || b2.length !== bones.length) return null;
      for (let i = 0; i < bones.length; i++) if (b2[i] !== bones[i]) return null;
    }
    const inverses = skel.boneInverses;
    if (!Array.isArray(inverses) || inverses.length !== bones.length) return null;

    const scratchA = new Float64Array(16);
    const scratchB = new Float64Array(16);
    let pre = null;
    let post = null;
    for (const node of meshNodes) {
      const nodeMW = copy16(node.matrixWorld);
      const bind = node.bindMatrix ? copy16(node.bindMatrix) : copy16(IDENT16);
      if (!nodeMW || !bind) return null;
      let bindInv = node.bindMatrixInverse ? copy16(node.bindMatrixInverse) : null;
      if (!bindInv) {
        bindInv = new Float64Array(16);
        if (!mat4Invert(bindInv, bind)) return null;
      }
      const nodeInv = new Float64Array(16);
      if (!mat4Invert(nodeInv, nodeMW)) return null;
      mat4Multiply(scratchA, nodeMW, bindInv);       
      mat4Multiply(scratchB, bind, nodeInv);        
      if (!pre) {
        pre = Float64Array.from(scratchA);
        post = Float64Array.from(scratchB);
      } else if (!mat4NearlyEqual(pre, scratchA) || !mat4NearlyEqual(post, scratchB)) {
        return null;                                                     
      }
    }


    const n = bones.length;
    const names = new Array(n);
    const parents = new Array(n);
    const rootPre = new Array(n);
    const restPos = new Float64Array(n * 3);
    const restQuat = new Float64Array(n * 4);
    const restScale = new Float64Array(n * 3);
    const invFlat = new Float64Array(n * 16);
    for (let i = 0; i < n; i++) {
      const b = bones[i];
      if (!b) return null;
      names[i] = typeof b.name === "string" ? b.name : "";
      const p = b.parent;
      let pi = -1;
      for (let j = 0; j < n; j++) {
        if (bones[j] === p) { pi = j; break; }
      }
      parents[i] = pi;
      rootPre[i] = pi === -1 && p && p.matrixWorld ? copy16(p.matrixWorld) : null;
      const pos = b.position || { x: 0, y: 0, z: 0 };
      const q = b.quaternion || { x: 0, y: 0, z: 0, w: 1 };
      const s = b.scale || { x: 1, y: 1, z: 1 };
      restPos[i * 3] = pos.x; restPos[i * 3 + 1] = pos.y; restPos[i * 3 + 2] = pos.z;
      restQuat[i * 4] = q.x; restQuat[i * 4 + 1] = q.y; restQuat[i * 4 + 2] = q.z; restQuat[i * 4 + 3] = q.w;
      restScale[i * 3] = s.x; restScale[i * 3 + 1] = s.y; restScale[i * 3 + 2] = s.z;
      const inv = copy16(inverses[i]);
      if (!inv) return null;
      invFlat.set(inv, i * 16);
    }

    const evalOrder = [];
    const placed = new Array(n).fill(false);
    for (let pass = 0; pass < n && evalOrder.length < n; pass++) {
      for (let i = 0; i < n; i++) {
        if (placed[i]) continue;
        const pi = parents[i];
        if (pi === -1 || placed[pi]) {
          placed[i] = true;
          evalOrder.push(i);
        }
      }
    }
    if (evalOrder.length !== n) return null;                    
    return {
      boneCount: n,
      texWidth: n * 4,
      names,
      parents,
      evalOrder,
      rootPre,
      restPos,
      restQuat,
      restScale,
      inverses: invFlat,
      pre,
      post,
      preIdentity: mat4IsIdentity(pre),
      postIdentity: mat4IsIdentity(post),
    };
  } catch (_) {
    return null;
  }
}


let scratchWorlds = new Float64Array(16 * 8);
const sLocal = new Float64Array(16);
const sTmp = new Float64Array(16);
const sQ = new Float64Array(4);
const sQe = new Float64Array(4);
const sQt = new Float64Array(4);


export function computePosePalette(meta, poseMap, out, off = 0) {
  if (!meta || !out) return false;
  const n = meta.boneCount;
  if (scratchWorlds.length < n * 16) scratchWorlds = new Float64Array(n * 16);
  const worlds = scratchWorlds;
  const get = poseMap && typeof poseMap.get === "function" ? (nm) => poseMap.get(nm) : () => null;
  for (let k = 0; k < n; k++) {
    const i = meta.evalOrder[k];
    const pose = get(meta.names[i]) || null;

    let qx = meta.restQuat[i * 4], qy = meta.restQuat[i * 4 + 1], qz = meta.restQuat[i * 4 + 2], qw = meta.restQuat[i * 4 + 3];
    let px = meta.restPos[i * 3], py = meta.restPos[i * 3 + 1], pz = meta.restPos[i * 3 + 2];
    if (pose) {
      px += pose.px || 0; py += pose.py || 0; pz += pose.pz || 0;
      sQ[0] = qx; sQ[1] = qy; sQ[2] = qz; sQ[3] = qw;
      if (pose.hasQuat) {
        sQt[0] = pose.qx; sQt[1] = pose.qy; sQt[2] = pose.qz; sQt[3] = pose.qw;
        quatMultiply(sQ, sQt, sQ);
      }
      if (pose.hasEuler) {
        quatFromEulerDegYXZ(sQe, pose.ex || 0, pose.ey || 0, pose.ez || 0);
        quatMultiply(sQ, sQe, sQ);
      }
      qx = sQ[0]; qy = sQ[1]; qz = sQ[2]; qw = sQ[3];
    }
    sQ[0] = qx; sQ[1] = qy; sQ[2] = qz; sQ[3] = qw;
    mat4Compose(sLocal, px, py, pz, sQ, meta.restScale[i * 3], meta.restScale[i * 3 + 1], meta.restScale[i * 3 + 2]);
    const pi = meta.parents[i];
    const wOff = i * 16;
    if (pi >= 0) {
      mat4Multiply(worlds.subarray(wOff, wOff + 16), worlds.subarray(pi * 16, pi * 16 + 16), sLocal);
    } else if (meta.rootPre[i]) {
      mat4Multiply(worlds.subarray(wOff, wOff + 16), meta.rootPre[i], sLocal);
    } else {
      worlds.set(sLocal, wOff);
    }
  }
  for (let i = 0; i < n; i++) {

    mat4Multiply(sTmp, worlds.subarray(i * 16, i * 16 + 16), meta.inverses.subarray(i * 16, i * 16 + 16));
    if (!meta.preIdentity) mat4Multiply(sTmp, meta.pre, sTmp);
    if (!meta.postIdentity) mat4Multiply(sTmp, sTmp, meta.post);
    const o = off + i * 16;
    for (let e = 0; e < 16; e++) out[o + e] = sTmp[e];
  }
  return true;
}


export const PALETTE_GLSL_DECL = [
  "uniform highp sampler2D rswPaletteTex;",
  "uniform highp vec2 rswPaletteDim;",
  "attribute highp float rswPaletteRow;",
  "attribute highp vec4 skinIndex;",
  "attribute highp vec4 skinWeight;",
  "mat4 rswPaletteBone(const in float bi) {",
  "  float y = (rswPaletteRow + 0.5) / rswPaletteDim.y;",
  "  float x0 = bi * 4.0;",
  "  vec4 v1 = texture2D(rswPaletteTex, vec2((x0 + 0.5) / rswPaletteDim.x, y));",
  "  vec4 v2 = texture2D(rswPaletteTex, vec2((x0 + 1.5) / rswPaletteDim.x, y));",
  "  vec4 v3 = texture2D(rswPaletteTex, vec2((x0 + 2.5) / rswPaletteDim.x, y));",
  "  vec4 v4 = texture2D(rswPaletteTex, vec2((x0 + 3.5) / rswPaletteDim.x, y));",
  "  return mat4(v1, v2, v3, v4);",
  "}",
].join("\n");


export const PALETTE_GLSL_MAT = [
  "mat4 rswSkinMat;",
  "{",
  "  float rswWsum = skinWeight.x + skinWeight.y + skinWeight.z + skinWeight.w;",
  "  if (rswWsum < 0.0001) { rswSkinMat = mat4(1.0); }",
  "  else {",
  "    rswSkinMat = skinWeight.x * rswPaletteBone(skinIndex.x);",
  "    rswSkinMat += skinWeight.y * rswPaletteBone(skinIndex.y);",
  "    rswSkinMat += skinWeight.z * rswPaletteBone(skinIndex.z);",
  "    rswSkinMat += skinWeight.w * rswPaletteBone(skinIndex.w);",
  "  }",
  "}",
].join("\n");

export const PALETTE_GLSL_APPLY_NORMAL = "objectNormal = (rswSkinMat * vec4(objectNormal, 0.0)).xyz;";
export const PALETTE_GLSL_APPLY_POS = "transformed = (rswSkinMat * vec4(transformed, 1.0)).xyz;";


export function injectPaletteShader(shader, uniforms) {
  if (!shader || typeof shader.vertexShader !== "string") return false;
  shader.uniforms = shader.uniforms || {};
  shader.uniforms.rswPaletteTex = uniforms.tex;
  shader.uniforms.rswPaletteDim = uniforms.dim;
  let vs = PALETTE_GLSL_DECL + "\n" + shader.vertexShader;
  const hasNormal = vs.includes("#include <beginnormal_vertex>");
  if (hasNormal) {
    vs = vs.replace(
      "#include <beginnormal_vertex>",
      "#include <beginnormal_vertex>\n" + PALETTE_GLSL_MAT + "\n" + PALETTE_GLSL_APPLY_NORMAL,
    );
    vs = vs.replace("#include <begin_vertex>", "#include <begin_vertex>\n" + PALETTE_GLSL_APPLY_POS);
  } else {

    vs = vs.replace("#include <begin_vertex>", "#include <begin_vertex>\n" + PALETTE_GLSL_MAT + "\n" + PALETTE_GLSL_APPLY_POS);
  }
  shader.vertexShader = vs;
  return true;
}


export function patchMaterialForPalette(material, uniforms) {
  if (!material) return false;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = function (shader, renderer) {
    if (typeof prev === "function") prev.call(this, shader, renderer);
    injectPaletteShader(shader, uniforms);
  };
  const prevKey = material.customProgramCacheKey;
  material.customProgramCacheKey = function () {
    const base = typeof prevKey === "function" ? String(prevKey.call(this)) : "";
    return base + "|rswPalette186";
  };
  material.needsUpdate = true;
  return true;
}
