import { makeTextureResource } from "../../contracts/frameContract.js";
import { DOF_TEMPORAL_OWNER, DOF_TEMPORAL_RESOURCES, DOF_GUIDE_ENCODING, DOF_TEMPORAL_SETTINGS, DOF_CAPTURE_SETTING } from "./dofTemporalContract.js";
import { resolveDofTemporalSettings } from "./dofTemporalSettings.js";
import { assertDofBindingsUnchanged } from "./dofInputBindings.js";
import { createDofCapturePlan } from "./dofCapturePlan.js";
import { validateDofInput, readDofJitter } from "./dofInputValidation.js";
import { makeDofValueResource } from "./dofResourceMetadata.js";

export function createDofGuidePass(services, bindings, sessions, materials) {
  return {
    id: "CP-F20.stabilizeCoc", owner: DOF_TEMPORAL_OWNER, stage: "dof", order: 1850,
    reads: [...Object.keys(bindings).filter((key) => key !== "translucencyAfterDof").map((key) => bindings[key]), "CP-F07.temporalFrame"],
    writes: [DOF_TEMPORAL_RESOURCES.guide, DOF_TEMPORAL_RESOURCES.session], transformsColor: false,
    execute(context) {
      assertDofBindingsUnchanged(services.settings, bindings);
      if (context.frame.referenceMode) throw new Error("CP-F20 reference mode is blocked until identified reference and integration evidence exist");
      const settings = resolveDofTemporalSettings(services.settings.get(DOF_TEMPORAL_SETTINGS));
      const capture = createDofCapturePlan(context.frame, settings, services.settings.get(DOF_CAPTURE_SETTING));
      const inputs = Object.fromEntries(Object.entries(bindings).filter(([key]) => key !== "translucencyAfterDof").map(([key, name]) => [key, validateDofInput(context.read(name), context.frame, key)]));
      const session = sessions.acquire(context, settings, capture, inputs);
      try {
        const previousGuide = session.leases.guide.read;
        const guide = session.leases.guide.writeTarget;
        const frame = context.frame;
        materials.draw("guide", {
          uCoc: inputs.circleOfConfusion.texture, uDepth: inputs.linearDepth.texture,
          uCoverage: inputs.coverage.texture, uVelocity: inputs.velocity.texture, uReactive: inputs.reactiveMask.texture,
          uPreviousGuide: previousGuide?.texture ?? inputs.circleOfConfusion.texture,
          uSize: [frame.renderSize.width, frame.renderSize.height], uFullSize: [capture.fullSize.width, capture.fullSize.height],
          uJitterDelta: readDofJitter(frame), uTolerances: [settings.depthTolerance, settings.coverageTolerance, settings.cocTolerancePixels],
          uRelativeCoc: settings.cocRelativeTolerance, uMaximumCoc: settings.maximumCocPixels,
          uMaximumMotion: capture.maximumMotionPixels, uCocHistoryWeight: settings.cocHistoryWeight * session.policy.cameraWeight,
          uHistoryAllowed: session.policy.historyAllowed && Boolean(previousGuide)
        }, guide);
        const resource = makeTextureResource(guide, frame, DOF_GUIDE_ENCODING);
        session.guide = resource;
        context.publish(DOF_TEMPORAL_RESOURCES.guide, resource);
        context.publish(DOF_TEMPORAL_RESOURCES.session, makeDofValueResource(frame, session));
      } catch (error) { sessions.abort(session); throw error; }
      finally { materials.clearSamplers(); }
    }
  };
}
