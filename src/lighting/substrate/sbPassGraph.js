import { SB_PASS_OWNERS } from "./sbMaterialContract.js"
import { sbQa } from "./support/src/lab/labTelemetry.js"


export const SB_PASS_NAMES = [
	"materialTopologyResolve",
	"materialBufferUpload",
	"closureDispatchPrepare",
	"glintNoisePrepare",
	"specularProfileAtlas",
	"opaqueRoughRefraction",
	"subsurfaceScattering",
	"translucencyResolve",
	"lightingBridge",
	"debugVisualization",
]

function createStubPass(passName) {
	return {
		name: passName,
		owner: SB_PASS_OWNERS[passName] ?? "sem dono",
		stub: true,
		execute(passContext) {
			return passContext
		},
	}
}

const passesByName = new Map(SB_PASS_NAMES.map((passName) => [passName, createStubPass(passName)]))
const lastExecutionByName = new Map()









export function registerPass(passName, definition) {
	if (!passesByName.has(passName)) {
		sbQa.error("sbPassGraph", "passe desconhecido: " + passName)
		return { accepted: false, reason: "passe desconhecido" }
	}
	const expectedOwner = SB_PASS_OWNERS[passName]
	if (definition.owner !== expectedOwner) {
		sbQa.error(
			"sbPassGraph",
			"passe " + passName + " pertence a " + expectedOwner + ", nao a " + definition.owner,
		)
		return { accepted: false, reason: "dono divergente do contrato" }
	}
	if (typeof definition.execute !== "function") {
		return { accepted: false, reason: "execute e obrigatorio" }
	}
	passesByName.set(passName, { name: passName, owner: definition.owner, stub: false, execute: definition.execute })
	sbQa.pass(passName, { owner: definition.owner, stub: false })
	return { accepted: true, passName }
}


export function restoreStubPass(passName) {
	if (!passesByName.has(passName)) return false
	passesByName.set(passName, createStubPass(passName))
	sbQa.pass(passName, { owner: SB_PASS_OWNERS[passName], stub: true })
	return true
}

export function listPasses() {
	return SB_PASS_NAMES.map((passName) => {
		const pass = passesByName.get(passName)
		const lastExecution = lastExecutionByName.get(passName) ?? null
		return {
			name: passName,
			owner: pass.owner,
			stub: pass.stub,
			lastMilliseconds: lastExecution?.milliseconds ?? null,
			lastError: lastExecution?.error ?? null,
		}
	})
}

export function implementedPassCount() {
	return SB_PASS_NAMES.filter((passName) => !passesByName.get(passName).stub).length
}

export function passSummary() {
	return {
		total: SB_PASS_NAMES.length,
		implemented: implementedPassCount(),
		stubs: SB_PASS_NAMES.length - implementedPassCount(),
		passes: listPasses(),
	}
}


export function executePassGraph(passContext) {
	let currentContext = passContext
	for (const passName of SB_PASS_NAMES) {
		const pass = passesByName.get(passName)
		const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now()
		try {
			const result = pass.execute(currentContext)

			if (result && result !== currentContext) {
				currentContext.passResults ??= {}
				currentContext.passResults[passName] = result
				if (typeof result === "object" && !ArrayBuffer.isView(result)) Object.assign(currentContext, result)
			}
			lastExecutionByName.set(passName, {
				milliseconds: (typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt,
				error: null,
			})
		} catch (error) {
			const message = error?.message ?? String(error)
			lastExecutionByName.set(passName, { milliseconds: null, error: message })
			sbQa.error("sbPassGraph", "passe " + passName + " falhou: " + message)
		}
	}
	return currentContext
}
