export const MSM_PATCH_ANCHOR_OWNER_PHASE = "MSM-F24";

export const MSM_PATCH_DECISION_APPLY = "apply";
export const MSM_PATCH_DECISION_SKIP = "skip";

export const MSM_PATCH_SKIP_REASONS = Object.freeze({
	consumerNotReady: "consumer-not-ready",
	injectionDisabled: "injection-disabled",
	alreadyPatched: "material-already-patched",
	missingShaderSource: "missing-shader-source",
	missingFragmentAnchor: "missing-fragment-anchor",
	missingVertexAnchor: "missing-vertex-anchor",
	missingShaderSymbol: "missing-shader-symbol",
	missingShaderChunk: "missing-shader-chunk",
});

function asSourceText(value) {
	return typeof value === "string" ? value : "";
}

function asTokenList(value) {
	if (!Array.isArray(value)) return [];
	return value.filter((token) => typeof token === "string" && token.length > 0);
}

function findMissingTokens(sourceText, tokens) {
	return asTokenList(tokens).filter((token) => sourceText.indexOf(token) === -1);
}


export function verifyShaderChunkNames(shaderChunks, requiredChunkNames) {
	const chunks = shaderChunks && typeof shaderChunks === "object" ? shaderChunks : {};
	const missingShaderChunks = asTokenList(requiredChunkNames).filter(
		(chunkName) => typeof chunks[chunkName] !== "string",
	);
	return Object.freeze({
		ok: missingShaderChunks.length === 0,
		missingShaderChunks: Object.freeze(missingShaderChunks),
		reason: missingShaderChunks.length === 0 ? null : MSM_PATCH_SKIP_REASONS.missingShaderChunk,
	});
}


export function verifyShaderAnchors(args = {}) {
	const fragmentShader = asSourceText(args.fragmentShader);
	const vertexShader = asSourceText(args.vertexShader);
	if (fragmentShader.length === 0 || vertexShader.length === 0) {
		return Object.freeze({
			ok: false,
			missingFragmentAnchors: Object.freeze([]),
			missingVertexAnchors: Object.freeze([]),
			missingSymbols: Object.freeze([]),
			reason: MSM_PATCH_SKIP_REASONS.missingShaderSource,
		});
	}
	const missingFragmentAnchors = findMissingTokens(fragmentShader, args.fragmentAnchors);
	const missingVertexAnchors = findMissingTokens(vertexShader, args.vertexAnchors);
	const missingSymbols = findMissingTokens(asSourceText(args.symbolSource) || fragmentShader, args.requiredSymbols);
	const reason = missingFragmentAnchors.length > 0
		? MSM_PATCH_SKIP_REASONS.missingFragmentAnchor
		: missingVertexAnchors.length > 0
			? MSM_PATCH_SKIP_REASONS.missingVertexAnchor
			: missingSymbols.length > 0
				? MSM_PATCH_SKIP_REASONS.missingShaderSymbol
				: null;
	return Object.freeze({
		ok: reason === null,
		missingFragmentAnchors: Object.freeze(missingFragmentAnchors),
		missingVertexAnchors: Object.freeze(missingVertexAnchors),
		missingSymbols: Object.freeze(missingSymbols),
		reason,
	});
}


export function decidePatch(args = {}) {
	if (args.consumerReady !== true) {
		return Object.freeze({
			decision: MSM_PATCH_DECISION_SKIP,
			reason: MSM_PATCH_SKIP_REASONS.consumerNotReady,
		});
	}
	if (args.alreadyPatched === true) {
		return Object.freeze({
			decision: MSM_PATCH_DECISION_SKIP,
			reason: MSM_PATCH_SKIP_REASONS.alreadyPatched,
		});
	}
	const verification = args.verification;
	if (!verification || verification.ok !== true) {
		return Object.freeze({
			decision: MSM_PATCH_DECISION_SKIP,
			reason: (verification && verification.reason) || MSM_PATCH_SKIP_REASONS.missingShaderSource,
		});
	}
	return Object.freeze({ decision: MSM_PATCH_DECISION_APPLY, reason: null });
}

export function describePatchAnchorPolicy() {
	return Object.freeze({
		ownerPhase: MSM_PATCH_ANCHOR_OWNER_PHASE,
		decisions: Object.freeze([MSM_PATCH_DECISION_APPLY, MSM_PATCH_DECISION_SKIP]),
		skipReasons: MSM_PATCH_SKIP_REASONS,
		fallback: "ancora ausente: patch fora, material intacto, motivo na telemetria",
	});
}
