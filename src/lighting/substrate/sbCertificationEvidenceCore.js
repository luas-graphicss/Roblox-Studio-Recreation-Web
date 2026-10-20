export function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value)
}

export function nonEmptyText(value) {
    return typeof value === "string" && value.trim().length > 0 && value.length <= 4096
}

export function evidencePathIsSafe(path) {
    return typeof path === "string" && path.length <= 240 && /^[A-Za-z0-9_. /-]+$/.test(path) &&
        !path.startsWith("/") && path.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
}

export function evidenceProblems(evidence, expectedKind) {
    const problems = []
    if (!isRecord(evidence)) return ["Missing evidence reference."]
    if (!evidencePathIsSafe(evidence.path)) problems.push("Evidence path must stay inside the evidence directory.")
    if (typeof evidence.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(evidence.sha256)) problems.push("Missing SHA-256 digest.")
    if (evidence.kind !== expectedKind) problems.push("Expected evidence kind: " + expectedKind)
    if (evidence.synthetic !== false) problems.push("Synthetic or unspecified evidence provenance.")
    if (evidence.measurementValid !== true) problems.push("Measurement validity is not established.")
    if (!nonEmptyText(evidence.producer)) problems.push("Missing evidence producer.")
    if (!nonEmptyText(evidence.recordedAt) || !Number.isFinite(Date.parse(evidence.recordedAt))) problems.push("Missing evidence timestamp.")
    return problems
}

export function signatureProblems(record) {
    const problems = []
    if (!nonEmptyText(record?.signedBy)) problems.push("Missing named sign-off.")
    if (!nonEmptyText(record?.signedAt) || !Number.isFinite(Date.parse(record.signedAt))) problems.push("Missing sign-off timestamp.")
    return problems
}

export function uniqueRecords(records, key, expectedIds) {
    const problems = []
    const values = Array.isArray(records) ? records : []
    const byId = new Map()
    for (const record of values) {
        const id = record?.[key]
        if (!expectedIds.includes(id)) problems.push("Unknown " + key + ": " + String(id))
        else if (byId.has(id)) problems.push("Duplicate " + key + ": " + String(id))
        else byId.set(id, record)
    }
    for (const id of expectedIds) if (!byId.has(id)) problems.push("Missing " + key + ": " + id)
    return { byId, problems }
}

export function sectionResult(problems, details = {}) {
    return { ...details, complete: problems.length === 0, problems }
}
