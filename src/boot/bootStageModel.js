export const BOOT_STAGE_IDS = Object.freeze({
	CORE_SERVICES: "core-services",
	DATA_MODEL: "data-model",
	INTERFACE_SHELL: "interface-shell",
	START_PAGE: "start-page",
	VISUAL_STYLES: "visual-styles",
})


export const BOOT_STAGES = Object.freeze([
	Object.freeze({
		id: BOOT_STAGE_IDS.CORE_SERVICES,
		label: "Starting core services",
		weight: 1,
		deadlineMs: 8000,
	}),
	Object.freeze({
		id: BOOT_STAGE_IDS.DATA_MODEL,
		label: "Building the data model",
		weight: 1,
		deadlineMs: 8000,
	}),
	Object.freeze({
		id: BOOT_STAGE_IDS.INTERFACE_SHELL,
		label: "Assembling the interface",
		weight: 4,
		deadlineMs: 20000,
	}),
	Object.freeze({
		id: BOOT_STAGE_IDS.START_PAGE,
		label: "Preparing your projects",
		weight: 2,
		deadlineMs: 10000,
	}),
	Object.freeze({
		id: BOOT_STAGE_IDS.VISUAL_STYLES,
		label: "Applying the theme",
		weight: 1,
		deadlineMs: 8000,
	}),
])

function assertStageShape(stage, index) {
	if (!stage || typeof stage !== "object") {
		throw new Error(`Boot stage #${index} must be an object.`)
	}
	if (typeof stage.id !== "string" || stage.id.trim() === "") {
		throw new Error(`Boot stage #${index} needs a non-empty string id.`)
	}
	if (typeof stage.label !== "string" || stage.label.trim() === "") {
		throw new Error(`Boot stage "${stage.id}" needs a non-empty label.`)
	}
	if (!Number.isFinite(stage.weight) || stage.weight <= 0) {
		throw new Error(`Boot stage "${stage.id}" needs a weight greater than zero.`)
	}
}


export function normalizeBootStages(stages) {
	if (!Array.isArray(stages) || stages.length === 0) {
		throw new Error("Boot stages must be a non-empty array.")
	}
	const alreadySeenIds = new Set()
	return Object.freeze(
		stages.map((stage, index) => {
			assertStageShape(stage, index)
			if (alreadySeenIds.has(stage.id)) {
				throw new Error(`Duplicated boot stage id "${stage.id}".`)
			}
			alreadySeenIds.add(stage.id)
			const hasUsableDeadline =
				Number.isFinite(stage.deadlineMs) && stage.deadlineMs > 0
			return Object.freeze({
				id: stage.id,
				label: stage.label,
				weight: stage.weight,
				deadlineMs: hasUsableDeadline ? stage.deadlineMs : 0,
			})
		}),
	)
}

export function createBootProgressTracker(stages = BOOT_STAGES) {
	const normalizedStages = normalizeBootStages(stages)
	const totalWeight = normalizedStages.reduce(
		(runningTotal, stage) => runningTotal + stage.weight,
		0,
	)
	const completedStageIds = new Set()
	const stageFractions = new Map()
	let completedWeight = 0

	let highestProgress = 0

	function findStage(stageId) {
		const stage = normalizedStages.find((candidate) => candidate.id === stageId)
		if (!stage) throw new Error(`Unknown boot stage id "${stageId}".`)
		return stage
	}

	function currentProgress() {
		let partialWeight = 0
		for (const stage of normalizedStages) {
			if (!completedStageIds.has(stage.id)) {
				partialWeight += stage.weight * (stageFractions.get(stage.id) || 0)
			}
		}
		const rawProgress = (completedWeight + partialWeight) / totalWeight
		const progressCeiling = completedStageIds.size === normalizedStages.length ? 1 : 0.99
		highestProgress = Math.min(progressCeiling, Math.max(highestProgress, rawProgress))
		return highestProgress
	}

	function describeStage(stage, phase) {
		const progress = currentProgress()
		return Object.freeze({
			stageId: stage.id,
			label: stage.label,
			phase,
			progress,
			percent: completedStageIds.size === normalizedStages.length ? 100 : Math.min(99, Math.round(progress * 100)),
		})
	}

	return Object.freeze({
		stages: normalizedStages,
		totalWeight,


		begin(stageId) {
			return describeStage(findStage(stageId), "begin")
		},


		advance(stageId, fraction) {
			const stage = findStage(stageId)
			if (Number.isFinite(fraction) && !completedStageIds.has(stage.id)) {
				const previous = stageFractions.get(stage.id) || 0
				stageFractions.set(stage.id, Math.max(previous, Math.min(0.99, Math.max(0, fraction))))
			}
			return describeStage(stage, "progress")
		},


		complete(stageId) {
			const stage = findStage(stageId)
			if (!completedStageIds.has(stage.id)) {
				completedStageIds.add(stage.id)
				completedWeight += stage.weight
			}
			return describeStage(stage, "complete")
		},

		snapshot() {
			const progress = currentProgress()
			return Object.freeze({
				progress,
				percent: completedStageIds.size === normalizedStages.length ? 100 : Math.min(99, Math.round(progress * 100)),
				completedStageCount: completedStageIds.size,
				stageCount: normalizedStages.length,
				isComplete: completedStageIds.size === normalizedStages.length,
			})
		},
	})
}
