import { Body } from "./body.js";

export class SAPBroadphase {
  constructor(world) {
    this.world = world || null;
    this.sortedBodies = [];
    this.pairs = [];
    this.pairTuplePool = [];
  }


  sortBodiesByMinX(bodies) {
    const sorted = this.sortedBodies;
    const bodyCount = bodies.length;
    for (let i = 0; i < bodyCount; i++) sorted[i] = bodies[i];
    if (sorted.length > bodyCount) sorted.length = bodyCount;
    for (let i = 1; i < bodyCount; i++) {
      const current = sorted[i];
      const currentMinX = current.aabbMin.x;
      let previous = i - 1;
      while (previous >= 0 && sorted[previous].aabbMin.x > currentMinX) {
        sorted[previous + 1] = sorted[previous];
        previous--;
      }
      sorted[previous + 1] = current;
    }
    return sorted;
  }


  fillPairTuple(slotIndex, bodyA, bodyB) {
    let tuple = this.pairTuplePool[slotIndex];
    if (!tuple) {
      tuple = [bodyA, bodyB];
      this.pairTuplePool[slotIndex] = tuple;
      return tuple;
    }
    tuple[0] = bodyA;
    tuple[1] = bodyB;
    return tuple;
  }

  passesCollisionFilters(bodyA, bodyB) {
    if (bodyA.type !== Body.DYNAMIC && bodyB.type !== Body.DYNAMIC) return false;
    if ((bodyA.collisionFilterGroup & bodyB.collisionFilterMask) === 0) return false;
    if ((bodyB.collisionFilterGroup & bodyA.collisionFilterMask) === 0) return false;
    return true;
  }

  overlapsOnYAndZ(bodyA, bodyB) {
    if (bodyA.aabbMin.y > bodyB.aabbMax.y || bodyB.aabbMin.y > bodyA.aabbMax.y) return false;
    if (bodyA.aabbMin.z > bodyB.aabbMax.z || bodyB.aabbMin.z > bodyA.aabbMax.z) return false;
    return true;
  }

  collisionPairs(world) {
    const sorted = this.sortBodiesByMinX(world.bodies);
    const pairs = this.pairs;
    let pairCount = 0;
    for (let i = 0; i < sorted.length; i++) {
      const bodyA = sorted[i];
      const bodyAMaxX = bodyA.aabbMax.x;
      for (let j = i + 1; j < sorted.length; j++) {
        const bodyB = sorted[j];
        if (bodyB.aabbMin.x > bodyAMaxX) break;
        if (!this.passesCollisionFilters(bodyA, bodyB)) continue;
        if (!this.overlapsOnYAndZ(bodyA, bodyB)) continue;
        pairs[pairCount] = this.fillPairTuple(pairCount, bodyA, bodyB);
        pairCount++;
      }
    }
    if (pairs.length > pairCount) pairs.length = pairCount;
    return pairs;
  }
}
