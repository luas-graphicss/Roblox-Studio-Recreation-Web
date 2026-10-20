export const TEMPLATE_OPEN_STAGE_IDS = Object.freeze({
	PREPARE_ENGINE: "template-prepare-engine",
	CLEAR_PLACE: "template-clear-place",
	BUILD_TEMPLATE: "template-build",
	ENTER_EDITOR: "template-enter-editor",
	SETTLE_FIRST_FRAME: "template-settle-first-frame",
})

export const TEMPLATE_OPEN_STAGES = Object.freeze([
	Object.freeze({
		id: TEMPLATE_OPEN_STAGE_IDS.PREPARE_ENGINE,
		label: "Preparing template resources",
		weight: 3,
		deadlineMs: 30000,
	}),
	Object.freeze({
		id: TEMPLATE_OPEN_STAGE_IDS.CLEAR_PLACE,
		label: "Preparing the template scene",
		weight: 1,
		deadlineMs: 10000,
	}),
	Object.freeze({
		id: TEMPLATE_OPEN_STAGE_IDS.BUILD_TEMPLATE,
		label: "Building template objects",
		weight: 4,
		deadlineMs: 25000,
	}),
	Object.freeze({
		id: TEMPLATE_OPEN_STAGE_IDS.ENTER_EDITOR,
		label: "Opening the template",
		weight: 2,
		deadlineMs: 20000,
	}),
	Object.freeze({
		id: TEMPLATE_OPEN_STAGE_IDS.SETTLE_FIRST_FRAME,
		label: "Rendering the template",
		weight: 4,
		deadlineMs: 120000,
	}),
])
