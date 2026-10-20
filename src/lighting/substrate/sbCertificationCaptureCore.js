import { SB_GATES } from "./sbMaterialContract.js"
import { SB_CERTIFICATION_SCENE_IDS } from "./sbCertificationContract.js"
import { evidenceProblems, nonEmptyText, uniqueRecords, sectionResult } from "./sbCertificationEvidenceCore.js"

export function evaluateCertificationCaptures(captures) {
    const { byId, problems } = uniqueRecords(captures, "sceneId", SB_CERTIFICATION_SCENE_IDS)
    const rows = []
    for (const sceneId of SB_CERTIFICATION_SCENE_IDS) {
        const capture = byId.get(sceneId)
        const errors = []
        for (const mode of ["engineOn", "engineOff", "legacy", "unreal"]) errors.push(...evidenceProblems(capture?.[mode], "capture").map((problem) => mode + ": " + problem))
        errors.push(...evidenceProblems(capture?.evidence, "measurement"))
        if (typeof capture?.offSsim !== "number" || !Number.isFinite(capture.offSsim) || capture.offSsim < SB_GATES.flagOffMinimumSsim || capture.offSsim > 1) errors.push("Flag-OFF SSIM fails the frozen gate.")
        if (!Number.isInteger(capture?.changedPixels) || capture.changedPixels < 1) errors.push("Flag-ON has no measured effect.")
        if (!Number.isInteger(capture?.width) || capture.width < 1 || capture.width > 8192 || !Number.isInteger(capture?.height) || capture.height < 1 || capture.height > 8192) errors.push("Invalid capture dimensions.")
        if (capture?.changedPixels > capture?.width * capture?.height) errors.push("Changed-pixel count exceeds capture dimensions.")
        if (typeof capture?.referenceVersion !== "string" || !/^5\.[2-9](?:\.\d+)?$/.test(capture.referenceVersion) || !nonEmptyText(capture?.referenceBuild)) errors.push("The Unreal reference build is not identified.")
        if (typeof capture?.captureStateSha256 !== "string" || !/^[a-f0-9]{64}$/.test(capture.captureStateSha256)) errors.push("Missing shared camera/exposure/capture-state digest.")
        rows.push({ sceneId, complete: errors.length === 0, problems: errors })
        problems.push(...errors.map((error) => sceneId + ": " + error))
    }
    return sectionResult(problems, { rows })
}
