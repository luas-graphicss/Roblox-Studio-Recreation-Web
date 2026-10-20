import { createSubstrateSmOperatorPlan } from './ssmOperatorPlanCore.js';
import { reduceSubstrateSmOperators } from './ssmOperatorReductionCore.js';
import { evaluateSubstrateSmLayerTransmission } from './ssmLayerReductionCore.js';
import { copySubstrateSmImmutableData } from './ssmImmutableData.js';
import { createSubstrateSmLossEntry } from './ssmLossReportCore.js';
import { createSubstrateSmCompilationRefusal } from './ssmValidationCore.js';
import {
  SSM_COAT_VERSION,
  SSM_COAT_F0,
  SSM_COAT_F90,
  SSM_COAT_RESOURCES,
  SSM_COAT_LIMITATIONS,
} from './ssmCoatContract.js';

function refuse(sourcePath, code, reason, losses = []) {
  return copySubstrateSmImmutableData({
    ok: false,
    surface: null,
    losses,
    refusals: [createSubstrateSmCompilationRefusal(code, sourcePath, reason)],
    diagnostics: null,
  });
}

function findCoatInterfaceProblem(parameters) {
  if (parameters.diffuseReflectance.some((value) => value !== 0))
    return 'The coat cannot contain an additional diffuse lobe';
  if (parameters.emissiveRadiance.some((value) => value !== 0))
    return 'Emissive top layers require a separate emission model';
  if (
    parameters.specularF90 !== SSM_COAT_F90 ||
    parameters.specularF0.some((value) => Math.abs(value - SSM_COAT_F0) > 1e-12)
  ) {
    return 'The analytical coat requires achromatic F0 0.04 and F90 1; arbitrary interfaces require an explicit optical reduction';
  }
  return null;
}

function reduceCoatOperators(request) {
  const root = request?.root;
  if (
    request?.profile !== 'Moderate' ||
    root?.operator !== 'verticalLayering' ||
    root?.parameters?.coverage === 0
  ) {
    return reduceSubstrateSmOperators(request);
  }
  const sourcePath = typeof root.path === 'string' ? root.path : 'root';
  if (
    !Array.isArray(root.children) ||
    root.children.length !== 2 ||
    Array.from(root.children).some((child) => child?.type !== 'bsdf' || child.bsdf !== 'slab')
  ) {
    return refuse(
      sourcePath,
      'SSM_COAT_TOPOLOGY',
      'Coat Moderate preserves exactly one top slab over one base slab; compound layers require explicit F06 reduction',
    );
  }
  for (const [index, child] of root.children.entries()) {
    if ((child.parameters?.specularProfileIndex ?? 0) !== 0) {
      return refuse(
        child.path ?? `${sourcePath}/${index}`,
        'SSM_COAT_PROFILE',
        'A nonneutral specular profile cannot be discarded by coat compilation',
      );
    }
  }
  let prepared;
  try {
    prepared = createSubstrateSmOperatorPlan(request);
  } catch {
    return refuse(
      sourcePath,
      'SSM_COAT_SOURCE',
      'Coat compilation requires a validated resolved tree and synchronous slab resolver',
    );
  }
  if (!prepared.ok)
    return copySubstrateSmImmutableData({
      ok: false,
      surface: null,
      losses: prepared.losses,
      refusals: prepared.refusals,
      diagnostics: null,
    });
  const plan = prepared.plan;
  if (plan.kind !== 'verticalLayering' || plan.children.some((child) => child.kind !== 'slab')) {
    return refuse(
      sourcePath,
      'SSM_COAT_TOPOLOGY',
      'The prepared optical plan is not one coat over one base',
    );
  }
  const top = plan.children[0].surface.parameters;
  const bottom = plan.children[1].surface.parameters;
  const problem = findCoatInterfaceProblem(top);
  if (problem)
    return refuse(
      plan.children[0].sourcePath,
      'SSM_COAT_INTERFACE',
      problem,
      prepared.losses.filter(
        (loss) =>
          loss.sourcePath !== sourcePath ||
          !['verticalLayering', 'layerTransport'].includes(loss.operation),
      ),
    );
  const transmission = evaluateSubstrateSmLayerTransmission({
    ...plan.parameters,
    specularF0: top.specularF0,
    specularF90: top.specularF90,
    lightCosine: 1,
    viewCosine: 1,
  });
  const losses = prepared.losses.filter(
    (loss) =>
      loss.sourcePath !== sourcePath ||
      !['verticalLayering', 'layerTransport'].includes(loss.operation),
  );
  losses.push(
    createSubstrateSmLossEntry({
      sourcePath,
      operation: 'verticalLayering',
      replacement: 'moderateAnalyticalCoat',
      reason:
        'The bounded F06 shared-normal single-scatter response is retained as two GGX terms with round-trip base absorption and outgoing-only emission transmission; this is not full multilayer transport',
      classification: 'exact',
      evidenceStatus: 'analytical',
    }),
  );
  return copySubstrateSmImmutableData({
    ok: true,
    surface: {
      family: 'coat',
      parameters: {
        ...bottom,
        coverage: plan.parameters.coverage,
        extinctionCoefficient: transmission.extinctionCoefficient,
        layerThickness: plan.parameters.thickness,
        extensionWeight: 1,
        extensionRoughness: top.perceptualRoughness,
      },
    },
    losses,
    refusals: [],
    diagnostics: {
      method: 'analytical-coat-over-base',
      reductionVersion: SSM_COAT_VERSION,
      sourcePaths: prepared.sourcePaths,
      sourceNodeCount: prepared.nodeCount,
      resources: SSM_COAT_RESOURCES,
      limitations: SSM_COAT_LIMITATIONS,
      reflectionRoughness: {
        value: bottom.reflectionRoughness,
        policy: 'base-retained',
        twoLayerReflectionError: null,
      },
      omittedTransport: {
        roughInterLayerRefraction: { evidenceStatus: 'unmeasured', measuredLoss: null },
        multipleScattering: { evidenceStatus: 'unmeasured', measuredLoss: null },
      },
      engineIntegrated: false,
      gpuVerified: false,
    },
  });
}

export function reduceSubstrateSmCoatOperators(request = {}) {
  try {
    return reduceCoatOperators(request);
  } catch {
    return refuse(
      'root',
      'SSM_COAT_SOURCE',
      'Coat compilation requires a validated resolved tree and synchronous slab resolver',
    );
  }
}
