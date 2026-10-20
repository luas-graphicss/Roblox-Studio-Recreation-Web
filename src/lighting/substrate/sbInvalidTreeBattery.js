import { SB_MAX_TREE_DEPTH } from "./sbMaterialContract.js"
import { SB_REFUSAL_CODES } from "./sbOperatorRefusals.js"
import { SB_NODE_TYPES, SB_SLAB_BSDF_KIND } from "./sbMaterialTreeCore.js"
import { validateMaterialTree } from "./sbMaterialTreeValidation.js"


const VERTICAL_LAYERING_OPERATOR = "verticalLayering"
const HORIZONTAL_MIXING_OPERATOR = "horizontalMixing"
const ADD_OPERATOR = "add"
const WEIGHT_OPERATOR = "weight"

const UNKNOWN_BSDF_KIND = "toonShading"
const UNKNOWN_OPERATOR_NAME = "multiply"
const UNKNOWN_NODE_TYPE = "camera"
const UNLIT_BSDF_KIND = "unlit"
const HAIR_BSDF_KIND = "hair"

const SLABS_ABOVE_CEILING = 9

function createRawBsdf(bsdfKind, parameters = {}) {
	return { type: SB_NODE_TYPES.bsdf, bsdf: bsdfKind, parameters }
}

function createRawSlab(parameters = {}) {
	return createRawBsdf(SB_SLAB_BSDF_KIND, {
		albedo: [0.5, 0.5, 0.5],
		roughness: 0.4,
		...parameters,
	})
}

function createRawOperator(operatorName, children, parameters = {}) {
	return { type: SB_NODE_TYPES.operator, operator: operatorName, children, parameters }
}


function createChainOfWeightOperators(levelTotal) {
	let node = createRawSlab()
	for (let level = 1; levelTotal > level; level += 1) {
		node = createRawOperator(WEIGHT_OPERATOR, [node], { weight: 1 })
	}
	return node
}


function createChainOfAddedSlabs(slabTotal) {
	let node = createRawSlab()
	for (let slabIndex = 1; slabTotal > slabIndex; slabIndex += 1) {
		node = createRawOperator(ADD_OPERATOR, [node, createRawSlab()])
	}
	return node
}

function createTreeWithCycle() {
	const layering = createRawOperator(VERTICAL_LAYERING_OPERATOR, [createRawSlab()], { coverage: 1 })
	layering.children.push(layering)
	return layering
}


export const SB_INVALID_TREE_BATTERY = Object.freeze([
	{
		id: "missingRoot",
		description: "arvore sem raiz nenhuma",
		expectedCode: SB_REFUSAL_CODES.missingOperand,
		createRoot: () => null,
	},
	{
		id: "unknownChildNodeType",
		description: "operando de tipo que nao existe no IR",
		expectedCode: SB_REFUSAL_CODES.unsupportedChild,
		createRoot: () => createRawOperator(ADD_OPERATOR, [createRawSlab(), { type: UNKNOWN_NODE_TYPE }]),
	},
	{
		id: "slabRoughnessAboveRange",
		description: "slab com roughness 1.7",
		expectedCode: SB_REFUSAL_CODES.parameterOutOfRange,
		createRoot: () => createRawSlab({ roughness: 1.7 }),
	},
	{
		id: "slabNegativeOpacity",
		description: "slab com opacity negativa",
		expectedCode: SB_REFUSAL_CODES.parameterOutOfRange,
		createRoot: () => createRawSlab({ opacity: -1 }),
	},
	{
		id: "slabParameterOutsideContract",
		description: "slab com parametro que nao existe no contrato",
		expectedCode: SB_REFUSAL_CODES.parameterOutOfRange,
		createRoot: () => createRawSlab({ glossiness: 0.5 }),
	},
	{
		id: "slabScalarAlbedo",
		description: "slab com albedo escalar em vez de cor",
		expectedCode: SB_REFUSAL_CODES.parameterOutOfRange,
		createRoot: () => createRawSlab({ albedo: 0.5 }),
	},
	{
		id: "unknownBsdfKind",
		description: "BSDF fora do catalogo",
		expectedCode: SB_REFUSAL_CODES.unsupportedChild,
		createRoot: () => createRawBsdf(UNKNOWN_BSDF_KIND),
	},
	{
		id: "unknownOperatorName",
		description: "operador fora do catalogo",
		expectedCode: SB_REFUSAL_CODES.unsupportedChild,
		createRoot: () => createRawOperator(UNKNOWN_OPERATOR_NAME, [createRawSlab(), createRawSlab()]),
	},
	{
		id: "layeringWithOneOperand",
		description: "empilhamento vertical com um operando so",
		expectedCode: SB_REFUSAL_CODES.missingOperand,
		createRoot: () => createRawOperator(VERTICAL_LAYERING_OPERATOR, [createRawSlab()], { coverage: 1 }),
	},
	{
		id: "layeringWithThreeOperands",
		description: "empilhamento vertical com tres operandos",
		expectedCode: SB_REFUSAL_CODES.unsupportedChild,
		createRoot: () =>
			createRawOperator(VERTICAL_LAYERING_OPERATOR, [createRawSlab(), createRawSlab(), createRawSlab()], {
				coverage: 1,
			}),
	},
	{
		id: "layeringCoverageAboveOne",
		description: "empilhamento com coverage 1.4",
		expectedCode: SB_REFUSAL_CODES.parameterOutOfRange,
		createRoot: () =>
			createRawOperator(VERTICAL_LAYERING_OPERATOR, [createRawSlab(), createRawSlab()], { coverage: 1.4 }),
	},
	{
		id: "layeringNegativeThickness",
		description: "empilhamento com thickness negativa",
		expectedCode: SB_REFUSAL_CODES.parameterOutOfRange,
		createRoot: () =>
			createRawOperator(VERTICAL_LAYERING_OPERATOR, [createRawSlab(), createRawSlab()], { thickness: -0.2 }),
	},
	{
		id: "layeringTopIsNotSlab",
		description: "empilhamento com camada de cima que nao e slab",
		expectedCode: SB_REFUSAL_CODES.unsupportedChild,
		createRoot: () =>
			createRawOperator(VERTICAL_LAYERING_OPERATOR, [createRawBsdf(HAIR_BSDF_KIND), createRawSlab()], {
				coverage: 1,
			}),
	},
	{
		id: "layeringHairAtBottom",
		description: "empilhamento com hair embaixo da camada",
		expectedCode: SB_REFUSAL_CODES.unsupportedChild,
		createRoot: () =>
			createRawOperator(VERTICAL_LAYERING_OPERATOR, [createRawSlab(), createRawBsdf(HAIR_BSDF_KIND)], {
				coverage: 1,
			}),
	},
	{
		id: "mixingWeightAboveOne",
		description: "mistura horizontal com peso 1.5",
		expectedCode: SB_REFUSAL_CODES.parameterOutOfRange,
		createRoot: () =>
			createRawOperator(HORIZONTAL_MIXING_OPERATOR, [createRawSlab(), createRawSlab()], { weight: 1.5 }),
	},
	{
		id: "mixingBetweenUnlitAndSlab",
		description: "mistura horizontal entre unlit e slab",
		expectedCode: SB_REFUSAL_CODES.domainMismatch,
		createRoot: () =>
			createRawOperator(HORIZONTAL_MIXING_OPERATOR, [createRawBsdf(UNLIT_BSDF_KIND), createRawSlab()], {
				weight: 0.5,
			}),
	},
	{
		id: "addBetweenUnlitAndSlab",
		description: "soma entre unlit e slab",
		expectedCode: SB_REFUSAL_CODES.domainMismatch,
		createRoot: () => createRawOperator(ADD_OPERATOR, [createRawBsdf(UNLIT_BSDF_KIND), createRawSlab()]),
	},
	{
		id: "weightWithNegativeWeight",
		description: "peso negativo no operador weight",
		expectedCode: SB_REFUSAL_CODES.parameterOutOfRange,
		createRoot: () => createRawOperator(WEIGHT_OPERATOR, [createRawSlab()], { weight: -0.4 }),
	},
	{
		id: "weightWithoutOperand",
		description: "operador weight sem operando",
		expectedCode: SB_REFUSAL_CODES.missingOperand,
		createRoot: () => createRawOperator(WEIGHT_OPERATOR, [], { weight: 0.5 }),
	},
	{
		id: "treeAboveMaximumDepth",
		description: "arvore com um nivel acima do teto do contrato",
		expectedCode: SB_REFUSAL_CODES.treeTooDeep,
		createRoot: () => createChainOfWeightOperators(SB_MAX_TREE_DEPTH + 1),
	},
	{
		id: "treeAboveSlabCeiling",
		description: "arvore com mais slabs do que o teto do contrato",
		expectedCode: SB_REFUSAL_CODES.tooManySlabs,
		createRoot: () => createChainOfAddedSlabs(SLABS_ABOVE_CEILING),
	},
	{
		id: "cycleInTree",
		description: "operador que aponta para si mesmo",
		expectedCode: SB_REFUSAL_CODES.cycleDetected,
		createRoot: createTreeWithCycle,
	},
])

function hasReadableReason(refusal) {
	return typeof refusal.reason === "string" && refusal.reason.trim().length > 0
}

function runBatteryEntry(batteryEntry, options) {
	try {
		const validation = validateMaterialTree(batteryEntry.createRoot(), options)
		const codes = validation.refusals.map((refusal) => refusal.code)
		return {
			id: batteryEntry.id,
			description: batteryEntry.description,
			expectedCode: batteryEntry.expectedCode,
			refused: validation.ok === false && codes.length > 0,
			codes,
			matchedExpectedCode: codes.includes(batteryEntry.expectedCode),
			everyRefusalHasReason: validation.refusals.every(hasReadableReason),
			threw: false,
			thrownMessage: null,
		}
	} catch (error) {
		return {
			id: batteryEntry.id,
			description: batteryEntry.description,
			expectedCode: batteryEntry.expectedCode,
			refused: false,
			codes: [],
			matchedExpectedCode: false,
			everyRefusalHasReason: false,
			threw: true,
			thrownMessage: error?.message ?? String(error),
		}
	}
}

function describeEntryProblems(entry) {
	if (entry.threw) return [`${entry.id}: a validacao lancou excecao (${entry.thrownMessage})`]
	if (!entry.refused) return [`${entry.id}: passou sem nenhuma recusa`]
	const problems = []
	if (!entry.matchedExpectedCode) {
		problems.push(`${entry.id}: esperava o codigo ${entry.expectedCode} e recebeu ${entry.codes.join(", ")}`)
	}
	if (!entry.everyRefusalHasReason) problems.push(`${entry.id}: recusa sem motivo legivel`)
	return problems
}


export function runInvalidTreeBattery(options = {}) {
	const entries = SB_INVALID_TREE_BATTERY.map((batteryEntry) => runBatteryEntry(batteryEntry, options))
	const problems = entries.flatMap(describeEntryProblems)
	return {
		total: entries.length,
		refusedCount: entries.filter((entry) => entry.refused).length,
		ok: problems.length === 0,
		problems,
		entries,
	}
}
