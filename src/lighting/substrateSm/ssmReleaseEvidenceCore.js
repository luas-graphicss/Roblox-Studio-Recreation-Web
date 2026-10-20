import { SSM_HOST_PATH_MATRIX, SSM_PROFILES } from './ssmContract.js';
import { serializeSubstrateSmKeyDescriptor } from './ssmKeySerialization.js';
import {
  SSM_RELEASE_SCHEMA_VERSION, SSM_RELEASE_TARGET_FIELDS, SSM_RELEASE_DIGEST_FIELDS,
  SSM_RELEASE_EVIDENCE_PHASES, SSM_RELEASE_REQUIRED_GATES, SSM_RELEASE_ROLLBACK_CHECKS,
} from './ssmReleaseContract.js';

export function isSubstrateSmReleaseDigest(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

export function isSubstrateSmReleaseLabel(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
}

export function getSubstrateSmReleaseTargetSignature(target) {
  if (!target || typeof target !== 'object' || Array.isArray(target)) return null;
  if (Object.keys(target).length !== SSM_RELEASE_TARGET_FIELDS.length) return null;
  const snapshot = {};
  for (const field of SSM_RELEASE_TARGET_FIELDS) {
    const descriptor = Object.getOwnPropertyDescriptor(target, field);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
    snapshot[field] = descriptor.value;
  }
  if (!SSM_RELEASE_DIGEST_FIELDS.every(field => isSubstrateSmReleaseDigest(snapshot[field]))) return null;
  const profile = typeof snapshot.profile === 'string' && Object.hasOwn(SSM_PROFILES, snapshot.profile)
    ? SSM_PROFILES[snapshot.profile] : null;
  if (!profile?.families.includes(snapshot.family)) return null;
  if (typeof snapshot.materialPath !== 'string' || !Object.hasOwn(SSM_HOST_PATH_MATRIX, snapshot.materialPath)
    || !SSM_HOST_PATH_MATRIX[snapshot.materialPath].eligible) return null;
  if (!['OFF', 'A', 'B'].includes(snapshot.msmMode)) return null;
  return serializeSubstrateSmKeyDescriptor(snapshot);
}

function validateReceipt(kind, receipt, targetSignature, family) {
  const prefix = `SSM_RELEASE_${kind.toUpperCase()}`;
  if (!receipt || receipt.schemaVersion !== SSM_RELEASE_SCHEMA_VERSION
    || receipt.phase !== SSM_RELEASE_EVIDENCE_PHASES[kind]) return `${prefix}_MISSING`;
  if (receipt.status !== 'passed' || receipt.certified !== true || receipt.scope !== 'engine-host') {
    return `${prefix}_UNCERTIFIED`;
  }
  if (!Array.isArray(receipt.blockers) || receipt.blockers.length !== 0) return `${prefix}_BLOCKED`;
  if (getSubstrateSmReleaseTargetSignature(receipt.target) !== targetSignature) return `${prefix}_STALE`;
  if (!isSubstrateSmReleaseLabel(receipt.artifact?.path)
    || !isSubstrateSmReleaseDigest(receipt.artifact.sha256)) return `${prefix}_ARTIFACT_REQUIRED`;
  for (const gate of SSM_RELEASE_REQUIRED_GATES[kind]) {
    if (receipt.gates?.[gate] !== 'passed') return `${prefix}_${gate}_REQUIRED`;
  }
  if (kind === 'optical' && family === 'coat' && receipt.gates?.G07 !== 'passed') return `${prefix}_G07_REQUIRED`;
  if (kind === 'optical' && (receipt.referenceEquivalent !== true || receipt.humanReview?.decision !== 'approved'
    || !isSubstrateSmReleaseLabel(receipt.humanReview.reviewId))) return `${prefix}_REFERENCE_REVIEW_REQUIRED`;
  if (kind === 'performance' && (receipt.hardwareClass !== 'physical' || receipt.softwareRenderer !== false)) {
    return `${prefix}_PHYSICAL_GPU_REQUIRED`;
  }
  if (kind === 'rollback') {
    for (const check of SSM_RELEASE_ROLLBACK_CHECKS) {
      if (receipt.checks?.[check] !== 'passed') return `${prefix}_${check.toUpperCase()}_REQUIRED`;
    }
  }
  return null;
}

export function evaluateSubstrateSmReleaseGrant(grant, manifest) {
  const blockers = [];
  const targetSignature = getSubstrateSmReleaseTargetSignature(grant?.target);
  if (!targetSignature) blockers.push('SSM_RELEASE_TARGET_INVALID');
  if (!isSubstrateSmReleaseLabel(grant?.id)) blockers.push('SSM_RELEASE_GRANT_ID_INVALID');
  const channels = grant?.channels;
  if (!Array.isArray(channels) || channels.length === 0 || channels.length > 2
    || new Set(channels).size !== channels.length || channels.some(channel => !['optIn', 'auto'].includes(channel))) {
    blockers.push('SSM_RELEASE_CHANNEL_INVALID');
  }
  if (Array.isArray(channels) && channels.includes('auto') && grant?.target?.profile !== 'Lite') blockers.push('SSM_RELEASE_AUTO_LITE_ONLY');
  for (const kind of Object.keys(SSM_RELEASE_EVIDENCE_PHASES)) {
    const blocker = validateReceipt(kind, grant?.evidence?.[kind], targetSignature, grant?.target?.family);
    if (blocker) blockers.push(blocker);
  }
  const review = grant?.review;
  if (review?.decision !== 'approved' || review.reviewerRole !== 'Integrador Revisor'
    || !isSubstrateSmReleaseLabel(review.reviewer) || !isSubstrateSmReleaseLabel(review.reviewId)) {
    blockers.push('SSM_RELEASE_REVIEW_REQUIRED');
  } else {
    if (review.releaseId !== manifest.releaseId || review.revision !== manifest.revision
      || review.grantId !== grant.id || review.targetSignature !== targetSignature
      || !Array.isArray(review.channels) || !Array.isArray(channels)
      || serializeSubstrateSmKeyDescriptor([...review.channels].sort()) !== serializeSubstrateSmKeyDescriptor([...channels].sort())) {
      blockers.push('SSM_RELEASE_REVIEW_STALE');
    }
    for (const kind of Object.keys(SSM_RELEASE_EVIDENCE_PHASES)) {
      const digest = grant.evidence?.[kind]?.artifact?.sha256;
      if (!isSubstrateSmReleaseDigest(digest) || review.evidenceDigests?.[kind] !== digest) {
        blockers.push(`SSM_RELEASE_REVIEW_${kind.toUpperCase()}_MISMATCH`);
      }
    }
  }
  return Object.freeze({
    eligible: blockers.length === 0,
    targetSignature,
    blockers: Object.freeze(blockers),
  });
}
