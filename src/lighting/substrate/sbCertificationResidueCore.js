import { SB_FIVE_NINE_RESIDUES } from "./sbReferenceSourcesCore.js"
import { SB_CERTIFICATION_RESIDUES } from "./sbCertificationContract.js"
import { evidenceProblems, signatureProblems, nonEmptyText, uniqueRecords, sectionResult } from "./sbCertificationEvidenceCore.js"

export function requiredCertificationResidueIds() {
    return [...SB_CERTIFICATION_RESIDUES.map((residue) => residue.id), ...SB_FIVE_NINE_RESIDUES.map((residue) => residue.id)]
}

export function evaluateCertificationResidues(records, parityRows = []) {
    const required = requiredCertificationResidueIds()
    const expected = [...required, ...parityRows.filter((row) => row.verdict !== "pass").map((row) => "line-" + row.lineId)]
    const values = Array.isArray(records) ? records : []
    const allowed = [...required, ...Array.from({ length: 44 }, (_, index) => "line-" + (index + 1))]
    const { byId, problems } = uniqueRecords(values, "id", [...new Set([...expected, ...values.map((record) => record?.id).filter((id) => allowed.includes(id))])])
    for (const record of values) {
        if (!allowed.includes(record?.id)) continue
        problems.push(...evidenceProblems(record.evidence, "residue").map((problem) => record.id + ": " + problem))
        problems.push(...signatureProblems(record).map((problem) => record.id + ": " + problem))
        if (!nonEmptyText(record.statement)) problems.push(record.id + ": missing explicit limitation or finding.")
        const structural = SB_CERTIFICATION_RESIDUES.find((residue) => residue.id === record.id)
        if (structural && (record.statement !== structural.statement || !Array.isArray(record.lineIds) || structural.lines.some((lineId) => !record.lineIds.includes(lineId)))) problems.push(record.id + ": required structural disclosure was changed or omitted.")
        if (!["accepted-limitation", "unverified", "confirmed", "refuted"].includes(record.state)) problems.push(record.id + ": invalid disposition.")
        if (!Array.isArray(record.lineIds) || new Set(record.lineIds).size !== record.lineIds.length || record.lineIds.some((id) => !Number.isInteger(id) || id < 1 || id > 44)) problems.push(record.id + ": invalid parity-line coverage.")
        if (record.id.startsWith("line-") && (!Array.isArray(record.lineIds) || !record.lineIds.includes(Number(record.id.slice(5))))) problems.push(record.id + ": residue does not identify its open line.")
    }
    const uncoveredLines = parityRows.filter((row) => row.verdict !== "pass" && !byId.has("line-" + row.lineId)).map((row) => row.lineId)
    const unverifiedVersionClaims = SB_FIVE_NINE_RESIDUES.filter((residue) => byId.get(residue.id)?.state !== "confirmed" && byId.get(residue.id)?.state !== "refuted").map((residue) => residue.id)
    return sectionResult(problems, { uncoveredLines, unverifiedVersionClaims, signaturesCryptographicallyVerified: false })
}
