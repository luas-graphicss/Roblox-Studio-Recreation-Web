import { makeTextureResource } from "../../contracts/frameContract.js";
import { DOF_TEMPORAL_OWNER, DOF_TEMPORAL_RESOURCES, DOF_HISTORY_ENCODING, DOF_REJECTION_ENCODING } from "./dofTemporalContract.js";
import { validateDofColor, readDofPreExposure, dofColorSignature, readDofJitter, isRepresentableDofExposure } from "./dofInputValidation.js";
import { createDofHistoryCheckpoint } from "./dofHistoryPolicy.js";
import { makeDofColorResource, makeDofValueResource } from "./dofResourceMetadata.js";

export function createDofColorPass(services, bindings, sessions, materials) {
  return {
    id: "CP-F20.resolveBokeh", owner: DOF_TEMPORAL_OWNER, stage: "dof", order: 2000,
    reads: ["$color", DOF_TEMPORAL_RESOURCES.guide, DOF_TEMPORAL_RESOURCES.session, bindings.velocity, bindings.reactiveMask],
    writes: [DOF_TEMPORAL_RESOURCES.color, DOF_TEMPORAL_RESOURCES.rejection, DOF_TEMPORAL_RESOURCES.diagnostics], transformsColor: true,
    execute(context) {
      const session = context.read(DOF_TEMPORAL_RESOURCES.session).value;
      if (!session || session.closed || session.frame !== context.frame) throw new Error("CP-F20 bokeh resolve requires an open current-frame guide session");
      try {
        const source = validateDofColor(context.read("$color"), context.frame);
        const guide = context.read(DOF_TEMPORAL_RESOURCES.guide);
        const { frame, settings, capture, leases, previous, policy } = session;
        const size = [frame.renderSize.width, frame.renderSize.height];
        const reducedSize = size.map((value) => Math.ceil(value / settings.workingScale));
        const prefix = `CP-F20.working.${encodeURIComponent(frame.viewId)}`;
        const descriptor = { width: reducedSize[0], height: reducedSize[1], format: "rgba16f", filter: "nearest", depth: false };
        const reducedColor = services.pool.acquire(DOF_TEMPORAL_OWNER, `${prefix}.color`, descriptor);
        const reducedGuide = services.pool.acquire(DOF_TEMPORAL_OWNER, `${prefix}.guide`, descriptor);
        const tolerances = [settings.depthTolerance, settings.coverageTolerance, settings.cocTolerancePixels];
        const reduction = { uSource: source.texture, uGuide: guide.texture, uSize: size, uReducedSize: reducedSize, uTolerances: tolerances, uRelativeCoc: settings.cocRelativeTolerance, uScale: settings.workingScale };
        materials.draw("reduction", { ...reduction, uWriteGuide: false }, reducedColor);
        materials.draw("reduction", { ...reduction, uWriteGuide: true }, reducedGuide);
        const previousColor = leases.color.read;
        const previousGuide = leases.guide.read;
        const previousStatistics = leases.statistics.read;
        const colorPreExposure = readDofPreExposure(source);
        const colorSignature = dofColorSignature(source);
        const exposureScale = previous ? colorPreExposure / previous.colorPreExposure : 1;
        const historyExposureRepresentable = isRepresentableDofExposure(exposureScale);
        const resetReasons = previous && !historyExposureRepresentable ? Object.freeze([...policy.reasons, "pre-exposure-ratio"]) : policy.reasons;
        const historyAllowed = policy.historyAllowed && Boolean(previousColor && previousGuide && previousStatistics) && previous?.colorSignature === colorSignature && historyExposureRepresentable;
        const uniforms = {
          uSource: source.texture, uGuide: guide.texture, uReducedColor: reducedColor.texture, uReducedGuide: reducedGuide.texture,
          uVelocity: context.read(bindings.velocity).texture, uReactive: context.read(bindings.reactiveMask).texture,
          uPreviousColor: previousColor?.texture ?? source.texture, uPreviousGuide: previousGuide?.texture ?? guide.texture,
          uPreviousStatistics: previousStatistics?.texture ?? guide.texture,
          uSize: size, uReducedSize: reducedSize, uFullSize: [capture.fullSize.width, capture.fullSize.height], uJitterDelta: readDofJitter(frame),
          uTolerances: tolerances, uRelativeCoc: settings.cocRelativeTolerance, uScale: settings.workingScale,
          uMaximumMotion: capture.maximumMotionPixels, uHistoryWeight: settings.historyWeight, uMaximumSamples: settings.maximumSamples,
          uCameraWeight: policy.cameraWeight, uHistoryExposureScale: historyAllowed ? exposureScale : 1, uPreExposure: colorPreExposure,
          uClampSigma: settings.colorClampSigma, uClampMargin: settings.colorClampMargin, uRelativeMargin: settings.colorRelativeMargin,
          uEnabled: settings.enabled, uHistoryAllowed: historyAllowed, uCinematic: settings.mode === "cinematic"
        };
        const colorTarget = leases.color.writeTarget;
        const statisticsTarget = leases.statistics.writeTarget;
        materials.draw("resolve", { ...uniforms, uWriteStatistics: false }, colorTarget);
        materials.draw("resolve", { ...uniforms, uWriteStatistics: true }, statisticsTarget);
        leases.guide.commit(guide);
        leases.color.commit(makeTextureResource(colorTarget, frame, DOF_HISTORY_ENCODING));
        leases.statistics.commit(makeTextureResource(statisticsTarget, frame, DOF_REJECTION_ENCODING));
        const output = makeDofColorResource(colorTarget, frame, source);
        context.publish(DOF_TEMPORAL_RESOURCES.color, output);
        context.publish(DOF_TEMPORAL_RESOURCES.rejection, makeTextureResource(statisticsTarget, frame, DOF_REJECTION_ENCODING));
        const diagnostics = Object.freeze({ phase: DOF_TEMPORAL_OWNER, effectConnected: true, status: settings.enabled ? "submitted" : "disabled", historyAllowed, resetReasons, cameraWeight: policy.cameraWeight, colorPreExposure, historyExposureScale: uniforms.uHistoryExposureScale, workingScale: settings.workingScale, renderSize: frame.renderSize, capture, inputProvenance: source.provenance, integration: "explicit-bindings-not-reference-certified", drawCount: 5, memoryAccounting: "CP-F07 owns three RGBA16F history pairs; CP-F20 owns two reduced RGBA16F targets", referenceVerified: false });
        context.publish(DOF_TEMPORAL_RESOURCES.diagnostics, makeDofValueResource(frame, diagnostics));
        services.history.write(DOF_TEMPORAL_OWNER, session.key, frame, createDofHistoryCheckpoint(session, colorSignature, colorPreExposure));
        sessions.finish(session);
        services.report?.(diagnostics);
        return { color: output };
      } catch (error) { sessions.abort(session); throw error; }
      finally { materials.clearSamplers(); }
    }
  };
}
