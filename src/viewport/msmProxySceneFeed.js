import { createMsmProxyBoxCollector, collectMsmProxyBoxes } from '../lighting/megalightsSm/msmProxyCollectCore.js';
import { decideMsmProxyOcclusion } from '../lighting/megalightsSm/msmProxyVetoPolicyCore.js';

export function createMsmProxySceneFeed({ THREE, scene, camera }) {
  const collector = createMsmProxyBoxCollector();
  const bounds = new THREE.Box3(), center = new THREE.Vector3(), size = new THREE.Vector3();
  const instance = new THREE.Matrix4(), world = new THREE.Matrix4(), anchor = new THREE.Vector3();
  const candidates = [];
  let previousTier = '';
  let rebuilds = 0;
  let vetoReason = 'not-collected';
  function append(object, matrix, id) {
    bounds.copy(object.geometry.boundingBox).applyMatrix4(matrix);
    bounds.getCenter(center); bounds.getSize(size).multiplyScalar(0.5);
    candidates.push({ id, center: center.toArray(), halfExtent: size.toArray() });
  }
  function update({ tier, enabled, dirty, override }) {
    const decision = decideMsmProxyOcclusion({ tier, isEnabledByFlag: enabled });
    vetoReason = decision.vetoReason;
    if (!decision.runsProxyOcclusion) {
      collector.filledSlotCount = 0;
      previousTier = '';
      return collector;
    }
    if (!dirty && previousTier === tier && !override) return collector;
    candidates.length = 0;
    if (Array.isArray(override)) candidates.push(...override);
    else scene?.traverseVisible(object => {
      if (!object.isMesh || !object.castShadow || object.geometry?.type !== 'BoxGeometry') return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      if (materials.some(material => !material || material.transparent || material.alphaTest > 0)) return;
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      if (!object.geometry.boundingBox) return;
      if (object.isInstancedMesh) {
        for (let index = 0; index < object.count; index += 1) {
          object.getMatrixAt(index, instance); world.multiplyMatrices(object.matrixWorld, instance);
          append(object, world, object.uuid + ':' + index);
        }
      } else append(object, object.matrixWorld, object.uuid);
    });
    camera.getWorldPosition(anchor);
    collectMsmProxyBoxes(collector, candidates, anchor.toArray(), { tier });
    previousTier = tier;
    rebuilds += 1;
    return collector;
  }
  return { update, describe: () => ({ count: collector.filledSlotCount, rebuilds, vetoReason,
    considered: collector.consideredCandidateCount, refused: collector.refusedCandidateCount }) };
}
