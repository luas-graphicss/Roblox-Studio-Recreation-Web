import { warmUpRenderEngine } from "./engineWarmup.js"

let sharedWarmUpPromise = null


export function warmUpRenderEngineOnce() {
	if (!sharedWarmUpPromise) {
		sharedWarmUpPromise = warmUpRenderEngine()
	}
	return sharedWarmUpPromise
}
