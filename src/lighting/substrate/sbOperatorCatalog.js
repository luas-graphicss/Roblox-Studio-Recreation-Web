import { SB_OPERATOR_REFUSALS } from "./sbOperatorRefusals.js"

export const SB_CLOSURE_MATH = {
	sum: "sum",
	sumOrBlend: "sumOrBlend",
	unchanged: "unchanged",
}

export const SB_OPERATORS = {
	verticalLayering: {
		owner: "SB-F18",
		label: "Vertical Layering",
		arity: 2,
		closureMath: SB_CLOSURE_MATH.sum,
		parameters: ["coverage", "thickness", "transmittanceColor"],
		description: "um slab SOBRE outro: o de baixo e visto atraves do de cima, com absorcao",
	},
	horizontalMixing: {
		owner: "SB-F20",
		label: "Horizontal Mixing",
		arity: 2,
		closureMath: SB_CLOSURE_MATH.sumOrBlend,
		parameters: ["weight"],
		description: "dois slabs lado a lado por mascara; funde parametros quando o orcamento aperta",
	},
	add: {
		owner: "SB-F20",
		label: "Add",
		arity: 2,
		closureMath: SB_CLOSURE_MATH.sum,
		parameters: [],
		description: "soma dois sub-ramos",
	},
	weight: {
		owner: "SB-F20",
		label: "Weight",
		arity: 1,
		closureMath: SB_CLOSURE_MATH.unchanged,
		parameters: ["weight"],
		description: "atenua um sub-ramo inteiro",
	},
}

export function operatorNames() {
	return Object.keys(SB_OPERATORS)
}

export function operatorArity(operatorName) {
	return SB_OPERATORS[operatorName]?.arity ?? null
}

export function operatorClosureMath(operatorName) {
	return SB_OPERATORS[operatorName]?.closureMath ?? null
}

export function describeOperatorCatalog() {
	return operatorNames().map((operatorName) => ({
		operator: operatorName,
		...SB_OPERATORS[operatorName],
		refuses: SB_OPERATOR_REFUSALS[operatorName]?.refuses ?? [],
	}))
}


export function operatorCatalogProblems() {
	const problems = []
	for (const operatorName of operatorNames()) {
		const refusals = SB_OPERATOR_REFUSALS[operatorName]
		if (!refusals) {
			problems.push("operador sem recusas declaradas: " + operatorName)
			continue
		}
		if (refusals.arity !== SB_OPERATORS[operatorName].arity) {
			problems.push("aridade divergente entre catalogo e recusas: " + operatorName)
		}
	}
	return problems
}
