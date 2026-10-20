export const SUBSTRATE_PUBLIC_API = Object.freeze({
  SubstrateEnabled: Object.freeze({ type: 'boolean?', category: 'Lighting', description: 'Substrate material rendering. AUTO uses eligible WebGL2 Future on medium/high tiers; false keeps legacy materials. Weak/unknown tiers and shader safe mode always veto it.' }),
  SubstrateMaterial: Object.freeze({ type: 'string', category: 'Appearance', description: 'Serialized Substrate material tree JSON. Empty inherits the existing material, maps, tint, alpha and emission. Invalid or unsupported trees report a refusal instead of executing code. BasePart overrides SurfaceAppearance.' }),
});
