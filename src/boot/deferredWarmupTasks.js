import { yieldToBrowserPaint } from "./bootStageRunner.js"
import { warmUpRenderEngineOnce } from "./renderEngineReadiness.js"

export const DEFERRED_WARMUP_TASK_IDS = Object.freeze({
	STUDIO_PANELS: "studio-panels",
	RENDER_ENGINE: "render-engine",
	SCRIPT_RUNTIME: "script-runtime",
})


const LUAU_VM_BASE_URL = ""


const studioPanelInitializers = Object.freeze([
	async () => (await import("../ui/toolbox.js")).initToolbox(),
	async () => (await import("../ui/assetManager.js")).initAssetManager(),
	async () => (await import("../ui/materialManager.js")).initMaterialManager(),
	async () => (await import("../plugins/pluginHost.js")).initPluginSystem(),
	async () =>
		(await import("../ui/localizationEditor.js")).initLocalizationEditor(),
])

async function initializeStudioPanelsOneByOne({ signal, reportProgress = () => {} } = {}) {
	let completedPanels = 0
	for (const initializeStudioPanel of studioPanelInitializers) {
		await yieldToBrowserPaint({ signal })
		signal?.throwIfAborted()
		await initializeStudioPanel()
		completedPanels += 1
		reportProgress(completedPanels / studioPanelInitializers.length)
	}
}

async function preloadScriptRuntime() {
	const { preloadLuauVM } = await import("../runtime/lua/runtimeSelector.js")
	return preloadLuauVM(LUAU_VM_BASE_URL)
}


export function createDeferredWarmupTasks() {
	return Object.freeze([
		Object.freeze({
			id: DEFERRED_WARMUP_TASK_IDS.STUDIO_PANELS,
			label: "Studio panels",
			run: initializeStudioPanelsOneByOne,
		}),
		Object.freeze({
			id: DEFERRED_WARMUP_TASK_IDS.RENDER_ENGINE,
			label: "3D engine",
			run: warmUpRenderEngineOnce,
		}),
		Object.freeze({
			id: DEFERRED_WARMUP_TASK_IDS.SCRIPT_RUNTIME,
			label: "Script runtime",
			run: preloadScriptRuntime,
		}),
	])
}
