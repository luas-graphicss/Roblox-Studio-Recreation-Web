export const LIGHT_PROXY_SHAPE = Object.freeze({
	RECTANGLE: "rectangle",
	SPHERE: "sphere",
	CAPSULE: "capsule",
});

export const LIGHT_PROXY_SHAPE_BY_LIGHT_TYPE = Object.freeze({
	RectLight: LIGHT_PROXY_SHAPE.RECTANGLE,
	SurfaceLight: LIGHT_PROXY_SHAPE.RECTANGLE,
	TubeLight: LIGHT_PROXY_SHAPE.CAPSULE,
	PointLight: LIGHT_PROXY_SHAPE.SPHERE,
	SpotLight: LIGHT_PROXY_SHAPE.SPHERE,
});


export const MIN_RECTANGLE_SIDE = 0.05;
export const LEGACY_SPHERE_PROXY_MIN_RADIUS = 0.06;
export const LEGACY_CAPSULE_PROXY_MIN_RADIUS = 0.05;
export const LEGACY_CAPSULE_PROXY_MIN_LENGTH = 0.4;


export const LIGHT_PROXY_BUDGET_BY_TIER = Object.freeze({
	fraco: 0,
	medio: 2,
	forte: 6,
});

export const LIGHT_PROXY_MAX_VISIBLE = LIGHT_PROXY_BUDGET_BY_TIER.forte;

export const LIGHT_PROXY_REASON = Object.freeze({
	VISIBLE: "visible-in-reflections",
	PHASE_OFF: "phase-off",
	BUDGET_FULL: "budget-full",
	DISABLED: "disabled",
	DEGENERATE_SIZE: "degenerate-size",
	NO_ENERGY: "no-energy",
	UNKNOWN_TYPE: "unknown-type",
});

function readNumber(value, fallback) {
	const number = Number(value);
	return Number.isFinite(number) ? number : fallback;
}

export function proxyShapeForLightType(lightType) {
	const shape = LIGHT_PROXY_SHAPE_BY_LIGHT_TYPE[lightType];
	return shape === undefined ? null : shape;
}

export function isKnownLightType(lightType) {
	return proxyShapeForLightType(lightType) !== null;
}


export function resolveProxyDimensions(light) {
	const source = light || {};
	const shape = proxyShapeForLightType(source.type);
	if (shape === LIGHT_PROXY_SHAPE.RECTANGLE) {
		return Object.freeze({
			shape: shape,
			width: Math.max(readNumber(source.width, 0), MIN_RECTANGLE_SIDE),
			height: Math.max(readNumber(source.height, 0), MIN_RECTANGLE_SIDE),
			radius: 0,
			length: 0,
		});
	}
	if (shape === LIGHT_PROXY_SHAPE.CAPSULE) {
		return Object.freeze({
			shape: shape,
			width: 0,
			height: 0,
			radius: Math.max(readNumber(source.sourceRadius, 0), LEGACY_CAPSULE_PROXY_MIN_RADIUS),
			length: Math.max(readNumber(source.sourceLength, 0), LEGACY_CAPSULE_PROXY_MIN_LENGTH),
		});
	}
	return Object.freeze({
		shape: LIGHT_PROXY_SHAPE.SPHERE,
		width: 0,
		height: 0,
		radius: Math.max(readNumber(source.sourceRadius, 0), LEGACY_SPHERE_PROXY_MIN_RADIUS),
		length: 0,
	});
}


export function proxyProjectedArea(dimensions) {
	const shape = dimensions ? dimensions.shape : null;
	if (shape === LIGHT_PROXY_SHAPE.RECTANGLE) {
		return Math.max(readNumber(dimensions.width, 0), 0) * Math.max(readNumber(dimensions.height, 0), 0);
	}
	const radius = Math.max(readNumber(dimensions && dimensions.radius, 0), 0);
	if (shape === LIGHT_PROXY_SHAPE.CAPSULE) {
		const length = Math.max(readNumber(dimensions.length, 0), 0);
		return Math.PI * radius * radius + 2 * radius * length;
	}
	if (shape === LIGHT_PROXY_SHAPE.SPHERE) {
		return Math.PI * radius * radius;
	}
	return 0;
}


export function lightProxyPriority(light) {
	const candidate = light || {};
	return Math.max(readNumber(candidate.candela, 0), 0);
}

export function proxyBudgetForTier(tier) {
	const budget = LIGHT_PROXY_BUDGET_BY_TIER[tier];
	return budget === undefined ? 0 : budget;
}


export function resolveLightProxyPlan(params) {
	const settings = params || {};
	const tier = settings.tier || "medio";
	const budget = proxyBudgetForTier(tier);
	const phaseOn = !!settings.phaseFlagOn;
	const lights = Array.isArray(settings.lights) ? settings.lights : [];

	const decisions = lights.map((light, index) => {
		const source = light || {};
		const dimensions = resolveProxyDimensions(source);
		const projectedArea = proxyProjectedArea(dimensions);
		return {
			index: index,
			name: source.name !== undefined ? source.name : String(index),
			type: source.type === undefined ? null : source.type,
			shape: dimensions.shape,
			dimensions: dimensions,
			projectedArea: projectedArea,
			candela: Math.max(readNumber(source.candela, 0), 0),
			priority: lightProxyPriority(source),
			visible: false,
			reason: LIGHT_PROXY_REASON.UNKNOWN_TYPE,
		};
	});

	const candidates = decisions.filter((decision, index) => {
		const light = lights[index] || {};
		if (!isKnownLightType(decision.type)) return false;

		if (light.enabled === false) {
			decision.reason = LIGHT_PROXY_REASON.DISABLED;
			return false;
		}
		if (!(decision.projectedArea > 0)) {
			decision.reason = LIGHT_PROXY_REASON.DEGENERATE_SIZE;
			return false;
		}


		if (!(decision.candela > 0)) {
			decision.reason = LIGHT_PROXY_REASON.NO_ENERGY;
			return false;
		}
		decision.reason = phaseOn ? LIGHT_PROXY_REASON.BUDGET_FULL : LIGHT_PROXY_REASON.PHASE_OFF;
		return true;
	});

	if (phaseOn && budget > 0) {
		candidates
			.slice()
			.sort((a, b) => b.priority - a.priority || b.projectedArea - a.projectedArea || a.index - b.index)
			.slice(0, budget)
			.forEach((decision) => {
				decision.visible = true;
				decision.reason = LIGHT_PROXY_REASON.VISIBLE;
			});
	}

	const visible = decisions.filter((decision) => decision.visible);
	return {
		tier: tier,
		budget: budget,
		on: phaseOn,
		decisions: decisions,
		visibleNames: visible.map((decision) => decision.name),
		visibleCount: visible.length,
		candidateCount: candidates.length,
		fallbackNames: candidates.filter((decision) => !decision.visible).map((decision) => decision.name),
	};
}
