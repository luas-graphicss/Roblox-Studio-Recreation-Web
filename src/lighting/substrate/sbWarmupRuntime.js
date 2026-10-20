import { SB_WARMUP_SPIKE_CEILING_MILLISECONDS, WARMUP_PHASE_ID, evaluateWarmupGate } from "./sbWarmupPlanCore.js"

export const SB_WARMUP_FRAME_STAGE = "beforeRender"
export const SB_WARMUP_FRAME_STAGE_ID = "sbF34WarmupSlices"
export const SB_WARMUP_EVIDENCE_ID = "warmup"
export const SB_WARMUP_STATES = Object.freeze({ idle: "idle", warming: "warming", drained: "drained" })
export const SB_WARMUP_UNMEASURED_SLICE_SHARE = 0.5

export const SB_WARMUP_RUNTIME_REFUSALS = Object.freeze({
	noRenderer: "noRenderer",
	noCompile: "noCompile",
	noCamera: "noCamera",
	noProbe: "noProbe",
})

function defaultNow() {
	return "undefined" !== typeof performance && "function" === typeof performance.now ? performance.now() : Date.now()
}

export function warmupProgramKey(material, tierName) {
	const family = material?.userData?.sbMaterialPath ?? material?.type ?? "material"
	const custom = "function" === typeof material?.customProgramCacheKey ? material.customProgramCacheKey() : ""
	return family + ":" + tierName + ":" + (custom || material?.uuid || "anon")
}

export function warmupMaterialFamily(material) {
	return material?.userData?.sbMaterialPath ?? material?.type ?? "material"
}

export function describeWarmupHost(bench) {
	const renderer = bench?.renderer ?? null
	if (!renderer) return { ok: false, code: SB_WARMUP_RUNTIME_REFUSALS.noRenderer, reason: "bancada sem renderer: o warmup nao tem onde compilar" }
	if ("function" !== typeof renderer.compile) return { ok: false, code: SB_WARMUP_RUNTIME_REFUSALS.noCompile, reason: "renderer sem compile(): o warmup nao compila programa isolado" }
	return { ok: true, code: null, reason: null }
}

function createProbe(THREE) {
	if (!THREE?.Scene || !THREE?.Mesh || !THREE?.BufferGeometry || !THREE?.BufferAttribute) return null
	const geometry = new THREE.BufferGeometry()
	geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3))
	geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3))
	geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1]), 2))
	const mesh = new THREE.Mesh(geometry)
	mesh.frustumCulled = false
	const scene = new THREE.Scene()
	scene.add(mesh)
	return { scene, mesh, geometry }
}

export function createWarmupRuntime({ THREE, renderer, scene, now = defaultNow, spikeCeilingMilliseconds = SB_WARMUP_SPIKE_CEILING_MILLISECONDS, compile = null, programCount = null } = {}) {
	const host = describeWarmupHost({ renderer })
	const probe = compile ? null : createProbe(THREE)
	const ceiling = Number.isFinite(spikeCeilingMilliseconds) && 0 < spikeCeilingMilliseconds ? spikeCeilingMilliseconds : SB_WARMUP_SPIKE_CEILING_MILLISECONDS
	const seen = new Set()
	const pending = []
	const permutations = []
	const slices = []
	const refusals = []
	let worstMeasured = 0
	let sliceCount = 0

	if (!compile && !host.ok) refusals.push(host)
	if (!compile && host.ok && !probe) refusals.push({ ok: false, code: SB_WARMUP_RUNTIME_REFUSALS.noProbe, reason: "THREE sem Scene/Mesh/BufferGeometry: o warmup nao monta a sonda" })

	const readProgramCount = programCount ?? (() => (Array.isArray(renderer?.info?.programs) ? renderer.info.programs.length : null))

	const compileOne = compile ?? ((material, camera) => {
		probe.mesh.material = material
		renderer.compile(probe.scene, camera, scene ?? null)
	})

	function ready() {
		return 0 === refusals.length
	}

	function enqueue(materials, tierName) {
		if (!ready()) return 0
		let added = 0
		for (const material of materials ?? []) {
			if (!material || "object" !== typeof material) continue
			const programKey = warmupProgramKey(material, tierName)
			if (seen.has(programKey)) continue
			seen.add(programKey)
			pending.push({ programKey, material, materialFamily: warmupMaterialFamily(material), tier: tierName })
			added += 1
		}
		return added
	}

	function predictedNextCost() {
		return 0 < worstMeasured ? worstMeasured : ceiling * SB_WARMUP_UNMEASURED_SLICE_SHARE
	}

	function runSlice(camera) {
		if (!ready()) return null
		if (0 === pending.length) return null
		if (!camera) {
			return { index: sliceCount, programKeys: [], milliseconds: 0, skipped: SB_WARMUP_RUNTIME_REFUSALS.noCamera }
		}
		const slice = { index: sliceCount, programKeys: [], milliseconds: 0, programsCreated: 0, skipped: null }
		while (0 < pending.length) {
			if (0 < slice.programKeys.length && slice.milliseconds + predictedNextCost() > ceiling) break
			const next = pending.shift()
			const before = readProgramCount()
			const started = now()
			let failure = null
			try {
				compileOne(next.material, camera)
			} catch (error) {
				failure = error?.message ?? String(error)
			}
			const milliseconds = Math.max(0, now() - started)
			const after = readProgramCount()
			const programsCreated = Number.isFinite(before) && Number.isFinite(after) ? Math.max(0, after - before) : null
			const record = { programKey: next.programKey, materialFamily: next.materialFamily, tier: next.tier, milliseconds, programsCreated, sliceIndex: sliceCount, failure }
			permutations.push(record)
			if (null === failure && 0 !== programsCreated) worstMeasured = Math.max(worstMeasured, milliseconds)
			slice.programKeys.push(next.programKey)
			slice.milliseconds += milliseconds
			slice.programsCreated += programsCreated ?? 0
		}
		slices.push(slice)
		sliceCount += 1
		return slice
	}

	function state() {
		if (0 < pending.length) return SB_WARMUP_STATES.warming
		return 0 < permutations.length ? SB_WARMUP_STATES.drained : SB_WARMUP_STATES.idle
	}

	function compiledPermutations() {
		return permutations.filter((record) => null === record.failure && (null === record.programsCreated || 0 < record.programsCreated))
	}

	function gate() {
		if (SB_WARMUP_STATES.drained !== state()) return null
		const measured = compiledPermutations()
		if (0 === measured.length) return null
		const keys = new Set(measured.map((record) => record.programKey))
		const observedSlices = slices
			.map((slice) => ({ programKeys: slice.programKeys.filter((programKey) => keys.has(programKey)), milliseconds: slice.milliseconds }))
			.filter((slice) => 0 < slice.programKeys.length)
		return evaluateWarmupGate({
			permutations: measured.map((record) => ({ programKey: record.programKey, materialFamily: record.materialFamily, milliseconds: record.milliseconds })),
			observedSlices,
			spikeCeilingMilliseconds: ceiling,
		})
	}

	function evidence() {
		const created = permutations.reduce((total, record) => total + (record.programsCreated ?? 0), 0)
		return {
			phaseId: WARMUP_PHASE_ID,
			state: state(),
			ready: ready(),
			refusals: refusals.map((refusal) => ({ code: refusal.code, reason: refusal.reason })),
			ceilingMilliseconds: ceiling,
			pendingCount: pending.length,
			compiledCount: permutations.length,
			cachedCount: permutations.filter((record) => 0 === record.programsCreated).length,
			failedCount: permutations.filter((record) => null !== record.failure).length,
			programsCreated: created,
			worstSliceMilliseconds: slices.reduce((worst, slice) => Math.max(worst, slice.milliseconds), 0),
			sliceCount: slices.length,
			slices: slices.map((slice) => ({ ...slice, programKeys: [...slice.programKeys] })),
			permutations: permutations.map((record) => ({ ...record })),
			gate: gate(),
		}
	}

	function reset() {
		seen.clear()
		pending.length = 0
		permutations.length = 0
		slices.length = 0
		worstMeasured = 0
		sliceCount = 0
	}

	function dispose() {
		reset()
		probe?.geometry?.dispose?.()
	}

	return { enqueue, runSlice, evidence, state, gate, reset, dispose, ready, ceilingMilliseconds: ceiling, pendingCount: () => pending.length }
}
