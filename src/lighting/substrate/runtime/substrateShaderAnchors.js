export const SUBSTRATE_SHADER_ANCHORS = Object.freeze({
  common: { chunk: 'common', stage: 'fragment', signature: /#define PI/ },
  bsdfs: { chunk: 'common', stage: 'fragment', signature: /#define PI/ },
  lightsPhysicalPars: { chunk: 'lights_physical_pars_fragment', stage: 'fragment', signature: /struct PhysicalMaterial/ },
  lightsFragmentBegin: { chunk: 'lights_fragment_begin', stage: 'fragment', signature: /RE_Direct/ },
  lightsFragmentMaps: { chunk: 'lights_fragment_maps', stage: 'fragment', signature: /irradiance/ },
  lightsFragmentEnd: { chunk: 'lights_fragment_end', stage: 'fragment', signature: /RE_IndirectDiffuse|RE_IndirectSpecular/ },
  mapFragment: { chunk: 'map_fragment', stage: 'fragment', signature: /diffuseColor/ },
  normalFragmentMaps: { chunk: 'normal_fragment_maps', stage: 'fragment', signature: /normal/ },
  roughnessMapFragment: { chunk: 'roughnessmap_fragment', stage: 'fragment', signature: /roughnessFactor/ },
  metalnessMapFragment: { chunk: 'metalnessmap_fragment', stage: 'fragment', signature: /metalnessFactor/ },
  transmissionFragment: { chunk: 'transmission_fragment', stage: 'fragment', signature: /transmission/ },
  envmapPhysicalPars: { chunk: 'envmap_physical_pars_fragment', stage: 'fragment', signature: /getIBLRadiance/ },
  shadowmapPars: { chunk: 'shadowmap_pars_fragment', stage: 'fragment', signature: /getShadow/ },
  opaqueFragment: { chunk: 'opaque_fragment', stage: 'fragment', signature: /outgoingLight/ },
  beginVertex: { chunk: 'begin_vertex', stage: 'vertex', signature: /transformed/ },
  defaultNormalVertex: { chunk: 'defaultnormal_vertex', stage: 'vertex', signature: /transformedNormal/ },
});
export function checkSubstrateAnchor(THREE, id) {
  const anchor = SUBSTRATE_SHADER_ANCHORS[id];
  const source = anchor && THREE?.ShaderChunk?.[anchor.chunk];
  const present = typeof source === 'string' && anchor.signature.test(source);
  return { anchorId: id, present, reason: present ? null : 'Required Three shader chunk signature is unavailable' };
}
