import { RBX_ATTRIBUTE_PREFIX } from "./llPublicApiContract.js";
import { LL_PUBLIC_API, PUBLIC_API_PROPERTY_TYPES, clampPublicApiValue, findPublicApiProperty, sanitizePublicApiProps } from "./llPublicApiCore.js";

export const RBX_ATTRIBUTE_TYPES = Object.freeze({ BOOL: "bool", NUMBER: "number", STRING: "string" });

export const TRI_STATE_TOKENS = Object.freeze({ AUTO: "auto", ON: "on", OFF: "off" });

export function attributeNameFor(propertyName) {
  return RBX_ATTRIBUTE_PREFIX + propertyName;
}

export function propertyNameForAttribute(attributeName) {
  const name = typeof attributeName === "string" ? attributeName : "";
  if (name.indexOf(RBX_ATTRIBUTE_PREFIX) !== 0) return null;
  const propertyName = name.slice(RBX_ATTRIBUTE_PREFIX.length);
  return findPublicApiProperty(propertyName) ? propertyName : null;
}

export function attributeTypeFor(property) {
  if (!property) return null;
  if (property.type === PUBLIC_API_PROPERTY_TYPES.NUMBER) return RBX_ATTRIBUTE_TYPES.NUMBER;
  if (property.type === PUBLIC_API_PROPERTY_TYPES.BOOLEAN) return RBX_ATTRIBUTE_TYPES.BOOL;
  return RBX_ATTRIBUTE_TYPES.STRING;
}

function triStateToToken(value) {
  if (value === true) return TRI_STATE_TOKENS.ON;
  if (value === false) return TRI_STATE_TOKENS.OFF;
  return TRI_STATE_TOKENS.AUTO;
}

function tokenToTriState(token) {
  if (token === TRI_STATE_TOKENS.ON) return true;
  if (token === TRI_STATE_TOKENS.OFF) return false;
  return null;
}

function attributeValueFor(property, value) {
  const clamped = clampPublicApiValue(property.name, value);
  if (property.type === PUBLIC_API_PROPERTY_TYPES.TRI_STATE) return triStateToToken(clamped);
  return clamped;
}

function propertyValueFor(property, attributeValue) {
  if (property.type === PUBLIC_API_PROPERTY_TYPES.TRI_STATE) return tokenToTriState(attributeValue);
  return clampPublicApiValue(property.name, attributeValue);
}


export function encodeApiPropsToAttributes(props) {
  const sanitized = sanitizePublicApiProps(props);
  return LL_PUBLIC_API.map((property) => ({
    name: attributeNameFor(property.name),
    type: attributeTypeFor(property),
    value: attributeValueFor(property, sanitized[property.name]),
  }));
}


export function decodeAttributesToApiProps(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const props = {};
  list.forEach((entry) => {
    const source = entry && typeof entry === "object" ? entry : {};
    const propertyName = propertyNameForAttribute(source.name);
    if (!propertyName) return;
    const property = findPublicApiProperty(propertyName);
    props[propertyName] = propertyValueFor(property, source.value);
  });
  return sanitizePublicApiProps(props);
}


export function diffApiProps(before, after) {
  const left = sanitizePublicApiProps(before);
  const right = sanitizePublicApiProps(after);
  return LL_PUBLIC_API.filter((property) => left[property.name] !== right[property.name]).map((property) => ({
    name: property.name,
    before: left[property.name],
    after: right[property.name],
  }));
}


export function roundTripApiProps(props) {
  const attributes = encodeApiPropsToAttributes(props);
  const decoded = decodeAttributesToApiProps(attributes);
  const differences = diffApiProps(props, decoded);
  return {
    ok: differences.length === 0,
    preserved: LL_PUBLIC_API.length - differences.length,
    total: LL_PUBLIC_API.length,
    attributes,
    props: decoded,
    differences,
  };
}
