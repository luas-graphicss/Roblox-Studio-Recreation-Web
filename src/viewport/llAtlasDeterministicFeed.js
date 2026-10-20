import {
	ATLAS_META_ROWS_PER_KIND,
	buildPageRequests,
	indexSpotLights,
	pageBudgetForTier,
} from "../lighting/llShadowGateCore.js";


export const MAX_DETERMINISTIC_ATLAS_SPOTS = ATLAS_META_ROWS_PER_KIND;

const ORIGIN = Object.freeze([0, 0, 0]);

function normalizedDirection(fromPosition, toPosition, target) {
	const dx = toPosition.x - fromPosition.x;
	const dy = toPosition.y - fromPosition.y;
	const dz = toPosition.z - fromPosition.z;
	const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
	if (!(length > 0)) {
		target[0] = 0;
		target[1] = -1;
		target[2] = 0;
		return target;
	}
	target[0] = dx / length;
	target[1] = dy / length;
	target[2] = dz / length;
	return target;
}


export function createDeterministicAtlasFeed(options) {
	const settings = options && typeof options === "object" ? options : {};
	const logger = settings.logger && typeof settings.logger.warn === "function" ? settings.logger : null;


	const descriptorPool = [];
	const visibleSpots = [];
	const lightsByMetaRow = [];
	const pagedThreeLights = [];
	const pagedIds = new Set();
	let describedCount = 0;
	let lastPlanSummary = null;


	const NO_CUBE_PAGES = Object.freeze([]);
	const frameStateBuffer = {
		atlasWanted: false,
		lights: lightsByMetaRow,
		spotThreeLights: pagedThreeLights,
		renderSceneDepth: null,


		cubeFaces: NO_CUBE_PAGES,


		resolutionByLightId: null,


		redrawPolicy: null,
	};


	function refreshAtlasWanted() {
		frameStateBuffer.atlasWanted =
			pagedThreeLights.length > 0 || frameStateBuffer.cubeFaces.length > 0;
	}

	function descriptorAt(index) {
		let descriptor = descriptorPool[index];
		if (!descriptor) {
			descriptor = {
				id: null,
				key: null,
				name: "",
				rendererType: "SpotLight",
				visible: true,
				castShadow: false,
				hasMap: false,
				shadowsRequested: false,
				range: 0,
				angleRad: 0,
				brightness: 0,
				worldPosition: [0, 0, 0],
				direction: [0, -1, 0],
				threeLight: null,
			};
			descriptorPool[index] = descriptor;
		}
		return descriptor;
	}


	const ORIGIN_POSITION = { x: 0, y: 0, z: 0 };


	function describeSpotLight(threeLight, descriptor, influenceRadiusById) {
		const position = threeLight.position;
		const targetPosition =
			threeLight.target && threeLight.target.position ? threeLight.target.position : null;
		descriptor.id = threeLight.uuid;
		descriptor.key = threeLight.uuid;
		descriptor.name = threeLight.name || "";
		descriptor.rendererType = "SpotLight";
		descriptor.visible = true;
		descriptor.castShadow = threeLight.castShadow === true;


		descriptor.hasMap = !!threeLight.map;
		descriptor.shadowsRequested =
			!!threeLight.userData && threeLight.userData.__rswShadowsRequested === true;


		const declaredRange = Number(threeLight.distance) || 0;
		descriptor.range =
			declaredRange > 0
				? declaredRange
				: (influenceRadiusById && Number(influenceRadiusById[threeLight.uuid])) || 0;
		descriptor.angleRad = Number(threeLight.angle) || 0;
		descriptor.brightness = Math.max(Number(threeLight.intensity) || 0, 0);
		descriptor.worldPosition[0] = position.x;
		descriptor.worldPosition[1] = position.y;
		descriptor.worldPosition[2] = position.z;
		normalizedDirection(position, targetPosition || ORIGIN_POSITION, descriptor.direction);
		descriptor.threeLight = threeLight;
		return descriptor;
	}


	function planFrame(input) {
		const request = input && typeof input === "object" ? input : {};
		const spotLights = Array.isArray(request.spotLights) ? request.spotLights : [];
		const influenceRadiusById =
			request.influenceRadiusById && typeof request.influenceRadiusById === "object"
				? request.influenceRadiusById
				: null;

		describedCount = 0;
		visibleSpots.length = 0;
		for (let index = 0; index < spotLights.length; index++) {
			const threeLight = spotLights[index];
			if (!threeLight || threeLight.isSpotLight !== true || threeLight.visible === false) continue;
			if (describedCount >= MAX_DETERMINISTIC_ATLAS_SPOTS) break;
			visibleSpots.push(describeSpotLight(threeLight, descriptorAt(describedCount), influenceRadiusById));
			describedCount++;
		}

		const indexed = indexSpotLights(visibleSpots);
		const pageBudget = pageBudgetForTier(request.tier);


		const plan = buildPageRequests({
			spots: indexed.spots,
			cameraPosition: request.cameraPosition || ORIGIN,
			pageBudget,
		});

		pagedIds.clear();
		for (let index = 0; index < plan.requests.length; index++) pagedIds.add(plan.requests[index].id);

		lightsByMetaRow.length = 0;
		pagedThreeLights.length = 0;
		for (let index = 0; index < indexed.spots.length; index++) {
			const spot = indexed.spots[index];
			const metaRow = spot.spotIndex;

			while (lightsByMetaRow.length <= metaRow) lightsByMetaRow.push(null);
			if (!pagedIds.has(spot.id)) continue;
			const threeLight = spot.threeLight;
			if (!threeLight) continue;


			if (!threeLight.userData) threeLight.userData = {};
			threeLight.userData.__rswAtlasId = spot.id;
			lightsByMetaRow[metaRow] = spot;
			pagedThreeLights.push(threeLight);
		}

		refreshAtlasWanted();
		frameStateBuffer.renderSceneDepth =
			typeof request.renderSceneDepth === "function" ? request.renderSceneDepth : null;

		lastPlanSummary = {
			visibleSpots: describedCount,
			pagedSpots: pagedThreeLights.length,
			pageBudget,
			legacyShadowMapCount: indexed.legacyShadowMapCount,
			refusedCount: plan.refused.length,
			refused: plan.refused,
			hasDepthHook: frameStateBuffer.renderSceneDepth !== null,
		};
		if (logger && pagedThreeLights.length > 0 && frameStateBuffer.renderSceneDepth === null) {
			logger.warn("[Luzes locais] LL-F10: paginas planejadas sem hook de profundidade - atlas segue no fail-safe.");
		}
		return lastPlanSummary;
	}


	function frameState() {
		return frameStateBuffer;
	}

	function lastPlan() {
		return lastPlanSummary;
	}


	function reset() {
		describedCount = 0;
		visibleSpots.length = 0;
		lightsByMetaRow.length = 0;
		pagedThreeLights.length = 0;
		pagedIds.clear();
		frameStateBuffer.cubeFaces = NO_CUBE_PAGES;
		frameStateBuffer.resolutionByLightId = null;
		frameStateBuffer.redrawPolicy = null;
		frameStateBuffer.atlasWanted = false;
		frameStateBuffer.renderSceneDepth = null;
		lastPlanSummary = null;


		for (let index = 0; index < descriptorPool.length; index++) descriptorPool[index].threeLight = null;
	}


	function attachCubeFacePages(pages) {
		frameStateBuffer.cubeFaces = Array.isArray(pages) ? pages : NO_CUBE_PAGES;
		refreshAtlasWanted();
		return frameStateBuffer.cubeFaces.length;
	}


	function attachPageResolutions(resolutionByLightId) {
		frameStateBuffer.resolutionByLightId =
			resolutionByLightId && typeof resolutionByLightId === "object" ? resolutionByLightId : null;
		return frameStateBuffer.resolutionByLightId !== null;
	}


	function attachRedrawPolicy(redrawPolicy) {
		frameStateBuffer.redrawPolicy =
			redrawPolicy && typeof redrawPolicy === "object" ? redrawPolicy : null;
		return frameStateBuffer.redrawPolicy !== null;
	}

	return {
		planFrame,
		frameState,
		lastPlan,
		reset,
		attachCubeFacePages,
		attachPageResolutions,
		attachRedrawPolicy,
	};
}
