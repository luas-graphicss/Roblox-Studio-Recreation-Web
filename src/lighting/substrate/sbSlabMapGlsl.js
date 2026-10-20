import { SB_SLAB_MAP_CHANNELS, slabMapSlot, slabMapSlotNames } from "./sbSlabMapPlanCore.js"
import { SB_DIELECTRIC_F0 } from "./sbMapPackingCore.js"
import {
	SB_SLAB_MAP_DERIVATIONS,
	slabMapChannelDestination,
	slabMapFieldDefault,
	slabMapFieldRange,
} from "./sbSlabMapCodecCore.js"

export const SB_SLAB_MAP_GLSL_OWNER = "SB-F28"


export const SB_SLAB_MAP_GLSL_ANCHOR = "lightsPhysicalPars"

export const SB_SLAB_MAP_GLSL_STRUCT_NAME = "SbSlabMapSample"
export const SB_SLAB_MAP_GLSL_DIELECTRIC_F0_DEFINE = "SB_SLAB_MAP_DIELECTRIC_F0"

const COMPONENT_ACCESSORS = ["x", "y", "z"]
const SINGLE_COMPONENT_COUNT = 1


function glslFloatLiteral(value) {
	if (!Number.isFinite(value)) return "0.0"
	return Number.isInteger(value) ? value.toFixed(1) : String(value)
}

function glslTypeFor(componentCount) {
	return componentCount > SINGLE_COMPONENT_COUNT ? "vec3" : "float"
}

function glslValueLiteral(value, componentCount) {
	if (SINGLE_COMPONENT_COUNT >= componentCount) return glslFloatLiteral(value)
	const channels = Array.isArray(value) ? value : [value, value, value]
	return "vec3( " + channels.map((channel) => glslFloatLiteral(channel)).join(", ") + " )"
}

function capitalizeFirstLetter(text) {
	return text.charAt(0).toUpperCase() + text.slice(1)
}


export function slabMapDecodeFunctionName(slotName) {
	return "sbDecode" + capitalizeFirstLetter(slotName) + "Map"
}

function assignmentTargetFor(fieldName, componentCount, component) {
	if (SINGLE_COMPONENT_COUNT >= componentCount) return "slabSample." + fieldName
	return "slabSample." + fieldName + "." + COMPONENT_ACCESSORS[component]
}


function collectStructFields() {
	const fields = []
	const seenFieldNames = new Set()

	const appendField = (fieldName) => {
		if (!fieldName || seenFieldNames.has(fieldName)) return
		const range = slabMapFieldRange(fieldName)
		if (!range) return
		seenFieldNames.add(fieldName)
		fields.push({
			name: fieldName,
			componentCount: range.componentCount,
			type: glslTypeFor(range.componentCount),
			defaultValue: slabMapFieldDefault(fieldName),
		})
	}

	for (const slotName of slabMapSlotNames()) {
		for (const channelName of SB_SLAB_MAP_CHANNELS) {
			const destination = slabMapChannelDestination(slotName, channelName)
			if (destination) appendField(destination.field)
		}
	}
	for (const derivation of Object.values(SB_SLAB_MAP_DERIVATIONS)) appendField(derivation.targetField)

	return fields
}

const STRUCT_FIELDS = collectStructFields()

function buildStructText() {
	return [
		"struct " + SB_SLAB_MAP_GLSL_STRUCT_NAME + " {",
		...STRUCT_FIELDS.map((field) => "\t" + field.type + " " + field.name + ";"),
		"};",
	].join("\n")
}

function buildHelperText() {
	return [
		"// Canal normalizado de volta para as unidades do parametro (SB-F4 e dona das faixas).",
		"float sbDecodeSlabMapChannel( const in float encodedChannel, const in float minimumValue, const in float maximumValue ) {",
		"\treturn minimumValue + clamp( encodedChannel, 0.0, 1.0 ) * ( maximumValue - minimumValue );",
		"}",
		"",
		"// z reconstruido dos dois canais: a normal nunca sai curta.",
		"vec3 sbReconstructSlabMapNormal( const in vec2 tangentSpaceXy ) {",
		"\tvec2 clampedXy = clamp( tangentSpaceXy, -1.0, 1.0 );",
		"\tfloat reconstructedZ = sqrt( max( 0.0, 1.0 - dot( clampedXy, clampedXy ) ) );",
		"\treturn normalize( vec3( clampedXy, reconstructedZ ) );",
		"}",
		"",
		"// F0 pelo fluxo metalness do glTF, a mesma conta do IL-F10.",
		"vec3 sbSlabMapF0FromMetalness( const in float metalness, const in vec3 albedo ) {",
		"\treturn mix( vec3( " +
			SB_SLAB_MAP_GLSL_DIELECTRIC_F0_DEFINE +
			" ), clamp( albedo, vec3( 0.0 ), vec3( 1.0 ) ), clamp( metalness, 0.0, 1.0 ) );",
		"}",
	].join("\n")
}

function buildResetText() {
	return [
		"// Valor de partida de cada campo: o default autorado da SB-F4.",
		"// RESIDUO: na engine o valor de partida vem do buffer de material (SB-F8).",
		"void sbResetSlabMapSampleToDefaults( inout " + SB_SLAB_MAP_GLSL_STRUCT_NAME + " slabSample ) {",
		...STRUCT_FIELDS.map(
			(field) =>
				"\tslabSample." + field.name + " = " + glslValueLiteral(field.defaultValue, field.componentCount) + ";",
		),
		"}",
	].join("\n")
}

function buildSlotDecoderText(slotName) {
	const slot = slabMapSlot(slotName)
	const lines = [
		"// " + slotName + ": reusa o slot " + slot.reusedEngineSlot + " do IL-F10 (" + slot.colorSpace + ").",
		"void " +
			slabMapDecodeFunctionName(slotName) +
			"( const in vec4 texel, inout " +
			SB_SLAB_MAP_GLSL_STRUCT_NAME +
			" slabSample ) {",
	]

	for (const channelName of SB_SLAB_MAP_CHANNELS) {
		const destination = slabMapChannelDestination(slotName, channelName)
		if (!destination) continue
		const range = slabMapFieldRange(destination.field)
		if (!range) continue
		lines.push(
			"\t" +
				assignmentTargetFor(destination.field, range.componentCount, destination.component) +
				" = sbDecodeSlabMapChannel( texel." +
				channelName +
				", " +
				glslFloatLiteral(range.minimum) +
				", " +
				glslFloatLiteral(range.maximum) +
				" );",
		)
	}

	lines.push("}")
	return lines.join("\n")
}

function buildDerivationText() {
	const f0Derivation = SB_SLAB_MAP_DERIVATIONS.metalnessToF0
	return [
		"// Campos que nao viajam prontos: a normal fecha o z e o f0 sai do metalness.",
		"void sbResolveSlabMapDerivations( inout " + SB_SLAB_MAP_GLSL_STRUCT_NAME + " slabSample ) {",
		"\tslabSample.normal = sbReconstructSlabMapNormal( slabSample.normal.xy );",
		"\tslabSample." +
			f0Derivation.targetField +
			" = sbSlabMapF0FromMetalness( slabSample." +
			f0Derivation.sourceField +
			", slabSample.albedo );",
		"}",
	].join("\n")
}

const declarations = [
	"// SB-F28 mapas por slab. Texto GERADO do plano de canais, nao escrito a mao.",
	"// Sem sampler declarado: a unidade slabMaps fica reservada e nao consumida.",
	"#define " + SB_SLAB_MAP_GLSL_DIELECTRIC_F0_DEFINE + " " + glslFloatLiteral(SB_DIELECTRIC_F0),
	"",
	buildStructText(),
	"",
	buildHelperText(),
].join("\n")

const code = [
	buildResetText(),
	"",
	...slabMapSlotNames().map((slotName) => buildSlotDecoderText(slotName) + "\n"),
	buildDerivationText(),
].join("\n")

export const SB_SLAB_MAP_GLSL = Object.freeze({ declarations, code })


export const SB_SLAB_MAP_GLSL_STRUCT_FIELDS = Object.freeze(
	STRUCT_FIELDS.map((field) => Object.freeze({ name: field.name, type: field.type })),
)


export const SB_SLAB_MAP_GLSL_FUNCTION_NAMES = Object.freeze([
	"sbDecodeSlabMapChannel",
	"sbReconstructSlabMapNormal",
	"sbSlabMapF0FromMetalness",
	"sbResetSlabMapSampleToDefaults",
	...slabMapSlotNames().map((slotName) => slabMapDecodeFunctionName(slotName)),
	"sbResolveSlabMapDerivations",
])

function braceBalanceOf(text) {
	let depth = 0
	for (const character of text) {
		if ("{" === character) depth += 1
		if ("}" === character) depth -= 1
		if (0 > depth) return depth
	}
	return depth
}


export function slabMapGlslUniformTokens() {
	const tokens = new Set()
	const tokenPattern = /\buSb[A-Za-z0-9_]*/g
	for (const text of [declarations, code]) {
		for (const token of text.match(tokenPattern) ?? []) tokens.add(token)
	}
	return [...tokens].sort()
}


export function slabMapGlslProblems() {
	const problems = []
	const fullText = declarations + "\n" + code

	const structDeclarationCount = fullText.split("struct " + SB_SLAB_MAP_GLSL_STRUCT_NAME).length - 1
	if (1 !== structDeclarationCount) {
		problems.push("a struct " + SB_SLAB_MAP_GLSL_STRUCT_NAME + " foi declarada " + structDeclarationCount + " vezes")
	}

	for (const functionName of SB_SLAB_MAP_GLSL_FUNCTION_NAMES) {
		if (!fullText.includes(functionName + "(")) problems.push("o texto nao declara a funcao " + functionName)
	}

	for (const field of STRUCT_FIELDS) {
		if (!fullText.includes("slabSample." + field.name)) {
			problems.push("o campo " + field.name + " entrou na struct e nunca recebe valor")
		}
	}

	for (const [label, text] of [
		["declaracoes", declarations],
		["decodificadores", code],
	]) {
		if (0 !== braceBalanceOf(text)) problems.push("o trecho de " + label + " tem chaves desbalanceadas")
	}

	if (fullText.includes("uniform ")) {
		problems.push("o texto declarou uniform: sem passe escritor a fase nao pode gastar unidade de textura")
	}
	if (fullText.includes("texture(") || fullText.includes("texture2D")) {
		problems.push("o texto amostrou textura: nesta bancada nao existe quem escreva os mapas do slab")
	}
	const uniformTokens = slabMapGlslUniformTokens()
	if (0 !== uniformTokens.length) {
		problems.push("tokens uSb no texto sem uniform declarado pela fase: " + uniformTokens.join(", "))
	}
	if (!declarations.includes("#define " + SB_SLAB_MAP_GLSL_DIELECTRIC_F0_DEFINE + " " + glslFloatLiteral(SB_DIELECTRIC_F0))) {
		problems.push("o F0 de dieletrico do texto nao veio do sbMapPackingCore")
	}
	if (code.includes("#define")) {
		problems.push("um decodificador declarou #define fora do bloco de declaracoes")
	}

	return problems
}

export function describeSlabMapGlsl() {
	return {
		owner: SB_SLAB_MAP_GLSL_OWNER,
		anchor: SB_SLAB_MAP_GLSL_ANCHOR,
		structName: SB_SLAB_MAP_GLSL_STRUCT_NAME,
		structFields: SB_SLAB_MAP_GLSL_STRUCT_FIELDS,
		functionNames: SB_SLAB_MAP_GLSL_FUNCTION_NAMES,
		declarationLineCount: declarations.split("\n").length,
		codeLineCount: code.split("\n").length,
		declaredSamplerCount: 0,
		uniformTokens: slabMapGlslUniformTokens(),
		problems: slabMapGlslProblems(),
	}
}

export const SB_SLAB_MAP_RUNTIME_SAMPLE_NAME = "sbRuntimeMapSample"
export const SB_SLAB_MAP_RUNTIME_NORMAL_FUNCTION = "sbSlabMapPerturbNormal"

const RUNTIME_SKIPPED_FIELDS = new Set(["normal", "metalness", "ambientOcclusion"])

export const SB_SLAB_MAP_RUNTIME_HELPERS_GLSL = `
vec3 ${SB_SLAB_MAP_RUNTIME_NORMAL_FUNCTION}( const in vec3 surfaceNormal, const in vec3 viewPosition, const in vec2 uv, const in vec3 tangentSpaceNormal ) {
	vec3 dpdx = dFdx( viewPosition );
	vec3 dpdy = dFdy( viewPosition );
	vec2 duvdx = dFdx( uv );
	vec2 duvdy = dFdy( uv );
	vec3 tangentDirection = dpdx * duvdy.y - dpdy * duvdx.y;
	vec3 bitangentDirection = dpdy * duvdx.x - dpdx * duvdy.x;
	float determinant = duvdx.x * duvdy.y - duvdy.x * duvdx.y;
	if ( abs( determinant ) < 1.0e-8 ) return surfaceNormal;
	float invMax = inversesqrt( max( dot( tangentDirection, tangentDirection ), dot( bitangentDirection, bitangentDirection ) ) );
	vec3 tangent = tangentDirection * invMax * sign( determinant );
	vec3 bitangent = bitangentDirection * invMax * sign( determinant );
	tangent = normalize( tangent - surfaceNormal * dot( surfaceNormal, tangent ) );
	bitangent = normalize( cross( surfaceNormal, tangent ) ) * sign( dot( cross( surfaceNormal, tangent ), bitangent ) + 1.0e-6 );
	return normalize( mat3( tangent, bitangent, surfaceNormal ) * tangentSpaceNormal );
}
`

export function slabMapSamplerName(slotName) {
	const withoutPrefix = slotName.startsWith("slab") ? slotName.slice(4) : slotName
	return "uSbSlabMap" + withoutPrefix.charAt(0).toUpperCase() + withoutPrefix.slice(1)
}

function runtimeFieldAssignments(slotName, slabVariable, availableFields) {
	const lines = []
	const written = new Set()
	for (const channelName of SB_SLAB_MAP_CHANNELS) {
		const destination = slabMapChannelDestination(slotName, channelName)
		if (!destination || RUNTIME_SKIPPED_FIELDS.has(destination.field) || written.has(destination.field)) continue
		if (!availableFields.has(destination.field)) continue
		written.add(destination.field)
		lines.push("\t\t" + slabVariable + "." + destination.field + " = " + SB_SLAB_MAP_RUNTIME_SAMPLE_NAME + "." + destination.field + ";")
	}
	return lines
}

export function buildSlabMapRuntimeGlsl(request = {}) {
	const boundSlots = slabMapSlotNames().filter((slotName) => (request.boundSlots ?? []).includes(slotName))
	if (boundSlots.length === 0) return { declarations: "", apply: "", samplers: [], boundSlots: [] }
	const slabVariable = request.slabVariable ?? "sbRuntimeSlab"
	const normalVariable = request.normalVariable ?? "normal"
	const uvVariable = request.uvVariable ?? "vUv"
	const availableFields = new Set(request.availableFields ?? [])
	const samplers = boundSlots.map((slotName) => slabMapSamplerName(slotName))
	const declarations = [
		...samplers.map((sampler) => "uniform sampler2D " + sampler + ";"),
		SB_SLAB_MAP_RUNTIME_HELPERS_GLSL,
	].join("\n")
	const apply = [
		"\t{",
		"\t\t" + SB_SLAB_MAP_GLSL_STRUCT_NAME + " " + SB_SLAB_MAP_RUNTIME_SAMPLE_NAME + ";",
		"\t\tsbResetSlabMapSampleToDefaults( " + SB_SLAB_MAP_RUNTIME_SAMPLE_NAME + " );",
		...boundSlots.map((slotName, index) => "\t\t" + slabMapDecodeFunctionName(slotName) + "( texture2D( " + samplers[index] + ", " + uvVariable + " ), " + SB_SLAB_MAP_RUNTIME_SAMPLE_NAME + " );"),
		...(!boundSlots.includes("slabBaseColor") && availableFields.has("albedo") ? ["\t\t" + SB_SLAB_MAP_RUNTIME_SAMPLE_NAME + ".albedo = " + slabVariable + ".albedo;"] : []),
		"\t\tsbResolveSlabMapDerivations( " + SB_SLAB_MAP_RUNTIME_SAMPLE_NAME + " );",
		...boundSlots.flatMap((slotName) => runtimeFieldAssignments(slotName, slabVariable, availableFields)),
		...(boundSlots.includes("slabOrm") && availableFields.has("f0") ? ["\t\t" + slabVariable + ".f0 = " + SB_SLAB_MAP_RUNTIME_SAMPLE_NAME + ".f0;"] : []),
		...(boundSlots.includes("slabNormalAnisotropy")
			? ["\t\t" + normalVariable + " = " + SB_SLAB_MAP_RUNTIME_NORMAL_FUNCTION + "( " + normalVariable + ", -vViewPosition, " + uvVariable + ", " + SB_SLAB_MAP_RUNTIME_SAMPLE_NAME + ".normal );"]
			: []),
		"\t}",
	].join("\n")
	return { declarations, apply, samplers, boundSlots }
}
