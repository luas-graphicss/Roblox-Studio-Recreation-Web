import { makeTextureResource } from "../../contracts/frameContract.js";
import { FILMIC_SETTINGS_KEY, resolveFilmicSettings, getFilmicOutput } from "./filmicSettings.js";
import { FILMIC_FRAGMENT_SHADER } from "./filmicShader.js";
import { createFilmicUniforms, updateFilmicUniforms } from "./filmicUniforms.js";
import { validateFilmicReplacement, createFilmicReplacementMaterial } from "./filmicReplacement.js";
import { validateFilmicInput, preserveFilmicBypassMetadata } from "./filmicInput.js";

const OWNER = "CP-F11";
const OUTPUT_NAME = "CP-F11.color";

export function installFilmicTonemapper(services, authoredReplacement = null) {
  const { graph, pool, rendererAdapter: adapter, capabilities, report = () => {} } = services;
  const replacement = validateFilmicReplacement(authoredReplacement);
  if (!capabilities?.webgl2 || !capabilities.floatColorBuffer) throw new Error("CP-F11 requires WebGL2 and FP16 color rendering; no RGBA8 fallback");
  if (!graph?.register || !pool?.acquire || !pool?.releaseOwner || !adapter?.createMaterial || !adapter?.draw) throw new TypeError("CP-F11 requires graph, pool and renderer adapter services");
  const uniforms = createFilmicUniforms();
  let filmMaterial = null;
  let replacementMaterial = null;
  let cachedStore = null;
  let cachedRevision = null;
  let cachedAuthored = Symbol("unconfigured");
  let settings = null;
  let output = null;
  let disposed = false;

  function dispose() {
    if (disposed) return;
    disposed = true;
    filmMaterial?.dispose();
    replacementMaterial?.material.dispose();
    pool.releaseOwner(OWNER);
  }

  function configure(store) {
    const revision = store?.revision?.();
    const authored = store?.get?.(FILMIC_SETTINGS_KEY);
    if (store === cachedStore && revision === cachedRevision && authored === cachedAuthored) return;
    const nextSettings = resolveFilmicSettings(authored);
    if (nextSettings.mode === "replace" && !replacement) throw new Error("CP-F11 replacement mode requires an explicit replacement provider");
    settings = nextSettings;
    output = getFilmicOutput(settings);
    updateFilmicUniforms(uniforms, settings);
    cachedStore = store;
    cachedRevision = revision;
    cachedAuthored = authored;
  }

  const pass = {
    id: "CP-F11.filmicTonemapper",
    owner: OWNER,
    stage: "toneMapping",
    order: 0,
    reads: ["$color"],
    writes: [OUTPUT_NAME],
    transformsColor: true,
    dispose,
    execute(context) {
      if (disposed) throw new Error("CP-F11 has been disposed");
      configure(context.settings ?? services.settings);
      const { frame } = context;
      const source = context.read("$color");
      const preExposure = validateFilmicInput(source, settings.mode === "bypass");
      if (frame.referenceMode && settings.mode !== "bypass") throw new Error("CP-F11 BLOCKED_REFERENCE: no verified UE5.9 film profile is installed");
      const target = pool.acquire(OWNER, `${OWNER}.color.${frame.viewId}`, { width: source.width, height: source.height, format: "rgba16f", filter: "nearest" });
      if (target.texture === source.texture) throw new Error("CP-F11 rejects texture feedback");
      let encoding;
      let colorMetadata;
      if (settings.mode === "replace") {
        replacementMaterial ??= createFilmicReplacementMaterial(adapter, replacement);
        replacementMaterial.update(source, frame);
        adapter.draw(replacementMaterial.material, target);
        encoding = replacement.outputEncoding;
        colorMetadata = { ...(replacement.outputMetadata ?? {}), toneMapper: replacement.id, referenceVerified: false };
      } else {
        filmMaterial ??= adapter.createMaterial(FILMIC_FRAGMENT_SHADER, uniforms);
        uniforms.cp11InputTexture.value = source.texture;
        uniforms.cp11InversePreExposure.value = 1 / preExposure;
        adapter.draw(filmMaterial, target);
        encoding = settings.mode === "bypass" ? source.encoding : output.encoding;
        colorMetadata = settings.mode === "bypass" ? { ...(source.colorMetadata ?? {}) } : { ...output, toneMapper: "independent-logistic-film-v1", preExposureRemoved: true };
      }
      const transportMetadata = settings.mode === "bypass" ? preserveFilmicBypassMetadata(source, preExposure) : { preExposure: 1, transfer: encoding === "display-srgb" ? "srgb" : "linear", samplerDecoded: false, alphaMode: settings.mode === "replace" ? "straight" : source.alphaMode ?? "straight" };
      const color = Object.freeze({ ...makeTextureResource(target, frame, encoding), ...transportMetadata, colorMetadata: Object.freeze(colorMetadata), sourceProvenance: source.provenance });
      context.publish(OUTPUT_NAME, color);
      return { color };
    }
  };
  let unregister;
  try {
    configure(services.settings);
    unregister = graph.register(pass);
    report({ phase: OWNER, status: "implemented", profile: "independent-logistic-film-v1", referenceVerified: false, certification: "BLOCKED_REFERENCE", inputEncoding: "scene-linear-rec709", outputTransfer: "linear unless explicitly replaced", invalidPixelPolicy: "magenta diagnostic; no synchronous readback in runtime" });
  } catch (error) {
    unregister?.();
    dispose();
    throw error;
  }
  return () => { unregister(); dispose(); };
}
