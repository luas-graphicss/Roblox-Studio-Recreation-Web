import { SB_GATES, SB_SLAB_PARAMETER_NAMES, SB_TEXTURE_UNIT_CEILING, SB_CLOSURE_BYTES_CEILING, tierDefaults } from "./sbMaterialContract.js"
import { SB_PARITY_LEDGER_LINES } from "./sbParityLedgerCore.js"
import { evidenceProblems, isRecord, uniqueRecords } from "./sbCertificationEvidenceCore.js"

const metric = (name, minimum, maximum, integer = false) => Object.freeze({ name, minimum, maximum, integer })
const count = (name, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) => metric(name, minimum, maximum, true)
const zero = (name) => count(name, 0, 0)
const deviation = (name, maximum) => metric(name, 0, maximum)
const ssim = (name, minimum) => metric(name, minimum, 1)
const positive = (name) => metric(name, Number.MIN_VALUE, Number.MAX_VALUE)
const rules = {
    1: [count("treeDepth", 3), zero("roundTripLoss"), zero("renderErrors")],
    2: [count("parameterCount", SB_SLAB_PARAMETER_NAMES.length, SB_SLAB_PARAMETER_NAMES.length), zero("invalidRangeCount"), zero("missingDefaultCount")],
    3: [deviation("transmittanceError", SB_GATES.maxTransmittanceAbsoluteError)],
    4: [deviation("mixingEnergyDeviation", SB_GATES.maxMixingEnergyDeviation)],
    5: [count("algebraDepth", 3), deviation("algebraEnergyDeviation", SB_GATES.maxOperatorAlgebraEnergyDeviation)],
    6: [count("weakClosures", 1, 1), count("mediumClosures", 2, 2), count("strongClosures", 3, 3)],
    7: [count("closureBytes", 1, SB_CLOSURE_BYTES_CEILING), deviation("quantizationError", SB_GATES.maxQuantizationErrorPerChannel)],
    8: [deviation("deltaE76", SB_GATES.maxSimplificationDeltaE76), zero("overBudgetPixels")],
    9: [count("roughnessSamples", 3), zero("monotonicityViolations")],
    10: [metric("coatDarkening", SB_GATES.minimumCoatDarkening, 1), metric("thickness", 1, 1)],
    11: [count("poseSamples", 2), ssim("poseSsim", SB_GATES.anisotropyPoseMinimumSsim)],
    12: [count("lobeCount", 2, 2), deviation("energyDeviation", SB_GATES.maxDualLobeEnergyDeviation)],
    13: [count("qualityLevels", 2), deviation("energyDeviation", SB_GATES.maxSheenEnergyDeviation)],
    14: [count("angleSamples", 8), deviation("deltaE76", SB_GATES.maxThinFilmDeltaE76)],
    15: [count("lodLevels", 4), zero("aliasingPixels"), deviation("temporalVariance", SB_GATES.maxGlintTemporalVariance)],
    16: [count("changedPixels"), zero("programDelta"), count("programsPerFamily", 1, SB_GATES.maxProgramsPerMaterialFamily)],
    17: [count("roughnessSamples", 3), deviation("energyDeviation", SB_GATES.maxReferenceEnergyDeviation)],
    18: [deviation("radialProfileDeviation", SB_GATES.maxDiffusionProfileDeviation)],
    19: [positive("frontBackRatio"), count("backlightSamples")],
    20: [count("glassLayers", 4, 4), count("poseSamples"), zero("wrongOrderPixels")],
    21: [count("separableLobes", 3, 3), metric("totalEnergy", 0, 1)],
    22: [count("refractionPixels"), count("poseSamples"), zero("unstablePixels")],
    23: [deviation("absorptionDeviation", SB_GATES.maxWaterAbsorptionDeviation)],
    24: [count("compiledDomains", 4, 4), count("renderedDomains", 4, 4)],
    25: [count("textureUnits", 2, SB_TEXTURE_UNIT_CEILING), count("ltcTextureUnits", 2, 2)],
    26: [positive("roughnessDelta"), positive("normalAngularDelta")],
    27: [count("materialCount"), metric("convertedFraction", 1, 1), ssim("worstMaterialSsim", SB_GATES.legacyConversionMinimumSsim)],
    28: [count("editedNodeCount"), zero("validationErrors"), zero("roundTripLoss")],
    29: [count("closureCount", 2, 3), deviation("lightingEnergyDeviation", SB_GATES.maxClosureLightingEnergyDeviation)],
    30: [count("testedRays"), zero("wrongLayerSamples")],
    31: [count("testedPixels"), zero("materialCountError")],
    32: [count("testedPixels"), zero("byteCountError"), zero("budgetLabelError")],
    33: [count("testedPixels"), zero("closureListError")],
    34: [metric("oneClosureMilliseconds", Number.MIN_VALUE, tierDefaults("forte").frameBudgetMilliseconds), metric("twoClosureMilliseconds", Number.MIN_VALUE, tierDefaults("forte").frameBudgetMilliseconds), metric("threeClosureMilliseconds", Number.MIN_VALUE, tierDefaults("forte").frameBudgetMilliseconds)],
    35: [count("additionalProgramsPerFamily", 0, SB_GATES.maxProgramsPerMaterialFamily)],
    36: [metric("minimumFurnaceEnergy", SB_GATES.furnaceMinimum, SB_GATES.furnaceMaximum), metric("maximumFurnaceEnergy", SB_GATES.furnaceMinimum, SB_GATES.furnaceMaximum)],
    37: [ssim("offSsim", SB_GATES.flagOffMinimumSsim)],
    38: [zero("byteDifference")],
    39: [deviation("warmupMilliseconds", SB_GATES.maxWarmupSpikeMilliseconds)],
    40: [metric("confusionRate", SB_GATES.blindRoundMinimumConfusionRate, 1), count("evaluators", SB_GATES.blindRoundMinimumEvaluators), count("scenesCovered", 12, 12)],
    41: [ssim("branchSsim", SB_GATES.branchParityMinimumSsim)],
    42: [deviation("photometryDeviation", SB_GATES.maxPhotometryDeviation)],
    43: [count("testedPoses"), zero("highlightAliasingPixels")],
    44: [count("topologyCount"), zero("roundTripLoss")],
}
for (const value of Object.values(rules)) Object.freeze(value)
export const SB_PARITY_METRIC_RULES = Object.freeze(rules)

export function evaluateParityLine(lineId, measurement, blindRound) {
    const definition = SB_PARITY_LEDGER_LINES.find((line) => line.id === lineId)
    if (!definition) return { lineId, verdict: "invalid", problems: ["Unknown parity line."] }
    const problems = evidenceProblems(measurement?.evidence, "measurement")
    if (!definition.phases.includes(measurement?.phaseId)) problems.push("Measurement has no owning phase.")
    const metrics = lineId === 40 ? blindRound?.metrics : measurement?.metrics
    if (lineId === 40 && blindRound?.complete !== true) problems.push("Blind-round protocol is incomplete.")
    const checks = rules[lineId].map((rule) => {
        const value = isRecord(metrics) ? metrics[rule.name] : undefined
        const measured = typeof value === "number" && Number.isFinite(value) && (!rule.integer || Number.isInteger(value))
        const passed = measured && value >= rule.minimum && value <= rule.maximum
        if (!measured) problems.push("Missing finite numeric metric: " + rule.name)
        return { ...rule, value: measured ? value : null, measured, passed }
    })
    if (lineId === 36 && metrics?.minimumFurnaceEnergy > metrics?.maximumFurnaceEnergy) problems.push("Reversed furnace range.")
    const failed = checks.filter((check) => check.measured && !check.passed).map((check) => check.name)
    return { lineId, term: definition.term, gate: definition.gate, phaseId: measurement?.phaseId ?? null, evidence: measurement?.evidence ?? null,
        verdict: problems.length ? "unmeasured" : failed.length ? "fail" : "pass", checks, failed, problems }
}

export function evaluateParityLedger(measurements, blindRound) {
    const expected = SB_PARITY_LEDGER_LINES.map((line) => line.id)
    const { byId, problems } = uniqueRecords(measurements, "lineId", expected)
    const rows = expected.map((lineId) => evaluateParityLine(lineId, byId.get(lineId), blindRound))
    return { rows, problems, total: rows.length, passed: rows.filter((row) => row.verdict === "pass").length,
        failed: rows.filter((row) => row.verdict === "fail").map((row) => row.lineId),
        missing: rows.filter((row) => row.verdict === "unmeasured").map((row) => row.lineId),
        complete: problems.length === 0 && rows.every((row) => row.verdict !== "unmeasured") }
}
