import { getSubstrateHostSurface } from "../runtime/substrateHostSurface.js"
import { createParityCertificationSession } from "../sbParityCertificationCore.js"

export const PHASE_ID = "SB-F37"
export const FLAG_ID = "SubstrateParityCertification"
export const GLSL_PATCH_COUNT = 0
export const TEXTURE_UNITS_CONSUMED_BY_PHASE = 0
export const CLOSURE_BYTES_ADDED_BY_PHASE = 0
export const HOST_SURFACE_NAME = "parityCertification"

function reportInstallError(installContext, error) {
    const message = String(error?.message ?? error)
    try {
        installContext?.telemetry?.error?.(PHASE_ID, message)
    } catch {}
    return message
}

function publishSession(session) {
    const host = getSubstrateHostSurface()
    if (!host || typeof host !== "object") return false
    if (!host[HOST_SURFACE_NAME]) host[HOST_SURFACE_NAME] = session
    return host[HOST_SURFACE_NAME] === session
}

export function installPhase(installContext) {
    try {
        if (typeof installContext?.flags?.registerFlag !== "function" || typeof installContext?.telemetry?.textureUnit !== "function" || typeof installContext?.telemetry?.closureBytes !== "function") {
            return { installed: false, certified: false, phaseId: PHASE_ID, summary: "SB-F37 blocked: missing flag or budget registration dependencies." }
        }
        const registration = installContext.flags.registerFlag({ id: FLAG_ID, owner: PHASE_ID,
            description: "Evidence intake and parity verdicts; installation is not certification.", defaultsByTier: { fraco: false, medio: true, forte: true } })
        if (registration?.accepted === false) return { installed: false, certified: false, phaseId: PHASE_ID, summary: "SB-F37 blocked: flag registration refused." }
        installContext.telemetry.textureUnit(PHASE_ID, TEXTURE_UNITS_CONSUMED_BY_PHASE)
        installContext.telemetry.closureBytes(PHASE_ID, CLOSURE_BYTES_ADDED_BY_PHASE)
        const session = createParityCertificationSession()
        const published = publishSession(session)
        installContext.telemetry.phase?.(PHASE_ID, "installed", { certified: false, published })
        return { installed: true, certified: false, phaseId: PHASE_ID, session, published,
            summary: "SB-F37 installed; certification blocked until measured evidence and external review. Zero GLSL, texture units and closure bytes." }
    } catch (error) {
        return { installed: false, certified: false, phaseId: PHASE_ID, summary: "SB-F37 blocked: " + reportInstallError(installContext, error) }
    }
}
