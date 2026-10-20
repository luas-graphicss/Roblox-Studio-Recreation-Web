import { sbQa } from "./support/src/lab/labTelemetry.js"

export const SB_FRAME_STAGES = ["beforeMaterials", "beforeRender", "afterRender"]

const stagesByName = new Map(SB_FRAME_STAGES.map((stageName) => [stageName, []]))


export function registerFrameStage(stageName, definition) {
	const stage = stagesByName.get(stageName)
	if (!stage) {
		sbQa.error("sbFrameStages", "estagio desconhecido: " + stageName)
		return { accepted: false, reason: "estagio desconhecido" }
	}
	if (!definition?.id || typeof definition.run !== "function") {
		return { accepted: false, reason: "id e run sao obrigatorios" }
	}
	if (stage.some((entry) => entry.id === definition.id)) {
		return { accepted: false, reason: "id ja registrado neste estagio" }
	}
	stage.push({ id: definition.id, owner: definition.owner ?? "base", run: definition.run, errorCount: 0 })
	sbQa.frameStage(stageName, { count: stage.length })
	return { accepted: true, stageName, id: definition.id }
}

export function removeFrameStage(stageName, id) {
	const stage = stagesByName.get(stageName)
	if (!stage) return false
	const index = stage.findIndex((entry) => entry.id === id)
	if (index === -1) return false
	stage.splice(index, 1)
	return true
}

export function listFrameStages() {
	return SB_FRAME_STAGES.map((stageName) => ({
		stage: stageName,
		entries: stagesByName.get(stageName).map((entry) => ({
			id: entry.id,
			owner: entry.owner,
			errorCount: entry.errorCount,
		})),
	}))
}


export function runFrameStages(stageName, frameContext) {
	const stage = stagesByName.get(stageName)
	if (!stage) return frameContext
	for (const entry of stage) {
		try {
			entry.run(frameContext)
		} catch (error) {
			entry.errorCount += 1
			if (entry.errorCount <= 3) {
				sbQa.error("sbFrameStages", stageName + "/" + entry.id + " falhou: " + (error?.message ?? error))
			}
		}
	}
	return frameContext
}
