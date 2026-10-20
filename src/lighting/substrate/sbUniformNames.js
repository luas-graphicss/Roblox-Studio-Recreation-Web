export const SB_UNIFORM_PREFIX = "uSb"


export const SB_SAMPLER_UNIFORM_TYPES = ["sampler2D", "sampler2D[]"]

export const SB_UNIFORM_NAMES = {
	uSbMaterialBuffer: { owner: "SB-F8", type: "sampler2D", textureUnitConsumer: "materialBuffer", purpose: "textura de dados com os registros de closure" },
	uSbMaterialBufferSize: { owner: "SB-F8", type: "vec2", purpose: "dimensoes da textura de material" },
	uSbClosureCount: { owner: "SB-F9", type: "int", purpose: "quantas closures avaliar neste material" },
	uSbClosureBudget: { owner: "SB-F34", type: "int", purpose: "teto de closures do tier corrente" },
	uSbTopologyId: { owner: "SB-F6", type: "int", purpose: "identificador da topologia compilada" },
	uSbLayerCoverage: { owner: "SB-F18", type: "float", purpose: "cobertura da camada de cima" },
	uSbLayerThickness: { owner: "SB-F18", type: "float", purpose: "espessura da camada de cima" },
	uSbLayerTransmittance: { owner: "SB-F18", type: "vec3", purpose: "cor de transmitancia da camada" },
	uSbRoughRefractionStrength: { owner: "SB-F19", type: "float", purpose: "desfoque da camada de baixo" },
	uSbSecondLobe: { owner: "SB-F12", type: "vec2", purpose: "segunda rugosidade e peso do lobo" },
	uSbFuzz: { owner: "SB-F13", type: "vec4", purpose: "quantidade, rugosidade e cor do fuzz" },
	uSbSheenLtc: { owner: "SB-F13", type: "sampler2D", textureUnitConsumer: "sheenLtc", purpose: "tabela LTC do sheen" },
	uSbThinFilm: { owner: "SB-F14", type: "vec2", purpose: "espessura em nanometros e IOR do filme" },
	uSbGlint: { owner: "SB-F15", type: "vec3", purpose: "densidade, rugosidade e semente dos glints" },
	uSbGlintLut: { owner: "SB-F15", type: "sampler2D", textureUnitConsumer: "glintLut", purpose: "LUT de glints" },
	uSbSpecularProfile: { owner: "SB-F16", type: "sampler2D", textureUnitConsumer: "specularProfile", purpose: "LUT de resposta especular" },
	uSbSpecularProfileIndex: { owner: "SB-F16", type: "int", purpose: "perfil selecionado" },
	uSbAnisotropy: { owner: "SB-F11", type: "vec2", purpose: "intensidade e rotacao da anisotropia" },
	uSbSubsurfaceMfp: { owner: "SB-F21", type: "vec3", purpose: "caminho livre medio por canal" },
	uSbSubsurfaceTexture: { owner: "SB-F21", type: "sampler2D", textureUnitConsumer: "subsurface", purpose: "resultado do passe de difusao" },
	uSbThinTranslucency: { owner: "SB-F22", type: "vec4", purpose: "cor e espessura da transmissao fina" },
	uSbTranslucencyTexture: { owner: "SB-F23", type: "sampler2D", textureUnitConsumer: "translucency", purpose: "acumulador de translucidez ordenada" },
	uSbHair: { owner: "SB-F24", type: "vec4", purpose: "parametros do BSDF de cabelo" },
	uSbEye: { owner: "SB-F25", type: "vec4", purpose: "parametros do BSDF de olho" },
	uSbWater: { owner: "SB-F26", type: "vec4", purpose: "absorcao e scattering da agua" },
	uSbSlabMaps: { owner: "SB-F28", type: "sampler2D[]", textureUnitConsumer: "slabMaps", purpose: "mapas por slab, ja empacotados" },
	uSbSlabMapOrm: { owner: "SB-F28", type: "sampler2D", textureUnitConsumer: "slabMaps", purpose: "slot slabOrm: roughness, metalness e f90 empacotados" },
	uSbSlabMapNormalAnisotropy: { owner: "SB-F28", type: "sampler2D", textureUnitConsumer: "slabMaps", purpose: "slot slabNormalAnisotropy: normal xy e anisotropia" },
	uSbSlabMapFeatures: { owner: "SB-F28", type: "sampler2D", textureUnitConsumer: "slabMaps", purpose: "slot slabFeatures: filme fino e glints" },
	uSbSlabMapFuzz: { owner: "SB-F28", type: "sampler2D", textureUnitConsumer: "slabMaps", purpose: "slot slabFuzz: cor e quantidade de fuzz" },
	uSbSlabMapTransmission: { owner: "SB-F28", type: "sampler2D", textureUnitConsumer: "slabMaps", purpose: "slot slabTransmission: caminho livre medio e fase" },
	uSbDecalBuffer: { owner: "SB-F29", type: "sampler2D", textureUnitConsumer: "decalBuffer", purpose: "DBuffer de decais" },
	uSbDebugMode: { owner: "SB-F35", type: "int", purpose: "modo de visualizacao de debug" },
}

function deepFreeze(value) {
	if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value
	Object.freeze(value)
	Object.values(value).forEach(deepFreeze)
	return value
}

export function uniformNames() {
	return Object.keys(SB_UNIFORM_NAMES).sort()
}

export function uniformOwner(uniformName) {
	return SB_UNIFORM_NAMES[uniformName]?.owner ?? null
}

export function uniformsOwnedBy(phaseId) {
	return uniformNames().filter((uniformName) => SB_UNIFORM_NAMES[uniformName].owner === phaseId)
}


export function uniformNamingProblems() {
	return uniformNames().filter((uniformName) => !uniformName.startsWith(SB_UNIFORM_PREFIX))
}


export function samplerUniformNames() {
	return uniformNames().filter((uniformName) => SB_SAMPLER_UNIFORM_TYPES.includes(SB_UNIFORM_NAMES[uniformName].type))
}

export function uniformTextureUnitConsumer(uniformName) {
	return SB_UNIFORM_NAMES[uniformName]?.textureUnitConsumer ?? null
}


export function samplerUniformsWithoutTextureUnitConsumer() {
	return samplerUniformNames().filter((uniformName) => !uniformTextureUnitConsumer(uniformName))
}

export function declaredTextureUnitConsumers() {
	return samplerUniformNames()
		.map((uniformName) => uniformTextureUnitConsumer(uniformName))
		.filter((consumerId) => Boolean(consumerId))
}

deepFreeze(SB_SAMPLER_UNIFORM_TYPES)
deepFreeze(SB_UNIFORM_NAMES)
