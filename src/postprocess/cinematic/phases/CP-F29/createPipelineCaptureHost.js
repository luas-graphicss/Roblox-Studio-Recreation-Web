import { createCaptureEndpoint } from "./captureEndpoint.js";
import { CAPTURE_ENDPOINT_SETTING } from "./captureContract.js";
import { validateFrame } from "../../contracts/frameContract.js";

export function createPipelineCaptureHost({ adapter, describe, simulation, createSession, finalizeFrame }) {
  if (typeof describe !== "function" || typeof createSession !== "function") throw new TypeError("Capture requires an explicit pipeline session factory and capability description");
  for (const method of ["snapshot", "seek", "restore"]) if (typeof simulation?.[method] !== "function") throw new TypeError(`Capture simulation requires ${method}`);
  let active = false;
  let session = null;
  let endpoint = null;
  return Object.freeze({
    describe,
    ...(typeof finalizeFrame === "function" ? { finalizeFrame } : {}),
    snapshot: () => simulation.snapshot(),
    async begin() { if (active) throw new Error("Capture host is already active"); active = true; },
    async beginTile(context) {
      if (!active || session) throw new Error("Capture tile lifecycle is invalid");
      session = await createSession(context);
      if (!session?.pipeline?.prepare || !session.pipeline.render || !session.settings?.set || !session.dispose) throw new Error("Capture requires a dedicated disposable B00 pipeline session per tile");
      for (const method of ["prepareFrame", "renderScene"]) if (typeof session[method] !== "function") throw new TypeError(`Capture tile session requires ${method}`);
      endpoint = createCaptureEndpoint(adapter);
      session.settings.set(CAPTURE_ENDPOINT_SETTING, endpoint);
    },
    async render(request) {
      if (!session || !endpoint) throw new Error("Capture tile is not initialized");
      await simulation.seek({ timeSeconds: request.timeSeconds, seed: request.seed, frameSeed: request.frameSeed });
      const frame = await session.prepareFrame(request);
      validateFrame(frame);
      for (const field of ["frameId", "viewId", "generation", "timeSeconds", "deltaSeconds"]) if (frame[field] !== request[field]) throw new Error(`Capture frame did not follow manual ${field}`);
      if (frame.renderSize.width !== request.tile.width || frame.renderSize.height !== request.tile.height) throw new Error("Capture session rendered at the wrong physical size");
      const preparation = session.pipeline.prepare(frame);
      await session.afterPrepare?.({ frame, preparation, request });
      const inputs = await session.renderScene(frame, request);
      if (request.capture) endpoint.arm({ ...frame, width: request.tile.width, height: request.tile.height, maxBytes: request.tile.width * request.tile.height * 16 });
      session.pipeline.render(frame, inputs);
      return request.capture ? endpoint.collect({ signal: request.signal, timeoutMilliseconds: request.options.maxGpuReadbackMilliseconds }) : null;
    },
    async finalizeTile(context) { return session.finalizeTile ? session.finalizeTile(context) : context; },
    async endTile() {
      const previous = session;
      session = null;
      endpoint?.dispose();
      endpoint = null;
      if (previous) await previous.dispose();
    },
    async restore(snapshot) { active = false; await simulation.restore(snapshot); }
  });
}
