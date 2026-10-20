export const SB_DECAL_GLSL_OWNER = "SB-F29"
export const SB_DECAL_GLSL_UNIFORM_NAME = "uSbDecal"
export const SB_DECAL_GLSL_ROUGHNESS_ANCHOR = "roughnessMapFragment"
export const SB_DECAL_GLSL_NORMAL_ANCHOR = "normalFragmentMaps"
export const SB_DECAL_GLSL_MIRROR_TOLERANCE = 0.25

const DECLARATIONS = `
                                                                               
uniform vec4 uSbDecal;

vec3 sbDecalNormalFromChannels(vec2 encodedNormalXy) {
	vec2 clampedNormalXy = clamp(encodedNormalXy, -1.0, 1.0);
	float squaredLength = dot(clampedNormalXy, clampedNormalXy);
	float reconstructedZ = sqrt(max(0.0, 1.0 - squaredLength));
	return normalize(vec3(clampedNormalXy, reconstructedZ));
}

float sbBlendDecalRoughness(float baseRoughness, float decalRoughness, float decalOpacity) {
	float baseVariance = baseRoughness * baseRoughness;
	float decalVariance = decalRoughness * decalRoughness;
	return sqrt(mix(baseVariance, decalVariance, decalOpacity));
}

vec3 sbBlendDecalNormal(vec3 baseNormal, vec3 decalNormal, float decalOpacity) {
	return normalize(mix(baseNormal, decalNormal, decalOpacity));
}
`

const ROUGHNESS_CODE = `
                                                                       
	if (uSbDecal.w > 0.0) {
		roughnessFactor = sbBlendDecalRoughness(roughnessFactor, uSbDecal.z, uSbDecal.w);
	}
`

const NORMAL_CODE = `
                                                                  
	if (uSbDecal.w > 0.0) {
		normal = sbBlendDecalNormal(normal, sbDecalNormalFromChannels(uSbDecal.xy), uSbDecal.w);
	}
`

export const SB_DECAL_GLSL = Object.freeze({
	declarations: DECLARATIONS,
	roughnessCode: ROUGHNESS_CODE,
	normalCode: NORMAL_CODE,
})


export function mirrorDecalRoughness(baseRoughness, decalRoughness, opacity) {
	const baseVariance = baseRoughness * baseRoughness
	const decalVariance = decalRoughness * decalRoughness
	return Math.sqrt(baseVariance + (decalVariance - baseVariance) * opacity)
}


export function decalGlslUniformTokens() {
	const tokens = new Set()
	const tokenPattern = /\buSb[A-Za-z0-9_]*/g
	for (const text of [DECLARATIONS, ROUGHNESS_CODE, NORMAL_CODE]) {
		const matches = text.match(tokenPattern) ?? []
		for (const token of matches) tokens.add(token)
	}
	return [...tokens].sort()
}

function braceBalanceOf(text) {
	let depth = 0
	for (const character of text) {
		if ("{" === character) depth += 1
		if ("}" === character) depth -= 1
		if (0 > depth) return depth
	}
	return depth
}


export function decalGlslProblems() {
	const problems = []

	if (!DECLARATIONS.includes(`uniform vec4 ${SB_DECAL_GLSL_UNIFORM_NAME};`)) {
		problems.push(`as declaracoes nao declaram ${SB_DECAL_GLSL_UNIFORM_NAME}`)
	}
	for (const [label, text] of [
		["declaracoes", DECLARATIONS],
		["rugosidade", ROUGHNESS_CODE],
		["normal", NORMAL_CODE],
	]) {
		if (0 !== braceBalanceOf(text)) problems.push(`o trecho de ${label} tem chaves desbalanceadas`)
	}
	if (ROUGHNESS_CODE.includes("uniform ") || NORMAL_CODE.includes("uniform ")) {
		problems.push("um trecho de aplicacao declara uniform dentro do main")
	}
	if (!ROUGHNESS_CODE.includes("roughnessFactor")) {
		problems.push(`o trecho de rugosidade nao escreve em roughnessFactor, alvo da ancora ${SB_DECAL_GLSL_ROUGHNESS_ANCHOR}`)
	}
	if (!NORMAL_CODE.includes("normal =")) {
		problems.push(`o trecho de normal nao escreve em normal, alvo da ancora ${SB_DECAL_GLSL_NORMAL_ANCHOR}`)
	}
	if (DECLARATIONS.includes("texture2D") || DECLARATIONS.includes("texture(")) {
		problems.push("o decal leu textura: o DBuffer ainda nao tem passe escritor nesta bancada")
	}
	const unexpectedTokens = decalGlslUniformTokens().filter((token) => token !== SB_DECAL_GLSL_UNIFORM_NAME)
	if (0 !== unexpectedTokens.length) {
		problems.push(`tokens uSb nao declarados pela fase: ${unexpectedTokens.join(", ")}`)
	}
	return problems
}

export function describeDecalGlsl() {
	return {
		owner: SB_DECAL_GLSL_OWNER,
		uniformName: SB_DECAL_GLSL_UNIFORM_NAME,
		roughnessAnchor: SB_DECAL_GLSL_ROUGHNESS_ANCHOR,
		normalAnchor: SB_DECAL_GLSL_NORMAL_ANCHOR,
		mirrorTolerance: SB_DECAL_GLSL_MIRROR_TOLERANCE,
		uniformTokens: decalGlslUniformTokens(),
		declarationLineCount: DECLARATIONS.trim().split("\n").length,
	}
}
