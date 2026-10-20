import {
	createSlabNode,
	createOperatorNode,
	createReferenceSlabTree,
	createReferenceLayeredTree,
} from "./sbMaterialTreeCore.js"
import { compileMaterialTopology } from "./sbTopologyCompilerCore.js"
import { SB_DEFAULT_MATERIAL_FAMILY } from "./sbTopologySignatureCore.js"

const VERTICAL_LAYERING_OPERATOR = "verticalLayering"
const HORIZONTAL_MIXING_OPERATOR = "horizontalMixing"
const ADD_OPERATOR = "add"
const WEIGHT_OPERATOR = "weight"


export const createBaselineTree = createReferenceLayeredTree

function createSlab(overrides, label) {
	return createSlabNode(
		{
			albedo: [0.8, 0.8, 0.8],
			f0: [0.04, 0.04, 0.04],
			f90: [1, 1, 1],
			roughness: 0.4,
			opacity: 1,
			...overrides,
		},
		{ label },
	)
}


function createMixOfTwoLayeredStacks(recipe) {
	return createOperatorNode({
		operator: HORIZONTAL_MIXING_OPERATOR,
		label: recipe.label,
		parameters: { weight: recipe.mixingWeight },
		children: [
			createOperatorNode({
				operator: VERTICAL_LAYERING_OPERATOR,
				label: "firstStack",
				parameters: { coverage: recipe.firstCoverage, thickness: recipe.firstThickness },
				children: [createSlab(recipe.firstTop, "firstTop"), createSlab(recipe.firstBottom, "firstBottom")],
			}),
			createOperatorNode({
				operator: VERTICAL_LAYERING_OPERATOR,
				label: "secondStack",
				parameters: { coverage: recipe.secondCoverage, thickness: recipe.secondThickness },
				children: [createSlab(recipe.secondTop, "secondTop"), createSlab(recipe.secondBottom, "secondBottom")],
			}),
		],
	})
}


function createSameShapeRecipe(overrides) {
	return {
		label: "sameShapeOtherValues",
		mixingWeight: 0.72,
		firstCoverage: 0.83,
		firstThickness: 0.31,
		secondCoverage: 0.24,
		secondThickness: 0.44,
		firstTop: { albedo: [0.11, 0.62, 0.33], roughness: 0.91 },
		firstBottom: { albedo: [0.02, 0.02, 0.9], f0: [0.71, 0.7, 0.68], roughness: 0.13 },
		secondTop: { albedo: [0.5, 0.1, 0.1], roughness: 0.77, thinFilmThicknessNanometers: 520, thinFilmIor: 2.1 },
		secondBottom: { albedo: [0.95, 0.95, 0.2], roughness: 0.05 },
		...overrides,
	}
}

function createLayeredStackOfTwoSlabs(label) {
	return createOperatorNode({
		operator: VERTICAL_LAYERING_OPERATOR,
		label,
		parameters: { coverage: 1, thickness: 0.08 },
		children: [createSlab({ roughness: 0.06 }, label + "Top"), createSlab({ roughness: 0.28 }, label + "Bottom")],
	})
}

function createAddOfTwoSlabs(label) {
	return createOperatorNode({
		operator: ADD_OPERATOR,
		label,
		children: [createSlab({ roughness: 0.06 }, label + "First"), createSlab({ roughness: 0.28 }, label + "Second")],
	})
}


export function createPrunedBranchTree() {
	return createOperatorNode({
		operator: ADD_OPERATOR,
		label: "liveSlabPlusDeadBranch",
		children: [
			createSlab({ albedo: [0.3, 0.3, 0.3] }, "liveSlab"),
			createOperatorNode({
				operator: WEIGHT_OPERATOR,
				label: "deadBranch",
				parameters: { weight: 0 },
				children: [createSlab({ albedo: [0.9, 0.1, 0.1] }, "prunedSlab")],
			}),
		],
	})
}


export const SB_TOPOLOGY_PERMUTATION_BATTERY = Object.freeze([
	{
		id: "sameTreeCompiledTwice",
		description: "a mesma arvore de referencia, compilada de novo",
		expectSameSignature: true,
		why: "compilar duas vezes tem de dar a mesma topologia, ou nada em cache serve",
		createTree: () => createBaselineTree(),
	},
	{
		id: "sameShapeOtherValues",
		description: "mesma forma e mesmas features, todos os valores trocados",
		expectSameSignature: true,
		why: "valor de material vira uniform, nao programa novo",
		createTree: () => createMixOfTwoLayeredStacks(createSameShapeRecipe()),
	},
	{
		id: "sameShapeOtherMixingWeight",
		description: "mesma forma, so o peso da mistura horizontal muda",
		expectSameSignature: true,
		why: "peso de mistura e valor: enquanto nao zera um lado, a forma e a mesma",
		createTree: () => createMixOfTwoLayeredStacks(createSameShapeRecipe({ mixingWeight: 0.19 })),
	},
	{
		id: "thinFilmTurnedOff",
		description: "mesma forma, filme fino desligado",
		expectSameSignature: false,
		why: "feature desligada apaga codigo do shader: e outro programa",
		createTree: () =>
			createMixOfTwoLayeredStacks(
				createSameShapeRecipe({ secondTop: { albedo: [0.5, 0.1, 0.1], roughness: 0.77 } }),
			),
	},
	{
		id: "glintsTurnedOn",
		description: "mesma forma, brilho granulado ligado em uma closure",
		expectSameSignature: false,
		why: "feature ligada acende codigo do shader: e outro programa",
		createTree: () =>
			createMixOfTwoLayeredStacks(
				createSameShapeRecipe({
					firstTop: { albedo: [0.11, 0.62, 0.33], roughness: 0.91, glintDensity: 1200, glintRoughness: 0.2 },
				}),
			),
	},
	{
		id: "rootMixingSwappedToAdd",
		description: "a mistura horizontal da raiz virou soma",
		expectSameSignature: false,
		why: "a matematica do operador muda o laco de closures",
		createTree: () =>
			createOperatorNode({
				operator: ADD_OPERATOR,
				label: "twoStacksAdded",
				children: [createLayeredStackOfTwoSlabs("firstStack"), createLayeredStackOfTwoSlabs("secondStack")],
			}),
	},
	{
		id: "layeringSwappedToAdd",
		description: "as duas pilhas verticais viraram somas",
		expectSameSignature: false,
		why: "sem empilhamento nao ha camada cobrindo ninguem: a pilha de closures e outra",
		createTree: () =>
			createOperatorNode({
				operator: HORIZONTAL_MIXING_OPERATOR,
				label: "twoAddedPairsMixed",
				parameters: { weight: 0.35 },
				children: [createAddOfTwoSlabs("firstPair"), createAddOfTwoSlabs("secondPair")],
			}),
	},
	{
		id: "extraSlabAddedAtRoot",
		description: "a arvore de referencia com um slab somado por cima",
		expectSameSignature: false,
		why: "uma closure a mais e um laco a mais",
		createTree: () =>
			createOperatorNode({
				operator: ADD_OPERATOR,
				label: "referencePlusExtraSlab",
				children: [createBaselineTree(), createSlab({ albedo: [0.4, 0.4, 0.45] }, "extraSlab")],
			}),
	},
	{
		id: "singleSlabOnly",
		description: "um slab solto, sem operador nenhum",
		expectSameSignature: false,
		why: "o caso mais simples do motor tem de ser um programa proprio, e o mais barato",
		createTree: () => createReferenceSlabTree(),
	},
])

function describeEntryProblems(entry) {
	const problems = []
	if (entry.threw) {
		problems.push(`${entry.id}: o compilador lancou excecao (${entry.thrownMessage})`)
		return problems
	}
	if (!entry.compiled.ok) {
		problems.push(`${entry.id}: arvore valida foi recusada pelo compilador (${entry.refusalReasons.join("; ")})`)
	}
	if (!entry.matchedExpectation) {
		const expected = entry.expectSameSignature ? "a MESMA assinatura" : "uma assinatura DIFERENTE"
		problems.push(`${entry.id}: esperava ${expected} da referencia (${entry.why})`)
	}
	if (entry.compiled.orderProblems.length > 0) {
		problems.push(`${entry.id}: ordem das closures inconsistente (${entry.compiled.orderProblems.join("; ")})`)
	}
	return problems
}

function runBatteryEntry(batteryEntry, baselineSignature, options) {
	try {
		const compiled = compileMaterialTopology(batteryEntry.createTree(), options)
		const sameSignature = compiled.signature === baselineSignature
		return {
			id: batteryEntry.id,
			description: batteryEntry.description,
			why: batteryEntry.why,
			expectSameSignature: batteryEntry.expectSameSignature,
			sameSignature,
			matchedExpectation: sameSignature === batteryEntry.expectSameSignature,
			signatureHash: compiled.signatureHash,
			programKey: compiled.programKey,
			refusalReasons: compiled.refusals.map((refusal) => refusal.reason),
			compiled: {
				ok: compiled.ok,
				closureCount: compiled.budget.closureCount,
				byteCount: compiled.budget.byteCount,
				withinBudget: compiled.budget.withinBudget,
				requiresSimplification: compiled.requiresSimplification,
				orderProblems: compiled.orderProblems,
			},
			threw: false,
			thrownMessage: null,
		}
	} catch (error) {
		return {
			id: batteryEntry.id,
			description: batteryEntry.description,
			why: batteryEntry.why,
			expectSameSignature: batteryEntry.expectSameSignature,
			sameSignature: false,
			matchedExpectation: false,
			signatureHash: null,
			programKey: null,
			refusalReasons: [],
			compiled: {
				ok: false,
				closureCount: 0,
				byteCount: 0,
				withinBudget: false,
				requiresSimplification: false,
				orderProblems: [],
			},
			threw: true,
			thrownMessage: error?.message ?? String(error),
		}
	}
}


export function runTopologyPermutationBattery(options = {}) {
	const compileOptions = {
		tier: options.tier,
		materialFamily: options.materialFamily ?? SB_DEFAULT_MATERIAL_FAMILY,
	}
	const baseline = compileMaterialTopology(createBaselineTree(), compileOptions)
	const entries = SB_TOPOLOGY_PERMUTATION_BATTERY.map((batteryEntry) =>
		runBatteryEntry(batteryEntry, baseline.signature, compileOptions),
	)
	const problems = entries.flatMap(describeEntryProblems)
	if (!baseline.ok) {
		problems.push(`referencia recusada pelo compilador: ${baseline.refusals.map((r) => r.reason).join("; ")}`)
	}

	const distinctSignatureHashes = Array.from(
		new Set([baseline.signatureHash, ...entries.map((entry) => entry.signatureHash)].filter(Boolean)),
	)

	return {
		ok: problems.length === 0,
		total: entries.length,
		matchedCount: entries.filter((entry) => entry.matchedExpectation).length,
		sameSignatureCount: entries.filter((entry) => entry.sameSignature).length,
		distinctSignatureHashes,
		distinctSignatureCount: distinctSignatureHashes.length,
		baseline: {
			ok: baseline.ok,
			signatureHash: baseline.signatureHash,
			programKey: baseline.programKey,
			closureCount: baseline.budget.closureCount,
			byteCount: baseline.budget.byteCount,
		},
		problems,
		entries,
	}
}
