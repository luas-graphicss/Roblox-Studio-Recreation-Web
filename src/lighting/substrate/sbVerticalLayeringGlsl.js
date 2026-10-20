import { SB_UNIFORM_NAMES } from "./sbUniformNames.js"
import {
	SB_LAYER_REFERENCE_THICKNESS,
	SB_MINIMUM_TRANSMITTANCE_CHANNEL,
	SB_MINIMUM_VIEW_COSINE,
} from "./sbLayerTransmittanceCore.js"

export const SB_VERTICAL_LAYERING_GLSL_OWNER = "SB-F18"

export const SB_VERTICAL_LAYERING_UNIFORM_NAMES = Object.freeze({
	coverage: "uSbLayerCoverage",
	thickness: "uSbLayerThickness",
	transmittance: "uSbLayerTransmittance",
})

export const SB_VERTICAL_LAYERING_GLSL_FUNCTION_NAMES = Object.freeze({
	absorption: "sbLayerAbsorptionCoefficients",
	pathLength: "sbLayerPathLength",
	transmittance: "sbLayerTransmittance",
	bottomAttenuation: "sbLayerBottomAttenuation",
})

export const SB_VERTICAL_LAYERING_GLSL_CONSTANTS = Object.freeze({
	referenceThickness: SB_LAYER_REFERENCE_THICKNESS,
	minimumTransmittanceChannel: SB_MINIMUM_TRANSMITTANCE_CHANNEL,
	minimumViewCosine: SB_MINIMUM_VIEW_COSINE,
})

const GLSL_CONSTANT_NAMES = Object.freeze({
	referenceThickness: "SB_LAYER_REFERENCE_THICKNESS",
	minimumTransmittanceChannel: "SB_MINIMUM_TRANSMITTANCE_CHANNEL",
	minimumViewCosine: "SB_MINIMUM_VIEW_COSINE",
})

const EXPECTED_UNIFORM_COUNT = 3


const FORBIDDEN_TOKENS = Object.freeze(["dFdx", "dFdy", "fwidth", "geometry.", "texture2D", "texture("])


function glslFloat(value) {
	if (Number.isInteger(value)) return value.toFixed(1)
	const text = String(value)
	return text.includes("e") ? value.toFixed(8) : text
}


function uniformDeclaration(uniformName) {
	const declared = SB_UNIFORM_NAMES[uniformName]
	return "uniform " + (declared?.type ?? "float") + " " + uniformName + ";"
}

function constantDeclaration(constantKey, value) {
	return "const float " + GLSL_CONSTANT_NAMES[constantKey] + " = " + glslFloat(value) + ";"
}

const UNIFORMS = SB_VERTICAL_LAYERING_UNIFORM_NAMES
const FUNCTIONS = SB_VERTICAL_LAYERING_GLSL_FUNCTION_NAMES

export const SB_VERTICAL_LAYERING_DECLARATIONS_GLSL = [
	"// SB-F18: transmitancia de camada por Beer-Lambert.",
	"// Espelho exato de src/substrate/sbLayerTransmittanceCore.js.",
	uniformDeclaration(UNIFORMS.coverage),
	uniformDeclaration(UNIFORMS.thickness),
	uniformDeclaration(UNIFORMS.transmittance),
	"",
	constantDeclaration("referenceThickness", SB_LAYER_REFERENCE_THICKNESS),
	constantDeclaration("minimumTransmittanceChannel", SB_MINIMUM_TRANSMITTANCE_CHANNEL),
	constantDeclaration("minimumViewCosine", SB_MINIMUM_VIEW_COSINE),
	"",
	"// Absorcao por canal: a cor autorada e a transmitancia na espessura 1.",
	"vec3 " + FUNCTIONS.absorption + "( vec3 transmittanceColor ) {",
	"\tvec3 measuredTransmittance = clamp( transmittanceColor, " + GLSL_CONSTANT_NAMES.minimumTransmittanceChannel + ", 1.0 );",
	"\treturn -log( measuredTransmittance ) / " + GLSL_CONSTANT_NAMES.referenceThickness + ";",
	"}",
	"",
	"// Caminho optico: a visada rasante alonga, com piso para nao explodir.",
	"float " + FUNCTIONS.pathLength + "( float thickness, float viewCosine ) {",
	"\treturn max( thickness, 0.0 ) / max( viewCosine, " + GLSL_CONSTANT_NAMES.minimumViewCosine + " );",
	"}",
	"",
	"vec3 " + FUNCTIONS.transmittance + "( vec3 transmittanceColor, float thickness, float viewCosine ) {",
	"\tvec3 absorption = " + FUNCTIONS.absorption + "( transmittanceColor );",
	"\treturn exp( -absorption * " + FUNCTIONS.pathLength + "( thickness, viewCosine ) );",
	"}",
	"",
	"// Quanto da camada de baixo sobrevive: cobertura 0 devolve ela intacta.",
	"vec3 " + FUNCTIONS.bottomAttenuation + "( vec3 transmittanceColor, float thickness, float coverage, float viewCosine ) {",
	"\tvec3 transmittance = " + FUNCTIONS.transmittance + "( transmittanceColor, thickness, viewCosine );",
	"\treturn mix( vec3( 1.0 ), transmittance, clamp( coverage, 0.0, 1.0 ) );",
	"}",
].join("\n")

export const SB_VERTICAL_LAYERING_APPLY_GLSL = [
	"// SB-F18: o que esta EMBAIXO da camada e visto ATRAVES dela.",
	"// Roda com o reflectedLight ja somado; o emissivo fica de fora de",
	"// proposito, porque luz propria do material nao atravessa o verniz.",
	"{",
	"\tfloat sbLayerViewCosine = clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 );",
	"\tvec3 sbLayerAttenuation = " +
		FUNCTIONS.bottomAttenuation +
		"( " +
		UNIFORMS.transmittance +
		", " +
		UNIFORMS.thickness +
		", " +
		UNIFORMS.coverage +
		", sbLayerViewCosine );",
	"\treflectedLight.directDiffuse *= sbLayerAttenuation;",
	"\treflectedLight.indirectDiffuse *= sbLayerAttenuation;",
	"\treflectedLight.directSpecular *= sbLayerAttenuation;",
	"\treflectedLight.indirectSpecular *= sbLayerAttenuation;",
	"}",
].join("\n")

function hasUnbalancedBraces(text) {
	let depth = 0
	for (const character of text) {
		if (character === "{") depth += 1
		if (character === "}") depth -= 1
		if (0 > depth) return true
	}
	return depth !== 0
}


export function findVerticalLayeringGlslProblems() {
	const problems = []
	const declarations = SB_VERTICAL_LAYERING_DECLARATIONS_GLSL
	const apply = SB_VERTICAL_LAYERING_APPLY_GLSL

	for (const [role, uniformName] of Object.entries(UNIFORMS)) {
		const declared = SB_UNIFORM_NAMES[uniformName]
		if (!declared) {
			problems.push("uniforme fora do contrato de nomes: " + uniformName)
			continue
		}
		if (declared.owner !== SB_VERTICAL_LAYERING_GLSL_OWNER) {
			problems.push("uniforme " + uniformName + " e da fase " + declared.owner)
		}
		if (!declarations.includes(uniformDeclaration(uniformName))) {
			problems.push("uniforme nao declarado no GLSL: " + uniformName)
		}
		if (!apply.includes(uniformName)) {
			problems.push("uniforme declarado e nunca usado: " + uniformName + " (" + role + ")")
		}
	}

	const uniformLineCount = declarations.split("\n").filter((line) => line.trim().startsWith("uniform ")).length
	if (uniformLineCount !== EXPECTED_UNIFORM_COUNT) {
		problems.push("o GLSL declara " + uniformLineCount + " uniformes e a fase reservou " + EXPECTED_UNIFORM_COUNT)
	}

	for (const functionName of Object.values(FUNCTIONS)) {
		if (!declarations.includes(functionName + "(")) {
			problems.push("funcao ausente das declaracoes: " + functionName)
		}
		if (apply.includes(functionName + "(") && !declarations.includes(functionName + "(")) {
			problems.push("a aplicacao chama uma funcao nao declarada: " + functionName)
		}
	}
	if (!apply.includes(FUNCTIONS.bottomAttenuation + "(")) {
		problems.push("a aplicacao nao chama " + FUNCTIONS.bottomAttenuation)
	}

	const expectedConstants = [
		["referenceThickness", SB_LAYER_REFERENCE_THICKNESS],
		["minimumTransmittanceChannel", SB_MINIMUM_TRANSMITTANCE_CHANNEL],
		["minimumViewCosine", SB_MINIMUM_VIEW_COSINE],
	]
	for (const [constantKey, value] of expectedConstants) {
		if (!declarations.includes(constantDeclaration(constantKey, value))) {
			problems.push("constante do core ausente no GLSL: " + GLSL_CONSTANT_NAMES[constantKey])
		}
	}

	for (const token of FORBIDDEN_TOKENS) {
		if (declarations.includes(token) || apply.includes(token)) {
			problems.push("token proibido no GLSL da fase: " + token)
		}
	}
	if (declarations.includes("if (") || apply.includes("if (")) {
		problems.push("a fase nao pode ramificar no fragment: use clamp, max e mix")
	}
	if (hasUnbalancedBraces(declarations)) problems.push("chaves desbalanceadas nas declaracoes")
	if (hasUnbalancedBraces(apply)) problems.push("chaves desbalanceadas na aplicacao")

	return problems
}
