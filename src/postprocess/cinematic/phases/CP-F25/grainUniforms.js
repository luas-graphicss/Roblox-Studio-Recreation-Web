import { hashGrainWord } from "./grainHash.js";

export function createGrainUniforms() {
  return {
    cp25Input: { value: null }, cp25GrainTexture: { value: null },
    cp25Apply: { value: false }, cp25UseTexture: { value: false },
    cp25TileOrigin: { value: [0, 0] }, cp25TextureSize: { value: [1, 1] },
    cp25TextureOffset: { value: [0, 0] }, cp25TextureSign: { value: 1 },
    cp25TexelSize: { value: 1 }, cp25Intensity: { value: 0 },
    cp25ZoneIntensities: { value: [1, 1, 1] }, cp25ZoneLimits: { value: [0.25, 0.65, 1] },
    cp25Luminance: { value: [0.2126, 0.7152, 0.0722] }, cp25SequenceSeed: { value: 0 }
  };
}

export function updateGrainUniforms(uniforms, { source, settings, sequence, domain, capture, applying, texture }) {
  uniforms.cp25Input.value = source.texture;
  uniforms.cp25Apply.value = applying;
  uniforms.cp25UseTexture.value = Boolean(texture);
  uniforms.cp25GrainTexture.value = texture?.texture ?? null;
  uniforms.cp25TexelSize.value = settings.texelSize;
  uniforms.cp25Intensity.value = settings.intensity;
  uniforms.cp25SequenceSeed.value = sequence.seed;
  uniforms.cp25TextureSign.value = (sequence.seed & 1) === 0 ? 1 : -1;
  uniforms.cp25ZoneIntensities.value.splice(0, 3, settings.shadowsIntensity, settings.midtonesIntensity, settings.highlightsIntensity);
  uniforms.cp25ZoneLimits.value.splice(0, 3, settings.shadowsMax, settings.highlightsMin, settings.highlightsMax);
  uniforms.cp25Luminance.value.splice(0, 3, ...(domain?.luminance ?? [0.2126, 0.7152, 0.0722]));
  uniforms.cp25TileOrigin.value.splice(0, 2, ...(capture?.tileOrigin ?? [0, 0]));
  uniforms.cp25TextureSize.value.splice(0, 2, texture?.asset.width ?? 1, texture?.asset.height ?? 1);
  uniforms.cp25TextureOffset.value.splice(0, 2, texture ? hashGrainWord(sequence.seed ^ 0x5bd1e995) % texture.asset.width : 0, texture ? hashGrainWord(sequence.seed ^ 0x27d4eb2d) % texture.asset.height : 0);
}
