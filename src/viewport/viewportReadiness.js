const STAGE_STATE = Object.freeze({
	PENDING: "pending",
	LIVE: "live",
	UNAVAILABLE: "unavailable",
})

let stageState = STAGE_STATE.PENDING
let unavailableReason = ""
let settleStageSettled = null
let stageSettled = new Promise((resolve) => {
	settleStageSettled = resolve
})

function settleStage(nextState, reason) {


	if (stageState !== STAGE_STATE.PENDING) return
	stageState = nextState
	unavailableReason = reason || ""
	settleStageSettled(stageState === STAGE_STATE.LIVE)
}

export function markViewportStageLive() {
	settleStage(STAGE_STATE.LIVE, "")
}

export function markViewportStageUnavailable(reason) {
	settleStage(STAGE_STATE.UNAVAILABLE, reason)
}

export function isViewportStageLive() {
	return stageState === STAGE_STATE.LIVE
}

export function describeViewportStageState() {
	return Object.freeze({ state: stageState, unavailableReason })
}


export function waitForViewportStage({ timeoutMs = 0 } = {}) {
	if (stageState !== STAGE_STATE.PENDING) {
		return Promise.resolve(isViewportStageLive())
	}
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return stageSettled
	let timeoutTimer = null
	const timedOut = new Promise((resolve) => {
		timeoutTimer = setTimeout(() => resolve(false), timeoutMs)
	})
	return Promise.race([stageSettled, timedOut]).finally(() => {
		clearTimeout(timeoutTimer)
	})
}

export function resetViewportReadinessForTests() {
	stageState = STAGE_STATE.PENDING
	unavailableReason = ""
	stageSettled = new Promise((resolve) => {
		settleStageSettled = resolve
	})
}
