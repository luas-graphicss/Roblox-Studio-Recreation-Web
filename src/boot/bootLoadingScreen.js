import { yieldToBrowserPaint } from "./browserPaint.js"

const BOOT_SCREEN_ELEMENT_ID = "rsw-boot"
const STAGE_LABEL_ELEMENT_ID = "rsw-boot-step"
const TITLE_ELEMENT_ID = "rsw-boot-title"
const PERCENT_ELEMENT_ID = "rsw-boot-percent"
const RETRY_BUTTON_ELEMENT_ID = "rsw-boot-retry"


const PROGRESS_CUSTOM_PROPERTY = "--rsw-boot-progress"
const BOOTING_BODY_CLASS = "rsw-booting"
const DONE_CLASS = "is-done"
const FAILED_CLASS = "is-failed"


const FADE_OUT_DURATION_MS = 460

function createInertBootLoadingScreen() {
	return Object.freeze({
		isPresent: false,
		show() {},
		showStage() {},
		showFailure() {},
		hide() {
			return Promise.resolve()
		},
	})
}

export function createBootLoadingScreenController(
	targetDocument = globalThis.document,
) {
	const rootElement =
		typeof targetDocument?.getElementById === "function"
			? targetDocument.getElementById(BOOT_SCREEN_ELEMENT_ID)
			: null
	if (!rootElement) return createInertBootLoadingScreen()

	const stageLabelElement = targetDocument.getElementById(
		STAGE_LABEL_ELEMENT_ID,
	)
	const titleElement = targetDocument.getElementById(TITLE_ELEMENT_ID)
	const initialTitle = titleElement?.textContent || ""
	const initialAccessibleLabel =
		rootElement.getAttribute("aria-label") || initialTitle
	const percentElement = targetDocument.getElementById(PERCENT_ELEMENT_ID)
	const retryButtonElement = targetDocument.getElementById(
		RETRY_BUTTON_ELEMENT_ID,
	)
	let pendingHide = null
	let presentationVersion = 0


	function showStage({ label, progress, percent } = {}) {


		let reportedPercent = percent
		if (!Number.isFinite(reportedPercent) && Number.isFinite(progress)) {
			reportedPercent = progress * 100
		}
		if (Number.isFinite(reportedPercent)) {
			const displayedPercent = Math.min(100, Math.max(0, Math.round(reportedPercent)))
			rootElement.style.setProperty(
				PROGRESS_CUSTOM_PROPERTY,
				String(displayedPercent / 100),
			)
			if (percentElement) {
				percentElement.textContent = `${displayedPercent}%`
			}
		}
		if (stageLabelElement && typeof label === "string" && label !== "") {
			stageLabelElement.textContent = label
		}
	}


	function show({ label, title } = {}) {
		presentationVersion += 1

		const hasCustomTitle = typeof title === "string" && title.trim() !== ""
		if (titleElement) {
			titleElement.textContent = hasCustomTitle ? title : initialTitle
		}
		rootElement.setAttribute(
			"aria-label",
			hasCustomTitle ? title : initialAccessibleLabel,
		)
		pendingHide = null
		rootElement.classList.remove(DONE_CLASS, FAILED_CLASS)
		if (retryButtonElement) retryButtonElement.hidden = true
		rootElement.hidden = false
		targetDocument.body?.classList.add(BOOTING_BODY_CLASS)
		showStage({ label, progress: 0, percent: 0 })
	}

	function reloadPage() {
		globalThis.location?.reload()
	}

	function showFailure(message) {
		presentationVersion += 1
		pendingHide = null
		rootElement.classList.remove(DONE_CLASS)
		rootElement.classList.add(FAILED_CLASS)
		if (stageLabelElement && typeof message === "string" && message !== "") {
			stageLabelElement.textContent = message
		}
		if (!retryButtonElement) return
		retryButtonElement.hidden = false

		retryButtonElement.addEventListener("click", reloadPage, { once: true })
	}


	function hide() {
		if (pendingHide) return pendingHide
		showStage({ progress: 1, percent: 100 })
		const hidingVersion = presentationVersion
		pendingHide = (async () => {

			await yieldToBrowserPaint()
			if (hidingVersion !== presentationVersion) return
			rootElement.classList.add(DONE_CLASS)
			await new Promise((resolve) => setTimeout(resolve, FADE_OUT_DURATION_MS))

			if (hidingVersion !== presentationVersion) return
			rootElement.hidden = true
			targetDocument.body?.classList.remove(BOOTING_BODY_CLASS)
		})()
		return pendingHide
	}

	return Object.freeze({ isPresent: true, show, showStage, showFailure, hide })
}
