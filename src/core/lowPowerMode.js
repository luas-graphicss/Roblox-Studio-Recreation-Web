const LOW_POWER_DATASET_KEY = "rswPower"
const LOW_POWER_VALUE = "low"

const MAX_LOW_POWER_CORE_COUNT = 4
const MAX_LOW_POWER_MEMORY_GB = 4

function prefersReducedMotion(scope) {
	if (typeof scope.matchMedia !== "function") return false
	try {
		return scope.matchMedia("(prefers-reduced-motion: reduce)").matches
	} catch (error) {
		return false
	}
}

export function isLowPowerDevice(scope = globalThis) {
	const navigatorInfo = scope.navigator || {}
	const coreCount = navigatorInfo.hardwareConcurrency
	const memoryGb = navigatorInfo.deviceMemory
	if (Number.isFinite(coreCount) && coreCount <= MAX_LOW_POWER_CORE_COUNT) {
		return true
	}
	if (Number.isFinite(memoryGb) && memoryGb <= MAX_LOW_POWER_MEMORY_GB) {
		return true
	}

	return prefersReducedMotion(scope)
}

export function applyLowPowerMode(
	targetDocument = globalThis.document,
	scope = globalThis,
) {
	const isLowPower = isLowPowerDevice(scope)
	const rootElement = targetDocument && targetDocument.documentElement
	if (!rootElement) return isLowPower
	if (isLowPower) {
		rootElement.dataset[LOW_POWER_DATASET_KEY] = LOW_POWER_VALUE
	} else {
		delete rootElement.dataset[LOW_POWER_DATASET_KEY]
	}
	return isLowPower
}
