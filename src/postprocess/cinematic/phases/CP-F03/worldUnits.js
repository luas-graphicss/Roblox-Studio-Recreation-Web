import { enumValue, finiteNumber, plainRecord, positiveNumber } from "./cameraValidation.js";

export function createWorldUnitAdapter(configuration) {
  plainRecord(configuration, "worldUnits");
  const worldUnit = enumValue(configuration.worldUnit, "worldUnit", ["meter", "centimeter", "stud"]);
  const metersPerStud = configuration.metersPerStud;
  if (metersPerStud !== undefined) positiveNumber(metersPerStud, "metersPerStud");
  if (worldUnit === "stud" && metersPerStud === undefined) throw new TypeError("Stud units require authored metersPerStud");
  const metersPerWorldUnit = worldUnit === "meter" ? 1 : worldUnit === "centimeter" ? 0.01 : metersPerStud;
  function scaleFor(unit) {
    enumValue(unit, "unit", ["meter", "centimeter", "millimeter", "stud", "world"]);
    if (unit === "stud" && metersPerStud === undefined) throw new TypeError("Stud conversion requires authored metersPerStud");
    return unit === "world" ? metersPerWorldUnit : unit === "stud" ? metersPerStud : unit === "centimeter" ? 0.01 : unit === "millimeter" ? 0.001 : 1;
  }
  function convert(value, fromUnit, toUnit) {
    finiteNumber(value, "distance");
    return finiteNumber(value * scaleFor(fromUnit) / scaleFor(toUnit), "converted distance");
  }
  return Object.freeze({
    worldUnit,
    metersPerWorldUnit,
    metersPerStud: metersPerStud ?? null,
    convert,
    toMeters: (value) => convert(value, "world", "meter"),
    fromMeters: (value) => convert(value, "meter", "world")
  });
}
