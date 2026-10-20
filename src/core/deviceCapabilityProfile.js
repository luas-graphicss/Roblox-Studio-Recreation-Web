const LOW_MEMORY_GIGABYTES = 8


const LOW_LOGICAL_CORE_COUNT = 4

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)"

function readPositiveNumber(value) {
	return Number.isFinite(value) && value > 0 ? value : null
}

function prefersReducedMotion(windowLike) {
	if (typeof windowLike?.matchMedia !== "function") return false
	try {
		return windowLike.matchMedia(REDUCED_MOTION_QUERY).matches === true
	} catch {

		return false
	}
}

export function describeDeviceCapabilityProfile({
	navigatorLike = globalThis.navigator,
	windowLike = globalThis,
} = {}) {
	const memoryGigabytes = readPositiveNumber(navigatorLike?.deviceMemory)
	const logicalCoreCount = readPositiveNumber(
		navigatorLike?.hardwareConcurrency,
	)
	const hasLowMemory =
		memoryGigabytes !== null && memoryGigabytes <= LOW_MEMORY_GIGABYTES
	const hasFewLogicalCores =
		logicalCoreCount !== null && logicalCoreCount <= LOW_LOGICAL_CORE_COUNT
	const wantsLessMotion = prefersReducedMotion(windowLike)

	return Object.freeze({
		memoryGigabytes,
		logicalCoreCount,
		hasLowMemory,
		hasFewLogicalCores,
		wantsLessMotion,
		isLowEnd: hasLowMemory || hasFewLogicalCores || wantsLessMotion,
	})
}

export function isLowEndDevice(options) {
	return describeDeviceCapabilityProfile(options).isLowEnd
}
