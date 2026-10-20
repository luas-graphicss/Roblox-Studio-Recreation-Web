export const MSM_GRID_UPLOAD_PHASE_ID = "MSM-PERF-O2"


export const MSM_GRID_UPLOAD_DECISIONS = Object.freeze({
	FIRST_UPLOAD: "first-upload",
	INVALIDATED: "invalidated",
	WATCHDOG: "watchdog-forced",
	BYTES_CHANGED: "bytes-changed",
	SKIP_NO_DIRTY_CELL: "no-dirty-cell",
	SKIP_BYTES_UNCHANGED: "bytes-unchanged",
})


export const MSM_GRID_UPLOAD_DEFAULT_MAX_SKIPPED_FRAMES = 120


export const MSM_GRID_FINGERPRINT_OFFSET_BASIS = 2166136261
export const MSM_GRID_FINGERPRINT_PRIME = 16777619


export function fingerprintGridBytes(textureData, byteLength) {
	if (!textureData || typeof textureData.length !== "number") return 0
	const requestedLength = Math.floor(Number(byteLength))
	const readableLength = Number.isFinite(requestedLength) && requestedLength >= 0
		? Math.min(requestedLength, textureData.length)
		: textureData.length

	let fingerprint = MSM_GRID_FINGERPRINT_OFFSET_BASIS
	for (let byteIndex = 0; readableLength > byteIndex; byteIndex += 1) {
		fingerprint ^= textureData[byteIndex] & 0xff
		fingerprint = Math.imul(fingerprint, MSM_GRID_FINGERPRINT_PRIME)
	}
	return fingerprint >>> 0
}


export function createGridUploadTracker(options) {
	const settings = options && typeof options === "object" ? options : {}
	const requestedMaxSkippedFrames = Math.floor(Number(settings.maxSkippedFrames))
	const maxSkippedFrames = Number.isFinite(requestedMaxSkippedFrames) && requestedMaxSkippedFrames >= 0
		? requestedMaxSkippedFrames
		: MSM_GRID_UPLOAD_DEFAULT_MAX_SKIPPED_FRAMES
	const verifyBytes = settings.verifyBytes !== false

	const totals = {
		decisions: 0,
		uploads: 0,
		skips: 0,
		watchdogUploads: 0,
		fingerprints: 0,
		invalidations: 0,
	}

	let hasUploadedOnce = false
	let invalidationPending = false
	let lastUploadedFingerprint = 0
	let skippedFrameCount = 0

	function computeFingerprint(textureData, byteLength) {
		totals.fingerprints += 1
		return fingerprintGridBytes(textureData, byteLength)
	}

	function buildAnswer(shouldUpload, decision, dirtyCellCount, fingerprint, skippedFramesBeforeUpload) {
		return Object.freeze({
			phase: MSM_GRID_UPLOAD_PHASE_ID,
			shouldUpload,
			decision,
			dirtyCellCount,
			fingerprint,
			skippedFrameCount,
			skippedFramesBeforeUpload,
			watchdogLimit: maxSkippedFrames,
			verifyBytes,
		})
	}

	function commitUpload(decision, dirtyCellCount, textureData, byteLength, knownFingerprint) {
		const canVerifyBytes = verifyBytes && Boolean(textureData)
		let fingerprint = knownFingerprint
		if (fingerprint === null) {
			fingerprint = canVerifyBytes ? computeFingerprint(textureData, byteLength) : 0
		}
		if (canVerifyBytes) lastUploadedFingerprint = fingerprint

		const skippedFramesBeforeUpload = skippedFrameCount
		hasUploadedOnce = true
		invalidationPending = false
		skippedFrameCount = 0
		totals.uploads += 1
		return buildAnswer(true, decision, dirtyCellCount, fingerprint, skippedFramesBeforeUpload)
	}

	function commitSkip(decision, dirtyCellCount, fingerprint) {
		skippedFrameCount += 1
		totals.skips += 1
		return buildAnswer(false, decision, dirtyCellCount, fingerprint, 0)
	}


	function decideUpload(frame) {
		const request = frame && typeof frame === "object" ? frame : {}
		const textureData = request.textureData || null
		const byteLength = request.byteLength
		const requestedDirtyCellCount = Math.floor(Number(request.dirtyCellCount))
		const dirtyCellCount = Number.isFinite(requestedDirtyCellCount) && requestedDirtyCellCount >= 0
			? requestedDirtyCellCount
			: 0
		totals.decisions += 1

		if (!hasUploadedOnce) {
			return commitUpload(MSM_GRID_UPLOAD_DECISIONS.FIRST_UPLOAD, dirtyCellCount, textureData, byteLength, null)
		}
		if (invalidationPending) {
			return commitUpload(MSM_GRID_UPLOAD_DECISIONS.INVALIDATED, dirtyCellCount, textureData, byteLength, null)
		}
		if (skippedFrameCount >= maxSkippedFrames) {
			totals.watchdogUploads += 1
			return commitUpload(MSM_GRID_UPLOAD_DECISIONS.WATCHDOG, dirtyCellCount, textureData, byteLength, null)
		}


		if (dirtyCellCount === 0) {
			return commitSkip(MSM_GRID_UPLOAD_DECISIONS.SKIP_NO_DIRTY_CELL, dirtyCellCount, lastUploadedFingerprint)
		}

		if (verifyBytes && textureData) {
			const fingerprint = computeFingerprint(textureData, byteLength)
			if (fingerprint === lastUploadedFingerprint) {
				return commitSkip(MSM_GRID_UPLOAD_DECISIONS.SKIP_BYTES_UNCHANGED, dirtyCellCount, fingerprint)
			}
			return commitUpload(
				MSM_GRID_UPLOAD_DECISIONS.BYTES_CHANGED,
				dirtyCellCount,
				textureData,
				byteLength,
				fingerprint,
			)
		}
		return commitUpload(MSM_GRID_UPLOAD_DECISIONS.BYTES_CHANGED, dirtyCellCount, textureData, byteLength, null)
	}


	function invalidate() {
		invalidationPending = true
		totals.invalidations += 1
		return true
	}

	function describe() {
		return Object.freeze({
			phase: MSM_GRID_UPLOAD_PHASE_ID,
			maxSkippedFrames,
			verifyBytes,
			hasUploadedOnce,
			invalidationPending,
			skippedFrameCount,
			lastUploadedFingerprint,
			totals: Object.freeze(Object.assign({}, totals)),
		})
	}

	return Object.freeze({
		phase: MSM_GRID_UPLOAD_PHASE_ID,
		maxSkippedFrames,
		verifyBytes,
		decideUpload,
		invalidate,
		describe,
	})
}
