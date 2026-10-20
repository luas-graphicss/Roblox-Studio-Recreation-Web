import { SB_TIER_NAMES } from "../../../sbMaterialContract.js"
import { sbQa } from "./labTelemetry.js"

const registeredFlags = new Map()
const flagOverrides = new Map()


export function resolveIgnitionFlag(rawOverride, tierDefault) {
	if (rawOverride === true) return { on: true, mode: "forced" }
	if (rawOverride === false) return { on: false, mode: "vetoed" }
	return tierDefault
		? { on: true, mode: "auto-on" }
		: { on: false, mode: "auto-off" }
}

export function registerFlag(definition) {
	const { id, owner, description, defaultsByTier } = definition
	if (!id) throw new Error("registerFlag: flag sem id")
	if (registeredFlags.has(id)) {
		sbQa.error("labFlags", "flag registrada duas vezes: " + id)
		return registeredFlags.get(id)
	}
	const normalizedDefaults = {}
	for (const tierName of SB_TIER_NAMES) {
		normalizedDefaults[tierName] = Boolean(defaultsByTier?.[tierName])
	}
	const flag = { id, owner: owner ?? "base", description: description ?? "", defaultsByTier: normalizedDefaults }
	registeredFlags.set(id, flag)
	return flag
}

export function flagState(flagId, tierName) {
	const flag = registeredFlags.get(flagId)
	if (!flag) return { id: flagId, known: false, on: false, mode: "unknown" }
	const resolved = resolveIgnitionFlag(flagOverrides.get(flagId), flag.defaultsByTier[tierName])
	return {
		id: flagId,
		known: true,
		owner: flag.owner,
		description: flag.description,
		tierDefault: flag.defaultsByTier[tierName],
		override: flagOverrides.has(flagId) ? flagOverrides.get(flagId) : null,
		on: resolved.on,
		mode: resolved.mode,
	}
}

export function isFlagActive(flagId, tierName) {
	return flagState(flagId, tierName).on
}


export function setFlag(flagId, value) {
	if (!registeredFlags.has(flagId)) {
		sbQa.error("labFlags", "flag desconhecida: " + flagId)
		return null
	}
	if (value === null || value === undefined) flagOverrides.delete(flagId)
	else flagOverrides.set(flagId, Boolean(value))
	return flagId
}

export function clearFlagOverrides() {
	flagOverrides.clear()
}

export function listFlags(tierName) {
	return Array.from(registeredFlags.keys())
		.sort()
		.map((flagId) => flagState(flagId, tierName))
}

export function definedFlagIds() {
	return Array.from(registeredFlags.keys()).sort()
}


registerFlag({
	id: "SubstrateEnabled",
	owner: "base",
	description: "Liga o caminho Substrate. Desligada, a bancada renderiza o material legado.",
	defaultsByTier: { fraco: false, medio: true, forte: true },
})
