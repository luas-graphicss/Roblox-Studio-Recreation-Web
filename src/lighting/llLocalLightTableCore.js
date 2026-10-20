export const AREA_LIGHT_SLOT_SIZE = 4;


export const MAX_AREA_LIGHTS = 32;


export function collectLocalLightsAndRectAreaLightsInRenderOrder(root) {
  const pointLights = [];
  const spotLights = [];
  const rectAreaLights = [];
  visitInRenderOrder(root, pointLights, spotLights, rectAreaLights);
  return { pointLights, spotLights, rectAreaLights };
}

export function collectLocalLightsInRenderOrder(root) {
  const collected = collectLocalLightsAndRectAreaLightsInRenderOrder(root);
  return { pointLights: collected.pointLights, spotLights: collected.spotLights };
}


export function collectRectAreaLightsInRenderOrder(root) {
  return collectLocalLightsAndRectAreaLightsInRenderOrder(root).rectAreaLights;
}


function visitInRenderOrder(root, pointLights, spotLights, rectAreaLights) {
  if (!root || root.visible === false) return;
  const pending = [root];
  while (pending.length > 0) {
    const object = pending.pop();
    if (object.isPointLight === true) pointLights.push(object);
    else if (object.isSpotLight === true) spotLights.push(object);
    else if (object.isRectAreaLight === true) rectAreaLights.push(object);
    const children = object.children;
    if (!children) continue;
    for (let index = children.length; index > 0; index -= 1) {
      const child = children[index - 1];
      if (child && child.visible !== false) pending.push(child);
    }
  }
}


export function createAreaLightBuffer(lightCount) {
  return new Float32Array(Math.max(lightCount, 0) * AREA_LIGHT_SLOT_SIZE);
}

export function writeAreaLightShape(buffer, slotIndex, shape) {
  const offset = slotIndex * AREA_LIGHT_SLOT_SIZE;
  if (offset + AREA_LIGHT_SLOT_SIZE > buffer.length) return false;
  buffer[offset] = shape.sourceRadius;
  buffer[offset + 1] = shape.halfSourceLength;
  buffer[offset + 2] = shape.specularScale;
  buffer[offset + 3] = shape.enabled ? 1 : 0;
  return true;
}

export function writeAreaLightAxis(buffer, slotIndex, axis) {
  const offset = slotIndex * AREA_LIGHT_SLOT_SIZE;
  if (offset + AREA_LIGHT_SLOT_SIZE > buffer.length) return false;
  buffer[offset] = axis[0];
  buffer[offset + 1] = axis[1];
  buffer[offset + 2] = axis[2];
  buffer[offset + 3] = 0;
  return true;
}

export function readAreaLightSlot(buffer, slotIndex) {
  const offset = slotIndex * AREA_LIGHT_SLOT_SIZE;
  return [buffer[offset], buffer[offset + 1], buffer[offset + 2], buffer[offset + 3]];
}


export function readMatrixAxisY(matrixElements) {
  const x = matrixElements[4];
  const y = matrixElements[5];
  const z = matrixElements[6];
  const length = Math.max(Math.sqrt(x * x + y * y + z * z), 1e-6);
  return [x / length, y / length, z / length];
}


export function transformDirectionByMatrix(direction, matrixElements) {
  const x = direction[0];
  const y = direction[1];
  const z = direction[2];
  const outX = matrixElements[0] * x + matrixElements[4] * y + matrixElements[8] * z;
  const outY = matrixElements[1] * x + matrixElements[5] * y + matrixElements[9] * z;
  const outZ = matrixElements[2] * x + matrixElements[6] * y + matrixElements[10] * z;
  const length = Math.max(Math.sqrt(outX * outX + outY * outY + outZ * outZ), 1e-6);
  return [outX / length, outY / length, outZ / length];
}
