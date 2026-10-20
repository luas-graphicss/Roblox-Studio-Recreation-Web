import { createScopedFlagOverrides } from "../runtime/megaLightsFlagRegistry.js";
import { phaseInstallation } from "../mlPhaseRegistry.js";
import { DEBUG_BUFFER_MODES } from "./megaLightsDebugCatalog.js";
import { createDebugHistory, makeDebugCheck } from "./megaLightsDebugCore.js";
import { createMegaLightsDebugTextureReader } from "./megaLightsDebugTextureReader.js";
import { resolveDebugSource } from "./megaLightsDebugSources.js";
import { captureDebugSource } from "./megaLightsDebugCapture.js";
import {
  inspectMegaLightsFrame,
  inspectMegaLightsPrograms,
} from "./megaLightsDebugInspection.js";
import { createMegaLightsDebugPanel } from "./megaLightsDebugPanel.js";
import { createMegaLightsDebugFixture } from "./megaLightsDebugFixture.js";
import { createMegaLightsDebugOverlay } from "./megaLightsDebugOverlay.js";
import { createMegaLightsDebugExporter } from "./megaLightsDebugExport.js";
import { runMegaLightsDebugGpuProbe } from "./megaLightsDebugGpuProbe.js";
import { auditMegaLightsFrame } from "./megaLightsDebugAudit.js";
import { captureMegaLightsDebugBeauty } from "./megaLightsDebugBeauty.js";
import {
  compareDebugCaptures,
  createDebugDifference,
} from "./megaLightsDebugImageEvidence.js";
import { createMegaLightsDebugFrameQueue } from "./megaLightsDebugFrameQueue.js";
import { createMegaLightsDebugVerification } from "./megaLightsDebugVerification.js";

export function createMegaLightsDebugSession(configuration) {
  const { THREE, renderer, scene, pipeline } = configuration;
  const document = configuration.document || globalThis.document;
  const overrides = createScopedFlagOverrides();
  const history = createDebugHistory();
  const textureReader = createMegaLightsDebugTextureReader({ THREE, renderer });
  const fixture = createMegaLightsDebugFixture({
    THREE,
    scene,
    requestRender: configuration.requestRender,
  });
  const overlay = createMegaLightsDebugOverlay({ THREE, renderer, document });
  const exporter = createMegaLightsDebugExporter(document);
  const frameQueue = createMegaLightsDebugFrameQueue(configuration);
  const errors = [];
  const captures = {};
  let packet = null;
  let model = null;
  let capture = null;
  let checks = [];
  let mode = DEBUG_BUFFER_MODES[0];
  let level = 0;
  let tierOverride = "inherit";
  let exposure = 1;
  let frozen = false;
  let captureRequested = true;
  let animationEnabled = false;
  let pendingBeauty = null;
  let pendingProbe = null;
  let readbacks = 0;
  let captureCost = 0;
  let lastCaptureTime = -Infinity;
  let lastPacketTime = 0;
  let lastProgramTime = -Infinity;
  let programReport = [];
  let disposed = false;
  let probeBusy = false;
  let cpuActionRevision = 0;

  function recordError(error, operation) {
    const entry = {
      operation,
      message: String(error?.message || error),
      frameIndex: packet?.report?.frameIndex ?? null,
    };
    errors.push(entry);
    if (errors.length > 80) errors.shift();
    checks.push(makeDebugCheck(operation, false, entry.message));
    checks = checks.slice(-200);
    panel.tests(checks);
  }

  const panel = createMegaLightsDebugPanel({
    document,
    onAction: action,
    onInput: input,
    onPixel: (pixel) => {
      if (!capture?.available) return;
      if (frozen) {
        const x = Math.min(
          capture.width - 1,
          Math.floor(pixel.u * capture.width),
        );
        const y = Math.min(
          capture.height - 1,
          Math.floor(pixel.v * capture.height),
        );
        const offset = (y * capture.width + x) * 4;
        panel.json("pixel", {
          frozen: true,
          capturedFrame: capture.frameIndex,
          sampledCoordinate: { x, y },
          rawRgba: Array.from(capture.rawPixels.subarray(offset, offset + 4)),
          note: "Frozen sampled texel; no live GPU read",
        });
        return;
      }
      pendingProbe = pixel;
      captureRequested = true;
      configuration.requestRender?.();
    },
  });

  const verification = createMegaLightsDebugVerification({
    ...configuration,
    document,
    panel,
    pipeline,
    frameQueue,
    readPacket: () => packet,
    readBuffer: readEvidenceBuffer,
    readBeauty: (observed) =>
      captureMegaLightsDebugBeauty({
        document,
        renderer,
        packet: observed,
        flags: pipeline.snapshot().flags,
      }),
    readAudit() {
      refreshModel(true);
      return auditMegaLightsFrame(model);
    },
    runGpuProbe: () => runMegaLightsDebugGpuProbe({ THREE, renderer }),
    onResults(results) {
      if (!disposed) {
        checks = results;
        panel.tests(checks);
      }
    },
  });

  function readEvidenceBuffer(selected, observed) {
    try {
      const source = resolveDebugSource(
        selected.id,
        observed?.frameContext,
        observed?.host,
        level,
      );
      const image = captureDebugSource({
        source,
        mode: selected,
        textureReader,
        exposure,
      });
      if (source.texture && image.available) readbacks += 1;
      return {
        ...image,
        frameIndex: observed?.report?.frameIndex ?? null,
        channels: selected.channels,
      };
    } catch (error) {
      return {
        available: false,
        reason: error.message,
        frameIndex: observed?.report?.frameIndex ?? null,
      };
    }
  }

  function refreshModel(force = false) {
    if (disposed || (frozen && !force)) return;
    const now = performance.now();
    if (now - lastProgramTime > 1000) {
      programReport = inspectMegaLightsPrograms(renderer);
      lastProgramTime = now;
    }
    model = inspectMegaLightsFrame({
      packet,
      pipeline,
      renderer,
      overrides: overrides.entries(),
      history: history.read(),
      frozen,
      capture,
      readbacks,
      captureCost,
      errors,
      programReport,
    });
    model.verification = verification.snapshot();
    panel.render(model);
    const fixtureState = fixture.describe();
    panel.text(
      "fixtureState",
      fixtureState.name === "none"
        ? "No diagnostic fixture. Original scene preserved."
        : fixtureState.name +
            " · " +
            fixtureState.ownedObjectCount +
            " owned objects · " +
            fixtureState.lightCount +
            " lights · intensity ×" +
            fixtureState.intensityScale +
            " · range " +
            fixtureState.range +
            " · step " +
            fixtureState.stepIndex +
            ". Original scene preserved.",
    );
  }

  function captureBuffer() {
    const started = performance.now();
    try {
      const source = resolveDebugSource(
        mode.id,
        packet?.frameContext,
        packet?.host,
        level,
      );
      capture = captureDebugSource({ source, mode, textureReader, exposure });
      capture.frameIndex = packet?.report?.frameIndex ?? null;
      capture.channels =
        mode.channels || "See the owning phase output contract";
      if (source.texture && capture.available) readbacks += 1;
      panel.buffer(capture);
      if (pendingProbe && source.available) {
        const coordinate = {
          x: Math.min(
            source.width - 1,
            Math.floor(pendingProbe.u * source.width),
          ),
          y: Math.min(
            source.height - 1,
            Math.floor(pendingProbe.v * source.height),
          ),
        };
        const pixel = captureDebugSource({
          source,
          mode,
          textureReader,
          exposure,
          pixel: coordinate,
        });
        if (source.texture) readbacks += 1;
        panel.json("pixel", {
          source: mode.id,
          frameIndex: capture.frameIndex,
          coordinate,
          rawRgba: Array.from(pixel.rawPixels),
          channels: capture.channels,
        });
      }
    } catch (error) {
      capture = {
        available: false,
        reason: String(error?.message || error),
        frameIndex: packet?.report?.frameIndex ?? null,
      };
      panel.buffer(capture);
      recordError(error, "Buffer readback");
    }
    pendingProbe = null;
    captureCost = performance.now() - started;
    lastCaptureTime = performance.now();
    captureRequested = false;
  }

  function observe(nextPacket) {
    if (disposed) return;
    packet = nextPacket;
    lastPacketTime = performance.now();
    overlay.draw(packet.frameContext);
    if (!panel.isVisible() || verification.isRunning()) return;
    if (
      (!frozen || captureRequested) &&
      (captureRequested || lastPacketTime - lastCaptureTime >= 250)
    ) {
      captureBuffer();
      refreshModel(true);
    }
  }

  const unsubscribe = pipeline.setDebugObserver(observe);

  function invalidateFlags() {
    configuration.onFlagsChanged?.();
    configuration.requestRender?.();
    captureRequested = true;
    refreshModel(true);
  }

  function restore() {
    const changed = overrides.entries().length > 0;
    overrides.clear();
    fixture.clear();
    animationEnabled = false;
    tierOverride = "inherit";
    panel.root.querySelector('[data-input="tier"]').value = "inherit";
    overlay.setEnabled(false);
    panel.root.querySelector('[data-input="fixture"]').value = "none";
    for (const name of ["motion", "overlay", "baseline"])
      panel.root.querySelector('[data-input="' + name + '"]').checked = false;
    if (changed) invalidateFlags();
    else {
      configuration.requestRender?.();
      refreshModel(true);
    }
  }

  function input(name, value) {
    if (disposed || verification.isRunning()) return;
    try {
      if (name === "tier") {
        tierOverride = ["fraco", "medio", "forte"].includes(value)
          ? value
          : "inherit";
        invalidateFlags();
      }
      if (name === "mode") {
        const selected = DEBUG_BUFFER_MODES.find((entry) => entry.id === value);
        if (selected) mode = selected;
        capture = null;
        pendingProbe = null;
      }
      if (name === "level")
        level = Math.min(31, Math.max(0, Math.floor(Number(value) || 0)));
      if (name === "exposure")
        exposure = Math.min(16, Math.max(0.05, Number(value) || 1));
      if (name === "flag") {
        if (value.value === "inherit") overrides.remove(value.id);
        else
          overrides.set(
            value.id,
            value.value === "auto" ? null : value.value === "on",
          );
        invalidateFlags();
      }
      if (name === "baseline") {
        if (value) overrides.set("MegaLightsBaseline", true);
        else overrides.remove("MegaLightsBaseline");
        invalidateFlags();
      }
      if (name === "fixture") {
        fixture.set(value, packet?.request?.camera);
        configuration.onFlagsChanged?.();
      }
      if (name === "fixtureIntensity")
        fixture.configure({ intensityScale: Number(value) });
      if (name === "fixtureRange") fixture.configure({ range: Number(value) });
      if (name === "motion") animationEnabled = value === true;
      if (name === "overlay") {
        overlay.setEnabled(value === true);
        overlay.draw(packet?.frameContext);
      }
      captureRequested = true;
      configuration.requestRender?.();
      refreshModel(true);
    } catch (error) {
      recordError(error, "Control: " + name);
    }
  }

  async function action(name) {
    if (disposed) return;
    try {
      if (name === "close") {
        configuration.onClose?.();
        return;
      }
      if (name === "runAll" || name === "scanBuffers") {
        if (verification.isRunning()) return;
        cpuActionRevision += 1;
        panel.showTab("tests");
        await verification.run({
          includeCpu: name === "runAll",
          scenarios: name === "runAll",
        });
        refreshModel(true);
        return;
      }
      if (
        verification.isRunning() &&
        !["cancelTests", "export", "restore"].includes(name)
      )
        return;
      if (name === "freeze") {
        frozen = !frozen;
        captureRequested = !frozen;
        refreshModel(true);
      }
      if (name === "capture") {
        captureRequested = true;
        configuration.requestRender?.();
      }
      if (name === "export") exporter.json(report());
      if (name === "downloadBuffer") {
        if (!capture?.available)
          throw new Error("No captured buffer to download");
        exporter.png(panel.canvas("buffer"));
      }
      if (name === "downloadProbe")
        exporter.png(panel.canvas("gpuProbe"), "megalights-gpu-probe.png");
      if (name === "restore") {
        verification.cancel();
        restore();
      }
      if (name === "recover") {
        pipeline.resumeAfterFailures();
        captureRequested = true;
        configuration.requestRender?.();
        checks.push(
          makeDebugCheck(
            "Driver recovery requested",
            true,
            "Driver stand-down cleared; individual pass errors are not cleared",
          ),
        );
        panel.tests(checks);
      }
      if (name === "resetHistory") {
        const store = phaseInstallation("ML-F20")?.pass?.historyStore?.();
        if (!store?.clear) throw new Error("Temporal history is not installed");
        store.clear();
        captureRequested = true;
        configuration.requestRender?.();
        checks.push(
          makeDebugCheck(
            "Temporal history reset",
            true,
            "F20 accumulation cleared by explicit request; the next frame starts new history",
          ),
        );
        panel.tests(checks);
      }
      if (name === "stepFixture") {
        fixture.step();
        captureRequested = true;
      }
      if (name === "audit") {
        cpuActionRevision += 1;
        programReport = inspectMegaLightsPrograms(configuration.renderer);
        refreshModel(true);
        checks = auditMegaLightsFrame(model);
        panel.tests(checks);
        panel.showTab("tests");
      }
      if (name === "gpuProbe" && !probeBusy) {
        cpuActionRevision += 1;
        probeBusy = true;
        const result = runMegaLightsDebugGpuProbe({ THREE, renderer });
        checks = result.checks;
        if (result.preview) {
          panel.root.querySelector('[data-field="probePreview"]').hidden =
            false;
          panel.drawCapture("gpuProbe", result.preview);
        }
        panel.tests(checks);
        panel.showTab("tests");
        probeBusy = false;
      }

      if (name === "cancelTests") {
        verification.cancel();
        panel.tests(checks, "Cancelled · incomplete checks are not passes");
      }
      if (name === "captureA" || name === "captureB") {
        pendingBeauty = name;
        configuration.requestRender?.();
        panel.text(
          "comparison",
          "Waiting for the next actual post-render callback…",
        );
      }
      if (name === "compare") {
        const difference = createDebugDifference(
          captures.captureA,
          captures.captureB,
        );
        panel.json(
          "comparison",
          compareDebugCaptures(captures.captureA, captures.captureB),
        );
        if (difference.available) {
          panel.drawCapture("difference", difference);
          panel.root.querySelector('[data-field="differencePreview"]').hidden =
            false;
        }
      }
    } catch (error) {
      probeBusy = false;
      recordError(error, "Action: " + name);
    }
  }

  function captureBeauty(name) {
    captures[name] = captureMegaLightsDebugBeauty({
      document,
      renderer,
      packet,
      flags: pipeline.snapshot().flags,
    });
    panel.drawCapture(name, captures[name]);
    panel.text(
      "comparison",
      name +
        " captured from the actual engine draw at frame " +
        captures[name].frameIndex +
        ".",
    );
  }

  function report() {
    return {
      ...model,
      tierOverride,
      tests: checks,
      capture: capture
        ? {
            available: capture.available,
            frameIndex: capture.frameIndex,
            source: mode.id,
            range: capture.range,
            reason: capture.reason,
            backend: capture.backend,
            producerFrame: capture.producerFrame,
            inputFrame: capture.inputFrame,
            level: capture.level,
            levelCount: capture.levelCount,
            width: capture.width,
            height: capture.height,
            rawTexelSample: capture.rawPixels
              ? Array.from(capture.rawPixels.subarray(0, 64))
              : null,
          }
        : null,
      fixture: fixture.describe(),
      beauty: Object.fromEntries(
        Object.entries(captures).map(([key, value]) => [
          key,
          { ...value, pixels: undefined },
        ]),
      ),
      comparison: compareDebugCaptures(captures.captureA, captures.captureB),
      verification: verification.snapshot(),
      referenceLab: panel.referenceEvidence(),
      debugErrors: errors.slice(),
      certification: {
        completeGpu: false,
        physicalGpuPerformance: false,
        ueParity: false,
      },
    };
  }

  const staleTimer = setInterval(() => {
    if (disposed || frozen || !panel.isVisible()) return;
    if (performance.now() - lastPacketTime > 1500)
      panel.text(
        "freshness",
        "STALE · no engine frame for " +
          ((performance.now() - lastPacketTime) / 1000).toFixed(1) +
          "s",
      );
    if (pendingBeauty && performance.now() - lastPacketTime > 2000)
      panel.text(
        "comparison",
        "Waiting for an engine render; no image was fabricated.",
      );
  }, 1000);

  refreshModel(true);
  return {
    beforeFrame(request) {
      if (tierOverride !== "inherit") request.tierName = tierOverride;
      verification.beforeFrame(request);
      if (animationEnabled && fixture.active() && !verification.isRunning())
        fixture.step();
    },
    afterRender(milliseconds) {
      if (disposed) return;
      frameQueue.afterRender(packet);
      history.push({
        frameIndex: packet?.report?.frameIndex ?? null,
        milliseconds: Number(milliseconds) || 0,
      });
      if (pendingBeauty) {
        const name = pendingBeauty;
        pendingBeauty = null;
        try {
          captureBeauty(name);
        } catch (error) {
          recordError(error, "Beauty capture");
        }
      }
    },
    report,
    action,
    input,
    dispose() {
      if (disposed) return;
      disposed = true;
      clearInterval(staleTimer);
      unsubscribe();
      verification.dispose();
      frameQueue.dispose();
      const changed = overrides.entries().length > 0;
      overrides.dispose();
      fixture.dispose();
      overlay.dispose();
      textureReader.dispose();
      exporter.dispose();
      panel.dispose();
      history.clear();
      packet = model = capture = pendingProbe = pendingBeauty = null;
      if (changed) configuration.onFlagsChanged?.();
    },
  };
}
