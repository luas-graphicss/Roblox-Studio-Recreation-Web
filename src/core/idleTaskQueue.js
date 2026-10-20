const IDLE_SLOT_TIMEOUT_MS = 200


function scheduleIdleSlotInBrowser(runTask) {
	if (typeof globalThis.requestIdleCallback === "function") {
		globalThis.requestIdleCallback(() => runTask(), {
			timeout: IDLE_SLOT_TIMEOUT_MS,
		})
		return
	}
	if (typeof globalThis.requestAnimationFrame === "function") {
		globalThis.requestAnimationFrame(() => {
			globalThis.setTimeout(() => runTask(), 0)
		})
		return
	}
	globalThis.setTimeout(() => runTask(), 0)
}

function assertTaskShape(task) {
	if (!task || typeof task !== "object") {
		throw new Error("An idle task must be an object.")
	}
	if (typeof task.name !== "string" || task.name.trim() === "") {
		throw new Error("An idle task needs a non-empty string name.")
	}
	if (typeof task.run !== "function") {
		throw new Error(`Idle task "${task.name}" needs a run function.`)
	}
}

export function createIdleTaskQueue({
	scheduleIdleSlot = scheduleIdleSlotInBrowser,
	onTaskError = () => {},
} = {}) {
	const waitingTasks = []
	const drainedWaiters = []
	let isDraining = false

	function notifyDrained() {
		while (drainedWaiters.length > 0) {
			const resolveWaiter = drainedWaiters.shift()
			resolveWaiter()
		}
	}


	async function runTaskSafely(task) {
		try {
			await task.run()
		} catch (error) {
			onTaskError(task.name, error)
		}
	}

	function scheduleNextTask() {
		scheduleIdleSlot(async () => {
			const nextTask = waitingTasks.shift()
			if (!nextTask) {
				isDraining = false
				notifyDrained()
				return
			}
			await runTaskSafely(nextTask)


			scheduleNextTask()
		})
	}

	function enqueue(task) {
		assertTaskShape(task)
		waitingTasks.push(Object.freeze({ name: task.name, run: task.run }))
	}

	function enqueueAll(tasks) {
		if (!Array.isArray(tasks)) {
			throw new Error("enqueueAll expects an array of idle tasks.")
		}
		tasks.forEach(enqueue)
	}



	function start() {
		if (isDraining) return
		if (waitingTasks.length === 0) {
			notifyDrained()
			return
		}
		isDraining = true
		scheduleNextTask()
	}

	function whenDrained() {
		if (!isDraining && waitingTasks.length === 0) return Promise.resolve()
		return new Promise((resolve) => drainedWaiters.push(resolve))
	}

	function pendingTaskCount() {
		return waitingTasks.length
	}

	return Object.freeze({
		enqueue,
		enqueueAll,
		start,
		whenDrained,
		pendingTaskCount,
	})
}
