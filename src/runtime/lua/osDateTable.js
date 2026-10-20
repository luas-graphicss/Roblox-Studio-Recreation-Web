import { LuaError } from "./interpreter.js";

const REQUIRED_FIELD_NAMES = ["year", "month", "day"];
const HOUR_WHEN_ABSENT = 12;
const MINUTE_WHEN_ABSENT = 0;
const SECOND_WHEN_ABSENT = 0;
const MILLISECONDS_PER_SECOND = 1000;
const FIRST_YEAR_NOT_REMAPPED_BY_DATE_UTC = 100;

function toFiniteNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsedValue = Number(value);
    return Number.isFinite(parsedValue) ? parsedValue : null;
  }
  return null;
}


function readRequiredField(dateTable, fieldName) {
  const fieldValue = toFiniteNumber(dateTable.rawget(fieldName));
  if (fieldValue === null) throw new LuaError("field '" + fieldName + "' missing in date table");
  return Math.trunc(fieldValue);
}

function readOptionalField(dateTable, fieldName, valueWhenAbsent) {
  const rawFieldValue = dateTable.rawget(fieldName);
  if (rawFieldValue === undefined || rawFieldValue === null) return valueWhenAbsent;
  const fieldValue = toFiniteNumber(rawFieldValue);
  if (fieldValue === null) throw new LuaError("field '" + fieldName + "' is not a number in date table");
  return Math.trunc(fieldValue);
}


function utcMillisecondsOf(year, month, day, hour, minute, second) {
  const milliseconds = Date.UTC(year, month - 1, day, hour, minute, second);
  if (year < 0 || year >= FIRST_YEAR_NOT_REMAPPED_BY_DATE_UTC) return milliseconds;
  const remappedDate = new Date(milliseconds);
  remappedDate.setUTCFullYear(year);
  return remappedDate.getTime();
}

export function epochSecondsFromDateTable(dateTable) {
  const [year, month, day] = REQUIRED_FIELD_NAMES.map((fieldName) => readRequiredField(dateTable, fieldName));
  const hour = readOptionalField(dateTable, "hour", HOUR_WHEN_ABSENT);
  const minute = readOptionalField(dateTable, "min", MINUTE_WHEN_ABSENT);
  const second = readOptionalField(dateTable, "sec", SECOND_WHEN_ABSENT);
  const utcMilliseconds = utcMillisecondsOf(year, month, day, hour, minute, second);
  return Math.floor(utcMilliseconds / MILLISECONDS_PER_SECOND);
}
