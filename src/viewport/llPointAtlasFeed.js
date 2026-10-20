import { orderLightsAsRendererDoes } from "../lighting/llShadowGateCore.js";
import {
	CUBE_FACE_COUNT,
	cubeFaceForward,
	cubeFaceHalfAngleRad,
	cubeFaceUpVector,
} from "../lighting/llPointShadowCore.js";
import { planPointCubePages } from "../lighting/llPointAtlasPlanCore.js";

const ORIGIN = Object.freeze([0, 0, 0]);


export function createPointCubeAtlasFeed(options) {
	const settings = options && typeof options === "object" ? options : {};
	const logger = settings.logger && typeof settings.logger.warn === "function" ? settings.logger : null;


	const descriptorPool = [];
	const sortablePool = [];
	const plannerInput = [];
	const cubeFacePages = [];


	const previousResolutions = {};
	const previousFingerprints = {};
	let freshLightKeys = [];

	let lastPlanSummary = null;

	function sortableAt(index) {
		let entry = sortablePool[index];
		if (!entry) {
			entry = { castShadow: false, hasMap: false, threeLight: null };
			sortablePool[index] = entry;
		}
		return entry;
	}

	function descriptorAt(index) {
		let descriptor = descriptorPool[index];
		if (!descriptor) {
			descriptor = {
				key: "",
				rendererIndex: 0,
				worldPosition: [0, 0, 0],
				range: 0,
				castsShadow: false,
				enabled: true,
			};
			descriptorPool[index] = descriptor;
		}
		return descriptor;
	}


	function pageAt(index) {
		let page = cubeFacePages[index];
		if (!page) {
			page = {
				id: "",
				metaRow: 0,
				res: 0,
				range: 0,
				x: 0,
				y: 0,
				z: 0,
				forwardX: 0,
				forwardY: 0,
				forwardZ: 0,
				upX: 0,
				upY: 1,
				upZ: 0,
				halfAngleRad: 0,

				lightKey: "",
				faceIndex: 0,
				needsRender: true,
			};
			cubeFacePages[index] = page;
		}
		return page;
	}


	function planFrame(input) {
		const request = input && typeof input === "object" ? input : {};
		const pointLights = Array.isArray(request.pointLights) ? request.pointLights : [];


		let sortableCount = 0;
		for (let index = 0; index < pointLights.length; index++) {
			const threeLight = pointLights[index];
			if (!threeLight || threeLight.isPointLight !== true || threeLight.visible === false) continue;
			const entry = sortableAt(sortableCount);
			entry.castShadow = threeLight.castShadow === true;


			entry.hasMap = !!threeLight.map;
			entry.threeLight = threeLight;
			sortableCount++;
		}
		const sorted = orderLightsAsRendererDoes(sortablePool.slice(0, sortableCount));


		plannerInput.length = 0;
		let legacyShadowCount = 0;
		for (let rendererIndex = 0; rendererIndex < sorted.length; rendererIndex++) {
			const threeLight = sorted[rendererIndex].threeLight;
			if (!threeLight) continue;
			if (sorted[rendererIndex].castShadow === true) legacyShadowCount++;
			const descriptor = descriptorAt(rendererIndex);
			const position = threeLight.position;
			descriptor.key = threeLight.uuid;
			descriptor.rendererIndex = rendererIndex;
			descriptor.worldPosition[0] = position.x;
			descriptor.worldPosition[1] = position.y;
			descriptor.worldPosition[2] = position.z;


			descriptor.range = Number(threeLight.distance) || 0;


			descriptor.castsShadow =
				!!threeLight.userData && threeLight.userData.__rswShadowsRequested === true;
			descriptor.enabled = true;
			plannerInput.push(descriptor);
		}


		const plan = planPointCubePages({
			pointLights: plannerInput,
			tier: request.tier,
			cameraPosition: request.cameraPosition || ORIGIN,
			previousResolutions,
			previousFingerprints,
			freshLightKeys,
			redrawLightsPerFrame: plannerInput.length,
		});


		cubeFacePages.length = plan.pages.length;
		for (let index = 0; index < plan.pages.length; index++) {
			const planned = plan.pages[index];
			const light = plannerInput[planned.rendererIndex];
			const forward = cubeFaceForward(planned.faceIndex);
			const up = cubeFaceUpVector(planned.faceIndex);
			const page = pageAt(index);
			page.id = planned.id;
			page.metaRow = planned.metaRow;
			page.res = planned.res;
			page.range = light ? light.range : 0;
			page.x = light ? light.worldPosition[0] : 0;
			page.y = light ? light.worldPosition[1] : 0;
			page.z = light ? light.worldPosition[2] : 0;
			page.forwardX = forward[0];
			page.forwardY = forward[1];
			page.forwardZ = forward[2];
			page.upX = up[0];
			page.upY = up[1];
			page.upZ = up[2];


			page.halfAngleRad = cubeFaceHalfAngleRad(planned.res);
			page.lightKey = planned.lightKey;
			page.faceIndex = planned.faceIndex;
			page.needsRender = planned.needsRender === true;
		}


		for (let index = 0; index < plan.lights.length; index++) {
			const planned = plan.lights[index];
			previousResolutions[planned.key] = planned.resolution;
			previousFingerprints[planned.key] = planned.fingerprint;
		}
		freshLightKeys = plan.lights.map((planned) => planned.key);

		lastPlanSummary = {
			visiblePointLights: sorted.length,


			atlasLightCount: plan.atlasLightCount,
			atlasedLights: plan.stats.atlased,
			pageCount: cubeFacePages.length,
			lightBudget: plan.lightBudget,
			legacyShadowCount,
			legacyCubemapsSaved: plan.stats.legacyCubemapsSaved,
			refusedCount: plan.refusals.length,
			refused: plan.refusals,
			facesPerLight: CUBE_FACE_COUNT,
		};
		if (logger && cubeFacePages.length > 0 && plan.atlasLightCount <= 0) {
			logger.warn("[Luzes locais] LL-F11: paginas planejadas sem contagem de luzes - gate segue fechado.");
		}
		return lastPlanSummary;
	}


	function pages() {
		return cubeFacePages;
	}

	function lastPlan() {
		return lastPlanSummary;
	}


	function reset() {
		plannerInput.length = 0;
		cubeFacePages.length = 0;
		freshLightKeys = [];
		lastPlanSummary = null;


		for (let index = 0; index < sortablePool.length; index++) sortablePool[index].threeLight = null;
		for (let index = 0; index < descriptorPool.length; index++) descriptorPool[index].key = "";
	}

	return { planFrame, pages, lastPlan, reset };
}
