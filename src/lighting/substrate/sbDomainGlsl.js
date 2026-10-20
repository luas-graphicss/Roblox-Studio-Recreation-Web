export const SB_DOMAIN_GLSL_ANCHOR = "opaqueFragment"

export const SB_DOMAIN_UNIFORM_PREFIX = "uSbDomain"

export const SB_DOMAIN_UNIFORM_NAMES = Object.freeze({
	volumeExtinction: "uSbDomainVolumeExtinction",
	volumeScattering: "uSbDomainVolumeScattering",
	unlitColor: "uSbDomainUnlitColor",
	lightFunctionMask: "uSbDomainLightFunctionMask",
	postProcessGrade: "uSbDomainPostProcessGrade",
})

export const SB_DOMAIN_UNIFORM_TYPES = Object.freeze({
	[SB_DOMAIN_UNIFORM_NAMES.volumeExtinction]: "vec3",
	[SB_DOMAIN_UNIFORM_NAMES.volumeScattering]: "vec3",
	[SB_DOMAIN_UNIFORM_NAMES.unlitColor]: "vec4",
	[SB_DOMAIN_UNIFORM_NAMES.lightFunctionMask]: "vec4",
	[SB_DOMAIN_UNIFORM_NAMES.postProcessGrade]: "vec4",
})


const FORBIDDEN_GLSL_TERMS = Object.freeze(["outgoingLight", "#include", "sampler"])


function glslBlock(lines) {
	return lines.join("\n")
}

function uniformDeclaration(uniformName) {
	return "uniform " + SB_DOMAIN_UNIFORM_TYPES[uniformName] + " " + uniformName + ";"
}

const VOLUME_GLSL = Object.freeze({
	uniforms: Object.freeze([
		SB_DOMAIN_UNIFORM_NAMES.volumeExtinction,
		SB_DOMAIN_UNIFORM_NAMES.volumeScattering,
	]),
	declarations: glslBlock([
		uniformDeclaration(SB_DOMAIN_UNIFORM_NAMES.volumeExtinction),
		uniformDeclaration(SB_DOMAIN_UNIFORM_NAMES.volumeScattering),
	]),
	code: glslBlock([
		"// Dominio volume: Beer-Lambert ao longo da distancia de vista, com a",
		"// mesma matematica de volumeAppliedColor no CPU (sbVolumeBsdfCore.js).",
		"float sbVolumeViewDistance = 1.0 / max(gl_FragCoord.w, 1e-4);",
		"vec3 sbVolumeTransmittance = exp(-uSbDomainVolumeExtinction * sbVolumeViewDistance);",
		"gl_FragColor.rgb = gl_FragColor.rgb * sbVolumeTransmittance + uSbDomainVolumeScattering * (1.0 - sbVolumeTransmittance);",
	]),
})

const UNLIT_GLSL = Object.freeze({
	uniforms: Object.freeze([SB_DOMAIN_UNIFORM_NAMES.unlitColor]),
	declarations: uniformDeclaration(SB_DOMAIN_UNIFORM_NAMES.unlitColor),
	code: glslBlock([
		"// Dominio unlit: a cor autorada substitui a iluminacao inteira e o alpha",
		"// do material continua respeitado.",
		"gl_FragColor = vec4(uSbDomainUnlitColor.rgb, gl_FragColor.a * uSbDomainUnlitColor.a);",
	]),
})

const LIGHT_FUNCTION_GLSL = Object.freeze({
	uniforms: Object.freeze([SB_DOMAIN_UNIFORM_NAMES.lightFunctionMask]),
	declarations: uniformDeclaration(SB_DOMAIN_UNIFORM_NAMES.lightFunctionMask),
	code: glslBlock([
		"// Dominio light function: mascara de aneis concentricos em espaco de tela.",
		"// Substituto honesto -- projetar a mascara pela luz de verdade depende de",
		"// SB-F31 (ponte de iluminacao), que ainda nao existe.",
		"float sbLightFunctionRadius = length(gl_FragCoord.xy) * uSbDomainLightFunctionMask.a;",
		"float sbLightFunctionValue = 0.5 + 0.5 * cos(sbLightFunctionRadius);",
		"gl_FragColor.rgb *= mix(vec3(1.0), uSbDomainLightFunctionMask.rgb, sbLightFunctionValue);",
	]),
})

const POST_PROCESS_GLSL = Object.freeze({
	uniforms: Object.freeze([SB_DOMAIN_UNIFORM_NAMES.postProcessGrade]),
	declarations: uniformDeclaration(SB_DOMAIN_UNIFORM_NAMES.postProcessGrade),
	code: glslBlock([
		"// Dominio post process: saturacao e tint sobre a cor final do material.",
		"// Substituto honesto -- um pass de tela cheia nao pertence a esta fase e",
		"// nao esta em SB_PASS_OWNERS para SB-F27.",
		"float sbPostProcessLuminance = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));",
		"vec3 sbPostProcessGraded = mix(vec3(sbPostProcessLuminance), gl_FragColor.rgb, uSbDomainPostProcessGrade.a);",
		"gl_FragColor.rgb = sbPostProcessGraded * uSbDomainPostProcessGrade.rgb;",
	]),
})

export const SB_DOMAIN_GLSL = Object.freeze({
	volume: VOLUME_GLSL,
	unlit: UNLIT_GLSL,
	lightFunction: LIGHT_FUNCTION_GLSL,
	postProcess: POST_PROCESS_GLSL,
})

export function domainGlslNames() {
	return Object.keys(SB_DOMAIN_GLSL)
}

export function domainGlsl(domainName) {
	return SB_DOMAIN_GLSL[domainName] ?? null
}

export function domainGlslUniformNames(domainName) {
	const snippet = domainGlsl(domainName)
	if (!snippet) return []
	return [...snippet.uniforms]
}

export function domainGlslUniformType(uniformName) {
	return SB_DOMAIN_UNIFORM_TYPES[uniformName] ?? null
}


export function domainGlslProblems() {
	const problems = []
	const uniformOwners = new Map()

	for (const domainName of domainGlslNames()) {
		const snippet = SB_DOMAIN_GLSL[domainName]
		const label = 'glsl do dominio "' + domainName + '"'

		if (!snippet.code.includes("gl_FragColor")) {
			problems.push(label + " nao escreve em gl_FragColor, entao nao mudaria a imagem")
		}

		for (const forbiddenTerm of FORBIDDEN_GLSL_TERMS) {
			if (snippet.code.includes(forbiddenTerm) || snippet.declarations.includes(forbiddenTerm)) {
				problems.push(label + ' usa o termo proibido "' + forbiddenTerm + '"')
			}
		}

		if (snippet.uniforms.length > 0 === false) {
			problems.push(label + " nao declara uniforme nenhum, logo nao teria como ser controlado")
		}

		for (const uniformName of snippet.uniforms) {
			const uniformType = domainGlslUniformType(uniformName)
			if (!uniformType) {
				problems.push(label + ' usa o uniforme "' + uniformName + '" sem tipo em SB_DOMAIN_UNIFORM_TYPES')
				continue
			}
			if (!uniformName.startsWith(SB_DOMAIN_UNIFORM_PREFIX)) {
				problems.push(label + ' usa o uniforme "' + uniformName + '" fora do prefixo ' + SB_DOMAIN_UNIFORM_PREFIX)
			}
			if (!snippet.declarations.includes(uniformDeclaration(uniformName))) {
				problems.push(label + ' nao declara o uniforme "' + uniformName + '" antes da ancora')
			}
			if (!snippet.code.includes(uniformName)) {
				problems.push(label + ' declara o uniforme "' + uniformName + '" e nunca o usa')
			}
			const previousOwner = uniformOwners.get(uniformName)
			if (previousOwner) {
				problems.push('o uniforme "' + uniformName + '" e compartilhado pelos dominios "' + previousOwner + '" e "' + domainName + '"')
			}
			uniformOwners.set(uniformName, domainName)
		}

		for (const uniformName of Object.keys(SB_DOMAIN_UNIFORM_TYPES)) {
			const isListed = snippet.uniforms.includes(uniformName)
			if (!isListed && snippet.declarations.includes(uniformName)) {
				problems.push(label + ' declara "' + uniformName + '" sem listar em uniforms, e ele nunca seria ligado')
			}
		}
	}

	for (const uniformName of Object.values(SB_DOMAIN_UNIFORM_NAMES)) {
		if (!uniformOwners.has(uniformName)) {
			problems.push('o uniforme "' + uniformName + '" esta no catalogo e nenhum dominio o usa')
		}
	}

	return problems
}

export function describeDomainGlsl() {
	return {
		anchor: SB_DOMAIN_GLSL_ANCHOR,
		uniformPrefix: SB_DOMAIN_UNIFORM_PREFIX,
		domains: domainGlslNames().map((domainName) => ({
			domain: domainName,
			uniforms: domainGlslUniformNames(domainName),
			codeLineCount: SB_DOMAIN_GLSL[domainName].code.split("\n").length,
		})),
		problems: domainGlslProblems(),
	}
}
