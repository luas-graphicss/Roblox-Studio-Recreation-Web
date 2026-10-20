import { SB_CLOSURE_DISPATCH_READY_DEFINE, resolveClosureCeiling } from "./sbClosureDispatchGlsl.js"

export const SB_CLOSURE_LIGHTING_READY_DEFINE = "SB_CLOSURE_LIGHTING_READY"
export const SB_CLOSURE_LIGHTING_LIMIT_DEFINE = "SB_CLOSURE_LIGHTING_LIMIT"
export const SB_CLOSURE_LIGHTING_WEIGHTS_STRUCT = "SbClosureLightingWeights"
export const SB_CLOSURE_LIGHTING_SHADING_STRUCT = "SbClosureLightingShading"
export const SB_CLOSURE_LIGHTING_SHADE_FUNCTION = "sbShadeClosures"


export function resolveClosureLightingCeiling(rawCeiling) {
	return resolveClosureCeiling(rawCeiling)
}

export function closureLightingLimitDefineLine(closureCeiling) {
	return "#define " + SB_CLOSURE_LIGHTING_LIMIT_DEFINE + " " + resolveClosureLightingCeiling(closureCeiling)
}


export function buildClosureLightingDeclarations(options) {
	const closureCeiling = resolveClosureLightingCeiling(options?.closureCeiling)
	return [
		"#ifdef " + SB_CLOSURE_DISPATCH_READY_DEFINE,
		"#define " + SB_CLOSURE_LIGHTING_READY_DEFINE + " 1",
		closureLightingLimitDefineLine(closureCeiling),
		"",
		"struct " + SB_CLOSURE_LIGHTING_WEIGHTS_STRUCT + " {",
		"\tvec3 diffuseAlbedo;",
		"\tvec3 specularEnvBrdf;",
		"};",
		"",
		"struct " + SB_CLOSURE_LIGHTING_SHADING_STRUCT + " {",
		"\tvec3 diffuse;",
		"\tvec3 specular;",
		"};",
		"",
		"// O peso do material entra UMA vez, no fim, como o MegaLights exige.",
		"SbClosureRadiance sbApplyClosureLightingWeights(" +
			SB_CLOSURE_LIGHTING_WEIGHTS_STRUCT +
			" weights, " +
			SB_CLOSURE_LIGHTING_SHADING_STRUCT +
			" shading) {",
		"\tSbClosureRadiance radiance;",
		"\tradiance.diffuse = weights.diffuseAlbedo * shading.diffuse;",
		"\tradiance.specular = weights.specularEnvBrdf * shading.specular;",
		"\treturn radiance;",
		"}",
		"",
		"// STUB da SB-F30/SB-F32: sem amostra de luz por closure, toda closure recebe",
		"// a MESMA radiancia crua do forward. Trocar isto e o trabalho da fase dona,",
		"// e o laco abaixo nao muda quando isso acontecer.",
		"" + SB_CLOSURE_LIGHTING_SHADING_STRUCT + " sbClosureLightingShading(int slot, " +
			SB_CLOSURE_LIGHTING_SHADING_STRUCT +
			" forwardShading) {",
		"\treturn forwardShading;",
		"}",
		"",
		"// STUB da SB-F8: o peso de material por closure sai do buffer quantizado.",
		"// Ate o call site existir, toda closure usa o peso neutro do forward.",
		"" + SB_CLOSURE_LIGHTING_WEIGHTS_STRUCT + " sbClosureLightingWeightsForSlot(int slot, " +
			SB_CLOSURE_LIGHTING_WEIGHTS_STRUCT +
			" forwardWeights) {",
		"\treturn forwardWeights;",
		"}",
		"",
		"SbClosureRadiance " + SB_CLOSURE_LIGHTING_SHADE_FUNCTION + "(" +
			SB_CLOSURE_LIGHTING_WEIGHTS_STRUCT +
			" forwardWeights, " +
			SB_CLOSURE_LIGHTING_SHADING_STRUCT +
			" forwardShading) {",
		"\tSbClosureRadiance total;",
		"\ttotal.diffuse = vec3(0.0);",
		"\ttotal.specular = vec3(0.0);",
		"\tint activeClosureCount = sbActiveClosureCount();",
		"\tfor (int slot = 0; slot < " + SB_CLOSURE_LIGHTING_LIMIT_DEFINE + "; slot += 1) {",
		"\t\tif (slot >= activeClosureCount) break;",
		"\t\t" + SB_CLOSURE_LIGHTING_WEIGHTS_STRUCT + " weights = sbClosureLightingWeightsForSlot(slot, forwardWeights);",
		"\t\t" + SB_CLOSURE_LIGHTING_SHADING_STRUCT + " shading = sbClosureLightingShading(slot, forwardShading);",
		"\t\tSbClosureRadiance radiance = sbApplyClosureLightingWeights(weights, shading);",
		"\t\tfloat closureWeight = sbClosureWeight(slot, activeClosureCount);",
		"\t\ttotal.diffuse += radiance.diffuse * closureWeight;",
		"\t\ttotal.specular += radiance.specular * closureWeight;",
		"\t}",
		"\treturn total;",
		"}",
		"#endif",
	].join("\n")
}







export function buildClosureLightingCode() {
	return [
		"#ifdef " + SB_CLOSURE_LIGHTING_READY_DEFINE,
		"{",
		"\t// Peso neutro do forward: a SB-F8 ainda nao entrega albedo e EnvBRDF por",
		"\t// closure neste ponto. RECUSADO dividir reflectedLight pelo albedo para",
		"\t// desfatorar: albedo preto explode e a identidade de uma closure morre.",
		"\t" + SB_CLOSURE_LIGHTING_WEIGHTS_STRUCT + " sbForwardWeights = " +
			SB_CLOSURE_LIGHTING_WEIGHTS_STRUCT +
			"(vec3(1.0), vec3(1.0));",
		"\t" + SB_CLOSURE_LIGHTING_SHADING_STRUCT + " sbForwardShading;",
		"\tsbForwardShading.diffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;",
		"\tsbForwardShading.specular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;",
		"\tSbClosureRadiance sbClosureTotal = " + SB_CLOSURE_LIGHTING_SHADE_FUNCTION + "(sbForwardWeights, sbForwardShading);",
		"\treflectedLight.indirectDiffuse += sbClosureTotal.diffuse - sbForwardShading.diffuse;",
		"\treflectedLight.indirectSpecular += sbClosureTotal.specular - sbForwardShading.specular;",
		"}",
		"#endif",
	].join("\n")
}

export function buildClosureLightingGlsl(options) {
	const closureCeiling = resolveClosureLightingCeiling(options?.closureCeiling)
	return {
		closureCeiling,
		declarations: buildClosureLightingDeclarations({ closureCeiling }),
		code: buildClosureLightingCode(),
	}
}





export function closureLightingGlslProblems(glsl) {
	const declarations = typeof glsl?.declarations === "string" ? glsl.declarations : ""
	const code = typeof glsl?.code === "string" ? glsl.code : ""
	const closureCeiling = resolveClosureLightingCeiling(glsl?.closureCeiling)
	const problems = []
	if (!declarations.includes(closureLightingLimitDefineLine(closureCeiling))) {
		problems.push("o teto de closures nao saiu compilado nas declaracoes")
	}
	if (!declarations.includes("#ifdef " + SB_CLOSURE_DISPATCH_READY_DEFINE)) {
		problems.push("as declaracoes nao estao protegidas pelo ifdef do despacho da SB-F9")
	}
	if (declarations.includes("uniform ")) {
		problems.push("esta fase nao declara uniform: o contador de closures e da SB-F9")
	}
	if (declarations.includes("struct SbClosureRadiance")) {
		problems.push("a struct SbClosureRadiance e da SB-F9 e nao pode ser redeclarada")
	}
	if (declarations.includes("int sbActiveClosureCount()") || declarations.includes("float sbClosureWeight(")) {
		problems.push("as funcoes de contagem e peso sao da SB-F9 e nao podem ser redeclaradas")
	}
	if (!declarations.includes("slot < " + SB_CLOSURE_LIGHTING_LIMIT_DEFINE)) {
		problems.push("o laco nao usa o teto compilado como limite")
	}
	if (!declarations.includes("sbClosureWeight(slot, activeClosureCount)")) {
		problems.push("o laco nao usa o peso de closure da SB-F9")
	}
	if (!code.includes("#ifdef " + SB_CLOSURE_LIGHTING_READY_DEFINE)) {
		problems.push("o bloco do main nao esta protegido pelo ifdef de prontidao")
	}
	if (code.includes("#define")) {
		problems.push("o bloco do main nao pode definir macro dentro do escopo do main")
	}
	if (code.includes("/ material.") || code.includes("/ diffuseColor")) {
		problems.push("o bloco do main nao pode dividir radiancia pelo albedo para desfatorar")
	}
	if (!code.includes("- sbForwardShading.diffuse") || !code.includes("- sbForwardShading.specular")) {
		problems.push("o bloco do main tem de somar apenas o delta contra o forward")
	}
	return problems
}
