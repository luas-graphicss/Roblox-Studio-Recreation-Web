import { SB_BYTES_PER_PIXEL_CEILING, SB_MAX_CLOSURES_PER_PIXEL } from "./sbMaterialContract.js"
import { DEFAULT_CLOSURE_KIND, closureKindBytes } from "./sbClosureDispatchCore.js"
import { SB_CLOSURE_DISPATCH_READY_DEFINE } from "./sbClosureDispatchGlsl.js"
import { SB_DEBUG_MODES, SB_DEBUG_MODE_IDS, SB_DEBUG_RAMP_STOPS } from "./sbDebugVisualizationCore.js"

export const SB_DEBUG_VISUALIZATION_READY_DEFINE = "SB_DEBUG_VISUALIZATION_READY"
export const SB_DEBUG_MODE_UNIFORM_NAME = "uSbDebugMode"
export const SB_DEBUG_CLOSURE_COUNT_CEILING_DEFINE = "SB_DEBUG_CLOSURE_COUNT_CEILING"
export const SB_DEBUG_BYTES_PER_PIXEL_CEILING_DEFINE = "SB_DEBUG_BYTES_PER_PIXEL_CEILING"
export const SB_DEBUG_CLOSURE_BYTES_DEFINE = "SB_DEBUG_CLOSURE_BYTES"


export const SHADING_TARGETS_THAT_MUST_STAY_INTACT = Object.freeze([
	"diffuseColor",
	"outgoingLight",
	"reflectedLight",
	"material",
	"normal",
	"roughnessFactor",
	"metalnessFactor",
])

export function formatGlslFloat(value) {
	return Number(value).toFixed(6)
}

function upperSnakeFromCamelCase(text) {
	let result = ""
	for (const character of text) {
		const isUpperCase = character !== character.toLowerCase() && character === character.toUpperCase()
		if (isUpperCase) result += "_"
		result += character.toUpperCase()
	}
	return result
}

export function glslModeDefineName(modeId) {
	return "SB_DEBUG_MODE_" + upperSnakeFromCamelCase(modeId)
}

function rampStopVector(stop) {
	return "vec3(" + stop.map(formatGlslFloat).join(", ") + ")"
}






function rampColorFunctionLines() {
	const segmentCount = SB_DEBUG_RAMP_STOPS.length - 1
	const lines = [
		"vec3 sbDebugRampColor(const in float ratio) {",
		"\tfloat clampedRatio = clamp(ratio, 0.0, 1.0);",
		"\tfloat scaledRatio = clampedRatio * " + formatGlslFloat(segmentCount) + ";",
		"\tvec3 rampColor = " + rampStopVector(SB_DEBUG_RAMP_STOPS[0]) + ";",
	]
	for (let segment = 0; segmentCount > segment; segment += 1) {
		lines.push(
			"\trampColor = mix(rampColor, " +
				rampStopVector(SB_DEBUG_RAMP_STOPS[segment + 1]) +
				", clamp(scaledRatio - " +
				formatGlslFloat(segment) +
				", 0.0, 1.0));",
		)
	}
	lines.push("\treturn rampColor;", "}")
	return lines
}


export function buildDebugVisualizationDeclarations() {
	return [
		"// SB-F35: modos de debug de material. Texto GERADO das constantes do nucleo.",
		"#define " + SB_DEBUG_VISUALIZATION_READY_DEFINE + " 1",
		...SB_DEBUG_MODES.map((mode) => "#define " + glslModeDefineName(mode.id) + " " + mode.code),
		"#define " + SB_DEBUG_CLOSURE_COUNT_CEILING_DEFINE + " " + formatGlslFloat(SB_MAX_CLOSURES_PER_PIXEL),
		"#define " + SB_DEBUG_BYTES_PER_PIXEL_CEILING_DEFINE + " " + formatGlslFloat(SB_BYTES_PER_PIXEL_CEILING),
		"#define " + SB_DEBUG_CLOSURE_BYTES_DEFINE + " " + formatGlslFloat(closureKindBytes(DEFAULT_CLOSURE_KIND)),
		"",
		"uniform int " + SB_DEBUG_MODE_UNIFORM_NAME + ";",
		"",
		...rampColorFunctionLines(),
		"",
		"float sbDebugClosureCountRatio(const in float closureCount) {",
		"\treturn clamp(closureCount / " + SB_DEBUG_CLOSURE_COUNT_CEILING_DEFINE + ", 0.0, 1.0);",
		"}",
		"",
		"float sbDebugBytesPerPixelRatio(const in float closureCount) {",
		"\treturn clamp(closureCount * " +
			SB_DEBUG_CLOSURE_BYTES_DEFINE +
			" / " +
			SB_DEBUG_BYTES_PER_PIXEL_CEILING_DEFINE +
			", 0.0, 1.0);",
		"}",
	].join("\n")
}


export function buildDebugVisualizationCode() {
	return [
		"#ifdef " + SB_DEBUG_VISUALIZATION_READY_DEFINE,
		"{",
		"#ifdef " + SB_CLOSURE_DISPATCH_READY_DEFINE,
		"\tfloat sbDebugClosureCount = float(sbActiveClosureCount());",
		"#else",
		"\tfloat sbDebugClosureCount = 1.0;",
		"#endif",
		"\tif (" +
			SB_DEBUG_MODE_UNIFORM_NAME +
			" == " +
			glslModeDefineName(SB_DEBUG_MODE_IDS.materialCount) +
			") {",
		"\t\tgl_FragColor.rgb = sbDebugRampColor(sbDebugClosureCountRatio(sbDebugClosureCount));",
		"\t}",
		"\tif (" +
			SB_DEBUG_MODE_UNIFORM_NAME +
			" == " +
			glslModeDefineName(SB_DEBUG_MODE_IDS.bytesPerPixel) +
			") {",
		"\t\tgl_FragColor.rgb = sbDebugRampColor(sbDebugBytesPerPixelRatio(sbDebugClosureCount));",
		"\t}",
		"}",
		"#endif",
	].join("\n")
}


export function buildDebugVisualizationGlsl() {
	return {
		declarations: buildDebugVisualizationDeclarations(),
		code: buildDebugVisualizationCode(),
	}
}

function isIdentifierCharacter(character) {
	if (character === "_") return true
	if (character >= "0" && "9" >= character) return true
	if (character >= "a" && "z" >= character) return true
	return character >= "A" && "Z" >= character
}

const ASSIGNMENT_PREFIXES = Object.freeze(["+=", "-=", "*=", "/="])

function isAssignmentAt(text, index) {
	const pair = text.slice(index, index + 2)
	if (ASSIGNMENT_PREFIXES.includes(pair)) return true
	return text[index] === "=" && text[index + 1] !== "="
}


export function findShadingWrites(glslText) {
	const text = typeof glslText === "string" ? glslText : ""
	const writes = []
	for (const target of SHADING_TARGETS_THAT_MUST_STAY_INTACT) {
		let searchIndex = text.indexOf(target)
		while (searchIndex !== -1) {
			const characterBefore = searchIndex === 0 ? "" : text[searchIndex - 1]
			const isOwnToken = characterBefore === "" || !isIdentifierCharacter(characterBefore)
			if (isOwnToken) {
				let cursor = searchIndex + target.length
				while (cursor !== text.length && isIdentifierCharacter(text[cursor])) cursor += 1
				while (cursor !== text.length && (text[cursor] === "." || text[cursor] === "[" || text[cursor] === "]")) {
					cursor += 1
					while (cursor !== text.length && isIdentifierCharacter(text[cursor])) cursor += 1
				}
				while (cursor !== text.length && (text[cursor] === " " || text[cursor] === "\t")) cursor += 1
				if (isAssignmentAt(text, cursor)) writes.push(target)
			}
			searchIndex = text.indexOf(target, searchIndex + 1)
		}
	}
	return writes
}

function countOccurrences(text, token) {
	let count = 0
	let searchIndex = text.indexOf(token)
	while (searchIndex !== -1) {
		count += 1
		searchIndex = text.indexOf(token, searchIndex + token.length)
	}
	return count
}


export function debugVisualizationGlslProblems(glsl) {
	const problems = []
	const declarations = typeof glsl?.declarations === "string" ? glsl.declarations : ""
	const code = typeof glsl?.code === "string" ? glsl.code : ""

	if (countOccurrences(declarations, "uniform int " + SB_DEBUG_MODE_UNIFORM_NAME + ";") !== 1) {
		problems.push("o uniform " + SB_DEBUG_MODE_UNIFORM_NAME + " nao foi declarado exatamente uma vez")
	}
	if (countOccurrences(code, "uniform ") !== 0) {
		problems.push("o bloco do main declara uniform, e uniform dentro do main nao compila")
	}
	for (const mode of SB_DEBUG_MODES) {
		if (!declarations.includes("#define " + glslModeDefineName(mode.id) + " " + mode.code)) {
			problems.push("o codigo do modo " + mode.id + " nao saiu compilado igual ao do nucleo")
		}
	}
	for (const stop of SB_DEBUG_RAMP_STOPS) {
		if (!declarations.includes(rampStopVector(stop))) {
			problems.push("uma parada da rampa nao saiu impressa com os numeros do nucleo")
		}
	}
	if (!declarations.includes("#define " + SB_DEBUG_CLOSURE_BYTES_DEFINE + " " + formatGlslFloat(closureKindBytes(DEFAULT_CLOSURE_KIND)))) {
		problems.push("os bytes da closure nao vieram do layout da SB-F8")
	}
	if (!code.includes("#ifdef " + SB_DEBUG_VISUALIZATION_READY_DEFINE)) {
		problems.push("o bloco do main nao esta protegido pelo ifdef de prontidao")
	}
	if (!code.includes("#ifdef " + SB_CLOSURE_DISPATCH_READY_DEFINE)) {
		problems.push("o bloco do main nao le a contagem da SB-F9 dentro do ifdef dela")
	}
	if (!code.includes("gl_FragColor.rgb = sbDebugRampColor(")) {
		problems.push("o bloco do main nao pinta gl_FragColor com a rampa")
	}
	const shadingWrites = findShadingWrites(declarations + "\n" + code)
	if (shadingWrites.length !== 0) {
		problems.push("o debug escreve entrada de shading: " + shadingWrites.join(", "))
	}
	for (const [text, label] of [
		[declarations, "declaracoes"],
		[code, "codigo"],
	]) {
		if (countOccurrences(text, "{") !== countOccurrences(text, "}")) {
			problems.push("chaves desbalanceadas nas " + label)
		}
	}
	if (countOccurrences(code, "#ifdef ") !== countOccurrences(code, "#endif")) {
		problems.push("diretivas de ifdef desbalanceadas no codigo")
	}
	return problems
}
