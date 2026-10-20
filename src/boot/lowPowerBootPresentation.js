import { describeDeviceCapabilityProfile } from "../core/deviceCapabilityProfile.js"

export const LOW_POWER_ROOT_CLASS = "rsw-low-power"


export function applyLowPowerBootPresentation({
	targetDocument = globalThis.document,
	profile = describeDeviceCapabilityProfile(),
} = {}) {
	const rootElement = targetDocument?.documentElement
	if (!rootElement?.classList) return false
	if (!profile.isLowEnd) return false
	rootElement.classList.add(LOW_POWER_ROOT_CLASS)
	return true
}
