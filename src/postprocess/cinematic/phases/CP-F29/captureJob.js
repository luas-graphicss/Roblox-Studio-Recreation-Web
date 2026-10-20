import { resolveCaptureOptions } from "./captureOptions.js";
import { resolveCaptureSupport, createCaptureTilePlan } from "./captureTilePlan.js";
import { createCaptureMemoryPlan } from "./captureMemoryPlan.js";
import { captureTileTimeline, captureShutter } from "./captureTimeline.js";
import { createCaptureAccumulator } from "./captureAccumulator.js";
import { stitchCaptureTile } from "./captureStitch.js";
import { validateCaptureColor, captureColorSignature } from "./captureColor.js";
import { throwIfAborted } from "./captureValidation.js";

export function createCaptureJob({ host, encoder, sink, yieldControl = () => new Promise((resolve) => setTimeout(resolve, 0)), onProgress = () => {} }) {
  for (const name of ["describe", "snapshot", "begin", "beginTile", "render", "endTile", "restore"]) if (typeof host?.[name] !== "function") throw new TypeError(`Capture host requires ${name}`);
  for (const name of ["writeFrame", "finish", "abort"]) if (typeof sink?.[name] !== "function") throw new TypeError(`Capture sink requires ${name}`);
  if (typeof encoder?.encode !== "function") throw new TypeError("Capture requires an asynchronous encoder");
  let running = false;
  let cancellation = null;
  return Object.freeze({
    cancel() { cancellation?.abort(); encoder.cancel?.(); },
    async run(authored, { signal } = {}) {
      if (running) throw new Error("Capture job is already running");
      running = true;
      cancellation = new AbortController();
      const cancelFromCaller = () => cancellation?.abort();
      signal?.addEventListener("abort", cancelFromCaller, { once: true });
      if (signal?.aborted) cancellation.abort();
      const activeSignal = cancellation.signal;
      let snapshot;
      let snapshotTaken = false;
      let tileOpen = false;
      let completedFrames = 0;
      let failure;
      let manifest;
      try {
        throwIfAborted(activeSignal);
        const options = resolveCaptureOptions(authored);
        const description = structuredClone(await host.describe(options));
        if (JSON.stringify(description).length > 32768) throw new Error("Capture host description exceeds its metadata budget");
        if (description.apiVersion !== "1.0.0" || description.provenance !== "gpu") throw new Error("Capture requires a versioned real GPU host");
        if (description.motionBlurOwner !== options.motionBlurMode) throw new Error("Capture motion blur ownership is ambiguous");
        if (options.spatialSamples > 1 && description.spatialJitter !== "host-applied") throw new Error("Spatial sampling requires real projection jitter");
        if (description.histories !== "isolated-per-tile" || description.clock !== "manual" || description.seed !== "explicit") throw new Error("Capture requires deterministic time, seed and isolated histories");
        if (description.grain !== "disabled" && description.grain !== "resolve-only") throw new Error("Grain must be disabled or applied once after accumulation");
        if (description.grain === "resolve-only" && typeof host.finalizeTile !== "function") throw new Error("Resolve-only grain requires a final output consumer");
        const support = resolveCaptureSupport(description.effects);
        const plan = createCaptureTilePlan(options, support, description.maximumTextureSize);
        const memory = createCaptureMemoryPlan(options, plan, description.hostMemoryBytes, typeof host.finalizeFrame === "function");
        captureTileTimeline(options, 0).next();
        manifest = { phase: "CP-F29", version: "1.0.0", status: "running", options, plan, memory, host: description, frames: [], provenance: "gpu", referenceVerified: false, timing: "not-production-timing" };
        snapshot = await host.snapshot();
        snapshotTaken = true;
        await host.begin({ options, plan, signal: activeSignal });
        for (let outputIndex = 0; outputIndex < options.frameCount; outputIndex += 1) {
          const outputPixels = new Float32Array(options.width * options.height * 4);
          let outputColor;
          let outputSignature;
          for (const tile of plan.tiles) {
            throwIfAborted(activeSignal);
            const viewId = `${options.sequenceId}.frame-${outputIndex}.tile-${tile.index}`;
            tileOpen = true;
            await host.beginTile({ tile, plan, outputIndex, viewId, options, signal: activeSignal });
            const accumulator = createCaptureAccumulator(tile.width, tile.height, options.spatialSamples * options.temporalSamples, options.format);
            for (const sample of captureTileTimeline(options, outputIndex)) {
              throwIfAborted(activeSignal);
              const request = Object.freeze({ ...sample, viewId, generation: 0, tile, fullSize: plan.fullSize, options, signal: activeSignal, capture: sample.kind === "sample" });
              const rendered = await host.render(request);
              throwIfAborted(activeSignal);
              if (sample.kind === "sample") {
                if (!rendered || rendered.provenance !== "gpu" || rendered.frameId !== request.frameId || rendered.viewId !== viewId || rendered.generation !== request.generation) throw new Error("Capture host returned missing, duplicate or stale pixels");
                await accumulator.addAsync(rendered.pixels, rendered.color, sample.sampleIndex, { signal: activeSignal, yieldControl });
              }
              onProgress({ status: "rendering", outputIndex, completedFrames, frameCount: options.frameCount, tileIndex: tile.index, tileCount: plan.tiles.length, sampleIndex: sample.kind === "sample" ? sample.sampleIndex : null, stage: sample.kind });
              await yieldControl();
            }
            let resolved = await accumulator.resolveAsync(options.alpha, { signal: activeSignal, yieldControl });
            if (host.finalizeTile) resolved = await host.finalizeTile({ ...resolved, tile, plan, outputIndex, options, signal: activeSignal });
            throwIfAborted(activeSignal);
            const color = validateCaptureColor(resolved.color, host.finalizeFrame ? "exr" : options.format);
            if (!(resolved.pixels instanceof Float32Array) || resolved.pixels.length !== tile.width * tile.height * 4) throw new Error("Final output tile is invalid");
            if (outputSignature && outputSignature !== captureColorSignature(color)) throw new Error("Color transform differs between capture tiles");
            outputColor = color;
            outputSignature = captureColorSignature(color);
            stitchCaptureTile(outputPixels, resolved.pixels, tile, plan, options.width);
            await host.endTile();
            tileOpen = false;
          }
          let finalOutput = { pixels: outputPixels, color: outputColor };
          if (host.finalizeFrame) finalOutput = await host.finalizeFrame({ ...finalOutput, options, outputIndex, plan, signal: activeSignal });
          throwIfAborted(activeSignal);
          outputColor = validateCaptureColor(finalOutput.color, options.format);
          if (!(finalOutput.pixels instanceof Float32Array) || finalOutput.pixels.length !== outputPixels.length) throw new Error("Full-frame output resolve changed the capture extent");
          const metadata = Object.freeze({ phase: "CP-F29", version: "1.0.0", sequenceId: options.sequenceId, outputFrameId: options.firstOutputFrameId + outputIndex, width: options.width, height: options.height, origin: "bottom-left", color: outputColor, seed: options.seed, shutter: captureShutter(options, outputIndex), sampleCount: options.spatialSamples * options.temporalSamples, warmupFramesPerTile: options.warmupFrames, overscan: options.overscan, tileCount: plan.tiles.length, format: options.format, alphaMode: options.alpha, referenceVerified: false });
          onProgress({ status: "encoding", outputIndex, completedFrames, frameCount: options.frameCount });
          const encoded = await encoder.encode({ pixels: finalOutput.pixels, metadata, format: options.format }, { signal: activeSignal });
          throwIfAborted(activeSignal);
          const record = await sink.writeFrame({ encoded, metadata, signal: activeSignal });
          if (!record || record.outputFrameId !== metadata.outputFrameId || typeof record.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(record.sha256)) throw new Error("Capture sink must acknowledge the correct frame with its content hash");
          if (typeof record.path !== "string" || record.path.length > 256 || !Number.isSafeInteger(record.bytes) || record.bytes < 1) throw new Error("Capture sink returned invalid bounded frame metadata");
          manifest.frames.push({ outputFrameId: record.outputFrameId, path: record.path, bytes: record.bytes, sha256: record.sha256 });
          completedFrames += 1;
          await yieldControl();
        }
      } catch (error) { failure = error; }
      finally {
        try { if (tileOpen) await host.endTile(); }
        catch (error) { failure = failure ? new AggregateError([failure, error], "Capture and tile cleanup failed") : error; }
        try { if (snapshotTaken) await host.restore(snapshot); }
        catch (error) { failure = failure ? new AggregateError([failure, error], "Capture and host restoration failed") : error; }

      }
      try {
        if (failure) throw failure;
        throwIfAborted(activeSignal);
        manifest.status = "complete";
        await sink.finish(manifest);
        onProgress({ status: "complete", completedFrames });
        return manifest;
      } catch (error) {
        encoder.cancel?.();
        try { await sink.abort({ error: error.message, completedFrames }); }
        catch (abortError) { throw new AggregateError([error, abortError], "Capture and sink abort failed"); }
        throw error;
      } finally {
        signal?.removeEventListener("abort", cancelFromCaller);
        cancellation = null;
        running = false;
      }
    }
  });
}
