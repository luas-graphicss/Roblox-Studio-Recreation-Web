import {
  createScopedFlagOverrides,
  listFlags,
} from "../runtime/megaLightsFlagRegistry.js";
import { DEBUG_BUFFER_MODES } from "./megaLightsDebugCatalog.js";
import { makeDebugCheck } from "./megaLightsDebugCore.js";
import { createMegaLightsDebugFixture } from "./megaLightsDebugFixture.js";
import {
  compareDebugCaptures,
  createDebugDifference,
} from "./megaLightsDebugImageEvidence.js";

export function createMegaLightsDebugVerification(configuration) {
  const { frameQueue, panel, pipeline } = configuration;
  const fixture = createMegaLightsDebugFixture(configuration);
  let controller = null;
  let overrides = null;
  let temporaryTier = null;
  let results = [];
  let progress = {
    state: "idle",
    completed: 0,
    current: "No complete run yet",
  };
  let generation = 0;
  let disposed = false;

  function publish(current) {
    progress = { ...progress, completed: results.length, current };
    if (disposed) return;
    configuration.onResults(results.slice());
    panel.verification(progress);
  }

  function append(check, scope) {
    results.push({ ...check, scope, capturedAt: new Date().toISOString() });
    publish(check.id);
  }

  function release() {
    overrides?.dispose();
    overrides = null;
    temporaryTier = null;
    fixture.clear();
    configuration.onFlagsChanged?.();
    configuration.requestRender?.();
  }

  function cancel() {
    controller?.abort();
    controller = null;
    release();
    if (progress.state === "running") {
      progress.state = "cancelled";
      publish(
        "Cancelled; incomplete work is not a pass. Temporary controls restored.",
      );
    }
  }

  async function run({ scenarios = true } = {}) {
    if (disposed || controller) return;
    const runGeneration = ++generation;
    const abortController = new AbortController();
    controller = abortController;
    const signal = abortController.signal;
    const originalFlags = listFlags().map(({ id, override }) => ({
      id,
      override,
    }));
    results = [];
    progress = {
      state: "running",
      startedAt: new Date().toISOString(),
      completed: 0,
      current: "Waiting for an actual draw",
    };
    panel.clearGallery();
    publish(progress.current);
    const wait = (read = (packet) => packet) =>
      frameQueue.waitForFrame(read, signal);
    const readSnapshot = (packet) => ({
      packet,
      pipeline: pipeline.snapshot(),
    });
    try {
      await wait();
      for (const check of configuration.readAudit())
        append(
          check,
          "Live registry audit; availability is not pixel correctness",
        );
      const probe = configuration.runGpuProbe();
      for (const check of probe.checks)
        append(check, "Private WebGL input proof");
      if (probe.preview)
        panel.addEvidenceImage(
          "GPU input proof",
          probe.preview,
          "Actual 32×32 input scene; not final MegaLights shading",
        );
      for (const mode of DEBUG_BUFFER_MODES) {
        signal.throwIfAborted();
        publish("Reading " + mode.title);
        const image = await wait((packet) =>
          configuration.readBuffer(mode, packet),
        );
        const condition = image.available
          ? image.range.invalidCount === 0
          : null;
        append(
          makeDebugCheck(
            "Buffer / " + mode.title,
            condition,
            image.available
              ? "Finite sampled RGBA texels; zero values do not imply correctness"
              : image.reason,
            {
              source: mode.id,
              owner: mode.owner,
              frame: image.frameIndex,
              origin: image.origin,
              backend: image.backend,
              range: image.range,
              sourceWidth: image.sourceWidth,
              sourceHeight: image.sourceHeight,
              producerFrame: image.producerFrame,
              inputFrame: image.inputFrame,
            },
          ),
          "Sampled output evidence",
        );
        panel.addEvidenceImage(
          mode.title,
          image,
          image.available
            ? image.backend + " · frame " + image.frameIndex
            : image.reason,
          mode.id,
        );
      }
      if (scenarios) {
        overrides = createScopedFlagOverrides();
        for (const flag of listFlags()) overrides.set(flag.id, null);
        for (const tier of ["fraco", "medio", "forte"]) {
          temporaryTier = tier;
          configuration.onFlagsChanged?.();
          const observed = await wait(readSnapshot);
          const enabled = observed.packet.report.ran;
          append(
            makeDebugCheck(
              "Tier / " + tier,
              tier === "fraco" ? enabled === false : enabled ? true : null,
              enabled
                ? "Pipeline invoked with automatic tier policy; inspect its individual outputs"
                : observed.packet.report.refusal ||
                    observed.packet.report.failure,
              {
                requested: tier,
                observed: observed.pipeline.tier,
                frame: observed.packet.report.frameIndex,
              },
            ),
            "Live tier gate",
          );
        }
        for (const [id, value] of [
          ["MegaLightsBaseline", true],
          ["MegaLightsEnabled", false],
        ]) {
          overrides.set(id, value);
          configuration.onFlagsChanged?.();
          const observed = await wait(readSnapshot);
          append(
            makeDebugCheck(
              "Veto / " + id,
              observed.packet.report.ran === false,
              observed.packet.report.refusal ||
                "Expected a closed pipeline gate",
              {
                ran: observed.packet.report.ran,
                frame: observed.packet.report.frameIndex,
              },
            ),
            "Live veto",
          );
          overrides.set(id, null);
        }
        for (const flag of listFlags().filter(
          (entry) => entry.phase !== "base",
        )) {
          for (const value of [false, null]) {
            overrides.set(flag.id, value);
            configuration.onFlagsChanged?.();
            const observed = await wait(readSnapshot);
            const current = observed.pipeline.flags.find(
              (entry) => entry.id === flag.id,
            );
            const expected = value === null ? flag.defaultsByTier.forte : value;
            append(
              makeDebugCheck(
                "Flag / " + flag.id + (value === null ? " / AUTO" : " / OFF"),
                current?.on === expected,
                "Effective state read from a subsequent frame; does not certify the phase image",
                {
                  owner: flag.phase,
                  expected,
                  actual: current?.on,
                  mode: current?.mode,
                  frame: observed.packet.report.frameIndex,
                },
              ),
              "Live flag round-trip",
            );
          }
        }
        for (const name of [
          "single",
          "spot",
          "materials",
          "occluder",
          "many",
          "transparency",
        ]) {
          signal.throwIfAborted();
          publish("Fixture / " + name);
          const before = await wait((packet) =>
            configuration.readBeauty(packet),
          );
          fixture.set(name, configuration.readPacket()?.request?.camera);
          configuration.onFlagsChanged?.();
          await wait();
          const after = await wait((packet) =>
            configuration.readBeauty(packet),
          );
          const comparison = compareDebugCaptures(before, after);
          const source = await wait((packet) =>
            configuration.readBuffer(DEBUG_BUFFER_MODES[0], packet),
          );
          append(
            makeDebugCheck(
              "Fixture / " + name,
              after.pipelineRan && source.available
                ? source.range.invalidCount === 0
                : null,
              "Additive fixture, real beauty and depth captured. Occlusion, transparency and area GPU parity remain separate requirements.",
              {
                fixture: fixture.describe(),
                comparison,
                depthRange: source.range,
                refusal: after.refusal || source.reason,
              },
            ),
            "Live additive scene smoke test",
          );
          panel.addEvidenceImage(
            "Fixture / " + name,
            after,
            "Actual post-render frame " + after.frameIndex,
          );
          if (name === "occluder") {
            fixture.step();
            const moved = await wait((packet) =>
              configuration.readBeauty(packet),
            );
            const difference = createDebugDifference(after, moved);
            append(
              makeDebugCheck(
                "Fixture motion pixels",
                difference.comparison?.cameraUnchanged === true
                  ? difference.comparison.changedPixels > 0
                  : null,
                "Changed final pixels under a fixed camera prove motion, not correct shadows",
                difference.comparison,
              ),
              "Live pixel comparison",
            );
            panel.addEvidenceImage(
              "Occluder motion / difference ×4",
              difference,
              "Black = identical; amber = changed pixel",
            );
          }
          fixture.clear();
        }
        release();
        const restored = listFlags().map(({ id, override }) => ({
          id,
          override,
        }));
        append(
          makeDebugCheck(
            "Temporary flag restoration",
            JSON.stringify(originalFlags) === JSON.stringify(restored),
            "Owned fixtures and overrides removed. Frames and temporal history naturally advanced; history was not reset.",
          ),
          "Session lifecycle",
        );
      }

      progress.state = "completed";
      progress.completedAt = new Date().toISOString();
      publish(
        "Complete run finished; inspect FAIL and BLOCKED results. This is not universal certification.",
      );
    } catch (error) {
      if (runGeneration !== generation || disposed) return;
      progress.state =
        error.name === "AbortError" ? "cancelled" : "interrupted";
      append(
        makeDebugCheck(
          "Run interrupted",
          ["AbortError", "TimeoutError"].includes(error.name) ? null : false,
          error.message,
        ),
        "Run lifecycle",
      );
    } finally {
      if (runGeneration === generation) {
        release();
        controller = null;
        if (!disposed) publish(progress.current);
      }
    }
  }

  return {
    run,
    cancel,
    isRunning: () => controller !== null,
    beforeFrame(request) {
      if (temporaryTier) request.tierName = temporaryTier;
    },
    snapshot: () => ({ ...progress, checks: results.length }),
    dispose() {
      disposed = true;
      generation += 1;
      cancel();
      fixture.dispose();
    },
  };
}
