export const SB_OIT_ACCUMULATION_ANCHOR_ID = "opaqueFragment"
export const SB_OIT_TRANSLUCENCY_UNIFORM_NAME = "uSbTranslucencyTexture"


export const SB_OIT_MINIMUM_WEIGHT_LITERAL = "1e-5"


export const SB_OIT_OPAQUE_GUARD_SOURCE = "if (1.0 > gl_FragColor.a)"

const ACCUMULATION_DECLARATIONS = [
	"float sbOitWeight(float viewDepth, float coverage) {",
	"\tfloat normalizedDepth = abs(viewDepth) / 200.0;",
	"\tfloat falloff = 0.03 / (1e-5 + pow(normalizedDepth, 4.0));",
	"\treturn clamp(coverage * falloff, 1e-2, 3e3);",
	"}",
].join("\n")

const ACCUMULATION_CODE = [
	"// SB-F23: so o pixel translucido vira acumulacao. Opaco segue byte a byte.",
	SB_OIT_OPAQUE_GUARD_SOURCE + " {",
	"\tfloat sbCoverage = clamp(gl_FragColor.a, 0.0, 1.0);",
	"\tfloat sbViewDepth = gl_FragCoord.z / max(gl_FragCoord.w, 1e-5);",
	"\tfloat sbWeight = sbOitWeight(sbViewDepth, sbCoverage);",
	"\tgl_FragColor = vec4(gl_FragColor.rgb * sbCoverage * sbWeight, sbCoverage * sbWeight);",
	"}",
].join("\n")

const RESOLVE_VERTEX_SHADER = ["varying vec2 vUv;", "", "void main() {", "\tvUv = uv;", "\tgl_Position = vec4(position.xy, 0.0, 1.0);", "}"].join("\n")

const RESOLVE_FRAGMENT_SHADER = [
	"uniform sampler2D uSbTranslucencyTexture;",
	"varying vec2 vUv;",
	"",
	"void main() {",
	"\tvec4 accumulation = texture2D(uSbTranslucencyTexture, vUv);",
	"\tfloat weightSum = max(accumulation.a, 1e-5);",
	"\tvec3 averageColor = accumulation.rgb / weightSum;",
	"\tfloat coverage = clamp(1.0 - exp(-accumulation.a), 0.0, 1.0);",
	"\tgl_FragColor = vec4(averageColor, coverage);",
	"}",
].join("\n")


export const SB_OIT_ACCUMULATION_GLSL = {
	anchor: SB_OIT_ACCUMULATION_ANCHOR_ID,
	declarations: ACCUMULATION_DECLARATIONS,
	code: ACCUMULATION_CODE,
}


export const SB_OIT_RESOLVE_PROGRAM_GLSL = {
	vertexShader: RESOLVE_VERTEX_SHADER,
	fragmentShader: RESOLVE_FRAGMENT_SHADER,
	uniformNames: [SB_OIT_TRANSLUCENCY_UNIFORM_NAME],
}

const UNIFORM_DECLARATION_PATTERN = /uniform\s+\w+\s+(\w+)/g

function declaredUniformNames(source) {
	const names = []
	for (const match of source.matchAll(UNIFORM_DECLARATION_PATTERN)) names.push(match[1])
	return names
}







export function oitGlslProblems() {
	const problems = []
	const sources = [
		{ name: "acumulacao.declarations", source: SB_OIT_ACCUMULATION_GLSL.declarations },
		{ name: "acumulacao.code", source: SB_OIT_ACCUMULATION_GLSL.code },
		{ name: "resolve.vertexShader", source: SB_OIT_RESOLVE_PROGRAM_GLSL.vertexShader },
		{ name: "resolve.fragmentShader", source: SB_OIT_RESOLVE_PROGRAM_GLSL.fragmentShader },
	]

	for (const entry of sources) {
		if (typeof entry.source !== "string" || entry.source.length === 0) {
			problems.push(entry.name + " esta vazio")
			continue
		}
		if (entry.source.includes("${")) problems.push(entry.name + " interpola template em tempo de frame")
		if (entry.source.includes("#include")) problems.push(entry.name + " traz include proprio")
		for (const uniformName of declaredUniformNames(entry.source)) {
			if (!SB_OIT_RESOLVE_PROGRAM_GLSL.uniformNames.includes(uniformName)) {
				problems.push(entry.name + " usa uniform nao reservado: " + uniformName)
			}
		}
	}

	if (!SB_OIT_ACCUMULATION_GLSL.code.includes(SB_OIT_OPAQUE_GUARD_SOURCE)) {
		problems.push("a acumulacao perdeu a guarda do pixel opaco")
	}
	if (!SB_OIT_RESOLVE_PROGRAM_GLSL.fragmentShader.includes(SB_OIT_MINIMUM_WEIGHT_LITERAL)) {
		problems.push("o resolve nao usa o piso de peso declarado")
	}

	return problems
}
