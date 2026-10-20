import { LOOK_SETTINGS_KEY, MAX_ACTIVE_LOOKS, resolveLookBlend } from "./lookBlend.js";
import { resolveLookInput } from "./lookInput.js";
import { createLookOutput } from "./lookOutput.js";
import { createLutOutputLeases } from "./lutOutputLeases.js";
import { createLutTextureCache } from "./lutTextureCache.js";
import { createLutFragmentShader } from "./lutShader.js";
import { LUT_PHASE_ID, LUT_STATE_RESOURCE, LUT_COLOR_RESOURCE } from "./lutPhaseContract.js";

export function createLutRuntime(services) {
  const { rendererAdapter: adapter, pool, settings } = services;
  if (!adapter?.capabilities?.webgl2 || !adapter.capabilities.floatColorBuffer || adapter.capabilities.maxTextureUnits < MAX_ACTIVE_LOOKS + 1) throw new Error("CP-F13 requires WebGL2, float color targets and five fragment texture units");
  const cache = createLutTextureCache(adapter);
  const materials = new Map();
  const outputLeases = createLutOutputLeases();
  let lastConfiguration = Symbol("unconfigured");
  let plan;
  let activeRecords;
  let disposed = false;
  let submittedDraws = 0;
  let configurationChanges = 0;
  let contextLosses = 0;
  const graphicsEventSource = adapter.context.canvas ?? adapter.renderer?.domElement;

  function releaseGpuResources() {
    outputLeases.clear();
    for (const material of materials.values()) material.dispose();
    materials.clear();
    cache.clear();
    pool.releaseOwner(LUT_PHASE_ID);
    lastConfiguration = Symbol("gpu-resources-released");
    plan = undefined;
    activeRecords = undefined;
  }

  function handleContextLoss() {
    if (disposed) return;
    contextLosses += 1;
    releaseGpuResources();
  }
  graphicsEventSource?.addEventListener?.("webglcontextlost", handleContextLoss);

  function materialFor(backend) {
    if (materials.has(backend)) return materials.get(backend);
    const { THREE } = adapter;
    const uniforms = {
      uSource: { value: null }, uWeights: { value: new THREE.Vector4() }, uIntensity: { value: 0 },
      uInputScale: { value: 1 }, uOutputScale: { value: 1 }, uActiveLooks: { value: 0 }, uChangesEncoding: { value: 0 }
    };
    for (let slot = 0; slot < MAX_ACTIVE_LOOKS; slot += 1) {
      uniforms[`uLut${slot}`] = { value: null };
      uniforms[`uDomainMin${slot}`] = { value: new THREE.Vector3(0, 0, 0) };
      uniforms[`uDomainMax${slot}`] = { value: new THREE.Vector3(1, 1, 1) };
      uniforms[`uLayout${slot}`] = { value: new THREE.Vector3(1, 1, 1) };
      uniforms[`uSize${slot}`] = { value: 2 };
      uniforms[`uInterpolation${slot}`] = { value: 0 };
      uniforms[`uClamp${slot}`] = { value: 0 };
    }
    const material = adapter.createMaterial(createLutFragmentShader(backend), uniforms);
    material.name = `${LUT_PHASE_ID}.${backend}`;
    materials.set(backend, material);
    return material;
  }

  function snapshot() {
    return { phase: LUT_PHASE_ID, disposed, submittedDraws, configurationChanges, contextLosses, materialVariants: materials.size, cache: cache.stats(), activeLooks: plan?.looks.map(({ look, weight }) => ({ id: look.id, weight, kind: look.kind, interpolation: look.interpolation, boundary: look.boundary, provenance: look.provenance })) ?? [] };
  }

  return Object.freeze({
    prepare(frame) {
      if (disposed) throw new Error("CP-F13 runtime is disposed");
      if (adapter.context.isContextLost?.()) throw new Error("CP-F13 WebGL context is lost");
      const configuration = settings.get(LOOK_SETTINGS_KEY);
      if (!Object.is(configuration, lastConfiguration)) {
        const nextPlan = resolveLookBlend(configuration);
        const nextRecords = cache.acquire(nextPlan.looks.map(({ look }) => look), nextPlan.backend);
        plan = nextPlan;
        activeRecords = nextRecords;
        lastConfiguration = configuration;
        configurationChanges += 1;
      }
      return Object.freeze({ value: Object.freeze({ plan, records: activeRecords }), frameId: frame.frameId, viewId: frame.viewId, generation: frame.generation, provenance: "gpu" });
    },
    render(context) {
      if (disposed) throw new Error("CP-F13 runtime is disposed");
      const input = context.read("$color");
      const state = context.read(LUT_STATE_RESOURCE).value;
      const current = state.plan;
      if (context.frame.referenceMode) throw new Error("CP-F13 BLOCKED_REFERENCE: no verified UE5.9 LUT reference");
      if (adapter.context.isContextLost?.()) throw new Error("CP-F13 WebGL context is lost");
      const transport = resolveLookInput(current, input);
      const target = pool.acquire(LUT_PHASE_ID, `${LUT_COLOR_RESOURCE}.${context.frame.viewId}`, { width: input.width, height: input.height, format: "rgba16f", filter: "nearest" });
      if (target.texture === input.texture) throw new Error("CP-F13 rejects read/write texture feedback before GPU submission");
      const material = materialFor(current.backend);
      const uniforms = material.uniforms;
      uniforms.uSource.value = input.texture;
      uniforms.uIntensity.value = current.intensity;
      uniforms.uActiveLooks.value = current.looks.length;
      uniforms.uChangesEncoding.value = current.changesEncoding ? 1 : 0;
      uniforms.uInputScale.value = transport.inputScale;
      uniforms.uOutputScale.value = transport.outputScale;
      uniforms.uWeights.value.set(0, 0, 0, 0);
      for (let slot = 0; slot < MAX_ACTIVE_LOOKS; slot += 1) {
        const entry = current.looks[slot];
        const record = state.records[slot];
        uniforms[`uLut${slot}`].value = record?.texture ?? null;
        if (!entry) continue;
        uniforms.uWeights.value.setComponent(slot, entry.weight);
        uniforms[`uDomainMin${slot}`].value.fromArray(entry.look.table.domainMin);
        uniforms[`uDomainMax${slot}`].value.fromArray(entry.look.table.domainMax);
        uniforms[`uLayout${slot}`].value.set(record.layout.columns, record.layout.width, record.layout.height);
        uniforms[`uSize${slot}`].value = entry.look.table.size;
        uniforms[`uInterpolation${slot}`].value = entry.look.interpolation === "tetrahedral" ? 1 : 0;
        uniforms[`uClamp${slot}`].value = entry.look.boundary === "clamp" ? 1 : 0;
      }
      const lease = outputLeases.begin(context.frame.viewId, target);
      adapter.draw(material, target);
      lease.commit();
      submittedDraws += 1;
      const color = createLookOutput(input, target, context.frame, current, transport, lease.isAlive);
      context.publish(LUT_COLOR_RESOURCE, color);
      return { color };
    },
    snapshot,
    dispose() {
      if (disposed) return;
      disposed = true;
      graphicsEventSource?.removeEventListener?.("webglcontextlost", handleContextLoss);
      releaseGpuResources();
      cache.dispose();
    }
  });
}
