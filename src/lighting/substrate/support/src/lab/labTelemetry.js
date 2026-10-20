const PUBLIC_GLOBAL_NAMES = []                                                                       
const MAX_STORED_ERRORS = 40

function createEmptyState() {
	return {
		benchName: "substrate",
		contractVersion: null,
		renderer: null,
		scene: null,
		tier: null,
		materialPath: null,
		threeRevision: null,
		phases: {},
		passes: {},
		frameStages: {},
		appliedPatches: [],
		refusedPatches: [],
		anchors: {},
		uniforms: {},
		textureUnits: {},
		closureBytes: {},
		topology: null,
		closures: null,
		measurement: null,
		errors: [],
	}
}

let state = createEmptyState()

function publish() {
	if (typeof window === "undefined") return
	for (const globalName of PUBLIC_GLOBAL_NAMES) {
		window[globalName] = state
	}
}

function sumValues(record) {
	return Object.values(record).reduce((total, value) => total + value, 0)
}

export const sbQa = {
	reset() {
		state = createEmptyState()
		publish()
		return state
	},

	get() {
		return state
	},

	contractVersion(version) {
		state.contractVersion = version
		publish()
	},

	renderer(info) {
		state.renderer = info
		publish()
	},

	threeRevision(revision) {
		state.threeRevision = revision
		publish()
	},

	scene(info) {
		state.scene = info
		publish()
	},

	tier(tierName) {
		state.tier = tierName
		publish()
	},

	materialPath(pathId) {
		state.materialPath = pathId
		publish()
	},

	phase(phaseId, phaseState, detail) {
		state.phases[phaseId] = { state: phaseState, detail: detail ?? null }
		publish()
	},

	pass(passName, info) {
		state.passes[passName] = info
		publish()
	},

	frameStage(stageName, info) {
		state.frameStages[stageName] = info
		publish()
	},

	appliedPatches(patchList) {
		state.appliedPatches = patchList
		publish()
	},

	refusedPatch(refusal) {
		state.refusedPatches.push(refusal)
		publish()
	},

	anchor(anchorId, info) {
		state.anchors[anchorId] = info
		publish()
	},

	uniform(uniformName, owner) {
		state.uniforms[uniformName] = owner
		publish()
	},


	textureUnit(consumerId, unitCount) {
		state.textureUnits[consumerId] = unitCount
		publish()
	},

	totalTextureUnits() {
		return sumValues(state.textureUnits)
	},


	closureBytes(consumerId, byteCount) {
		state.closureBytes[consumerId] = byteCount
		publish()
	},

	totalClosureBytes() {
		return sumValues(state.closureBytes)
	},


	topology(topology) {
		state.topology = topology
		publish()
	},


	closures(closures) {
		state.closures = closures
		publish()
	},

	measurement(info) {
		state.measurement = info
		publish()
	},

	error(source, message) {
		state.errors.push({ source, message, at: Date.now() })
		if (state.errors.length > MAX_STORED_ERRORS) {
			state.errors.splice(0, state.errors.length - MAX_STORED_ERRORS)
		}
		publish()
	},

	errors() {
		return state.errors
	},

	clearErrors() {
		state.errors = []
		publish()
	},
}

publish()
