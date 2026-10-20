export const SA_TILE = 256;                                 
export const SA_PAD = 4;                                             
export const SA_RES_LADDER = [256, 512, 1024];
export const SA_META_TEXELS = 6;                                                         
export const SA_ML_MAX = 128;                                                     
export const SA_META_TEX_W = SA_ML_MAX * SA_META_TEXELS;                         
export const SA_MAX_SLOTS = 64;                                            
export const SA_TOP_MAX = 8;                                                    
export const SA_DEFAULT_SAMPLES = 2;                                         
export const SA_DEFAULT_BIAS = 0.0015;                                          


export const SA_K_OFFSET = 0.7548776662466927;

function fract(x) { return x - Math.floor(x); }


export function saAtlasSizeFor(maxTextureSize, allow8k) {
  const m = Number(maxTextureSize) || 0;
  if (m < 2048) return 0;
  if (allow8k === true && m >= 8192) return 8192;
  if (m >= 4096) return 4096;
  return 2048;
}


export function saResFor(rank, count) {
  const r = Math.max(0, Math.floor(Number(rank) || 0));
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (n > 32) return 256;
  if (r === 0 && n <= 8) return 1024;
  if (r < 2) return 512;
  return 256;
}


export function saStepRes(prevRes, wantRes) {
  const lad = SA_RES_LADDER;


  let want = wantRes;
  if (lad.indexOf(want) < 0) {
    const w = Number(want) || 0;
    want = lad[0];
    for (let i = 0; i < lad.length; i++) {
      if (w >= lad[i]) want = lad[i];
    }
  }
  const pi = lad.indexOf(prevRes);
  if (pi < 0) return want;
  if (want === prevRes) return prevRes;
  return want > prevRes ? lad[Math.min(pi + 1, lad.length - 1)] : lad[Math.max(pi - 1, 0)];
}


export function createSaAllocator(atlasSize) {
  const size = Math.max(SA_TILE, Math.floor(Number(atlasSize) || 0));
  const tiles = Math.max(1, Math.floor(size / SA_TILE));
  const grid = new Uint8Array(tiles * tiles);                          
  const slots = new Map();                                          
  let stamp = 0;
  let evictions = 0;
  let fails = 0;

  function mark(s, v) {
    const tx0 = s.x / SA_TILE, ty0 = s.y / SA_TILE;
    for (let ty = ty0; ty < ty0 + s.span; ty++) {
      for (let tx = tx0; tx < tx0 + s.span; tx++) grid[ty * tiles + tx] = v;
    }
  }
  function fits(tx, ty, span) {
    for (let y = ty; y < ty + span; y++) {
      for (let x = tx; x < tx + span; x++) {
        if (grid[y * tiles + x]) return false;
      }
    }
    return true;
  }
  function findFree(span) {
    for (let ty = 0; ty + span <= tiles; ty += span) {
      for (let tx = 0; tx + span <= tiles; tx += span) {
        if (fits(tx, ty, span)) return { tx, ty };
      }
    }
    return null;
  }


  function plan(requests) {
    stamp++;


    const raw = Array.isArray(requests) ? requests : [];
    const want = new Map();
    const reqs = [];
    for (const r of raw) {
      if (!r || !r.id || want.has(r.id)) continue;
      want.set(r.id, r);
      reqs.push(r);
      if (reqs.length >= SA_MAX_SLOTS) break;
    }

    for (const [id, s] of slots) {
      if (!want.has(id)) { mark(s, 0); slots.delete(id); }
    }

    const placed = [];
    const pend = [];


    const placedIdx = new Map();
    for (const r of reqs) {
      if (!r || !r.id) continue;
      const s = slots.get(r.id);
      if (s && s.res === r.res) {
        s.rank = r.rank; s.stamp = stamp;
        placedIdx.set(r.id, placed.length);
        placed.push({ id: r.id, x: s.x, y: s.y, res: s.res, isNew: false });
      } else {
        if (s) { mark(s, 0); slots.delete(r.id); }                               
        pend.push(r);
      }
    }

    pend.sort((a, b) => (a.rank - b.rank) || String(a.id).localeCompare(String(b.id)));
    let planEvictions = 0;
    let planFails = 0;
    for (const r of pend) {
      let res = SA_RES_LADDER.indexOf(r.res) >= 0 ? r.res : 256;
      let got = null;


      for (let attempt = 0; attempt < SA_RES_LADDER.length && !got; attempt++) {
        const span = Math.max(1, Math.floor(res / SA_TILE));
        got = findFree(span);
        let guard = slots.size + 1;
        while (!got && guard-- > 0) {
          let worstId = null, worst = null;
          for (const [id, s] of slots) {
            if (s.rank > r.rank && (!worst || s.rank > worst.rank ||
              (s.rank === worst.rank && s.stamp < worst.stamp))) { worst = s; worstId = id; }
          }
          if (!worst) break;
          mark(worst, 0); slots.delete(worstId);


          const pIdx = placedIdx.get(worstId);
          if (pIdx !== undefined) { placed[pIdx] = null; placedIdx.delete(worstId); }
          evictions++; planEvictions++;
          got = findFree(span);
        }
        if (!got && res > 256) { res = res >> 1; continue; }
        break;
      }
      if (got) {
        const span = Math.max(1, Math.floor(res / SA_TILE));
        const s = { x: got.tx * SA_TILE, y: got.ty * SA_TILE, res, span, rank: r.rank, stamp };
        slots.set(r.id, s);
        mark(s, 1);
        placedIdx.set(r.id, placed.length);
        placed.push({ id: r.id, x: s.x, y: s.y, res, isNew: true });
      } else {
        fails++; planFails++;
      }
    }


    const placedOut = [];
    for (const p of placed) { if (p) placedOut.push(p); }
    return { placed: placedOut, evictions: planEvictions, fails: planFails };
  }

  function getSlot(id) { return slots.get(id) || null; }
  function stats() { return { slots: slots.size, tiles, evictions, fails }; }
  return { plan, getSlot, stats, size, tiles };
}


export function saSlotUv(x, y, res, atlasSize, pad) {
  const a = Math.max(1, Number(atlasSize) || 1);
  const p = Math.max(0, Number(pad) || 0);
  return {
    su: res / a,
    sv: res / a,
    ou: x / a,
    ov: y / a,
    minU: (x + p + 0.5) / a,
    minV: (y + p + 0.5) / a,
    maxU: (x + res - p - 0.5) / a,
    maxV: (y + res - p - 0.5) / a,
  };
}


export function saMul4(a, b, out) {
  const o = out || new Float64Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] =
        a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

export function saSpotViewProj(px, py, pz, dx, dy, dz, angle, range, near, out) {
  const o = out || new Float64Array(16);
  let fl = Math.hypot(dx, dy, dz);
  if (!(fl > 1e-6)) { dx = 0; dy = -1; dz = 0; fl = 1; }
  const fx = dx / fl, fy = dy / fl, fz = dz / fl;

  const zx = -fx, zy = -fy, zz = -fz;
  let ux = 0, uy = 1, uz = 0;
  if (Math.abs(fy) > 0.99) { ux = 0; uy = 0; uz = 1; }
  let xx = uy * zz - uz * zy, xy = uz * zx - ux * zz, xz = ux * zy - uy * zx;
  const xl = Math.hypot(xx, xy, xz) || 1;
  xx /= xl; xy /= xl; xz /= xl;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  const view = [
    xx, yx, zx, 0,
    xy, yy, zy, 0,
    xz, yz, zz, 0,
    -(xx * px + xy * py + xz * pz), -(yx * px + yy * py + yz * pz), -(zx * px + zy * py + zz * pz), 1,
  ];
  const n = Math.max(0.05, Number(near) || 0.5);
  const f = Math.max(n + 0.01, Number(range) || 1);
  const half = Math.min(Math.max(Number(angle) || 0.8, 0.05), 1.53);          
  const ct = 1 / Math.tan(half);
  const proj = [
    ct, 0, 0, 0,
    0, ct, 0, 0,
    0, 0, -(f + n) / (f - n), -1,
    0, 0, -2 * f * n / (f - n), 0,
  ];
  return saMul4(proj, view, o);
}


export function saProjectToSlot(m, wx, wy, wz) {
  const cx = m[0] * wx + m[4] * wy + m[8] * wz + m[12];
  const cy = m[1] * wx + m[5] * wy + m[9] * wz + m[13];
  const cz = m[2] * wx + m[6] * wy + m[10] * wz + m[14];
  const cw = m[3] * wx + m[7] * wy + m[11] * wz + m[15];
  if (cw <= 0) return null;
  const nx = cx / cw, ny = cy / cw, nz = cz / cw;
  if (Math.abs(nx) >= 1 || Math.abs(ny) >= 1 || nz >= 1 || nz <= -1) return null;
  return { u: nx * 0.5 + 0.5, v: ny * 0.5 + 0.5, depth01: nz * 0.5 + 0.5 };
}


export function saWriteMetaEntry(out, i, m, uv) {
  const base = i * SA_META_TEXELS * 4;
  for (let j = 0; j < 16; j++) out[base + j] = m[j];
  out[base + 16] = uv.su; out[base + 17] = uv.sv; out[base + 18] = uv.ou; out[base + 19] = uv.ov;
  out[base + 20] = uv.minU; out[base + 21] = uv.minV; out[base + 22] = uv.maxU; out[base + 23] = uv.maxV;
}
export function saClearMetaEntry(out, i) {
  const base = i * SA_META_TEXELS * 4;
  for (let j = 0; j < SA_META_TEXELS * 4; j++) out[base + j] = 0;
}
export function saPackMeta(entries, out) {
  const n = Math.min(Array.isArray(entries) ? entries.length : 0, SA_ML_MAX);
  for (let i = 0; i < SA_ML_MAX; i++) {
    const e = i < n ? entries[i] : null;
    if (e && e.m && e.uv) saWriteMetaEntry(out, i, e.m, e.uv);
    else saClearMetaEntry(out, i);
  }
  return out;
}


export function saReservoirK(weights, rnd0, kCount, golden, weightMin) {
  const K = Math.max(1, Math.min(4, Math.floor(Number(kCount)) || 1));
  const g = Number(golden) || 0;
  const wmin = Number(weightMin) > 0 ? Number(weightMin) : 0;
  const picks = [-1, -1, -1, -1];
  let wsum = 0;
  const n = Array.isArray(weights) || ArrayBuffer.isView(weights) ? weights.length : 0;
  for (let i = 0; i < n; i++) {
    const w = Number(weights[i]) || 0;
    if (w <= 0 || w < wmin) continue;
    wsum += w;
    for (let k = 0; k < K; k++) {
      const ri = fract(rnd0 + i * g + k * SA_K_OFFSET);
      if (ri * wsum <= w) picks[k] = i;
    }
  }
  return { wsum, picks };
}


export function saTintThrough(px, py, pz, lx, ly, lz, boxes, out) {
  const o = out || { r: 1, g: 1, b: 1 };
  o.r = 1; o.g = 1; o.b = 1;
  const n = Array.isArray(boxes) ? Math.min(boxes.length, 8) : 0;
  if (n === 0) return o;
  const rdx = lx - px, rdy = ly - py, rdz = lz - pz;
  const ix = 1 / (rdx >= 0 ? Math.max(rdx, 1e-5) : Math.min(rdx, -1e-5));
  const iy = 1 / (rdy >= 0 ? Math.max(rdy, 1e-5) : Math.min(rdy, -1e-5));
  const iz = 1 / (rdz >= 0 ? Math.max(rdz, 1e-5) : Math.min(rdz, -1e-5));
  for (let i = 0; i < n; i++) {
    const b = boxes[i];
    if (!b) continue;
    const tx0 = (b.minX - px) * ix, tx1 = (b.maxX - px) * ix;
    const ty0 = (b.minY - py) * iy, ty1 = (b.maxY - py) * iy;
    const tz0 = (b.minZ - pz) * iz, tz1 = (b.maxZ - pz) * iz;
    const tEnter = Math.max(Math.min(tx0, tx1), Math.min(ty0, ty1), Math.min(tz0, tz1));
    const tExit = Math.min(Math.max(tx0, tx1), Math.max(ty0, ty1), Math.max(tz0, tz1));
    if (tEnter < tExit && tExit > 0.02 && tEnter < 0.98) {
      o.r *= b.r; o.g *= b.g; o.b *= b.b;
    }
  }
  return o;
}


export function buildAtlasGlsl(metaTexW) {
  const W = String(Math.max(1, Math.floor(Number(metaTexW) || SA_META_TEX_W))) + ".0";
  return [
    "// ── F14: atlas físico (visibilidade REAL da luz sorteada) ──",
    "uniform sampler2D uAtlasTex;   // depth RGBA-packed (páginas dos spots)",
    "uniform sampler2D uAtlasMeta;  // 6 texels/luz: VP (4) + scale/offset + uvMin/Max",
    "uniform float uAtlasOn;        // 0 = caminho atual (SSCS), 1 = validação no atlas",
    "uniform float uAtlasBias;      // bias do compare (z clip 0..1)",
    "uniform float uAtlasTexel;     // 1/atlasSize (passo do PCF 4 taps)",
    "uniform float uSamplesK;       // K amostras/pixel do reservoir (1..4)",
    "uniform float uTopCount;       // top-N determinístico (0..8; prefixo com slot)",
    "uniform mat4 uCamWorld;        // view→mundo (meta/caixas ficam em MUNDO)",
    "uniform int uTransCount;       // caixas de transmissores (Fase 9) 0..8",
    "uniform vec4 uTransMin[8];",
    "uniform vec4 uTransMax[8];",
    "uniform vec4 uTransTint[8];",
    "const float RSW_SA_META_W = " + W + ";",
    "vec4 rswSaMeta(const in float li, const in float t) {",
    "  return texture2D(uAtlasMeta, vec2((li*6.0 + t + 0.5)/RSW_SA_META_W, 0.5));",
    "}",
    "// Visibilidade no atlas: 1=iluminado, 0=bloqueado; -1 = SEM slot (SSCS).",
    "float rswSaVis(const in float li, const in vec3 P) {",
    "  vec4 t4 = rswSaMeta(li, 4.0);",
    "  if (t4.x <= 0.0) return -1.0;",
    "  vec4 Pw = uCamWorld * vec4(P, 1.0);",
    "  mat4 M = mat4(rswSaMeta(li, 0.0), rswSaMeta(li, 1.0), rswSaMeta(li, 2.0), rswSaMeta(li, 3.0));",
    "  vec4 clip = M * vec4(Pw.xyz, 1.0);",
    "  if (clip.w <= 0.0) return 1.0;",
    "  vec3 ndc = clip.xyz / clip.w;",
    "  if (abs(ndc.x) >= 1.0 || abs(ndc.y) >= 1.0 || ndc.z >= 1.0 || ndc.z <= -1.0) return 1.0;",
    "  vec4 t5 = rswSaMeta(li, 5.0);",
    "  vec2 suv = (ndc.xy * 0.5 + 0.5) * t4.xy + t4.zw;",
    "  float ref = ndc.z * 0.5 + 0.5 - uAtlasBias;",
    "  float vis = 0.0;",
    "  vis += step(ref, rswUnpack(texture2D(uAtlasTex, clamp(suv + vec2(-uAtlasTexel, -uAtlasTexel), t5.xy, t5.zw))));",
    "  vis += step(ref, rswUnpack(texture2D(uAtlasTex, clamp(suv + vec2( uAtlasTexel, -uAtlasTexel), t5.xy, t5.zw))));",
    "  vis += step(ref, rswUnpack(texture2D(uAtlasTex, clamp(suv + vec2(-uAtlasTexel,  uAtlasTexel), t5.xy, t5.zw))));",
    "  vis += step(ref, rswUnpack(texture2D(uAtlasTex, clamp(suv + vec2( uAtlasTexel,  uAtlasTexel), t5.xy, t5.zw))));",
    "  return vis * 0.25;",
    "}",
    "// Fase 9 no atlas: tinte de transmissores no raio pixel→luz (slab AABB).",
    "vec3 rswSaTint(const in vec3 P, const in vec3 L) {",
    "  vec3 tint = vec3(1.0);",
    "  if (uTransCount <= 0) return tint;",
    "  vec3 ro = (uCamWorld * vec4(P, 1.0)).xyz;",
    "  vec3 rd = (uCamWorld * vec4(L, 1.0)).xyz - ro;",
    "  vec3 inv = vec3(",
    "    1.0 / (rd.x >= 0.0 ? max(rd.x, 1e-5) : min(rd.x, -1e-5)),",
    "    1.0 / (rd.y >= 0.0 ? max(rd.y, 1e-5) : min(rd.y, -1e-5)),",
    "    1.0 / (rd.z >= 0.0 ? max(rd.z, 1e-5) : min(rd.z, -1e-5)));",
    "  for (int b = 0; b < 8; b++) {",
    "    if (b >= uTransCount) break;",
    "    vec3 tA = (uTransMin[b].xyz - ro) * inv;",
    "    vec3 tB = (uTransMax[b].xyz - ro) * inv;",
    "    vec3 tLo = min(tA, tB);",
    "    vec3 tHi = max(tA, tB);",
    "    float tEnter = max(tLo.x, max(tLo.y, tLo.z));",
    "    float tExit = min(tHi.x, min(tHi.y, tHi.z));",
    "    if (tEnter < tExit && tExit > 0.02 && tEnter < 0.98) tint *= uTransTint[b].rgb;",
    "  }",
    "  return tint;",
    "}",
  ].join("\n");
}
