import {
  DEBUG_BUFFER_MODES,
  DEBUG_PHASES,
  DEBUG_LIMITATIONS,
} from "./megaLightsDebugCatalog.js";
import { listPhases, phaseInstallation } from "../mlPhaseRegistry.js";
import { mlQa } from "../runtime/megaLightsTelemetry.js";
import {
  listPatches,
  listUniforms,
} from "../runtime/megaLightsPatchRegistry.js";
import { MGL_UNIFORMS } from "../mlUniformNames.js";
import { summarizeDebugValue } from "./megaLightsDebugCore.js";
import { resolveDebugSource } from "./megaLightsDebugSources.js";

export function inspectMegaLightsPrograms(renderer) {
  const context = renderer.getContext();
  const parallelCompilation = renderer.extensions.has(
    "KHR_parallel_shader_compile",
  )
    ? renderer.extensions.get("KHR_parallel_shader_compile")
    : null;
  return (renderer.info.programs || []).slice(0, 80).map((program) => {
    try {
      if (
        parallelCompilation &&
        !context.getProgramParameter(
          program.program,
          parallelCompilation.COMPLETION_STATUS_KHR,
        )
      )
        return {
          id: program.id,
          name: program.name,
          linked: null,
          state: "compiling",
        };
      const linked = !!context.getProgramParameter(
        program.program,
        context.LINK_STATUS,
      );
      const uniforms = [];
      const count = linked
        ? context.getProgramParameter(program.program, context.ACTIVE_UNIFORMS)
        : 0;
      for (let index = 0; index < Math.min(count, 300); index += 1) {
        const uniform = context.getActiveUniform(program.program, index);
        if (uniform?.name.startsWith("uMgl"))
          uniforms.push({
            name: uniform.name,
            type: uniform.type,
            size: uniform.size,
          });
      }
      return {
        id: program.id,
        name: program.name,
        linked,
        activeMegaLightsUniforms: uniforms,
        shaderDiagnostics: linked
          ? []
          : (context.getAttachedShaders(program.program) || []).map(
              (shader) => ({
                type: context.getShaderParameter(shader, context.SHADER_TYPE),
                compiled: context.getShaderParameter(
                  shader,
                  context.COMPILE_STATUS,
                ),
                log: context.getShaderInfoLog(shader)?.slice(0, 6000),
              }),
            ),
        log: linked ? "" : context.getProgramInfoLog(program.program),
      };
    } catch (error) {
      return { id: program.id, error: String(error?.message || error) };
    }
  });
}

function inspectInstallation(result) {
  try {
    const inspection =
      result?.inspect?.() ||
      result?.pass?.inspect?.() ||
      result?.sceneInputs?.inspect?.() ||
      result?.stage?.inspect?.() ||
      result?.runtime?.report?.();
    return summarizeDebugValue(inspection || result);
  } catch (error) {
    return { inspectionError: String(error?.message || error) };
  }
}

export function inspectMegaLightsFrame({
  packet,
  pipeline,
  renderer,
  overrides,
  history,
  frozen,
  capture,
  readbacks,
  captureCost,
  errors,
  programReport,
}) {
  const snapshot = pipeline.snapshot();
  const telemetry = mlQa.get();
  const context = packet?.frameContext || null;
  const phaseStates = listPhases();
  const buffers = DEBUG_BUFFER_MODES.map((mode) => {
    try {
      const source = resolveDebugSource(mode.id, context, packet?.host);
      return {
        ...mode,
        available: source.available,
        reason: source.reason,
        origin: source.origin,
        width: source.width,
        height: source.height,
        backend: source.backend,
        producerFrame: source.producerFrame ?? null,
        inputFrame: source.inputFrame ?? null,
        observedFrame: context?.frameIndex ?? null,
      };
    } catch (error) {
      return {
        ...mode,
        available: false,
        reason: String(error?.message || error),
      };
    }
  });
  const executedPasses = packet?.report?.ran
    ? telemetry.passGraph.executed
    : [];
  const passes = snapshot.passes.map((pass) => ({
    ...pass,
    execution: executedPasses.includes(pass.passName)
      ? "invoked this frame"
      : "not invoked this frame",
    outputStatus: pass.disabledByError
      ? "failed"
      : buffers.some(
            (buffer) => buffer.owner === pass.expectedOwner && buffer.available,
          )
        ? "ready"
        : "missing",
  }));
  const phases = DEBUG_PHASES.map((phase) => {
    const state = phaseStates.find((entry) => entry.id === phase.id);
    const ownedPasses = passes.filter(
      (pass) => pass.expectedOwner === phase.id,
    );
    const phaseTelemetry = Object.fromEntries(
      Object.entries(telemetry.phases).filter(
        ([key]) => key === phase.id || key.startsWith(phase.id + ":"),
      ),
    );
    return {
      ...phase,
      status: state?.status || "pending",
      installation: state?.installation || "unavailable",
      detail: state?.detail,
      outputStatus: ownedPasses.some((pass) => pass.disabledByError)
        ? "failed"
        : buffers.some(
              (buffer) => buffer.owner === phase.id && buffer.available,
            )
          ? "ready"
          : phase.modes.length
            ? "missing"
            : "non-image",
      executed: ownedPasses
        .filter((pass) => executedPasses.includes(pass.passName))
        .map((pass) => pass.passName),
      installationResult: inspectInstallation(phaseInstallation(phase.id)),
      telemetry: phaseTelemetry,
      outputs: summarizeDebugValue(
        Object.fromEntries(
          Object.entries(context || {}).filter(
            ([, value]) => value?.owner === phase.id,
          ),
        ),
      ),
      imageProof: "not certified",
    };
  });
  const gl = renderer.getContext();
  const capabilities = {
    webgl2: renderer.capabilities.isWebGL2,
    contextLost: gl.isContextLost(),
    maxDrawBuffers: gl.getParameter(gl.MAX_DRAW_BUFFERS),
    fragmentTextureUnits: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),
    maxTextureSize: renderer.capabilities.maxTextureSize,
    floatColorBuffer: renderer.extensions.has("EXT_color_buffer_float"),
    timerQuery: renderer.extensions.has("EXT_disjoint_timer_query_webgl2"),
    threeRevision: packet?.host?.THREE?.REVISION || null,
  };
  const samplerDeclarations = Object.entries(MGL_UNIFORMS)
    .filter(
      ([, entry]) =>
        entry.type.startsWith("sampler") && entry.scope === "lighting",
    )
    .map(([name, entry]) => ({ name, ...entry }));
  const overrideMap = new Map(
    overrides.map((entry) => [
      entry.id,
      entry.value === null ? "auto" : entry.value ? "on" : "off",
    ]),
  );
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    frameIndex: packet?.report?.frameIndex ?? null,
    capturedFrame: capture?.frameIndex ?? null,
    gate: packet?.report?.ran
      ? "FUTURE ACTIVE · pipeline invoked. Check outputs and composition before claiming image correctness."
      : "PIPELINE BLOCKED · " +
        (packet?.report?.failure ||
          packet?.report?.refusal ||
          "waiting for the engine frame"),
    evidence:
      "Runtime observed; " +
      buffers.filter((buffer) => buffer.available).length +
      " sources available. Full GPU parity is NOT CERTIFIED.",
    lightCount: context?.lightSceneData?.ready
      ? context.lightSceneData.lightCount
      : null,
    phases,
    passes,
    frameStages: snapshot.frameStages.map((stage) => ({
      ...stage,
      execution:
        packet?.report?.ran &&
        packet.report.executedStages?.includes(stage.stageName)
          ? "invoked this frame"
          : "not invoked this frame",
    })),
    buffers,
    overrides,
    flags: snapshot.flags.map((flag) => ({
      ...flag,
      debugOverride: overrideMap.get(flag.id),
    })),
    baseline:
      snapshot.flags.find((flag) => flag.id === "MegaLightsBaseline")?.on ===
      true,
    frozen,
    readbacks,
    captureCost,
    history,
    runtime: {
      capabilities,
      pipeline: snapshot,
      patches: listPatches(),
      uniforms: listUniforms(),
      programs: programReport,
      budget: {
        fragmentUnits: capabilities.fragmentTextureUnits,
        declaredSharedSamplers: samplerDeclarations.length,
        declarations: samplerDeclarations,
        disclaimer: "Declared budget is not measured per-program binding usage",
      },
      telemetry,
      debugErrors: errors.slice(),
      limitations: DEBUG_LIMITATIONS,
    },
  };
}
