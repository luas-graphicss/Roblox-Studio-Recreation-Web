export function withSubstratePeelOrder(scene, captures, callback) {
  const changed = [];
  try {
    scene.traverseVisible(object => {
      changed.push([object, object.renderOrder]);
      object.renderOrder = object.material ? captures.region(object) : 0;
    });
    return callback();
  } finally { for (const [object, renderOrder] of changed) object.renderOrder = renderOrder; }
}
