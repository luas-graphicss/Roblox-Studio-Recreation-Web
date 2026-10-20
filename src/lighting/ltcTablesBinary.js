export const LTC_TABLE_SIDE = 64;
export const LTC_TABLE_COMPONENTS = 4;
export const LTC_TABLE_VALUE_COUNT = LTC_TABLE_SIDE * LTC_TABLE_SIDE * LTC_TABLE_COMPONENTS;
export const LTC_TABLE_COUNT = 2;
export const LTC_BYTES_PER_VALUE = 2;

export const LTC_TABLES_BINARY_MAGIC = "LTC1";
export const LTC_TABLES_BINARY_VERSION = 1;
export const LTC_TABLES_BINARY_HEADER_BYTES = 16;
export const LTC_TABLES_BINARY_BYTE_LENGTH =
  LTC_TABLES_BINARY_HEADER_BYTES + LTC_TABLE_COUNT * LTC_TABLE_VALUE_COUNT * LTC_BYTES_PER_VALUE;

const MAGIC_BYTE_LENGTH = 4;
const LITTLE_ENDIAN = true;
const HEADER_OFFSETS = Object.freeze({
  version: 4,
  tableCount: 6,
  tableSide: 8,
  components: 10,
  bytesPerValue: 12,
  reserved: 14,
});

function assertHalfTable(values, tableName) {
  if (!(values instanceof Uint16Array)) {
    throw new Error("ltcTablesBinary: " + tableName + " must be a Uint16Array of half floats");
  }
  if (values.length !== LTC_TABLE_VALUE_COUNT) {
    throw new Error(
      "ltcTablesBinary: " + tableName + " must hold " + LTC_TABLE_VALUE_COUNT + " values, got " + values.length,
    );
  }
}

function readMagic(header) {
  let magic = "";
  for (let index = 0; index < MAGIC_BYTE_LENGTH; index++) magic += String.fromCharCode(header.getUint8(index));
  return magic;
}

function assertHeaderField(header, fieldName, expectedValue) {
  const actualValue = header.getUint16(HEADER_OFFSETS[fieldName], LITTLE_ENDIAN);
  if (actualValue !== expectedValue) {
    throw new Error("ltcTablesBinary: " + fieldName + " is " + actualValue + ", expected " + expectedValue);
  }
}


export function encodeLtcTablesBinary(firstTable, secondTable) {
  assertHalfTable(firstTable, "firstTable");
  assertHalfTable(secondTable, "secondTable");
  const buffer = new ArrayBuffer(LTC_TABLES_BINARY_BYTE_LENGTH);
  const header = new DataView(buffer);
  for (let index = 0; index < MAGIC_BYTE_LENGTH; index++) {
    header.setUint8(index, LTC_TABLES_BINARY_MAGIC.charCodeAt(index));
  }
  header.setUint16(HEADER_OFFSETS.version, LTC_TABLES_BINARY_VERSION, LITTLE_ENDIAN);
  header.setUint16(HEADER_OFFSETS.tableCount, LTC_TABLE_COUNT, LITTLE_ENDIAN);
  header.setUint16(HEADER_OFFSETS.tableSide, LTC_TABLE_SIDE, LITTLE_ENDIAN);
  header.setUint16(HEADER_OFFSETS.components, LTC_TABLE_COMPONENTS, LITTLE_ENDIAN);
  header.setUint16(HEADER_OFFSETS.bytesPerValue, LTC_BYTES_PER_VALUE, LITTLE_ENDIAN);
  header.setUint16(HEADER_OFFSETS.reserved, 0, LITTLE_ENDIAN);
  const payload = new Uint16Array(buffer, LTC_TABLES_BINARY_HEADER_BYTES, LTC_TABLE_COUNT * LTC_TABLE_VALUE_COUNT);
  payload.set(firstTable, 0);
  payload.set(secondTable, LTC_TABLE_VALUE_COUNT);
  return buffer;
}



export function decodeLtcTablesBinary(arrayBuffer) {
  if (!arrayBuffer || typeof arrayBuffer.byteLength !== "number") {
    throw new Error("ltcTablesBinary: expected an ArrayBuffer");
  }
  if (arrayBuffer.byteLength !== LTC_TABLES_BINARY_BYTE_LENGTH) {
    throw new Error(
      "ltcTablesBinary: expected " + LTC_TABLES_BINARY_BYTE_LENGTH + " bytes, got " + arrayBuffer.byteLength,
    );
  }
  const header = new DataView(arrayBuffer);
  const magic = readMagic(header);
  if (magic !== LTC_TABLES_BINARY_MAGIC) {
    throw new Error('ltcTablesBinary: bad magic "' + magic + '", expected "' + LTC_TABLES_BINARY_MAGIC + '"');
  }
  assertHeaderField(header, "version", LTC_TABLES_BINARY_VERSION);
  assertHeaderField(header, "tableCount", LTC_TABLE_COUNT);
  assertHeaderField(header, "tableSide", LTC_TABLE_SIDE);
  assertHeaderField(header, "components", LTC_TABLE_COMPONENTS);
  assertHeaderField(header, "bytesPerValue", LTC_BYTES_PER_VALUE);
  const payload = new Uint16Array(arrayBuffer, LTC_TABLES_BINARY_HEADER_BYTES, LTC_TABLE_COUNT * LTC_TABLE_VALUE_COUNT);
  return {

    firstTable: payload.slice(0, LTC_TABLE_VALUE_COUNT),
    secondTable: payload.slice(LTC_TABLE_VALUE_COUNT),
  };
}


export function halfBitsToFloat(halfBits) {
  const bits = halfBits & 0xffff;
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 0x1f;
  const mantissa = bits & 0x03ff;
  if (exponent === 0) return sign * Math.pow(2, -14) * (mantissa / 1024);
  if (exponent === 31) return mantissa === 0 ? sign * Infinity : Number.NaN;
  return sign * Math.pow(2, exponent - 15) * (1 + mantissa / 1024);
}
