import {
  MSM_COMPOSITE_MODES,
  MSM_COMPOSITE_MODE_INJECTION,
  MSM_SAMPLE_PASS_ID,
} from "./msmPipelineContract.js";
import { describeMsmTierPolicy } from "./msmTierPolicy.js";

export const MSM_WARMUP_PHASE_ID = "MSM-F32";


export const MSM_TRANSITION_FRAME_CEILING_MS = 250;


export const MSM_ATLAS_PAGES_PER_WARMUP_FRAME = 1;


export const MSM_DEFAULT_WARMUP_ATLAS_PAGE_COUNT = 1;


export const MSM_WARMUP_SLICE = Object.freeze({
  ALLOCATE_TARGETS: "allocate-targets",
  COMPILE_SAMPLE_PROGRAM: "compile-sample-program",
  BUILD_WORLD_GRID: "build-world-grid",
  OPEN_ATLAS_PAGE: "open-atlas-page",
  ENABLE_FORWARD_INJECTION: "enable-forward-injection",
});


export const MSM_WARMUP_SLICE_ORDER = Object.freeze([
  MSM_WARMUP_SLICE.ALLOCATE_TARGETS,
  MSM_WARMUP_SLICE.COMPILE_SAMPLE_PROGRAM,
  MSM_WARMUP_SLICE.BUILD_WORLD_GRID,
  MSM_WARMUP_SLICE.OPEN_ATLAS_PAGE,
  MSM_WARMUP_SLICE.ENABLE_FORWARD_INJECTION,
]);

export const MSM_WARMUP_DIRECTION = Object.freeze({ ON: "on", OFF: "off" });

export const MSM_TRANSITION_KIND = Object.freeze({
  IGNITE: "ignite",
  SHUTDOWN: "shutdown",
  TIER_CHANGE: "tier-change",
});

export const MSM_TRANSITION_KINDS = Object.freeze([
  MSM_TRANSITION_KIND.IGNITE,
  MSM_TRANSITION_KIND.SHUTDOWN,
  MSM_TRANSITION_KIND.TIER_CHANGE,
]);

export const MSM_SLICE_SKIP_REASON = Object.freeze({
  MODE_A_HAS_NO_MATERIAL_PATCH: "mode-a-has-no-material-patch",
  TIER_KEEPS_THE_PROGRAM: "tier-keeps-the-program",
  TIER_KEEPS_THE_ATLAS_PAGES: "tier-keeps-the-atlas-pages",
  TIER_KEEPS_THE_MATERIAL_PATCH: "tier-keeps-the-material-patch",
});

export const MSM_WARMUP_PLAN_REFUSAL = Object.freeze({
  NONE: "none",
  UNKNOWN_TRANSITION: "unknown-transition",
  UNKNOWN_COMPOSITE_MODE: "unknown-composite-mode",
  TIER_SLEEPS: "tier-sleeps",
});


const SLICE_COST = Object.freeze({
  ALLOCATION: "CPU allocation plus GPU texture creation",
  COMPILE: "shader compile and link of one program",
  GRID: "CPU rebuild of the world grid",
  ATLAS: "one atlas page drawn on the GPU",
  MATERIAL: "forward material patch and the recompile it triggers",
});

const SLICE_DESCRIPTORS = Object.freeze({
  [MSM_WARMUP_SLICE.ALLOCATE_TARGETS]: Object.freeze({
    slice: MSM_WARMUP_SLICE.ALLOCATE_TARGETS,
    cost: SLICE_COST.ALLOCATION,
    onLabel: "allocate the reduced resolution render targets of the three MSM passes",
    offLabel: "release the reduced resolution render targets",
    tierChangeLabel: "re-aim the reduced resolution viewport without recreating a texture",
    runsOnTierChange: true,
    skipReasonOnTierChange: "",
  }),
  [MSM_WARMUP_SLICE.COMPILE_SAMPLE_PROGRAM]: Object.freeze({
    slice: MSM_WARMUP_SLICE.COMPILE_SAMPLE_PROGRAM,
    cost: SLICE_COST.COMPILE,
    onLabel: "compile the sample pass program once (" + MSM_SAMPLE_PASS_ID + ")",
    offLabel: "drop the sample pass program",
    tierChangeLabel: "",
    runsOnTierChange: false,
    skipReasonOnTierChange: MSM_SLICE_SKIP_REASON.TIER_KEEPS_THE_PROGRAM,
  }),
  [MSM_WARMUP_SLICE.BUILD_WORLD_GRID]: Object.freeze({
    slice: MSM_WARMUP_SLICE.BUILD_WORLD_GRID,
    cost: SLICE_COST.GRID,
    onLabel: "build the world grid of the tier",
    offLabel: "drop the world grid",
    tierChangeLabel: "rebuild the world grid on the new ladder step",
    runsOnTierChange: true,
    skipReasonOnTierChange: "",
  }),
  [MSM_WARMUP_SLICE.OPEN_ATLAS_PAGE]: Object.freeze({
    slice: MSM_WARMUP_SLICE.OPEN_ATLAS_PAGE,
    cost: SLICE_COST.ATLAS,
    onLabel: "open one atlas page",
    offLabel: "release the atlas pages the MSM was holding",
    tierChangeLabel: "",
    runsOnTierChange: false,
    skipReasonOnTierChange: MSM_SLICE_SKIP_REASON.TIER_KEEPS_THE_ATLAS_PAGES,
  }),
  [MSM_WARMUP_SLICE.ENABLE_FORWARD_INJECTION]: Object.freeze({
    slice: MSM_WARMUP_SLICE.ENABLE_FORWARD_INJECTION,
    cost: SLICE_COST.MATERIAL,
    onLabel: "enable the irradiance injection in the forward materials",
    offLabel: "remove the irradiance injection from the forward materials",
    tierChangeLabel: "",
    runsOnTierChange: false,
    skipReasonOnTierChange: MSM_SLICE_SKIP_REASON.TIER_KEEPS_THE_MATERIAL_PATCH,
  }),
});


export function msmWarmupSliceDescriptor(slice) {
  return SLICE_DESCRIPTORS[slice] || null;
}

function readText(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function readTransition(value) {
  const text = readText(value);
  return MSM_TRANSITION_KINDS.indexOf(text) === -1 ? "" : text;
}

function readCompositeMode(value) {
  const text = typeof value === "string" ? value.trim().toUpperCase() : "";
  return MSM_COMPOSITE_MODES.indexOf(text) === -1 ? "" : text;
}

function resolveAtlasPageCount(requestedValue, policy) {
  const ceiling = policy && policy.atlasSlots >= 1 ? policy.atlasSlots : MSM_DEFAULT_WARMUP_ATLAS_PAGE_COUNT;
  const requested = Math.floor(Number(requestedValue));
  if (!(requested >= 1)) return { pageCount: MSM_DEFAULT_WARMUP_ATLAS_PAGE_COUNT, clampedFrom: 0 };
  if (requested > ceiling) return { pageCount: ceiling, clampedFrom: requested };
  return { pageCount: requested, clampedFrom: 0 };
}

function refusedPlan(fields) {
  return Object.freeze({
    phase: MSM_WARMUP_PHASE_ID,
    ok: false,
    transition: fields.transition,
    tier: fields.tier,
    compositeMode: fields.compositeMode,
    compositeModeAssumed: false,
    direction: "",
    ceilingMs: MSM_TRANSITION_FRAME_CEILING_MS,
    atlasPagesPerFrame: MSM_ATLAS_PAGES_PER_WARMUP_FRAME,
    atlasPageCount: 0,
    atlasPageCountClampedFrom: 0,
    steps: Object.freeze([]),
    frameCount: 0,
    skippedSlices: Object.freeze([]),
    refusal: fields.refusal,
    reason: fields.reason,
  });
}


export function planMsmWarmup(request) {
  const source = request && typeof request === "object" ? request : {};
  const transition = readTransition(source.transition);

  if (!transition) {
    return refusedPlan({
      transition: readText(source.transition),
      tier: readText(source.tier),
      compositeMode: "",
      refusal: MSM_WARMUP_PLAN_REFUSAL.UNKNOWN_TRANSITION,
      reason:
        'unknown transition "' +
        readText(source.transition) +
        '" - the MSM plans only ' +
        MSM_TRANSITION_KINDS.join(", "),
    });
  }

  const isShutdown = transition === MSM_TRANSITION_KIND.SHUTDOWN;
  const requestedMode = readCompositeMode(source.compositeMode);


  const compositeMode = requestedMode || (isShutdown ? MSM_COMPOSITE_MODE_INJECTION : "");
  const compositeModeAssumed = isShutdown && !requestedMode;

  if (!compositeMode) {
    return refusedPlan({
      transition,
      tier: readText(source.tier),
      compositeMode: "",
      refusal: MSM_WARMUP_PLAN_REFUSAL.UNKNOWN_COMPOSITE_MODE,
      reason:
        'unknown composite mode "' +
        (typeof source.compositeMode === "string" ? source.compositeMode : "") +
        '" - a transition that turns the MSM on needs mode ' +
        MSM_COMPOSITE_MODES.join(" or "),
    });
  }

  const tierDecision = describeMsmTierPolicy(source.tier);


  if (!isShutdown && !tierDecision.runs) {
    return refusedPlan({
      transition,
      tier: tierDecision.tier,
      compositeMode,
      refusal: MSM_WARMUP_PLAN_REFUSAL.TIER_SLEEPS,
      reason: tierDecision.reason,
    });
  }

  const usesMaterialPatch = compositeMode === MSM_COMPOSITE_MODE_INJECTION;
  const atlas = resolveAtlasPageCount(source.atlasPageCount, tierDecision.policy);
  const direction = isShutdown ? MSM_WARMUP_DIRECTION.OFF : MSM_WARMUP_DIRECTION.ON;
  const steps = [];
  const skippedSlices = [];

  const pushStep = (slice, description, pageOrdinal) => {
    const index = steps.length;
    steps.push(
      Object.freeze({
        index,
        stepKey: slice + "#" + index,
        slice,
        direction,
        ceilingMs: MSM_TRANSITION_FRAME_CEILING_MS,
        cost: SLICE_DESCRIPTORS[slice].cost,
        pageOrdinal: pageOrdinal >= 1 ? pageOrdinal : 0,
        description,
      }),
    );
  };

  const skipSlice = (slice, reason) => {
    skippedSlices.push(Object.freeze({ slice, reason }));
  };

  if (transition === MSM_TRANSITION_KIND.IGNITE) {
    pushStep(MSM_WARMUP_SLICE.ALLOCATE_TARGETS, SLICE_DESCRIPTORS[MSM_WARMUP_SLICE.ALLOCATE_TARGETS].onLabel, 0);
    pushStep(
      MSM_WARMUP_SLICE.COMPILE_SAMPLE_PROGRAM,
      SLICE_DESCRIPTORS[MSM_WARMUP_SLICE.COMPILE_SAMPLE_PROGRAM].onLabel,
      0,
    );
    pushStep(MSM_WARMUP_SLICE.BUILD_WORLD_GRID, SLICE_DESCRIPTORS[MSM_WARMUP_SLICE.BUILD_WORLD_GRID].onLabel, 0);
    for (let page = 1; atlas.pageCount >= page; page += 1) {
      pushStep(
        MSM_WARMUP_SLICE.OPEN_ATLAS_PAGE,
        "open atlas page " + page + " of " + atlas.pageCount + " (one page per frame)",
        page,
      );
    }
    if (usesMaterialPatch) {
      pushStep(
        MSM_WARMUP_SLICE.ENABLE_FORWARD_INJECTION,
        SLICE_DESCRIPTORS[MSM_WARMUP_SLICE.ENABLE_FORWARD_INJECTION].onLabel,
        0,
      );
    } else {
      skipSlice(MSM_WARMUP_SLICE.ENABLE_FORWARD_INJECTION, MSM_SLICE_SKIP_REASON.MODE_A_HAS_NO_MATERIAL_PATCH);
    }
  } else if (transition === MSM_TRANSITION_KIND.TIER_CHANGE) {


    pushStep(
      MSM_WARMUP_SLICE.ALLOCATE_TARGETS,
      SLICE_DESCRIPTORS[MSM_WARMUP_SLICE.ALLOCATE_TARGETS].tierChangeLabel,
      0,
    );
    skipSlice(MSM_WARMUP_SLICE.COMPILE_SAMPLE_PROGRAM, MSM_SLICE_SKIP_REASON.TIER_KEEPS_THE_PROGRAM);
    pushStep(MSM_WARMUP_SLICE.BUILD_WORLD_GRID, SLICE_DESCRIPTORS[MSM_WARMUP_SLICE.BUILD_WORLD_GRID].tierChangeLabel, 0);
    skipSlice(MSM_WARMUP_SLICE.OPEN_ATLAS_PAGE, MSM_SLICE_SKIP_REASON.TIER_KEEPS_THE_ATLAS_PAGES);
    skipSlice(MSM_WARMUP_SLICE.ENABLE_FORWARD_INJECTION, MSM_SLICE_SKIP_REASON.TIER_KEEPS_THE_MATERIAL_PATCH);
  } else {


    if (usesMaterialPatch) {
      pushStep(
        MSM_WARMUP_SLICE.ENABLE_FORWARD_INJECTION,
        SLICE_DESCRIPTORS[MSM_WARMUP_SLICE.ENABLE_FORWARD_INJECTION].offLabel,
        0,
      );
    } else {
      skipSlice(MSM_WARMUP_SLICE.ENABLE_FORWARD_INJECTION, MSM_SLICE_SKIP_REASON.MODE_A_HAS_NO_MATERIAL_PATCH);
    }
    pushStep(MSM_WARMUP_SLICE.OPEN_ATLAS_PAGE, SLICE_DESCRIPTORS[MSM_WARMUP_SLICE.OPEN_ATLAS_PAGE].offLabel, 0);
    pushStep(MSM_WARMUP_SLICE.BUILD_WORLD_GRID, SLICE_DESCRIPTORS[MSM_WARMUP_SLICE.BUILD_WORLD_GRID].offLabel, 0);
    pushStep(
      MSM_WARMUP_SLICE.COMPILE_SAMPLE_PROGRAM,
      SLICE_DESCRIPTORS[MSM_WARMUP_SLICE.COMPILE_SAMPLE_PROGRAM].offLabel,
      0,
    );
    pushStep(MSM_WARMUP_SLICE.ALLOCATE_TARGETS, SLICE_DESCRIPTORS[MSM_WARMUP_SLICE.ALLOCATE_TARGETS].offLabel, 0);
  }

  return Object.freeze({
    phase: MSM_WARMUP_PHASE_ID,
    ok: true,
    transition,
    tier: tierDecision.tier,
    compositeMode,
    compositeModeAssumed,
    direction,
    ceilingMs: MSM_TRANSITION_FRAME_CEILING_MS,
    atlasPagesPerFrame: MSM_ATLAS_PAGES_PER_WARMUP_FRAME,
    atlasPageCount: transition === MSM_TRANSITION_KIND.IGNITE ? atlas.pageCount : 0,
    atlasPageCountClampedFrom: transition === MSM_TRANSITION_KIND.IGNITE ? atlas.clampedFrom : 0,
    steps: Object.freeze(steps),
    frameCount: steps.length,
    skippedSlices: Object.freeze(skippedSlices),
    refusal: MSM_WARMUP_PLAN_REFUSAL.NONE,
    reason: "",
  });
}


export function validateMsmWarmupPlan(plan) {
  const problems = [];

  if (!plan || plan.ok !== true) {
    problems.push("plan was refused: " + (plan && plan.refusal ? plan.refusal : "no plan"));
    return { ok: false, problems };
  }

  const seenKeys = new Set();
  plan.steps.forEach((step, position) => {
    if (step.index !== position) problems.push("step out of sequence: " + step.stepKey);
    if (seenKeys.has(step.stepKey)) problems.push("repeated step key: " + step.stepKey);
    seenKeys.add(step.stepKey);
    if (step.ceilingMs !== MSM_TRANSITION_FRAME_CEILING_MS) problems.push("step with another ceiling: " + step.stepKey);
    if (step.direction !== plan.direction) problems.push("step against the plan direction: " + step.stepKey);
    if (!SLICE_DESCRIPTORS[step.slice]) problems.push("unknown slice: " + step.slice);
  });

  if (plan.frameCount !== plan.steps.length) problems.push("frameCount does not match the number of steps");

  const sliceSequence = plan.steps.map((step) => step.slice);
  const collapsed = sliceSequence.filter((slice, position) => position === 0 || sliceSequence[position - 1] !== slice);
  const canonicalOrder =
    plan.direction === MSM_WARMUP_DIRECTION.OFF ? MSM_WARMUP_SLICE_ORDER.slice().reverse() : MSM_WARMUP_SLICE_ORDER.slice();
  const expected = canonicalOrder.filter((slice) => collapsed.indexOf(slice) !== -1);
  if (expected.join(">") !== collapsed.join(">")) problems.push("slices out of the order of section 6.4");

  const atlasSteps = sliceSequence.filter((slice) => slice === MSM_WARMUP_SLICE.OPEN_ATLAS_PAGE).length;
  if (plan.direction === MSM_WARMUP_DIRECTION.ON && atlasSteps !== plan.atlasPageCount) {
    problems.push("atlas pages do not match the frames that open them");
  }

  return { ok: problems.length === 0, problems };
}


export function describeMsmWarmupPlan(plan) {
  if (!plan || plan.ok !== true) {
    return MSM_WARMUP_PHASE_ID + " refused the plan: " + (plan && plan.reason ? plan.reason : "no plan");
  }
  return (
    MSM_WARMUP_PHASE_ID +
    " " +
    plan.transition +
    " on tier " +
    plan.tier +
    " in mode " +
    plan.compositeMode +
    ": " +
    plan.frameCount +
    " frames, at most " +
    plan.ceilingMs +
    " ms each"
  );
}
