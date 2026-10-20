import { contractSelfCheck } from "./sbMaterialContract.js"
import { SB_CERTIFICATION_VERSION, SB_BRIDGE_CHECK_IDS } from "./sbCertificationContract.js"
import { evidenceProblems, signatureProblems, uniqueRecords, sectionResult, isRecord } from "./sbCertificationEvidenceCore.js"
import { evaluateBlindRound } from "./sbBlindRoundCore.js"
import { evaluateParityLedger } from "./sbVerdictGatesCore.js"
import { evaluateCertificationCaptures } from "./sbCertificationCaptureCore.js"
import { evaluateCertificationHardware } from "./sbCertificationHardwareCore.js"
import { evaluateCertificationResidues } from "./sbCertificationResidueCore.js"

function evaluateNodeBattery(input) {
    const problems = evidenceProblems(input?.evidence, "node-suite")
    if (!Number.isInteger(input?.total) || input.total < 37 || input.passed !== input.total || input.failed !== 0 || input.skipped !== 0 || input.fullSuite !== true) problems.push("A complete passing Node suite is required; selected tests are insufficient.")
    const expected = Array.from({ length: 37 }, (_, index) => "SB-F" + (index + 1))
    const phases = input?.coveredPhases
    if (!Array.isArray(phases) || phases.length !== expected.length || new Set(phases).size !== expected.length || expected.some((id) => !phases.includes(id))) problems.push("The Node report must cover all 37 phases, including F2 contract checks.")
    if (input?.contractPassed !== true || input?.ledgerPassed !== true) problems.push("Contract and parity-ledger checks are mandatory.")
    return sectionResult(problems)
}

function evaluateBridge(input) {
    const { byId, problems } = uniqueRecords(input?.checks, "id", SB_BRIDGE_CHECK_IDS)
    for (const id of SB_BRIDGE_CHECK_IDS) {
        const check = byId.get(id)
        if (check?.passed !== true) problems.push("Bridge check not approved: " + id)
        problems.push(...evidenceProblems(check?.evidence, "bridge-check").map((problem) => id + ": " + problem))
        problems.push(...signatureProblems(check).map((problem) => id + ": " + problem))
    }
    const branches = input?.branches
    if (!Array.isArray(branches) || branches.length !== 2 || !branches.includes("individual") || !branches.includes("pool")) problems.push("Both lightingRender branches must be covered explicitly.")
    return sectionResult(problems)
}

export function evaluateParityCertification(packet) {
    const input = isRecord(packet) ? packet : {}
    const blindRound = evaluateBlindRound(input.blindRound)
    const parity = evaluateParityLedger(input.measurements, blindRound)
    const sections = {
        contract: contractSelfCheck(), node: evaluateNodeBattery(input.node), captures: evaluateCertificationCaptures(input.captures),
        hardware: evaluateCertificationHardware(input.hardware), blindRound, parity,
        residues: evaluateCertificationResidues(input.residues, parity.rows), bridge: evaluateBridge(input.bridge),
    }
    const blockers = []
    if (input.version !== SB_CERTIFICATION_VERSION) blockers.push("Missing or unsupported certification packet version.")
    if (input.synthetic !== false) blockers.push("Synthetic or unspecified packets cannot be submitted as measured evidence.")
    if (!sections.contract.ok) blockers.push("The frozen material contract failed its self-check.")
    for (const [name, section] of Object.entries(sections)) if (name !== "contract" && !section.complete) blockers.push(name + ": incomplete or invalid evidence.")
    if (!blindRound.passed) blockers.push("Blind confusion must reach 70% with the full human matrix.")
    if (parity.failed.length) blockers.push("Failed parity lines: " + parity.failed.join(", "))
    return { version: SB_CERTIFICATION_VERSION, phaseId: "SB-F37", installed: true, certified: false,
        status: blockers.length ? "blocked" : "awaiting-file-verification", numericReady: blockers.length === 0, readyForReview: false,
        sections, blockers, externalRequirements: [
            "Verify every referenced evidence file and its digest in the isolated verifier.",
            "A reviewer must authenticate human participation, physical GPUs, Unreal references and signed residues.",
            "An automated report is not a parity certificate or an Unreal 5.9 feature-completeness claim.",
        ] }
}

export function createParityCertificationSession() {
    let report = evaluateParityCertification(null)
    return Object.freeze({
        evaluate(packet) { report = evaluateParityCertification(packet); return structuredClone(report) },
        report() { return structuredClone(report) },
        reset() { report = evaluateParityCertification(null); return structuredClone(report) },
    })
}
