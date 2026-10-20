export const SB_REFUSAL_CODES = {
	treeTooDeep: "treeTooDeep",
	tooManySlabs: "tooManySlabs",
	unsupportedChild: "unsupportedChild",
	parameterOutOfRange: "parameterOutOfRange",
	budgetExceeded: "budgetExceeded",
	domainMismatch: "domainMismatch",
	missingOperand: "missingOperand",
	cycleDetected: "cycleDetected",
}


export const SB_TREE_REFUSALS = {
	owner: "SB-F3",
	refuses: [
		{ code: SB_REFUSAL_CODES.treeTooDeep, when: "a arvore passa da profundidade maxima do contrato" },
		{ code: SB_REFUSAL_CODES.tooManySlabs, when: "a arvore tem mais slabs que o teto do contrato" },
		{ code: SB_REFUSAL_CODES.cycleDetected, when: "um no da arvore aponta para um ancestral" },
	],
}

export const SB_OPERATOR_REFUSALS = {
	verticalLayering: {
		owner: "SB-F18",
		arity: 2,
		refuses: [
			{ code: SB_REFUSAL_CODES.unsupportedChild, when: "a camada de cima nao e um slab" },
			{ code: SB_REFUSAL_CODES.unsupportedChild, when: "a camada de baixo e hair, eye ou volume" },
			{ code: SB_REFUSAL_CODES.parameterOutOfRange, when: "coverage fora de 0..1 ou thickness negativa" },
		],
	},

	horizontalMixing: {
		owner: "SB-F20",
		arity: 2,
		refuses: [
			{ code: SB_REFUSAL_CODES.parameterOutOfRange, when: "peso fora de 0..1" },
			{ code: SB_REFUSAL_CODES.domainMismatch, when: "os dois lados tem dominios diferentes" },
		],
	},

	add: {
		owner: "SB-F20",
		arity: 2,
		refuses: [
			{ code: SB_REFUSAL_CODES.domainMismatch, when: "somar unlit com slab iluminado" },
			{ code: SB_REFUSAL_CODES.budgetExceeded, when: "a soma passa do teto de closures e nao ha o que simplificar" },
		],
	},

	weight: {
		owner: "SB-F20",
		arity: 1,
		refuses: [
			{ code: SB_REFUSAL_CODES.missingOperand, when: "nao ha sub-arvore para atenuar" },
			{ code: SB_REFUSAL_CODES.parameterOutOfRange, when: "peso negativo" },
		],
	},
}

const MATERIAL_TREE_PRODUCER = "materialTree"

function deepFreeze(value) {
	if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value
	Object.freeze(value)
	Object.values(value).forEach(deepFreeze)
	return value
}

export function operatorNames() {
	return Object.keys(SB_OPERATOR_REFUSALS).sort()
}

export function refusalsFor(operatorName) {
	return SB_OPERATOR_REFUSALS[operatorName]?.refuses ?? []
}


export function refusalCodeProducers() {
	const producers = new Map()
	const register = (code, producerName) => {
		if (!producers.has(code)) producers.set(code, [])
		producers.get(code).push(producerName)
	}

	for (const treeRefusal of SB_TREE_REFUSALS.refuses) {
		register(treeRefusal.code, MATERIAL_TREE_PRODUCER)
	}
	for (const operatorName of operatorNames()) {
		for (const refusal of refusalsFor(operatorName)) register(refusal.code, operatorName)
	}
	return producers
}


export function refusalCodeProblems() {
	const producers = refusalCodeProducers()
	return Object.keys(SB_REFUSAL_CODES)
		.filter((code) => !producers.has(code))
		.map((code) => "codigo de recusa sem produtor declarado: " + code)
}


export function describeRefusal(operatorName, code, detail) {
	const refusal = refusalsFor(operatorName).find((candidate) => candidate.code === code)
	return {
		operator: operatorName,
		code,
		owner: SB_OPERATOR_REFUSALS[operatorName]?.owner ?? null,
		reason: refusal?.when ?? "motivo nao catalogado",
		detail: detail ?? null,
	}
}


export function describeTreeRefusal(code, detail) {
	const refusal = SB_TREE_REFUSALS.refuses.find((candidate) => candidate.code === code)
	return {
		operator: MATERIAL_TREE_PRODUCER,
		code,
		owner: SB_TREE_REFUSALS.owner,
		reason: refusal?.when ?? "motivo nao catalogado",
		detail: detail ?? null,
	}
}

deepFreeze(SB_REFUSAL_CODES)
deepFreeze(SB_TREE_REFUSALS)
deepFreeze(SB_OPERATOR_REFUSALS)
