import {
  RT_SHADOWS_VERSION,
  buildBvh,
  refitBvh,
  packBvhForGpu,
  buildShadowWgsl,
  traceShadowSun,
  traceShadowPoint,
} from "../lighting/bvhCore.js";
import { buildSpatialWgsl } from "../lighting/rtParityCore.js";

export const RT_BACKEND_CPU = "cpu";
export const RT_BACKEND_WEBGPU = "webgpu";

function num(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

let probeCache = null;


export function probeWebGpu(env) {
  if (!env && probeCache) return probeCache;
  const gpu = env && "gpu" in env ? env.gpu : (globalThis.navigator && globalThis.navigator.gpu) || null;
  const promise = (async () => {
    if (!gpu || typeof gpu.requestAdapter !== "function") {
      return { available: false, reason: "navigator.gpu ausente (WebGPU nao suportado neste navegador)" };
    }
    try {
      const adapter = await gpu.requestAdapter();
      if (!adapter) return { available: false, reason: "requestAdapter devolveu null (GPU bloqueada?)" };
      let info = null;
      try {
        info = adapter.info
          ? { vendor: String(adapter.info.vendor || ""), architecture: String(adapter.info.architecture || "") }
          : null;
      } catch (_err) {
        info = null;
      }
      return { available: true, adapter, adapterInfo: info };
    } catch (err) {
      return { available: false, reason: "requestAdapter falhou: " + (err && err.message ? err.message : String(err)) };
    }
  })();
  if (!env) probeCache = promise;
  return promise;
}

export function resetWebGpuProbeCache() {
  probeCache = null;
}

function readVec3(v, def) {
  if (Array.isArray(v) || (v && ArrayBuffer.isView(v))) {
    return [num(v[0], def), num(v[1], def), num(v[2], def)];
  }
  if (v && typeof v === "object") {
    return [num(v.x, def), num(v.y, def), num(v.z, def)];
  }
  return [def, def, def];
}


const BOX_QUADS = [
  [0, 1, 3, 2, 0, 0, -1],      
  [4, 6, 7, 5, 0, 0, 1],      
  [0, 4, 5, 1, 0, -1, 0],      
  [2, 3, 7, 6, 0, 1, 0],      
  [0, 2, 6, 4, -1, 0, 0],      
  [1, 5, 7, 3, 1, 0, 0],      
];


export function collectPartTriangles(parts) {
  const list = Array.isArray(parts) ? parts : [];
  const out = new Float32Array(list.length * 12 * 9);
  let w = 0;
  for (const part of list) {
    if (!part) continue;
    const p = readVec3(part.position, 0);
    const s = readVec3(part.size, 1);
    const hx = Math.max(Math.abs(s[0]) * 0.5, 1e-4);
    const hy = Math.max(Math.abs(s[1]) * 0.5, 1e-4);
    const hz = Math.max(Math.abs(s[2]) * 0.5, 1e-4);
    const r = Array.isArray(part.rotation) && part.rotation.length === 9 ? part.rotation.map((x) => num(x, 0)) : null;
    const corners = new Float64Array(24);
    for (let c = 0; c < 8; c++) {
      const lx = (c & 1 ? 1 : -1) * hx;
      const ly = (c & 2 ? 1 : -1) * hy;
      const lz = (c & 4 ? 1 : -1) * hz;
      let wx = lx;
      let wy = ly;
      let wz = lz;
      if (r) {
        wx = r[0] * lx + r[1] * ly + r[2] * lz;
        wy = r[3] * lx + r[4] * ly + r[5] * lz;
        wz = r[6] * lx + r[7] * ly + r[8] * lz;
      }
      corners[c * 3] = p[0] + wx;
      corners[c * 3 + 1] = p[1] + wy;
      corners[c * 3 + 2] = p[2] + wz;
    }
    for (const quad of BOX_QUADS) {
      const [a, b, c, d] = quad;
      for (const tri of [
        [a, b, c],
        [a, c, d],
      ]) {
        for (const vi of tri) {
          out[w++] = corners[vi * 3];
          out[w++] = corners[vi * 3 + 1];
          out[w++] = corners[vi * 3 + 2];
        }
      }
    }
  }
  return out.subarray(0, w).slice();
}

const GPU_MAP_READ = (globalThis.GPUMapMode && globalThis.GPUMapMode.READ) || 1;
const GPU_TMAX = 3.0e38;                            


export function createRtShadows(opts) {
  const o = opts || {};
  const maxTris = num(o.maxTris, undefined);
  let bvh = null;
  let gpu = null;                                                       
  let gpuDirty = true;
  const stats = {
    version: RT_SHADOWS_VERSION,
    backend: RT_BACKEND_CPU,
    triCount: 0,
    nodeCount: 0,
    buildMs: 0,
    lastTraceMs: 0,
    gpuReady: false,
    spatialReady: false,
    lastError: null,
  };

  function setTriangles(triangles) {
    const t0 = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
    bvh = buildBvh(triangles, maxTris ? { maxTris } : undefined);
    const t1 = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
    stats.buildMs = t1 - t0;
    stats.triCount = bvh.triCount;
    stats.nodeCount = bvh.nodeCount;
    gpuDirty = true;
    return bvh;
  }

  function setParts(parts) {
    return setTriangles(collectPartTriangles(parts));
  }

  function refit(triangles) {
    if (!bvh) return null;
    refitBvh(bvh, triangles);
    gpuDirty = true;
    return bvh;
  }

  function sunVisibility(point, sunDir, sampleOpts) {
    return traceShadowSun(bvh, point, sunDir, sampleOpts);
  }

  function pointVisibility(point, lightPos, sampleOpts) {
    return traceShadowPoint(bvh, point, lightPos, sampleOpts);
  }


  function traceSunBatchCpu(originsF32, sunDir, sampleOpts) {
    const rayCount = Math.floor((originsF32 ? originsF32.length : 0) / 4);
    const outVis = new Float32Array(rayCount);
    const so = sampleOpts || {};
    const t0 = Date.now();
    for (let i = 0; i < rayCount; i++) {
      outVis[i] = traceShadowSun(bvh, [originsF32[i * 4], originsF32[i * 4 + 1], originsF32[i * 4 + 2]], sunDir, {
        tanHalfAngle: so.tanHalfAngle,
        samples: so.samples,
        frame: so.frame,
        tMin: so.tMin,
        px: i % 4096,
        py: Math.floor(i / 4096),
      });
    }
    stats.lastTraceMs = Date.now() - t0;
    return outVis;
  }


  async function initGpu(env) {
    if (gpu) return true;
    const probe = await probeWebGpu(env);
    if (!probe.available || !probe.adapter) {
      stats.lastError = probe.reason || "WebGPU indisponivel";
      return false;
    }
    try {
      const device = await probe.adapter.requestDevice();
      const module = device.createShaderModule({ code: buildShadowWgsl() });
      const pipeline = device.createComputePipeline({
        layout: "auto",
        compute: { module, entryPoint: "rswRtShadow" },
      });


      let spatial = null;
      try {
        const spatialModule = device.createShaderModule({ code: buildSpatialWgsl() });
        spatial = device.createComputePipeline({
          layout: "auto",
          compute: { module: spatialModule, entryPoint: "rswRtSpatial" },
        });
      } catch (err) {
        stats.lastError = "spatial pipeline: " + (err && err.message ? err.message : String(err));
      }
      gpu = { device, pipeline, spatial, nodesBuf: null, trisBuf: null };
      stats.spatialReady = spatial !== null;
      stats.gpuReady = true;
      stats.backend = RT_BACKEND_WEBGPU;
      return true;
    } catch (err) {
      stats.lastError = "initGpu falhou: " + (err && err.message ? err.message : String(err));
      gpu = null;
      stats.gpuReady = false;
      stats.backend = RT_BACKEND_CPU;
      return false;
    }
  }

  function uploadBvhToGpu() {
    const packed = packBvhForGpu(bvh);
    const device = gpu.device;
    if (gpu.nodesBuf) gpu.nodesBuf.destroy();
    if (gpu.trisBuf) gpu.trisBuf.destroy();


    const usage = 0x80 | 0x8;
    gpu.nodesBuf = device.createBuffer({ size: Math.max(packed.nodesF32.byteLength, 16), usage });
    gpu.trisBuf = device.createBuffer({ size: Math.max(packed.trisF32.byteLength, 16), usage });
    device.queue.writeBuffer(gpu.nodesBuf, 0, packed.nodesF32);
    device.queue.writeBuffer(gpu.trisBuf, 0, packed.trisF32);
    gpuDirty = false;
  }


  async function traceSunBatchGpu(originsF32, sunDir, sampleOpts) {
    if (!gpu || !bvh || !bvh.nodeCount) return null;
    let raysBuf = null, outBuf = null, readBuf = null, uniBuf = null;
    try {
      const so = sampleOpts || {};
      const rayCount = Math.floor(originsF32.length / 4);
      if (rayCount === 0) return new Float32Array(0);
      if (gpuDirty) uploadBvhToGpu();
      const device = gpu.device;
      raysBuf = device.createBuffer({ size: originsF32.byteLength, usage: 0x80 | 0x8 });
      device.queue.writeBuffer(raysBuf, 0, originsF32);
      outBuf = device.createBuffer({ size: rayCount * 4, usage: 0x80 | 0x4 });                      
      readBuf = device.createBuffer({ size: rayCount * 4, usage: 0x8 | 0x1 });                       
      const uni = new ArrayBuffer(48);
      const uf = new Float32Array(uni);
      const uu = new Uint32Array(uni);
      const sd = readVec3(sunDir, 0);
      uf[0] = sd[0];
      uf[1] = sd[1];
      uf[2] = sd[2];
      uf[3] = num(so.tanHalfAngle, 0);
      uu[4] = rayCount >>> 0;
      uu[5] = Math.max(1, Math.min(16, Math.round(num(so.samples, 1)))) >>> 0;
      uu[6] = ((Math.floor(num(so.frame, 0)) % 4294967295) + 4294967295) % 4294967295 >>> 0;
      uu[7] = bvh.nodeCount >>> 0;                                                                     
      uf[8] = Math.max(1e-6, num(so.tMin, 1e-3));
      uf[9] = GPU_TMAX;
      uniBuf = device.createBuffer({ size: 48, usage: 0x40 | 0x8 });                      
      device.queue.writeBuffer(uniBuf, 0, uni);
      const bind = device.createBindGroup({
        layout: gpu.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: gpu.nodesBuf } },
          { binding: 1, resource: { buffer: gpu.trisBuf } },
          { binding: 2, resource: { buffer: raysBuf } },
          { binding: 3, resource: { buffer: outBuf } },
          { binding: 4, resource: { buffer: uniBuf } },
        ],
      });
      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(gpu.pipeline);
      pass.setBindGroup(0, bind);
      pass.dispatchWorkgroups(Math.ceil(rayCount / 64));
      pass.end();
      enc.copyBufferToBuffer(outBuf, 0, readBuf, 0, rayCount * 4);
      device.queue.submit([enc.finish()]);
      await readBuf.mapAsync(GPU_MAP_READ);
      const result = new Float32Array(readBuf.getMappedRange().slice(0));
      readBuf.unmap();
      return result;
    } catch (err) {
      stats.lastError = "traceSunBatchGpu falhou: " + (err && err.message ? err.message : String(err));
      return null;
    } finally {

      if (raysBuf) try { raysBuf.destroy(); } catch (_) {}
      if (outBuf)  try { outBuf.destroy();  } catch (_) {}
      if (readBuf) try { readBuf.destroy(); } catch (_) {}
      if (uniBuf)  try { uniBuf.destroy();  } catch (_) {}
    }
  }


  async function denoiseSpatialGpu(visF32, originsF32, w, h, opts) {
    if (!gpu || !gpu.spatial) return null;
    const W = Math.max(0, Math.floor(num(w, 0)));
    const H = Math.max(0, Math.floor(num(h, 0)));
    const total = W * H;
    if (!visF32 || !originsF32 || visF32.length !== total || originsF32.length !== total * 4) return null;
    if (total === 0) return new Float32Array(0);
    let visBuf = null, orgBuf = null, outBuf = null, readBuf = null, uniBuf = null;
    try {
      const o = opts || {};
      const device = gpu.device;
      visBuf = device.createBuffer({ size: visF32.byteLength, usage: 0x80 | 0x8 });
      device.queue.writeBuffer(visBuf, 0, visF32);
      orgBuf = device.createBuffer({ size: originsF32.byteLength, usage: 0x80 | 0x8 });
      device.queue.writeBuffer(orgBuf, 0, originsF32);
      outBuf = device.createBuffer({ size: visF32.byteLength, usage: 0x80 | 0x4 });
      readBuf = device.createBuffer({ size: visF32.byteLength, usage: 0x8 | 0x1 });
      const uni = new ArrayBuffer(48);
      const uf = new Float32Array(uni);
      const uu = new Uint32Array(uni);
      uu[0] = W >>> 0;
      uu[1] = H >>> 0;
      uu[2] = Math.max(1, Math.min(3, Math.round(num(o.radius, 2)))) >>> 0;
      uu[3] = 0;
      const cam = readVec3(o.camPos, 0);
      uf[4] = cam[0];
      uf[5] = cam[1];
      uf[6] = cam[2];
      uf[7] = Math.max(1e-6, num(o.worldPerTexel, 0.002));
      uf[8] = Math.max(1e-3, num(o.sigmaFloor, 0.08));
      uf[9] = Math.max(0, num(o.varEps, 1e-4));
      uniBuf = device.createBuffer({ size: 48, usage: 0x40 | 0x8 });
      device.queue.writeBuffer(uniBuf, 0, uni);
      const bind = device.createBindGroup({
        layout: gpu.spatial.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: visBuf } },
          { binding: 1, resource: { buffer: orgBuf } },
          { binding: 2, resource: { buffer: outBuf } },
          { binding: 3, resource: { buffer: uniBuf } },
        ],
      });
      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(gpu.spatial);
      pass.setBindGroup(0, bind);
      pass.dispatchWorkgroups(Math.ceil(total / 64));
      pass.end();
      enc.copyBufferToBuffer(outBuf, 0, readBuf, 0, visF32.byteLength);
      device.queue.submit([enc.finish()]);
      await readBuf.mapAsync(GPU_MAP_READ);
      const result = new Float32Array(readBuf.getMappedRange().slice(0));
      readBuf.unmap();
      return result;
    } catch (err) {
      stats.lastError = "denoiseSpatialGpu falhou: " + (err && err.message ? err.message : String(err));
      return null;
    } finally {
      if (visBuf) try { visBuf.destroy(); } catch (_) {}
      if (orgBuf) try { orgBuf.destroy(); } catch (_) {}
      if (outBuf) try { outBuf.destroy(); } catch (_) {}
      if (readBuf) try { readBuf.destroy(); } catch (_) {}
      if (uniBuf) try { uniBuf.destroy(); } catch (_) {}
    }
  }

  function getStats() {
    return { ...stats };
  }

  function dispose() {
    if (gpu) {
      try {
        if (gpu.nodesBuf) gpu.nodesBuf.destroy();
        if (gpu.trisBuf) gpu.trisBuf.destroy();
        if (gpu.device && gpu.device.destroy) gpu.device.destroy();
      } catch (_err) {

      }
      gpu = null;
    }
    bvh = null;
    stats.gpuReady = false;
    stats.spatialReady = false;
    stats.backend = RT_BACKEND_CPU;
  }

  return {
    setTriangles,
    setParts,
    refit,
    sunVisibility,
    pointVisibility,
    traceSunBatchCpu,
    traceSunBatchGpu,
    denoiseSpatialGpu,
    initGpu,
    getStats,
    dispose,
    getBvh: () => bvh,
  };
}
