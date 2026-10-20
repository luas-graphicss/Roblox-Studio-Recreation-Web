import { SB_GATES, SB_MAX_CLOSURES_PER_PIXEL } from "./sbMaterialContract.js"
import { DEFAULT_CLOSURE_KIND, closureKindBytes, createStubClosureList, tierClosureCeiling } from "./sbClosureDispatchCore.js"
import {
	DEBUG_VISUALIZATION_PHASE_ID,
	SB_DEBUG_MODES,
	SB_DEBUG_MODE_IDS,
	buildPixelDispatchPlan,
	debugModeFromCode,
	debugRampColor,
	evaluateDebugVisualization,
} from "./sbDebugVisualizationCore.js"
import { buildDebugVisualizationGlsl, debugVisualizationGlslProblems } from "./sbDebugVisualizationGlsl.js"


export const SB_DEBUG_CERTIFICATION_SCENARIOS = Object.freeze([
	Object.freeze({ id: "singleClosureOnLowTier", tierName: "fraco", requestedClosureCount: 1 }),
	Object.freeze({ id: "twoClosuresOnMediumTier", tierName: "medio", requestedClosureCount: 2 }),
	Object.freeze({ id: "threeClosuresOnHighTier", tierName: "forte", requestedClosureCount: 3 }),
	Object.freeze({ id: "aboveTierCeiling", tierName: "medio", requestedClosureCount: 4 }),
])






export function countAllRequestedClosures(plan) {
	return Number.isInteger(plan?.requestedCount) ? plan.requestedCount : 0
}

function maxChannelDistance(leftColor, rightColor) {
	return leftColor.reduce(
		(largest, channelValue, channel) => Math.max(largest, Math.abs(channelValue - rightColor[channel])),
		0,
	)
}


export function measureDebugScenario(scenario) {
	const closures = createStubClosureList({
		closureCount: scenario.requestedClosureCount,
		kind: DEFAULT_CLOSURE_KIND,
	})
	const request = { closures, tierName: scenario.tierName }
	const plan = buildPixelDispatchPlan(request)
	const expectedClosureCount = Math.min(scenario.requestedClosureCount, tierClosureCeiling(scenario.tierName))
	const expectedBytes = expectedClosureCount * closureKindBytes(DEFAULT_CLOSURE_KIND)
	const problems = []

	const off = evaluateDebugVisualization({ ...request, modeId: SB_DEBUG_MODE_IDS.off })
	const materialCount = evaluateDebugVisualization({ ...request, modeId: SB_DEBUG_MODE_IDS.materialCount })
	const bytes = evaluateDebugVisualization({ ...request, modeId: SB_DEBUG_MODE_IDS.bytesPerPixel })
	const inspector = evaluateDebugVisualization({ ...request, modeId: SB_DEBUG_MODE_IDS.closureInspector })

	if (materialCount.readout.closureCount !== expectedClosureCount) {
		problems.push(
			"a contagem do modo (" +
				materialCount.readout.closureCount +
				") nao bate com o teto do tier " +
				scenario.tierName +
				" (" +
				expectedClosureCount +
				")",
		)
	}
	if (materialCount.readout.closureCount !== plan.dispatchedCount) {
		problems.push("a contagem do modo divergiu do plano de despacho da SB-F9")
	}
	if (bytes.readout.bytesPerPixel !== expectedBytes) {
		problems.push(
			"os bytes do modo (" + bytes.readout.bytesPerPixel + ") nao batem com o layout da SB-F8 (" + expectedBytes + ")",
		)
	}
	if (bytes.readout.bytesPerPixel !== plan.bytesPerPixel) {
		problems.push("os bytes do modo divergiram do plano de despacho da SB-F9")
	}
	if (bytes.readout.tierCeiling !== plan.byteCeiling) {
		problems.push("o teto de bytes do modo nao e o teto do tier no plano")
	}
	if (inspector.readout.rowCount !== expectedClosureCount) {
		problems.push("o inspetor listou " + inspector.readout.rowCount + " closure(s) para " + expectedClosureCount + " despachada(s)")
	}
	if (inspector.readout.totalBytes !== bytes.readout.bytesPerPixel) {
		problems.push("o inspetor e o modo de bytes discordaram: dois numeros para a mesma coisa")
	}
	if (off.paintsPixel !== false || off.color !== null) {
		problems.push("o modo desligado pintou pixel")
	}
	if (inspector.paintsPixel !== false) {
		problems.push("o inspetor pintou pixel em vez de listar")
	}

	const wrongReaderCount = countAllRequestedClosures(plan)
	const negativeControlSeparates =
		plan.droppedCount === 0 ? wrongReaderCount === plan.dispatchedCount : wrongReaderCount !== plan.dispatchedCount
	if (!negativeControlSeparates) {
		problems.push("o controle negativo nao separou o numero certo do errado neste cenario")
	}

	return {
		id: scenario.id,
		tierName: scenario.tierName,
		requestedClosureCount: scenario.requestedClosureCount,
		expectedClosureCount,
		expectedBytes,
		closureCount: materialCount.readout.closureCount,
		closureCeiling: materialCount.readout.tierCeiling,
		closureRatio: materialCount.ratio,
		bytesPerPixel: bytes.readout.bytesPerPixel,
		byteCeiling: bytes.readout.tierCeiling,
		byteRatio: bytes.ratio,
		withinByteCeiling: bytes.readout.withinTierCeiling,
		inspectedRowCount: inspector.readout.rowCount,
		inspectedTotalBytes: inspector.readout.totalBytes,
		droppedCount: plan.droppedCount,
		dropReasons: plan.dropped.map((closure) => closure.dropReason),
		wrongReaderCount,
		negativeControlSeparates,
		planProblems: plan.problems,
		problems,
	}
}


export function measureModeTable() {
	const problems = []
	const codes = SB_DEBUG_MODES.map((mode) => mode.code)
	if (new Set(codes).size !== codes.length) problems.push("dois modos com o mesmo codigo de uniform")
	if (SB_DEBUG_MODES[0].code !== 0) problems.push("o modo desligado nao e o codigo zero")
	for (const mode of SB_DEBUG_MODES) {
		if (debugModeFromCode(mode.code) !== mode.id) problems.push("o codigo " + mode.code + " nao volta para " + mode.id)
	}
	const paintingModeCount = SB_DEBUG_MODES.filter((mode) => mode.paintsPixel).length
	return {
		modeCount: SB_DEBUG_MODES.length,
		codes,
		paintingModeCount,
		ok: problems.length === 0,
		problems,
	}
}


export function measureRampDistinguishability() {
	const quantizationFloor = SB_GATES.maxQuantizationErrorPerChannel
	const ratios = []
	for (let closureCount = 0; SB_MAX_CLOSURES_PER_PIXEL >= closureCount; closureCount += 1) {
		ratios.push(closureCount / SB_MAX_CLOSURES_PER_PIXEL)
	}
	const colors = ratios.map((ratio) => debugRampColor(ratio))
	const distances = []
	for (let index = 1; colors.length > index; index += 1) {
		distances.push(maxChannelDistance(colors[index - 1], colors[index]))
	}
	const smallestDistance = Math.min(...distances)
	const problems = []
	if (smallestDistance === 0 || quantizationFloor >= smallestDistance) {
		problems.push(
			"a rampa separa contagens vizinhas em apenas " +
				smallestDistance.toFixed(6) +
				", dentro do piso de quantizacao " +
				quantizationFloor.toFixed(6),
		)
	}
	const firstStopIsFirstColor = maxChannelDistance(colors[0], debugRampColor(-5)) === 0
	const lastStopIsLastColor = maxChannelDistance(colors[colors.length - 1], debugRampColor(5)) === 0
	if (!firstStopIsFirstColor || !lastStopIsLastColor) {
		problems.push("a rampa nao prende razao fora de faixa nas paradas das pontas")
	}
	return {
		quantizationFloor,
		ratios,
		colors,
		distances,
		smallestDistance,
		ok: problems.length === 0,
		problems,
	}
}


export function certifyDebugVisualization() {
	const scenarios = SB_DEBUG_CERTIFICATION_SCENARIOS.map((scenario) => measureDebugScenario(scenario))
	const modeTable = measureModeTable()
	const ramp = measureRampDistinguishability()
	const glsl = buildDebugVisualizationGlsl()
	const glslProblems = debugVisualizationGlslProblems(glsl)

	const problems = []
	for (const scenario of scenarios) {
		for (const problem of scenario.problems) problems.push(scenario.id + ": " + problem)
	}
	for (const problem of modeTable.problems) problems.push("tabela de modos: " + problem)
	for (const problem of ramp.problems) problems.push("rampa: " + problem)
	for (const problem of glslProblems) problems.push("GLSL: " + problem)

	const negativeControlSeparated = scenarios.some(
		(scenario) => scenario.droppedCount > 0 && scenario.wrongReaderCount !== scenario.closureCount,
	)
	if (!negativeControlSeparated) {
		problems.push("controle negativo: nenhum cenario cortou closure, entao a conferencia passaria vazia")
	}

	return {
		phaseId: DEBUG_VISUALIZATION_PHASE_ID,
		ok: problems.length === 0,
		problems,
		scenarios,
		modeTable,
		ramp,
		negativeControlSeparated,
		glsl: {
			declarationLineCount: glsl.declarations.split("\n").length,
			codeLineCount: glsl.code.split("\n").length,
			problems: glslProblems,
		},
		planProblemsByScenario: scenarios.map((scenario) => ({ id: scenario.id, planProblems: scenario.planProblems })),
	}
}
