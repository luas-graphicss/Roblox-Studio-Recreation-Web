import { copySubstrateSmDiagnosticData } from './ssmDiagnosticData.js';
import { getSubstrateSmTelemetryStore } from './ssmTelemetryStore.js';
import { observeSubstrateSmDraws, readSubstrateSmGlErrors } from './ssmDrawCapture.js';
import { preserveSubstrateSmCaptureState } from './ssmCaptureState.js';
import { readSubstrateSmCaptureEnvironment, hashSubstrateSmCaptureBytes,
  inspectSubstrateSmCapturePixels } from './ssmCaptureMetadata.js';

const capturingContexts = new WeakSet();
let sequence = 0;

function validateCapture({ renderer, renderTarget, render, contextGeneration, frameId }) {
  if (!renderer?.getContext || !renderer?.readRenderTargetPixels || typeof render !== 'function') {
    throw new TypeError('SSM_QA_CAPTURE_INPUT_REQUIRED');
  }
  if (render.constructor?.name === 'AsyncFunction') throw new TypeError('SSM_QA_SYNCHRONOUS_RENDER_REQUIRED');
  if (!Number.isSafeInteger(contextGeneration) || contextGeneration < 0) throw new TypeError('SSM_QA_CONTEXT_GENERATION_REQUIRED');
  if (!(Number.isSafeInteger(frameId) && frameId >= 0) && !(typeof frameId === 'string' && frameId.length > 0 && frameId.length <= 256)) {
    throw new TypeError('SSM_QA_FRAME_ID_REQUIRED');
  }
  if (renderTarget?.isWebGLRenderTarget !== true || renderTarget.isWebGLCubeRenderTarget
    || renderTarget.depth > 1 || renderTarget.texture?.format !== 1023 || renderTarget.texture?.type !== 1009
    || (renderTarget.samples ?? 0) !== 0) throw new TypeError('SSM_QA_RGBA8_SINGLE_SAMPLE_TARGET_REQUIRED');
  for (const value of [renderTarget.width, renderTarget.height]) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 2048) throw new RangeError('SSM_QA_CAPTURE_DIMENSIONS');
  }
}

export async function captureSubstrateSmFrame(options = {}) {
  let store;
  let context;
  let owned = false;
  let observer;
  let restoreState;
  let pixels;
  let report;
  let registryRevision;
  const captureId = ++sequence;
  try {
    validateCapture(options);
    const { renderer, renderTarget, telemetry, render, frameId, contextGeneration, metadata, maxDraws } = options;
    store = getSubstrateSmTelemetryStore(telemetry);
    context = renderer.getContext();
    if (capturingContexts.has(context)) throw new Error('SSM_QA_CAPTURE_BUSY');
    capturingContexts.add(context);
    owned = true;
    registryRevision = store.revision;
    store.lastCapture = null;
    if (context.isContextLost()) throw new Error('SSM_QA_CONTEXT_LOST');
    if (readSubstrateSmGlErrors(context).length) throw new Error('SSM_QA_PREEXISTING_GL_ERROR');
    restoreState = preserveSubstrateSmCaptureState(renderer);
    try {
      renderer.setRenderTarget(renderTarget);
      observer = observeSubstrateSmDraws({ renderer, renderTarget, records: store.records, contextGeneration, maxDraws });
      const renderResult = render();
      if (renderResult?.then) {
        Promise.resolve(renderResult).catch(() => {});
        throw new Error('SSM_QA_SYNCHRONOUS_RENDER_REQUIRED');
      }
      if (!observer.restore()) throw new Error('SSM_QA_INSTRUMENTATION_RESTORE_FAILED');
      if (renderer.getRenderTarget() !== renderTarget) throw new Error('SSM_QA_CAPTURE_TARGET_CHANGED');
      if (context.isContextLost()) throw new Error('SSM_QA_CONTEXT_LOST');
      pixels = new Uint8Array(renderTarget.width * renderTarget.height * 4);
      const verification = new Uint8Array(pixels.length);
      pixels.fill(17);
      verification.fill(238);
      renderer.readRenderTargetPixels(renderTarget, 0, 0, renderTarget.width, renderTarget.height, pixels);
      renderer.readRenderTargetPixels(renderTarget, 0, 0, renderTarget.width, renderTarget.height, verification);
      if (pixels.some((byte, index) => byte !== verification[index])) throw new Error('SSM_QA_READBACK_NOT_REPRODUCIBLE');
      const errors = readSubstrateSmGlErrors(context);
      if (errors.length || observer.draws.some(draw => draw.errors.length || draw.preexistingErrors.length)) throw new Error('SSM_QA_CAPTURE_GL_ERROR');
      if (observer.droppedDraws) throw new Error('SSM_QA_DRAW_CAPTURE_TRUNCATED');
      report = { schemaVersion: 1, captureId, frameId, contextGeneration, registryRevision,
        scope: 'supplied-render-target', readbackVerified: true,
        environment: readSubstrateSmCaptureEnvironment(renderer, renderTarget),
        hostMetadata: copySubstrateSmDiagnosticData(metadata),
        hostMetadataProvenance: 'caller-supplied-not-independently-verified',
        pixelStatistics: inspectSubstrateSmCapturePixels(pixels),
        totalDrawCalls: observer.totalDrawCalls,
        matchedSubstrateSmDrawCalls: observer.draws.filter(draw => draw.verified).length,
        droppedDraws: observer.droppedDraws, draws: observer.draws, programs: [...observer.programs.values()],
        opticalCertified: false, performanceCertified: false, engineHostCertified: false };
    } finally {
      const restored = observer ? observer.restore() : true;
      restoreState();
      restoreState = null;
      if (!restored) throw new Error('SSM_QA_INSTRUMENTATION_RESTORE_FAILED');
    }
    for (const program of report.programs) {
      for (const shader of program.shaders ?? []) shader.sha256 = await hashSubstrateSmCaptureBytes(shader.source);
    }
    report.pixelSha256 = await hashSubstrateSmCaptureBytes(pixels);
    const registryCurrent = !store.disposed && store.revision === registryRevision;
    report.registryCurrent = registryCurrent;
    const receipts = new Map();
    for (const draw of report.draws) {
      if (!draw.verified) continue;
      const existing = receipts.get(draw.materialId);
      if (existing && existing.stamp !== draw.stamp) {
        existing.ambiguous = true;
        continue;
      }
      receipts.set(draw.materialId, { materialId: draw.materialId, registrationId: draw.registrationId,
        stamp: draw.stamp, drawCalls: (existing?.drawCalls ?? 0) + 1, resources: copySubstrateSmDiagnosticData(draw.resources),
        ambiguous: existing?.ambiguous ?? false });
    }
    const summary = Object.freeze({ ok: true, captureId, frameId: report.frameId,
      contextGeneration: report.contextGeneration, registryCurrent, pixelSha256: report.pixelSha256,
      totalDrawCalls: report.totalDrawCalls, matchedSubstrateSmDrawCalls: report.matchedSubstrateSmDrawCalls });
    if (!store.disposed) store.lastCapture = { ok: registryCurrent, captureId, summary,
      materials: registryCurrent ? [...receipts.values()].filter(receipt => !receipt.ambiguous) : [] };
    return Object.freeze({ ok: true, reason: null, report: Object.freeze(report), pixels });
  } catch (error) {
    const reason = String(error?.message ?? error).slice(0, 512);
    const failure = Object.freeze({ ok: false, captureId, reason, frameId: options.frameId ?? null });
    if (owned && store && !store.disposed) store.lastCapture = { ok: false, captureId, summary: failure, materials: [] };
    return Object.freeze({ ok: false, reason, report: failure, pixels: null });
  } finally {
    if (restoreState) { try { restoreState(); } catch {} }
    if (observer) observer.restore();
    if (owned) capturingContexts.delete(context);
  }
}
