export const MSM_PERF_PHASE_ID = "MSM-PERF"


export const MSM_PERF_DIRTY_CELL_GRID_PUBLISH = "dirtyCellGridPublish"


export const MSM_PERF_GRID_UPLOAD_GATE = "gridUploadGate"


export const MSM_PERF_OPTION_NAMES = Object.freeze([
	MSM_PERF_DIRTY_CELL_GRID_PUBLISH,
	MSM_PERF_GRID_UPLOAD_GATE,
])

function buildFrozenOptionRecord(isEveryOptionEnabled) {
	const options = {}
	for (const optionName of MSM_PERF_OPTION_NAMES) options[optionName] = isEveryOptionEnabled
	return Object.freeze(options)
}


export const MSM_PERF_ALL_DISABLED = buildFrozenOptionRecord(false)


export const MSM_PERF_DEFAULTS = buildFrozenOptionRecord(true)

function isKnownOptionName(candidateName) {
	return MSM_PERF_OPTION_NAMES.indexOf(candidateName) !== -1
}

function buildReason(isLegacy, activeOptionNames, unknownOptionNames, hasRequest) {
	const unknownNote = unknownOptionNames.length === 0
		? ""
		: " - names refused because they are not part of the pack: " + unknownOptionNames.join(", ")
	if (!hasRequest) {
		return "no options informed - legacy MSM path, the image of today byte for byte" + unknownNote
	}
	if (isLegacy) {
		return "every option absent or refused - legacy MSM path, the image of today byte for byte" + unknownNote
	}
	return "live optimizations: " + activeOptionNames.join(", ") + unknownNote
}


export function resolveMsmPerfOptions(requestedOptions) {
	const request = requestedOptions && typeof requestedOptions === "object" ? requestedOptions : null
	const options = {}
	const activeOptionNames = []

	for (const optionName of MSM_PERF_OPTION_NAMES) {
		const isOptionActive = request ? request[optionName] === true : false
		options[optionName] = isOptionActive
		if (isOptionActive) activeOptionNames.push(optionName)
	}

	const unknownOptionNames = request
		? Object.keys(request).filter((requestedName) => !isKnownOptionName(requestedName))
		: []
	const isLegacy = activeOptionNames.length === 0

	return Object.freeze({
		phase: MSM_PERF_PHASE_ID,
		options: Object.freeze(options),
		activeOptionNames: Object.freeze(activeOptionNames.slice()),
		unknownOptionNames: Object.freeze(unknownOptionNames.slice()),
		legacy: isLegacy,
		reason: buildReason(isLegacy, activeOptionNames, unknownOptionNames, Boolean(request)),
	})
}


export function isMsmPerfOptionActive(requestedOptions, optionName) {
	if (!isKnownOptionName(optionName)) return false
	return resolveMsmPerfOptions(requestedOptions).options[optionName] === true
}
