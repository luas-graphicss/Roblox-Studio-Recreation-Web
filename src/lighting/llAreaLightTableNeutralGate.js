export const NO_NEUTRAL_PUBLICATION = -1;

export const NEUTRAL_GATE_INVALIDATION = Object.freeze({
	TABLES_RESIZED: "tables-resized",
	SHAPED_SLOTS_PUBLISHED: "shaped-slots-published",
});

function asSlotCount(value) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return NO_NEUTRAL_PUBLICATION;
	const whole = Math.floor(parsed);
	return whole >= 0 ? whole : NO_NEUTRAL_PUBLICATION;
}


export function createAreaLightTableNeutralGate() {
	let publishedNeutralSlotCount = NO_NEUTRAL_PUBLICATION;
	let skippedWriteCount = 0;
	let neutralPublicationCount = 0;
	let invalidationCount = 0;
	let lastInvalidationReason = "";

	return {


		trySkipNeutralWrite(slotCount) {
			const wanted = asSlotCount(slotCount);
			const canSkip = wanted !== NO_NEUTRAL_PUBLICATION && wanted === publishedNeutralSlotCount;
			if (canSkip) skippedWriteCount += 1;
			return canSkip;
		},


		markNeutralPublished(slotCount) {
			const published = asSlotCount(slotCount);
			publishedNeutralSlotCount = published;
			if (published !== NO_NEUTRAL_PUBLICATION) neutralPublicationCount += 1;
			return published;
		},


		invalidate(reason) {
			if (publishedNeutralSlotCount !== NO_NEUTRAL_PUBLICATION) invalidationCount += 1;
			publishedNeutralSlotCount = NO_NEUTRAL_PUBLICATION;
			lastInvalidationReason = String(reason || "unspecified");
			return true;
		},


		isNeutralPublished() {
			return publishedNeutralSlotCount;
		},

		stats() {
			return {
				neutralSlotCount: publishedNeutralSlotCount,
				skippedWrites: skippedWriteCount,
				neutralPublications: neutralPublicationCount,
				invalidations: invalidationCount,
				lastInvalidationReason,
			};
		},
	};
}
