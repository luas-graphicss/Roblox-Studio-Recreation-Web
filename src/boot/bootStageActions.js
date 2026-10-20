import { BOOT_STAGE_IDS } from "./bootStageModel.js"

import { logger } from "../core/logger.js"
import { settings } from "../config/settings.js"
import { theme } from "../theme/theme.js"
import { store } from "../core/state.js"
import { bus } from "../core/eventBus.js"
import { registerGlobalErrorHandlers } from "../core/errors.js"
import { activateDeferredStylesCooperatively } from "../core/deferredStyles.js"            
import { buildDataModel } from "../datamodel/index.js"
import { mountShell } from "../ui/shell.js"
import { initStartPage } from "../ui/startPage.js"            
import { startSharedWindowStack } from "../plugins/zorder.js"           
import { initViewportGate } from "../ui/viewportGate.js"                     

const SHELL_HOST_ELEMENT_ID = "app"

export function createBootStageActions(targetDocument = globalThis.document) {


	const bootContext = { activeTheme: "dark", loadedSettings: null }

	const actions = {
		[BOOT_STAGE_IDS.CORE_SERVICES]() {


			registerGlobalErrorHandlers()

			const loadedSettings = settings.load()

			const activeTheme = theme.init()
			bootContext.loadedSettings = loadedSettings
			bootContext.activeTheme = activeTheme

			store.init({ theme: activeTheme, layout: loadedSettings.layout })
			bus.emit("app:bootstrapping", { theme: activeTheme })


			bus.on("theme:changed", (changedTheme) => store.set("theme", changedTheme))


			store.subscribe((state, change) => {
				if (change && change.key === "layout") {
					settings.set("layout", state.layout)
				}
			})
		},

		[BOOT_STAGE_IDS.DATA_MODEL]() {

			const dataModel = buildDataModel()
			store.setDataModel(dataModel)
			bus.emit("datamodel:ready", { dataModel })
			logger.info("Data model ready.")
		},

		[BOOT_STAGE_IDS.INTERFACE_SHELL](context) {

			return mountShell(targetDocument.getElementById(SHELL_HOST_ELEMENT_ID), context)
		},

		[BOOT_STAGE_IDS.START_PAGE]() {


			initStartPage()

			startSharedWindowStack()

			initViewportGate()
		},

		[BOOT_STAGE_IDS.VISUAL_STYLES](context) {


			return activateDeferredStylesCooperatively(targetDocument, context)
		},
	}

	return Object.freeze({
		actions,
		getBootContext: () => Object.freeze({ ...bootContext }),
	})
}
