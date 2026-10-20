export const HIERARCHICAL_DEPTH_CHANNELS = Object.freeze({
  minimum: "r",
  maximum: "g",
});


export const MAXIMUM_REDUCTION_TAPS_PER_AXIS = 3;

function positiveInteger(value, fallback) {
  const asInteger = Math.floor(Number(value));
  return Number.isFinite(asInteger) && asInteger > 0 ? asInteger : fallback;
}


export function hierarchicalDepthLevelCount(width, height) {
  const safeWidth = positiveInteger(width, 1);
  const safeHeight = positiveInteger(height, 1);
  return Math.max(1, Math.floor(Math.log2(Math.max(safeWidth, safeHeight))) + 1);
}


export function hierarchicalDepthLevelSize(width, height, levelIndex) {
  let levelWidth = positiveInteger(width, 1);
  let levelHeight = positiveInteger(height, 1);
  const level = Math.max(0, Math.floor(Number(levelIndex) || 0));
  for (let step = 0; step < level; step++) {
    levelWidth = Math.max(1, levelWidth >> 1);
    levelHeight = Math.max(1, levelHeight >> 1);
  }
  return { width: levelWidth, height: levelHeight };
}


export function sourceFootprintForDestinationTexel(
  destinationX,
  destinationY,
  sourceWidth,
  sourceHeight,
  destinationWidth,
  destinationHeight,
) {
  const startX = destinationX * 2;
  const startY = destinationY * 2;
  const isLastColumn = destinationX >= destinationWidth - 1;
  const isLastRow = destinationY >= destinationHeight - 1;
  return {
    startX,
    startY,
    endX: isLastColumn ? sourceWidth - 1 : Math.min(startX + 1, sourceWidth - 1),
    endY: isLastRow ? sourceHeight - 1 : Math.min(startY + 1, sourceHeight - 1),
  };
}


export function reduceHierarchicalDepthLevel(sourceLevel) {
  const sourceWidth = sourceLevel.width;
  const sourceHeight = sourceLevel.height;
  const destinationWidth = Math.max(1, sourceWidth >> 1);
  const destinationHeight = Math.max(1, sourceHeight >> 1);
  const minimum = new Float32Array(destinationWidth * destinationHeight);
  const maximum = new Float32Array(destinationWidth * destinationHeight);

  for (let destinationY = 0; destinationY < destinationHeight; destinationY++) {
    for (let destinationX = 0; destinationX < destinationWidth; destinationX++) {
      const footprint = sourceFootprintForDestinationTexel(
        destinationX,
        destinationY,
        sourceWidth,
        sourceHeight,
        destinationWidth,
        destinationHeight,
      );
      let smallestDepth = Infinity;
      let largestDepth = -Infinity;
      for (let sourceY = footprint.startY; sourceY <= footprint.endY; sourceY++) {
        for (let sourceX = footprint.startX; sourceX <= footprint.endX; sourceX++) {
          const sourceIndex = sourceY * sourceWidth + sourceX;
          if (sourceLevel.minimum[sourceIndex] < smallestDepth) smallestDepth = sourceLevel.minimum[sourceIndex];
          if (sourceLevel.maximum[sourceIndex] > largestDepth) largestDepth = sourceLevel.maximum[sourceIndex];
        }
      }
      const destinationIndex = destinationY * destinationWidth + destinationX;
      minimum[destinationIndex] = smallestDepth;
      maximum[destinationIndex] = largestDepth;
    }
  }

  return {
    levelIndex: (sourceLevel.levelIndex || 0) + 1,
    width: destinationWidth,
    height: destinationHeight,
    minimum,
    maximum,
  };
}


export function buildHierarchicalDepthPyramid(linearDepthValues, width, height) {
  const safeWidth = positiveInteger(width, 1);
  const safeHeight = positiveInteger(height, 1);
  const baseLevel = {
    levelIndex: 0,
    width: safeWidth,
    height: safeHeight,
    minimum: new Float32Array(safeWidth * safeHeight),
    maximum: new Float32Array(safeWidth * safeHeight),
  };
  for (let texelIndex = 0; texelIndex < safeWidth * safeHeight; texelIndex++) {
    const depth = Number(linearDepthValues[texelIndex]) || 0;
    baseLevel.minimum[texelIndex] = depth;
    baseLevel.maximum[texelIndex] = depth;
  }

  const levels = [baseLevel];
  while (levels[levels.length - 1].width > 1 || levels[levels.length - 1].height > 1) {
    levels.push(reduceHierarchicalDepthLevel(levels[levels.length - 1]));
  }
  return levels;
}

export function readHierarchicalDepthTexel(level, x, y) {
  if (!level || x < 0 || y < 0 || x >= level.width || y >= level.height) return null;
  const texelIndex = y * level.width + x;
  return { minimum: level.minimum[texelIndex], maximum: level.maximum[texelIndex] };
}
