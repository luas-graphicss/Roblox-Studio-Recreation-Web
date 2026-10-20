import { registerLocalLightFlag, resolveLocalLightFlag } from "../lighting/llFeatureFlags.js";
import { llQa } from "../lighting/llTelemetry.js";
import {
	EDITOR_GIZMOS_FLAG_ID,
	PUBLIC_API_BLOCK_NAME,
	PUBLIC_API_FLAG_ID,
	PUBLIC_API_PHASE_ID,
	PUBLIC_API_QA_ID,
} from "../lighting/llPublicApiContract.js";
import {
	LL_PUBLIC_API,
	LL_PUBLIC_API_VERSION,
	LOCAL_LIGHT_KINDS,
	defaultPublicApiProps,
	propertiesForLightKind,
	publicApiChecksum,
	publicApiDocRows,
	publicApiPropertiesByPhase,
	sanitizePublicApiProps,
} from "../lighting/llPublicApiCore.js";


export const PUBLIC_API_FLAG_DEFAULT = Object.freeze({ fraco: true, medio: true, forte: true });

export const EDITOR_GIZMOS_FLAG_DEFAULT = Object.freeze({ fraco: false, medio: true, forte: true });

export const PUBLIC_API_GLOBAL_NAME = "__llPublicApi";

registerLocalLightFlag({
	id: PUBLIC_API_FLAG_ID,
	phase: PUBLIC_API_PHASE_ID,
	description: "public API of the local lights: the " + PUBLIC_API_BLOCK_NAME + " block is exposed to the editor",
	defaultsByTier: PUBLIC_API_FLAG_DEFAULT,
});

registerLocalLightFlag({
	id: EDITOR_GIZMOS_FLAG_ID,
	phase: PUBLIC_API_PHASE_ID,
	description: "gizmos of the local lights in the editor: cone, range and source shape drawn on selection",
	defaultsByTier: EDITOR_GIZMOS_FLAG_DEFAULT,
});


export function publishLocalLightPublicApi(options) {
	const settings = options && typeof options === "object" ? options : {};
	const readTier = typeof settings.getTier === "function" ? settings.getTier : () => "";
	const scope = settings.globalScope || (typeof window !== "undefined" ? window : null);

	function flagState(flagId) {
		const resolved = resolveLocalLightFlag(flagId, { tier: readTier() });
		return { id: flagId, active: resolved.active === true, token: resolved.token, source: resolved.source };
	}

	function describe() {
		return {
			phaseId: PUBLIC_API_PHASE_ID,
			blockName: PUBLIC_API_BLOCK_NAME,
			version: LL_PUBLIC_API_VERSION,
			checksum: publicApiChecksum(),
			propertyCount: LL_PUBLIC_API.length,
			properties: publicApiDocRows(),
			propertiesByPhase: publicApiPropertiesByPhase(),
			defaults: defaultPublicApiProps(),
			kinds: LOCAL_LIGHT_KINDS.map((kind) => ({
				kind,
				properties: propertiesForLightKind(kind).map((property) => property.name),
			})),
			flags: [flagState(PUBLIC_API_FLAG_ID), flagState(EDITOR_GIZMOS_FLAG_ID)],
		};
	}

	const checksum = publicApiChecksum();
	llQa.setPhase(PUBLIC_API_PHASE_ID, {
		qa: PUBLIC_API_QA_ID,
		flag: PUBLIC_API_FLAG_ID,
		block: PUBLIC_API_BLOCK_NAME,
		version: LL_PUBLIC_API_VERSION,
		checksum,
		properties: LL_PUBLIC_API.length,
		published: true,
	});


	if (scope) scope[PUBLIC_API_GLOBAL_NAME] = describe;

	return {
		phaseId: PUBLIC_API_PHASE_ID,
		flagId: PUBLIC_API_FLAG_ID,
		gizmoFlagId: EDITOR_GIZMOS_FLAG_ID,
		globalName: PUBLIC_API_GLOBAL_NAME,
		blockName: PUBLIC_API_BLOCK_NAME,
		version: LL_PUBLIC_API_VERSION,
		checksum: () => publicApiChecksum(),
		describe,
		defaults: () => defaultPublicApiProps(),

		sanitize: (props) => sanitizePublicApiProps(props),
		propertiesFor: (kind) => propertiesForLightKind(kind),
		isApiEnabled: () => flagState(PUBLIC_API_FLAG_ID).active,
		areGizmosEnabled: () => flagState(EDITOR_GIZMOS_FLAG_ID).active,
		status() {
			return {
				phaseId: PUBLIC_API_PHASE_ID,
				flagId: PUBLIC_API_FLAG_ID,
				properties: LL_PUBLIC_API.length,
				checksum: publicApiChecksum(),
				flags: [flagState(PUBLIC_API_FLAG_ID), flagState(EDITOR_GIZMOS_FLAG_ID)],
			};
		},
	};
}
