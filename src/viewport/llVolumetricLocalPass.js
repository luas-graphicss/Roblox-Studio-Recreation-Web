import {
	registerLocalLightFlag,
	isLocalLightFlagActive,
	resolveLocalLightFlag,
	setLocalLightFlagOverride,
} from "../lighting/llFeatureFlags.js";
import { isLocalLightBaselineFrozen } from "../lighting/llBaselineFreezeFlag.js";
import { isLocalLightTechnology } from "../lighting/llTechnologyGate.js";
import { llQa } from "../lighting/llTelemetry.js";
import {
	LOCAL_VOLUMETRIC_ATLAS_ON_UNIFORM,
	LOCAL_VOLUMETRIC_COLOR_SCATTERING_UNIFORM,
	LOCAL_VOLUMETRIC_CONE_AXIS_UNIFORM,
	LOCAL_VOLUMETRIC_CONE_COSINES_UNIFORM,
	LOCAL_VOLUMETRIC_COUNT_UNIFORM,
	LOCAL_VOLUMETRIC_FLAG_ID,
	LOCAL_VOLUMETRIC_MAX_LIGHTS,
	LOCAL_VOLUMETRIC_ON_UNIFORM,
	LOCAL_VOLUMETRIC_OWN_TEXTURE_UNITS,
	LOCAL_VOLUMETRIC_PASS_ID,
	LOCAL_VOLUMETRIC_PHASE_ID,
	LOCAL_VOLUMETRIC_POSITION_RANGE_UNIFORM,
	LOCAL_VOLUMETRIC_TEXTURE_UNITS,
	LOCAL_VOLUMETRIC_UNIFORM_NAMES,
	LOCAL_VOLUMETRIC_VIEW_MATRIX_UNIFORM,
} from "../lighting/llVolumetricLocalContract.js";
import {
	LOCAL_VOLUMETRIC_PASS_VERTEX_GLSL,
	buildLocalVolumetricMarchFragmentGlsl,
} from "../lighting/llVolumetricLocalGlsl.js";
import { buildAtlasFragmentDeclarations } from "../lighting/llShadowGateShader.js";
import { ATLAS_UNIFORMS } from "./llShadowGatePatch.js";


const BORROWED_ATLAS_UNIFORM_NAMES = Object.freeze([
	ATLAS_UNIFORMS.atlasTexture,
	ATLAS_UNIFORMS.metaTexture,
	ATLAS_UNIFORMS.enabled,
	ATLAS_UNIFORMS.bias,
	ATLAS_UNIFORMS.texel,
	ATLAS_UNIFORMS.samplesK,
	ATLAS_UNIFORMS.topCount,
	ATLAS_UNIFORMS.cameraWorld,
	ATLAS_UNIFORMS.legacySpotShadowCount,
	ATLAS_UNIFORMS.transmitterCount,
	ATLAS_UNIFORMS.transmitterMin,
	ATLAS_UNIFORMS.transmitterMax,
	ATLAS_UNIFORMS.transmitterTint,
]);

export const LOCAL_VOLUMETRIC_PASS_REFUSALS = Object.freeze({
	rewriteFailed: "march-rewrite-refused",
	atlasSlotsMissing: "atlas-uniform-slots-missing",
});



registerLocalLightFlag({
	id: LOCAL_VOLUMETRIC_FLAG_ID,
	phase: LOCAL_VOLUMETRIC_PHASE_ID,
	description:
		"local lights scatter INSIDE the volumetric march: shafts get the medium phase function, the LL-F5 cone and the LL-F10 atlas shadow at every step",
	defaultsByTier: { fraco: false, medio: true, forte: true },
});


export function createLocalVolumetricPassExtension(options) {
	const settings = options && typeof options === "object" ? options : {};
	const THREE = settings.THREE;
	if (!THREE) throw new Error("createLocalVolumetricPassExtension: THREE is required");
	const registry = settings.registry || null;
	const logger = settings.logger && typeof settings.logger.warn === "function" ? settings.logger : null;

	let lastRefusal = "";

	function recordRefusal(reason) {
		lastRefusal = reason;
		llQa.addError("LL-F17: " + reason, { phase: LOCAL_VOLUMETRIC_PHASE_ID, pass: LOCAL_VOLUMETRIC_PASS_ID });
		if (logger) logger.warn("[Luzes locais] LL-F17 recusou: " + reason);
	}




	const borrowedAtlasUniforms = {};
	let borrowedAtlasSlotCount = 0;
	if (registry && typeof registry.getUniformSlot === "function") {
		for (let index = 0; index < BORROWED_ATLAS_UNIFORM_NAMES.length; index++) {
			const name = BORROWED_ATLAS_UNIFORM_NAMES[index];
			const slot = registry.getUniformSlot(name);
			if (!slot) continue;
			borrowedAtlasUniforms[name] = slot;
			borrowedAtlasSlotCount++;
		}
	}


	const atlasSlotsComplete = borrowedAtlasSlotCount === BORROWED_ATLAS_UNIFORM_NAMES.length;
	if (registry && !atlasSlotsComplete) {
		recordRefusal(
			LOCAL_VOLUMETRIC_PASS_REFUSALS.atlasSlotsMissing +
				" (" + borrowedAtlasSlotCount + "/" + BORROWED_ATLAS_UNIFORM_NAMES.length + ")",
		);
	}


	const atlasDeclarationsGlsl = atlasSlotsComplete ? buildAtlasFragmentDeclarations() : "";
	const rewrite = buildLocalVolumetricMarchFragmentGlsl({ atlasDeclarationsGlsl });
	if (!rewrite.ok) recordRefusal(LOCAL_VOLUMETRIC_PASS_REFUSALS.rewriteFailed + ": " + rewrite.refusal);

	const atlasShadowing = rewrite.ok && rewrite.atlasShadowing === true;

	function buildVector4Array() {
		const slots = [];
		for (let index = 0; index < LOCAL_VOLUMETRIC_MAX_LIGHTS; index++) slots.push(new THREE.Vector4());
		return slots;
	}


	const positionRangeSlots = buildVector4Array();
	const colorScatteringSlots = buildVector4Array();
	const coneAxisSlots = buildVector4Array();
	const coneCosinesSlots = buildVector4Array();

	const onUniform = { value: 0 };
	const countUniform = { value: 0 };
	const atlasOnUniform = { value: 0 };
	const viewMatrixUniform = { value: new THREE.Matrix4() };

	const ownUniforms = {};
	ownUniforms[LOCAL_VOLUMETRIC_ON_UNIFORM] = onUniform;
	ownUniforms[LOCAL_VOLUMETRIC_COUNT_UNIFORM] = countUniform;
	ownUniforms[LOCAL_VOLUMETRIC_ATLAS_ON_UNIFORM] = atlasOnUniform;
	ownUniforms[LOCAL_VOLUMETRIC_VIEW_MATRIX_UNIFORM] = viewMatrixUniform;
	ownUniforms[LOCAL_VOLUMETRIC_POSITION_RANGE_UNIFORM] = { value: positionRangeSlots };
	ownUniforms[LOCAL_VOLUMETRIC_COLOR_SCATTERING_UNIFORM] = { value: colorScatteringSlots };
	ownUniforms[LOCAL_VOLUMETRIC_CONE_AXIS_UNIFORM] = { value: coneAxisSlots };
	ownUniforms[LOCAL_VOLUMETRIC_CONE_COSINES_UNIFORM] = { value: coneCosinesSlots };

	const uniforms = Object.assign({}, borrowedAtlasUniforms, ownUniforms);

	llQa.setTextureUnits(
		LOCAL_VOLUMETRIC_PHASE_ID,
		atlasShadowing ? LOCAL_VOLUMETRIC_TEXTURE_UNITS : LOCAL_VOLUMETRIC_OWN_TEXTURE_UNITS,
	);

	let lastSelectedCount = 0;
	let lastStepCount = 0;

	function isPhaseActive(context) {
		const frame = context && typeof context === "object" ? context : {};
		if (!rewrite.ok) return false;
		if (!isLocalLightTechnology(frame.technology)) return false;
		if (isLocalLightBaselineFrozen(frame.tier)) return false;
		return isLocalLightFlagActive(LOCAL_VOLUMETRIC_FLAG_ID, frame.tier);
	}

	function clearSlot(index) {
		positionRangeSlots[index].set(0, 0, 0, 0);
		colorScatteringSlots[index].set(0, 0, 0, 0);
		coneAxisSlots[index].set(0, -1, 0, 0);
		coneCosinesSlots[index].set(-1, 1, -1, 0);
	}


	function handBackToLegacyTerm() {
		onUniform.value = 0;
		countUniform.value = 0;
		atlasOnUniform.value = 0;
		for (let index = 0; index < LOCAL_VOLUMETRIC_MAX_LIGHTS; index++) clearSlot(index);
		lastSelectedCount = 0;
		lastStepCount = 0;
	}

	handBackToLegacyTerm();

	const extension = {
		phaseId: LOCAL_VOLUMETRIC_PHASE_ID,
		flagId: LOCAL_VOLUMETRIC_FLAG_ID,
		passId: LOCAL_VOLUMETRIC_PASS_ID,
		maxLights: LOCAL_VOLUMETRIC_MAX_LIGHTS,
		uniformNames: LOCAL_VOLUMETRIC_UNIFORM_NAMES,
		textureUnits: atlasShadowing ? LOCAL_VOLUMETRIC_TEXTURE_UNITS : LOCAL_VOLUMETRIC_OWN_TEXTURE_UNITS,
		atlasShadowing,


		vertexShader: LOCAL_VOLUMETRIC_PASS_VERTEX_GLSL,


		fragmentShader: rewrite.ok ? rewrite.source : null,


		uniforms,

		setFlag(value) {
			return setLocalLightFlagOverride(LOCAL_VOLUMETRIC_FLAG_ID, value);
		},

		isActive(context) {
			return isPhaseActive(context);
		},


		syncFrame(input) {
			const frame = input && typeof input === "object" ? input : {};
			const plan = frame.plan;
			if (!isPhaseActive(frame) || !plan || !Array.isArray(plan.selected) || plan.selected.length === 0) {
				handBackToLegacyTerm();
				return false;
			}
			const selected = plan.selected;
			const count = Math.min(selected.length, LOCAL_VOLUMETRIC_MAX_LIGHTS);
			for (let index = 0; index < LOCAL_VOLUMETRIC_MAX_LIGHTS; index++) {
				if (index >= count) {
					clearSlot(index);
					continue;
				}
				const light = selected[index];
				positionRangeSlots[index].set(
					light.worldPosition.x,
					light.worldPosition.y,
					light.worldPosition.z,
					light.range,
				);

				colorScatteringSlots[index].set(
					light.color.red * light.intensity,
					light.color.green * light.intensity,
					light.color.blue * light.intensity,
					light.scatteringIntensity,
				);
				coneAxisSlots[index].set(
					light.coneAxis.x,
					light.coneAxis.y,
					light.coneAxis.z,
					light.isSpot ? 1 : 0,
				);
				coneCosinesSlots[index].set(light.cosOuter, light.cosInner, light.atlasMetaRow, 0);
			}
			countUniform.value = count;
			onUniform.value = 1;


			const atlasEnabledSlot = borrowedAtlasUniforms[ATLAS_UNIFORMS.enabled];
			const atlasGateOpen = atlasShadowing && !!atlasEnabledSlot && Number(atlasEnabledSlot.value) > 0;
			atlasOnUniform.value = atlasGateOpen ? 1 : 0;
			const camera = frame.camera;

			if (camera && camera.matrixWorldInverse) viewMatrixUniform.value.copy(camera.matrixWorldInverse);
			lastSelectedCount = count;
			lastStepCount = Number(plan.stepCount) || 0;
			lastRefusal = "";
			return true;
		},


		reset() {
			handBackToLegacyTerm();
			return true;
		},

		status(context) {
			const frame = context && typeof context === "object" ? context : {};
			const flagDecision = resolveLocalLightFlag(LOCAL_VOLUMETRIC_FLAG_ID, { tier: frame.tier });
			const baselineFrozen = isLocalLightBaselineFrozen(frame.tier);
			const technologyAllowed = isLocalLightTechnology(frame.technology);
			const status = {
				phase: LOCAL_VOLUMETRIC_PHASE_ID,
				flag: LOCAL_VOLUMETRIC_FLAG_ID,
				pass: LOCAL_VOLUMETRIC_PASS_ID,
				tier: frame.tier || null,
				technologyAllowed,
				flagOn: flagDecision.active,
				flagToken: flagDecision.token,
				flagSource: flagDecision.source,
				baselineFrozen,
				active: isPhaseActive(frame),
				marchRewritten: rewrite.ok,
				injections: rewrite.ok ? rewrite.injections : [],
				atlasShadowing,
				borrowedAtlasUniforms: borrowedAtlasSlotCount,
				marchingLights: lastSelectedCount,
				stepCount: lastStepCount,
				crossFade: onUniform.value,
				textureUnits: extension.textureUnits,
				refusal: lastRefusal,
				pending: !technologyAllowed
					? "Technology outside ShadowMap / Future keeps the legacy path byte for byte"
					: baselineFrozen
						? "LlBaseline is freezing the legacy path: release it for the phase to enter"
						: "Declared residuals: (a) a light with no atlas page reports row -1 and its shaft stays UNSHADED instead of wrongly black, which is the graceful fallback while LL-F10 does not cover every light; (b) only 8 lights march, the 9th is refused with out-of-light-budget; (c) only the SPOT has an angular gate here - the SHAPE of an area source inside the medium is LL-F19 work; (d) the frustum-and-range cull stands in for the real 16x9x24 cluster, which arrives with LL-F20 behind this same contract.",
			};
			llQa.setPhase(LOCAL_VOLUMETRIC_PHASE_ID, {
				flagOn: flagDecision.active,
				technologyAllowed,
				baselineFrozen,
				marchRewritten: rewrite.ok,
				atlasShadowing,
				marchingLights: lastSelectedCount,
				stepCount: lastStepCount,
				refusal: lastRefusal,
			});
			return status;
		},
	};

	llQa.setPhase(LOCAL_VOLUMETRIC_PHASE_ID, {
		registered: true,
		flag: LOCAL_VOLUMETRIC_FLAG_ID,
		pass: LOCAL_VOLUMETRIC_PASS_ID,
		uniforms: LOCAL_VOLUMETRIC_UNIFORM_NAMES,
		atlasShadowing,
		textureUnits: extension.textureUnits,
	});

	return extension;
}
