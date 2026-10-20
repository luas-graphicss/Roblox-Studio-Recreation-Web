import { OUTPUT_OWNER } from "./outputContract.js";
import { OUTPUT_LINEAR_SHADER } from "./outputLinearShader.js";
import { OUTPUT_ENCODING_SHADER } from "./outputEncodingShader.js";

export function createOutputGpuResources(adapter, pool) {
  const linearUniforms = { cp28Source: { value: null }, cp28SourceEncoded: { value: 0 }, cp28SourcePremultiplied: { value: 0 }, cp28SourceOpaque: { value: 0 } };
  const encodingUniforms = {
    cp28Linear: { value: null }, cp28Original: { value: null }, cp28Matrix: { value: new Float32Array(9) },
    cp28Luminance: { value: new Float32Array(3) }, cp28Maximum: { value: 1 }, cp28Black: { value: 0 },
    cp28PaperWhite: { value: 200 }, cp28Transfer: { value: 1 }, cp28Mapping: { value: 2 },
    cp28Premultiplied: { value: 0 }, cp28SourceEncoded: { value: 0 }, cp28SourceOpaque: { value: 0 }, cp28Copy: { value: 0 }, cp28Dither: { value: 0 }, cp28DitherOffset: { value: new Float32Array(2) }
  };
  let linearMaterial;
  let encodingMaterial;
  let disposed = false;
  const viewGenerations = new Map();

  function prepareView(frame) {
    if (disposed) throw new Error("CP-F28 GPU resources are disposed");
    if (adapter.context?.isContextLost?.()) throw new Error("CP-F28 output device is lost");
    const previousGeneration = viewGenerations.get(frame.viewId);
    if (previousGeneration != null && previousGeneration !== frame.generation) {
      pool.release(`${OUTPUT_OWNER}.linear.${frame.viewId}`);
      pool.release(`${OUTPUT_OWNER}.output.${frame.viewId}`);
    }
    viewGenerations.set(frame.viewId, frame.generation);
  }

  function acquire(kind, frame, format, sampledTextures) {
    const target = pool.acquire(OUTPUT_OWNER, `${OUTPUT_OWNER}.${kind}.${frame.viewId}`, { ...frame.outputSize, format, filter: "nearest" });
    if (sampledTextures.includes(target.texture)) throw new Error("CP-F28 rejects texture feedback before GPU submission");
    return target;
  }

  return Object.freeze({
    captureLinear(source, info, frame) {
      prepareView(frame);
      const target = acquire("linear", frame, "rgba16f", [source.texture]);
      linearMaterial ??= adapter.createMaterial(OUTPUT_LINEAR_SHADER, linearUniforms);
      linearUniforms.cp28Source.value = source.texture;
      linearUniforms.cp28SourceEncoded.value = Number(info.inheritedOetf);
      linearUniforms.cp28SourcePremultiplied.value = Number(info.alphaMode === "premultiplied");
      linearUniforms.cp28SourceOpaque.value = Number(info.alphaMode === "opaque");
      adapter.draw(linearMaterial, target);
      return target;
    },
    encode(source, linear, state, frame) {
      prepareView(frame);
      const { settings, info, plan, transform } = state;
      const target = acquire("output", frame, settings.enabled ? plan.format : source.format, [source.texture, linear.texture]);
      encodingMaterial ??= adapter.createMaterial(OUTPUT_ENCODING_SHADER, encodingUniforms);
      const uniforms = encodingUniforms;
      uniforms.cp28Linear.value = linear.texture;
      uniforms.cp28Original.value = source.texture;
      for (let row = 0; row < 3; row += 1) for (let column = 0; column < 3; column += 1) uniforms.cp28Matrix.value[column * 3 + row] = transform.matrix[row * 3 + column];
      uniforms.cp28Luminance.value.set(transform.luminance);
      uniforms.cp28Maximum.value = plan.maximum;
      uniforms.cp28Black.value = plan.blackNits / plan.paperWhiteNits;
      uniforms.cp28PaperWhite.value = plan.paperWhiteNits;
      uniforms.cp28Transfer.value = plan.mode === "scrgb" ? 4 : ({ linear: 0, srgb: 1, rec709: 2, pq: 3 })[plan.transfer];
      uniforms.cp28Mapping.value = ({ preserve: 0, clip: 1, compress: 2 })[plan.mapping];
      uniforms.cp28Premultiplied.value = Number(info.alphaMode === "premultiplied");
      uniforms.cp28SourceEncoded.value = Number(info.inheritedOetf);
      uniforms.cp28SourceOpaque.value = Number(info.alphaMode === "opaque");
      uniforms.cp28Copy.value = Number(!settings.enabled || info.inheritedOetf);
      uniforms.cp28Dither.value = Number(plan.dither === "bayer8");
      uniforms.cp28DitherOffset.value.set([plan.ditherSeed % 8, Math.floor(plan.ditherSeed / 8) % 8]);
      adapter.draw(encodingMaterial, target);
      return target;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      linearMaterial?.dispose();
      encodingMaterial?.dispose();
      pool.releaseOwner(OUTPUT_OWNER);
      viewGenerations.clear();
    }
  });
}
