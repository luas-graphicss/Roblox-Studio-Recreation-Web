import { yieldToBrowserPaint } from "./bootStageRunner.js"


const IDLE_SLOT_TIMEOUT_MS = 500

const registeredTasks = new Map()
const startedTasks = new Map()
let drainPromise = null

function waitForIdleSlot() {
	const requestIdle = globalThis.requestIdleCallback
	if (typeof requestIdle !== "function") return yieldToBrowserPaint()
	return new Promise((resolve) => {
		requestIdle(() => resolve(), { timeout: IDLE_SLOT_TIMEOUT_MS })
	})
}


function notifyWithoutBreakingWarmup(listener, payload) {
	if (typeof listener !== "function") return
	try {
		listener(payload)
	} catch {

	}
}

export function registerWarmupTask({ id, label, run } = {}) {
	if (typeof id !== "string" || id.trim() === "") {
		throw new Error("A warm-up task needs a non-empty string id.")
	}
	if (typeof run !== "function") {
		throw new Error(`Warm-up task "${id}" needs a run function.`)
	}
	registeredTasks.set(
		id,
		Object.freeze({ id, label: typeof label === "string" && label ? label : id, run }),
	)
	return id
}

export function registerWarmupTasks(tasks = []) {
	if (!Array.isArray(tasks)) throw new Error("Warm-up tasks must be an array.")
	return tasks.map(registerWarmupTask)
}


function startTaskOnce(task, onWarmupError, context = {}) {
	const alreadyStarted = startedTasks.get(task.id)
	if (alreadyStarted) return alreadyStarted


	const started = Promise.resolve()
		.then(() => task.run(context))
		.then(() => true)
		.catch((error) => {
			notifyWithoutBreakingWarmup(onWarmupError, {
				taskId: task.id,
				label: task.label,
				error,
			})
			return false
		})
	startedTasks.set(task.id, started)
	return started
}


export function flushWarmupTask(id, { onWarmupError, ...context } = {}) {
	const task = registeredTasks.get(id)
	if (!task) return Promise.resolve(false)
	return startTaskOnce(task, onWarmupError, context)
}

export function flushAllWarmupTasks({ onWarmupError } = {}) {
	const pending = [...registeredTasks.keys()].map((id) =>
		flushWarmupTask(id, { onWarmupError }),
	)
	return Promise.all(pending)
}


export function drainWarmupQueueWhenIdle({ onWarmupError } = {}) {
	if (drainPromise) return drainPromise
	drainPromise = (async () => {


		for (const task of registeredTasks.values()) {
			await waitForIdleSlot()
			await startTaskOnce(task, onWarmupError)
		}
	})()
	return drainPromise
}

export function describeWarmupQueue() {
	return Object.freeze({
		taskIds: [...registeredTasks.keys()],
		startedTaskIds: [...startedTasks.keys()],
		isDraining: drainPromise !== null,
	})
}

export function resetWarmupQueueForTests() {
	registeredTasks.clear()
	startedTasks.clear()
	drainPromise = null
}
