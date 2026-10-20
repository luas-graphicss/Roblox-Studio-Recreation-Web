import { makeDebugCheck } from "./megaLightsDebugCore.js";

export function auditMegaLightsFrame(model) {
  if (!model)
    return [
      makeDebugCheck("Live engine frame", null, "No observed engine frame"),
    ];
  const snapshot = model.runtime.pipeline;
  const capabilities = model.runtime.capabilities;
  const programFailures = (model.runtime.programs || []).filter(
    (program) => program.linked === false || program.error,
  );
  const programsUnverified =
    !model.runtime.programs?.length ||
    model.runtime.programs.some((program) => program.linked === null);
  const checks = [
    makeDebugCheck(
      "Future driver gate",
      snapshot.lastFrame ? snapshot.lastFrame.ran === true : null,
      model.gate,
    ),
    makeDebugCheck(
      "WebGL2 / MRT support",
      capabilities.webgl2 &&
        capabilities.maxDrawBuffers >= 4 &&
        capabilities.floatColorBuffer,
      "Four float attachments required",
      capabilities,
    ),
    makeDebugCheck(
      "Context alive",
      !capabilities.contextLost,
      "Current WebGL context loss state",
    ),
    makeDebugCheck(
      "Phase manifest coverage",
      model.phases.length === 30,
      model.phases.length + " phases enumerated",
    ),
    makeDebugCheck(
      "Pass contract coverage",
      model.passes.length === 14,
      model.passes.length + " ordered passes",
    ),
    makeDebugCheck(
      "No failed passes",
      !model.passes.some((pass) => pass.disabledByError),
      "Exceptions disable only their owning pass",
      model.passes.filter((pass) => pass.disabledByError),
    ),
    makeDebugCheck(
      "No failed stages",
      !snapshot.frameStages.some((stage) => stage.disabledByError),
      "Post-graph stages are inspected separately",
      snapshot.frameStages,
    ),
    makeDebugCheck(
      "Program link status",
      programFailures.length ? false : programsUnverified ? null : true,
      "Observed renderer programs only; pending compilation is unverified, not a success",
      programFailures,
    ),
    makeDebugCheck(
      "Shared sampler declaration ceiling",
      model.runtime.budget.declaredSharedSamplers <=
        capabilities.fragmentTextureUnits,
      "A declaration ceiling does not prove all engine samplers fit",
      model.runtime.budget,
    ),
  ];
  for (const phase of model.phases)
    checks.push(
      makeDebugCheck(
        phase.id + " installation",
        phase.installation === "unavailable"
          ? null
          : phase.installation === "installed",
        phase.detail || phase.title,
      ),
    );
  for (const buffer of model.buffers)
    checks.push(
      makeDebugCheck(
        buffer.owner + " · " + buffer.title,
        buffer.available ? true : null,
        buffer.origin || buffer.reason,
      ),
    );
  checks.push(
    makeDebugCheck(
      "Complete GPU visibility / area resolver",
      null,
      "F7/F17 GPU paths have declared residuals; CPU reference checks do not certify them",
    ),
  );
  checks.push(
    makeDebugCheck(
      "Physical GPU performance",
      null,
      "No physical-GPU benchmark evidence supplied; debug readbacks perturb frame time",
    ),
  );
  checks.push(
    makeDebugCheck(
      "UE image parity",
      null,
      "No matched UE reference images, scene specification or per-device measurements supplied",
    ),
  );
  return checks;
}
