import {
	MSM_GRID_ENTRIES_PER_TEXEL,
	MSM_GRID_SATURATED_FLAG,
	MSM_GRID_TEXTURE_WIDTH,
} from "./msmWorldGridLayout.js";
import { MSM_GRID_LAYOUT_CEILING } from "./msmPipelineContract.js";
import { MSM_GRID_LOOKUP_ENTRY_CEILING } from "./msmGridLookupCore.js";


import {
	MSM_FAR_LIST_CAPACITY,
	MSM_FAR_LIST_COUNT_UNIFORM_NAME,
	MSM_FAR_LIST_SLOTS_UNIFORM_NAME,
} from "./msmFarListCore.js";


import { toGlslFloatLiteral } from "./msmNormalFromDepthGlsl.js";


export const MSM_GRID_LOOKUP_UNIFORMS = Object.freeze([
	Object.freeze({
		name: "tMsmGridTexture",
		glslType: "sampler2D",
		carries: "the header + list texture of MSM-F2, NEAREST and without mips",
	}),
	Object.freeze({
		name: "uMsmGridOriginWorld",
		glslType: "vec3",
		carries: "world position of the low corner of cell (0, 0, 0)",
	}),
	Object.freeze({
		name: "uMsmGridRingOffset",
		glslType: "vec3",
		carries: "window origin in CPU storage cells; zero keeps linear storage",
	}),
	Object.freeze({
		name: "uMsmGridInverseCellSize",
		glslType: "float",
		carries: "1.0 / cell size in studs, so the shader multiplies instead of dividing",
	}),
	Object.freeze({
		name: "uMsmGridCellCounts",
		glslType: "vec3",
		carries: "cells per axis of the ACTIVE tier, never of the ceiling",
	}),
	Object.freeze({
		name: MSM_FAR_LIST_SLOTS_UNIFORM_NAME,
		glslType: `float[${MSM_FAR_LIST_CAPACITY}]`,
		carries: "the far list slots of MSM-F10, always full length, slot 0 = empty",
	}),
	Object.freeze({
		name: MSM_FAR_LIST_COUNT_UNIFORM_NAME,
		glslType: "float",
		carries: "how many far slots carry a light (0.0 = tier runs without far list)",
	}),
]);






export const MSM_GRID_LOOKUP_SAMPLER_REQUIREMENTS = Object.freeze({
	minFilter: "NEAREST",
	magFilter: "NEAREST",
	generateMipmaps: false,
	flipY: false,
	textureUnitCost: 1,
});


export const MSM_GRID_LOOKUP_FUNCTIONS = Object.freeze([
	"msmGridTexelUv",
	"msmGridDecodeByte",
	"msmGridSelectChannel",
	"msmGridCellCount",
	"msmGridCellCoordinatesAt",
	"msmGridCellIsInside",
	"msmGridCellIndexFrom",
	"msmGridStorageCellIndexFrom",
	"msmGridSaturatedFromFlags",
	"msmGridCursorIsEmpty",
	"msmGridFarLightSlotAt",
	"msmGridLookupBegin",
	"msmGridLookupLightIndexAt",
]);


export const MSM_GRID_LOOKUP_STRUCT_NAME = "MsmGridCursor";


export const MSM_GRID_LOOKUP_GLSL_EMPTY_INDEX = -1;


const CHANNEL_BYTE_SCALE = 255;
const HEADER_HIGH_BYTE_WEIGHT = 256;









export function buildGridLookupGlsl() {
	const textureWidth = toGlslFloatLiteral(MSM_GRID_TEXTURE_WIDTH);
	const textureHeight = toGlslFloatLiteral(MSM_GRID_LAYOUT_CEILING.textureHeight);
	const entriesPerTexel = toGlslFloatLiteral(MSM_GRID_ENTRIES_PER_TEXEL);
	const channelByteScale = toGlslFloatLiteral(CHANNEL_BYTE_SCALE);
	const headerHighByteWeight = toGlslFloatLiteral(HEADER_HIGH_BYTE_WEIGHT);
	const saturatedFlag = toGlslFloatLiteral(MSM_GRID_SATURATED_FLAG);
	const emptyIndex = toGlslFloatLiteral(MSM_GRID_LOOKUP_GLSL_EMPTY_INDEX);
	const structName = MSM_GRID_LOOKUP_STRUCT_NAME;
	const farListCapacity = MSM_FAR_LIST_CAPACITY;
	const farListSlotsUniform = MSM_FAR_LIST_SLOTS_UNIFORM_NAME;
	const farListCountUniform = MSM_FAR_LIST_COUNT_UNIFORM_NAME;

	return `
                                                                                    
struct ${structName} {
  float cellIndex;
  float listTexelIndex;
  float lightCount;
  bool insideGrid;
  bool usesFarList;
  bool saturated;
};

                                                                           
const int MSM_GRID_LOOKUP_ENTRY_CEILING = ${MSM_GRID_LOOKUP_ENTRY_CEILING};

                                                                              
const int MSM_GRID_FAR_LIST_CAPACITY = ${farListCapacity};

                                                                              
                                                             
vec2 msmGridTexelUv(const in float texelIndex) {
  float column = mod(texelIndex, ${textureWidth});
  float row = floor(texelIndex / ${textureWidth});
  return (vec2(column, row) + vec2(0.5)) / vec2(${textureWidth}, ${textureHeight});
}

                                                                                
                                                                           
float msmGridDecodeByte(const in float channel) {
  return floor(channel * ${channelByteScale} + 0.5);
}

float msmGridSelectChannel(const in vec4 texel, const in float channel) {
  if (channel >= 3.0) return texel.a;
  if (channel >= 2.0) return texel.b;
  if (channel >= 1.0) return texel.g;
  return texel.r;
}

                                                                                
float msmGridCellCount() {
  return uMsmGridCellCounts.x * uMsmGridCellCounts.y * uMsmGridCellCounts.z;
}

vec3 msmGridCellCoordinatesAt(const in vec3 worldPosition) {
  return floor((worldPosition - uMsmGridOriginWorld) * uMsmGridInverseCellSize);
}

bool msmGridCellIsInside(const in vec3 cellCoordinates) {
  return all(greaterThanEqual(cellCoordinates, vec3(0.0)))
    && all(lessThan(cellCoordinates, uMsmGridCellCounts));
}

                                                                             
float msmGridCellIndexFrom(const in vec3 cellCoordinates) {
  return cellCoordinates.x
    + uMsmGridCellCounts.x * (cellCoordinates.y + uMsmGridCellCounts.y * cellCoordinates.z);
}

                                                                          
                                                                           
                                                                             
float msmGridStorageCellIndexFrom(const in vec3 cellCoordinates) {
  vec3 storageCoordinates = mod(cellCoordinates + uMsmGridRingOffset, uMsmGridCellCounts);
  return msmGridCellIndexFrom(storageCoordinates);
}

bool msmGridSaturatedFromFlags(const in float flagsByte) {
  return mod(floor(flagsByte / ${saturatedFlag}), 2.0) >= 1.0;
}

bool msmGridCursorIsEmpty(const in ${structName} cursor) {
  return 1.0 > cursor.lightCount;
}

                                                                             
                                                                            
                                                                  
float msmGridFarLightSlotAt(const in int entry) {
  float slotByte = 0.0;
  for (int slotIndex = 0; MSM_GRID_FAR_LIST_CAPACITY > slotIndex; slotIndex++) {
    if (slotIndex == entry) slotByte = ${farListSlotsUniform}[slotIndex];
  }
  return slotByte;
}

                                                                               
                                                                           
${structName} msmGridLookupBegin(const in vec3 worldPosition) {
  ${structName} cursor;
  vec3 cellCoordinates = msmGridCellCoordinatesAt(worldPosition);
  float cellCount = msmGridCellCount();

  cursor.insideGrid = msmGridCellIsInside(cellCoordinates);
  cursor.usesFarList = !cursor.insideGrid;
  cursor.saturated = false;
  cursor.cellIndex = ${emptyIndex};

  if (cursor.usesFarList) {
                                                                               
                                                                             
    cursor.listTexelIndex = ${emptyIndex};
    cursor.lightCount = min(${farListCountUniform}, float(MSM_GRID_FAR_LIST_CAPACITY));
    return cursor;
  }

  cursor.cellIndex = msmGridStorageCellIndexFrom(cellCoordinates);
  vec4 headerTexel = texture2D(tMsmGridTexture, msmGridTexelUv(cursor.cellIndex));
  float offsetLow = msmGridDecodeByte(headerTexel.r);
  float offsetHigh = msmGridDecodeByte(headerTexel.g);
  cursor.listTexelIndex = cellCount + offsetLow + offsetHigh * ${headerHighByteWeight};
  cursor.lightCount = msmGridDecodeByte(headerTexel.b);
  cursor.saturated = msmGridSaturatedFromFlags(msmGridDecodeByte(headerTexel.a));
  return cursor;
}

                                                                                
                                                                             
float msmGridLookupLightIndexAt(const in ${structName} cursor, const in int entry) {
  float entryIndex = float(entry);
  if (entryIndex >= cursor.lightCount) return ${emptyIndex};

  if (cursor.usesFarList) {
    float farSlotByte = msmGridFarLightSlotAt(entry);
    return farSlotByte >= 1.0 ? farSlotByte - 1.0 : ${emptyIndex};
  }

  float texelIndex = cursor.listTexelIndex + floor(entryIndex / ${entriesPerTexel});
  vec4 listTexel = texture2D(tMsmGridTexture, msmGridTexelUv(texelIndex));
  float channel = mod(entryIndex, ${entriesPerTexel});
  float slotByte = msmGridDecodeByte(msmGridSelectChannel(listTexel, channel));
  return slotByte >= 1.0 ? slotByte - 1.0 : ${emptyIndex};
}
`;
}
