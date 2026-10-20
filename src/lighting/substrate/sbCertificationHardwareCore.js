import { SB_BYTES_PER_PIXEL_CEILING, SB_MAX_CLOSURES_PER_PIXEL, tierDefaults } from "./sbMaterialContract.js"
import { evidenceProblems, nonEmptyText, uniqueRecords, sectionResult } from "./sbCertificationEvidenceCore.js"

const softwareRenderer = /swiftshader|llvmpipe|lavapipe|software|offscreen|microsoft basic render/i

export function evaluateCertificationHardware(runs) {
    const { byId, problems } = uniqueRecords(runs, "tier", ["fraco", "forte"])
    const hardwareIds = new Set()
    for (const tier of ["fraco", "forte"]) {
        const run = byId.get(tier)
        problems.push(...evidenceProblems(run?.evidence, "gpu-run").map((problem) => tier + ": " + problem))
        const hardwareId = typeof run?.hardwareId === "string" ? run.hardwareId.trim().toLowerCase() : ""
        if (!hardwareId || hardwareIds.has(hardwareId)) problems.push("Two distinct physical GPU devices are required.")
        hardwareIds.add(hardwareId)
        if (run?.physical !== true || run?.backend !== "webgl2" || !nonEmptyText(run?.renderer) || softwareRenderer.test(run.renderer)) problems.push(tier + ": no qualifying physical WebGL2 renderer.")
        if (run?.clockFrozen !== false) problems.push(tier + ": the measurement clock is frozen or unspecified.")
        if (!Number.isInteger(run?.sampleCount) || run.sampleCount < 1) problems.push(tier + ": missing measured frame samples.")
        if (tier === "fraco" && (run?.substrateEnabled !== false || run?.legacyByteDifference !== 0)) problems.push("Weak GPU must retain byte-identical legacy output with Substrate disabled.")
        if (tier === "forte") {
            if (run?.substrateEnabled !== true || run?.closuresPerPixel !== SB_MAX_CLOSURES_PER_PIXEL) problems.push("Strong GPU must measure three active closures.")
            if (!Number.isInteger(run?.bytesPerPixel) || run.bytesPerPixel < 1 || run.bytesPerPixel > SB_BYTES_PER_PIXEL_CEILING) problems.push("Strong GPU exceeds the material-buffer byte budget.")
            if (typeof run?.p95FrameMilliseconds !== "number" || !Number.isFinite(run.p95FrameMilliseconds) || run.p95FrameMilliseconds <= 0 || run.p95FrameMilliseconds > tierDefaults("forte").frameBudgetMilliseconds) problems.push("Strong GPU fails the measured frame-time budget.")
        }
    }
    return sectionResult(problems, { physicalAuthenticityVerified: false })
}
