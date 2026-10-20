import { makeTextureResource } from "../../contracts/frameContract.js";
import { FILM_GRAIN_PHASE, FILM_GRAIN_SETTINGS, FILM_GRAIN_CAPTURE, FILM_GRAIN_COLOR, FILM_GRAIN_STATE, FILM_GRAIN_PROFILE } from "./grainContract.js";
import { resolveGrainSettings, isGrainEnabled } from "./grainSettings.js";
import { resolveGrainSequence } from "./grainSequence.js";
import { resolveGrainCapture } from "./grainCapture.js";
import { validateGrainColor, preserveGrainColorMetadata } from "./grainColorInput.js";
import { FILM_GRAIN_FRAGMENT_SHADER } from "./grainShader.js";
import { createGrainUniforms, updateGrainUniforms } from "./grainUniforms.js";
import { createGrainTextureCache } from "./grainTextureCache.js";

export function installFilmGrain(services) {
  const { graph, pool, rendererAdapter: adapter, capabilities, report = () => {} } = services;
  if (!capabilities?.webgl2 || !capabilities?.floatColorBuffer) throw new Error("CP-F25 requires WebGL2 and floating-point color targets");
  if (!graph?.register || !pool?.acquire || !pool?.releaseOwner || !adapter?.createMaterial || !adapter?.draw) throw new TypeError("CP-F25 requires graph, pool and renderer adapter services");
  const uniforms = createGrainUniforms();
  const textures = createGrainTextureCache(adapter.THREE, capabilities.maxTextureSize);
  let material = null;
  let disposed = false;
  let cachedStore = null;
  let cachedRevision = null;
  let cachedAuthored = Symbol("unconfigured");
  let settings = null;
  function configure(store) {
    const revision = store?.revision?.();
    const authored = store?.get?.(FILM_GRAIN_SETTINGS);
    if (settings && store === cachedStore && revision === cachedRevision && authored === cachedAuthored) return;
    const next = resolveGrainSettings(authored);
    if (next.texture) textures.resolve(next.texture);
    else textures.release();
    settings = next;
    cachedStore = store;
    cachedRevision = revision;
    cachedAuthored = authored;
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    try { material?.dispose(); }
    finally { textures.dispose(); pool.releaseOwner(FILM_GRAIN_PHASE); }
  }
  let unregister;
  try {
    configure(services.settings);
    unregister = graph.register({
      id: "CP-F25.filmGrain", owner: FILM_GRAIN_PHASE, stage: "filmFinish", order: 2500,
      reads: ["$color"], writes: [FILM_GRAIN_COLOR, FILM_GRAIN_STATE], transformsColor: true, dispose,
      execute(context) {
        if (disposed) throw new Error("CP-F25 has been disposed");
        const store = context.settings ?? services.settings;
        configure(store);
        const { frame } = context;
        const source = context.read("$color");
        const capture = resolveGrainCapture(store?.get?.(FILM_GRAIN_CAPTURE), frame, source);
        if (capture?.stage === "subframe" && source.filmGrain?.applied) throw new Error("CP-F25 capture subframes must not contain previously applied grain");
        const applying = isGrainEnabled(settings) && capture?.stage !== "subframe";
        const domain = validateGrainColor(source, frame, applying, capture);
        if (frame.referenceMode && applying) throw new Error("CP-F25 BLOCKED_REFERENCE: no verified UE5.9 grain profile");
        const sequence = resolveGrainSequence(frame, settings, capture);
        const texture = applying && settings.texture ? textures.resolve(settings.texture) : null;
        const target = pool.acquire(FILM_GRAIN_PHASE, `${FILM_GRAIN_PHASE}.color.${frame.viewId}`, { width: source.width, height: source.height, format: "rgba16f", filter: "nearest" });
        if (target.texture === source.texture) throw new Error("CP-F25 rejects texture feedback");
        material ??= adapter.createMaterial(FILM_GRAIN_FRAGMENT_SHADER, uniforms);
        updateGrainUniforms(uniforms, { source, settings, sequence, domain, capture, applying, texture });
        adapter.draw(material, target);
        const state = Object.freeze({
          profile: FILM_GRAIN_PROFILE, applied: applying, reason: applying ? "applied-once" : capture?.stage === "subframe" ? "deferred-until-capture-resolve" : "neutral",
          sequence, texelSizePixels: settings.texelSize, domain: domain?.mode ?? "preserved", ditherApplied: false,
          texture: texture ? { fingerprint: texture.asset.fingerprint, meanRemoved: texture.asset.mean, standardDeviation: texture.asset.standardDeviation, ...textures.stats() } : null,
          sourceProvenance: source.provenance, referenceVerified: false
        });
        const filmGrain = source.filmGrain?.applied ? source.filmGrain : state;
        const metadata = preserveGrainColorMetadata(source);
        if (applying) {
          metadata.referenceVerified = false;
          if (metadata.colorMetadata) metadata.colorMetadata = Object.freeze({ ...metadata.colorMetadata, referenceVerified: false });
        }
        const color = Object.freeze({ ...makeTextureResource(target, frame, source.encoding), ...metadata, filmGrain });
        context.publish(FILM_GRAIN_COLOR, color);
        context.publish(FILM_GRAIN_STATE, Object.freeze({ frameId: frame.frameId, viewId: frame.viewId, generation: frame.generation, provenance: "gpu", value: state }));
        return { color };
      }
    });
    report({ phase: FILM_GRAIN_PHASE, status: "implemented", profile: FILM_GRAIN_PROFILE, certification: "BLOCKED_REFERENCE", temporalPolicy: "stateless-counter-no-history", capturePolicy: "defer-subframes-apply-once-at-resolve", dither: "separate-output-responsibility", defaultIntensity: 0 });
  } catch (error) { unregister?.(); dispose(); throw error; }
  return () => { if (disposed) return; try { unregister(); } finally { dispose(); } };
}
