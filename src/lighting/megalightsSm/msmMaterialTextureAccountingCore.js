import { localShadowCap } from "../shadowBudget.js";
import { MSM_COMPOSITE_MODE_INJECTION } from "./msmPipelineContract.js";
import { MSM_MATERIAL_TEXTURE_CHARGE_BY_MODE } from "./msmResidentCapacityCore.js";

export const MSM_MATERIAL_TEXTURE_ACCOUNTING_OWNER_PHASE = "MSM-F24";


export const MSM_FORWARD_INJECTION_CONSUMER_READY = true;
let forwardInjectionReserved = false;
const reservationOwners = new Set();
const defaultOwner = Symbol('MSM default reservation');
export function isMsmForwardInjectionReserved() { return forwardInjectionReserved; }

export function setMsmForwardInjectionReservation(reserved, owner = defaultOwner) {
	if (reserved === true) reservationOwners.add(owner);
	else reservationOwners.delete(owner);
	forwardInjectionReserved = reservationOwners.size > 0;
}

export const MSM_TEXTURE_CHARGE_REASONS = Object.freeze({
	injectionLive: "injection-live",
	injectionNotLive: "injection-not-live",
	screenModeIsFree: "screen-mode-costs-no-material-unit",
	unknownCompositeMode: "unknown-composite-mode",
});

function resolveCompositeMode(compositeMode) {
	return typeof compositeMode === "string" && compositeMode.length > 0
		? compositeMode
		: MSM_COMPOSITE_MODE_INJECTION;
}


function tabledChargeOf(compositeMode) {
	const tabledCharge = MSM_MATERIAL_TEXTURE_CHARGE_BY_MODE[compositeMode];
	return Number.isFinite(tabledCharge) ? tabledCharge : null;
}


export function msmExtraGlobalTextureCharge(args = {}) {
	const tabledCharge = tabledChargeOf(resolveCompositeMode(args.compositeMode));
	if (tabledCharge === null || args.injectionActive !== true) return 0;
	return tabledCharge;
}

export function describeMaterialTextureAccounting(args = {}) {
	const compositeMode = resolveCompositeMode(args.compositeMode);
	const tabledCharge = tabledChargeOf(compositeMode);
	if (tabledCharge === null) {
		return Object.freeze({
			charge: 0,
			compositeMode,
			reason: MSM_TEXTURE_CHARGE_REASONS.unknownCompositeMode,
		});
	}
	if (args.injectionActive !== true) {
		return Object.freeze({
			charge: 0,
			compositeMode,
			reason: MSM_TEXTURE_CHARGE_REASONS.injectionNotLive,
		});
	}
	return Object.freeze({
		charge: tabledCharge,
		compositeMode,
		reason: tabledCharge > 0
			? MSM_TEXTURE_CHARGE_REASONS.injectionLive
			: MSM_TEXTURE_CHARGE_REASONS.screenModeIsFree,
	});
}


export function msmForwardInjectionTextureCharge(injectionLive = forwardInjectionReserved) {
	if (injectionLive !== true) return 0;
	return msmExtraGlobalTextureCharge({
		injectionActive: true,
		compositeMode: MSM_COMPOSITE_MODE_INJECTION,
	});
}


export function msmLocalShadowCapWithInjection(args = {}) {
	const extraGlobalTextures = Number.isFinite(args.extraGlobalTextures) ? args.extraGlobalTextures : 0;
	const charge = msmExtraGlobalTextureCharge(args);
	const capWithoutInjection = localShadowCap(args.hardCap, extraGlobalTextures);
	const capWithInjection = localShadowCap(args.hardCap, extraGlobalTextures + charge);
	return Object.freeze({
		charge,
		extraGlobalTextures,
		extraGlobalTexturesWithInjection: extraGlobalTextures + charge,
		capWithoutInjection,
		capWithInjection,
		shadowSlotsGivenUp: Math.max(0, capWithoutInjection - capWithInjection),
	});
}
