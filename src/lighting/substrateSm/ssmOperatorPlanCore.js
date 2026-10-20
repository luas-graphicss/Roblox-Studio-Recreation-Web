import { evaluateSubstrateSmLayerTransmission } from "./ssmLayerReductionCore.js";
import {
  copySubstrateSmReductionValue,
  createSubstrateSmReductionLoss,
  createSubstrateSmReductionRefusal,
  findSubstrateSmReductionSurfaceProblem,
  isSubstrateSmFiniteColor,
  isSubstrateSmFiniteScalar,
} from "./ssmReductionValidationCore.js";

const SSM_OPERATOR_ARITY = Object.freeze({ add: 2, weight: 1, horizontalMixing: 2, verticalLayering: 2 });
const SSM_OPERATOR_FIELDS = Object.freeze({
  add: [],
  weight: ["weight"],
  horizontalMixing: ["weight"],
  verticalLayering: ["coverage", "thickness", "transmittanceColor"],
});
const SSM_REDUCTION_WALK_LIMIT = 64;
const SSM_REDUCTION_NODE_LIMIT = 255;

function mixColor(first, second, firstWeight, secondWeight) {
  return first.map((channel, index) => channel * firstWeight + second[index] * secondWeight);
}

function responseImportance(parameters) {
  return (
    parameters.diffuseReflectance.reduce((sum, value) => sum + value, 0) +
    parameters.specularF0.reduce((sum, value) => sum + value, 0) +
    parameters.specularF90 * 0.05
  );
}

function combineSeeds(first, second, firstWeight, secondWeight) {
  const parameters = copySubstrateSmReductionValue(first.parameters);
  for (const name of ["diffuseReflectance", "specularF0", "emissiveRadiance"]) {
    parameters[name] = mixColor(first.parameters[name], second.parameters[name], firstWeight, secondWeight);
  }
  parameters.specularF90 =
    first.parameters.specularF90 * firstWeight + second.parameters.specularF90 * secondWeight;
  const firstImportance = firstWeight * responseImportance(first.parameters);
  const secondImportance = secondWeight * responseImportance(second.parameters);
  const importance = firstImportance + secondImportance;
  parameters.perceptualRoughness =
    importance > 0
      ? ((firstImportance * first.parameters.perceptualRoughness ** 4 +
          secondImportance * second.parameters.perceptualRoughness ** 4) /
          importance) **
        0.25
      : first.parameters.perceptualRoughness;
  parameters.reflectionRoughness = parameters.perceptualRoughness;
  return { family: "base", parameters };
}

function scaleSeed(surface, weight) {
  const scaled = copySubstrateSmReductionValue(surface);
  for (const name of ["diffuseReflectance", "specularF0", "emissiveRadiance"]) {
    scaled.parameters[name] = scaled.parameters[name].map((channel) => channel * weight);
  }
  scaled.parameters.specularF90 *= weight;
  return scaled;
}

function createLayerSeed(top, bottom, parameters) {
  const transmission = evaluateSubstrateSmLayerTransmission({
    ...parameters,
    specularF0: top.parameters.specularF0,
    specularF90: top.parameters.specularF90,
    lightCosine: 1,
    viewCosine: 1,
  });
  const attenuatedBottom = copySubstrateSmReductionValue(bottom);
  for (const name of ["diffuseReflectance", "specularF0"]) {
    attenuatedBottom.parameters[name] = bottom.parameters[name].map(
      (value, channel) => value * transmission.baseTransmission[channel],
    );
  }
  attenuatedBottom.parameters.emissiveRadiance = bottom.parameters.emissiveRadiance.map(
    (value, channel) => value * transmission.emissionTransmission[channel],
  );
  const grazingTransmission = evaluateSubstrateSmLayerTransmission({
    ...parameters,
    specularF0: top.parameters.specularF0,
    specularF90: top.parameters.specularF90,
    lightCosine: 0,
    viewCosine: 0,
  });
  attenuatedBottom.parameters.specularF90 *=
    grazingTransmission.baseTransmission.reduce((sum, value) => sum + value, 0) / 3;
  return combineSeeds(top, attenuatedBottom, parameters.coverage, 1);
}

function operatorParameterProblem(operator, parameters) {
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters))
    return "Operator parameters must be a resolved object";
  if (Object.keys(parameters).some((name) => !SSM_OPERATOR_FIELDS[operator].includes(name)))
    return "Unknown or dynamic operator parameters need an owning phase";
  if (operator === "weight" || operator === "horizontalMixing") {
    return isSubstrateSmFiniteScalar(parameters.weight)
      ? null
      : "Operator weight must be an explicit finite value in [0, 1]";
  }
  if (operator === "verticalLayering") {
    if (!isSubstrateSmFiniteScalar(parameters.coverage))
      return "Coverage must be an explicit finite value in [0, 1]";
    if (!isSubstrateSmFiniteScalar(parameters.thickness, 0, Number.MAX_VALUE))
      return "Thickness must be finite and nonnegative in normalized source units";
    if (!isSubstrateSmFiniteColor(parameters.transmittanceColor))
      return "Transmittance must contain three linear channels in [0, 1]";
  }
  return null;
}

function sameSpecularShape(first, second) {
  return (
    first.perceptualRoughness === second.perceptualRoughness &&
    first.specularF90 === second.specularF90 &&
    first.specularF0.every((channel, index) => channel === second.specularF0[index])
  );
}

function foldExactOperator(kind, parameters, children) {
  if (kind === "weight" && parameters.weight === 1) return children[0];
  if (kind === "weight" && parameters.weight === 0) {
    const surface = scaleSeed(children[0].seed, 0);
    return { kind: "slab", surface, seed: surface, sourcePath: children[0].sourcePath };
  }
  if (kind === "horizontalMixing" && parameters.weight === 0) return children[0];
  if (kind === "horizontalMixing" && parameters.weight === 1) return children[1];
  if (kind === "verticalLayering" && parameters.coverage === 0) return children[1];
  if (
    kind === "horizontalMixing" &&
    children.every((child) => child.kind === "slab") &&
    sameSpecularShape(children[0].seed.parameters, children[1].seed.parameters)
  ) {
    const surface = combineSeeds(
      children[0].seed,
      children[1].seed,
      1 - parameters.weight,
      parameters.weight,
    );
    surface.parameters.perceptualRoughness = children[0].seed.parameters.perceptualRoughness;
    surface.parameters.reflectionRoughness = surface.parameters.perceptualRoughness;
    return { kind: "slab", surface, seed: surface, sourcePath: children[0].sourcePath };
  }
  return null;
}

export function createSubstrateSmOperatorPlan({ root, resolveSlab, profile }) {
  const losses = [];
  const refusals = [];
  const ancestors = new Set();
  const roughnessCandidates = new Set();
  const sourcePaths = [];
  let nodeCount = 0;
  let containsLayer = false;
  let containsAdd = false;

  function refuse(code, sourcePath, reason) {
    refusals.push(createSubstrateSmReductionRefusal(code, sourcePath, reason));
    return null;
  }

  function excludeInactiveLosses(prefix) {
    for (let index = 0; index < losses.length; index += 1) {
      if (losses[index].sourcePath !== prefix && !losses[index].sourcePath.startsWith(`${prefix}/`)) continue;
      losses[index] = {
        ...losses[index],
        classification: "exact",
        replacement: "Inactive contribution removed by an outer operator identity",
        reason: "This validated source branch has exactly zero influence on the resolved response",
        estimatedLoss: 0,
        measuredLoss: null,
        evidenceStatus: "analytical",
      };
    }
  }

  function visit(node, fallbackPath, depth) {
    const sourcePath = typeof node?.path === "string" ? node.path : fallbackPath;
    if (node?.path !== undefined && (typeof node.path !== "string" || !/^root(?:\/[01])*$/.test(node.path)))
      return refuse(
        "SSM_REDUCTION_SOURCE_PATH",
        fallbackPath,
        "Resolved source paths must retain their canonical root/child form",
      );
    nodeCount += 1;
    sourcePaths.push(sourcePath);
    if (depth > SSM_REDUCTION_WALK_LIMIT || nodeCount > SSM_REDUCTION_NODE_LIMIT)
      return refuse("SSM_REDUCTION_LIMIT", sourcePath, "Reduction walk exceeded its safety bound");
    if (!node || typeof node !== "object" || Array.isArray(node))
      return refuse("SSM_REDUCTION_INVALID_NODE", sourcePath, "A resolved material node is required");
    if (ancestors.has(node))
      return refuse("SSM_REDUCTION_CYCLE", sourcePath, "Material source contains an ancestor cycle");
    if (node.type === "bsdf") {
      if (node.bsdf !== "slab")
        return refuse("SSM_REDUCTION_DOMAIN", sourcePath, "Only resolved opaque slabs belong to SSM-F06");
      const resolved = resolveSlab(node, { profile });
      if (
        !resolved ||
        !Array.isArray(resolved.losses) ||
        !Array.isArray(resolved.refusals) ||
        resolved.losses.some(
          (loss) =>
            !loss ||
            typeof loss !== "object" ||
            typeof loss.sourcePath !== "string" ||
            !["exact", "fitted", "baked", "unsupported", "budgetFallback"].includes(loss.classification),
        ) ||
        resolved.refusals.some(
          (refusal) => !refusal || typeof refusal !== "object" || typeof refusal.reason !== "string",
        )
      ) {
        return refuse(
          "SSM_REDUCTION_RESOLVER_ENVELOPE",
          sourcePath,
          "The slab resolver must return explicit structured losses and refusals",
        );
      }
      if (resolved.ok !== true || resolved.refusals.length > 0) {
        if (Array.isArray(resolved?.losses)) losses.push(...copySubstrateSmReductionValue(resolved.losses));
        if (Array.isArray(resolved?.refusals) && resolved.refusals.length)
          refusals.push(...copySubstrateSmReductionValue(resolved.refusals));
        else refuse("SSM_REDUCTION_SLAB_REFUSED", sourcePath, "The source adapter refused this slab");
        return null;
      }
      const problem = findSubstrateSmReductionSurfaceProblem(resolved.surface);
      if (problem) return refuse("SSM_REDUCTION_SURFACE", sourcePath, problem);
      if (Array.isArray(resolved.losses)) losses.push(...copySubstrateSmReductionValue(resolved.losses));
      const surface = copySubstrateSmReductionValue(resolved.surface);
      roughnessCandidates.add(surface.parameters.perceptualRoughness);
      return { kind: "slab", surface, seed: surface, sourcePath };
    }
    if (node.type !== "operator" || !Object.hasOwn(SSM_OPERATOR_ARITY, node.operator))
      return refuse("SSM_REDUCTION_OPERATOR", sourcePath, "Unknown material operator");
    if (!Array.isArray(node.children) || node.children.length !== SSM_OPERATOR_ARITY[node.operator])
      return refuse("SSM_REDUCTION_ARITY", sourcePath, "Operator arity does not match the canonical source");
    const problem = operatorParameterProblem(node.operator, node.parameters);
    if (problem) return refuse("SSM_REDUCTION_PARAMETERS", sourcePath, problem);
    ancestors.add(node);
    const children = Array.from(node.children, (child, index) =>
      visit(child, `${sourcePath}/${index}`, depth + 1),
    );
    ancestors.delete(node);
    if (children.some((child) => child === null)) return null;
    const parameters = copySubstrateSmReductionValue(node.parameters);
    const folded = foldExactOperator(node.operator, parameters, children);
    if (folded) {
      if (node.operator === "weight" && parameters.weight === 0) excludeInactiveLosses(`${sourcePath}/0`);
      if (node.operator === "horizontalMixing" && parameters.weight === 0)
        excludeInactiveLosses(`${sourcePath}/1`);
      if (node.operator === "horizontalMixing" && parameters.weight === 1)
        excludeInactiveLosses(`${sourcePath}/0`);
      if (node.operator === "verticalLayering" && parameters.coverage === 0)
        excludeInactiveLosses(`${sourcePath}/0`);
      losses.push({
        ...createSubstrateSmReductionLoss(
          sourcePath,
          node.operator,
          "exact",
          "Operator identity is preserved without optical fitting",
          0,
        ),
        evidenceStatus: "analytical",
      });
      return folded;
    }
    if (node.operator === "verticalLayering" && children[0].kind !== "slab")
      return refuse(
        "SSM_REDUCTION_LAYER_INTERFACE",
        sourcePath,
        "A composed top interface requires a calibrated layer model",
      );
    let seed;
    if (node.operator === "weight") seed = scaleSeed(children[0].seed, parameters.weight);
    else if (node.operator === "horizontalMixing")
      seed = combineSeeds(children[0].seed, children[1].seed, 1 - parameters.weight, parameters.weight);
    else if (node.operator === "add") seed = combineSeeds(children[0].seed, children[1].seed, 1, 1);
    else seed = createLayerSeed(children[0].seed, children[1].seed, parameters);
    containsLayer ||= node.operator === "verticalLayering";
    containsAdd ||= node.operator === "add";
    losses.push(
      createSubstrateSmReductionLoss(
        sourcePath,
        node.operator,
        "fitted",
        "One base response is fitted to the complete operator response; no authored weight is normalized",
      ),
    );
    if (node.operator === "verticalLayering") {
      losses.push(
        createSubstrateSmReductionLoss(
          sourcePath,
          "layerTransport",
          "fitted",
          "Lite removes the separate coat highlight and rough inter-layer refraction; optical thickness is normalized, not meters or studs",
        ),
      );
    }
    return { kind: node.operator, parameters, children, seed, sourcePath };
  }

  if (typeof resolveSlab !== "function")
    return {
      ok: false,
      plan: null,
      losses,
      refusals: [
        createSubstrateSmReductionRefusal(
          "SSM_REDUCTION_RESOLVER",
          "root",
          "A source-owned slab resolver is required",
        ),
      ],
    };
  const plan = visit(root, "root", 1);
  return {
    ok: plan !== null && refusals.length === 0,
    plan,
    losses,
    refusals,
    roughnessCandidates: [...roughnessCandidates].sort((first, second) => first - second),
    containsLayer,
    containsAdd,
    nodeCount,
    sourcePaths,
  };
}
