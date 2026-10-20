import { SSM_CONTRACT_VERSION, SSM_RECIPE_VERSION, SSM_THREE_REVISION } from './ssmContract.js';
import { SSM_RELEASE_SCHEMA_VERSION } from './ssmReleaseContract.js';

export const SSM_RELEASE_MANIFEST = Object.freeze({
  schemaVersion: SSM_RELEASE_SCHEMA_VERSION,
  releaseId: 'ssm-f28-development-v1',
  revision: 1,
  status: 'development',
  contractVersion: SSM_CONTRACT_VERSION,
  recipeVersion: SSM_RECIPE_VERSION,
  threeRevision: SSM_THREE_REVISION,
  development: Object.freeze({
    channel: 'optIn',
    permittedProfiles: Object.freeze(['Lite', 'Moderate']),
    allowSoftwareRenderer: true,
  }),
  grants: Object.freeze([]),
});
