import { RBX_ATTRIBUTE_TYPES } from "./llRbxAttributeCore.js";

const ATTRIBUTES_OPEN_TAG = "<Attributes>";
const ATTRIBUTES_CLOSE_TAG = "</Attributes>";
const ATTRIBUTE_ELEMENT_PATTERN = /<Attribute\s+name="([^"]*)"\s+type="([^"]*)"\s*>([\s\S]*?)<\/Attribute>/g;
const ELEMENT_INDENT = "  ";

export function escapeXmlText(value) {
  return String(value === undefined || value === null ? "" : value)
    .split("&")
    .join("&amp;")
    .split("<")
    .join("&lt;")
    .split(">")
    .join("&gt;")
    .split('"')
    .join("&quot;");
}

export function unescapeXmlText(value) {
  return String(value === undefined || value === null ? "" : value)
    .split("&quot;")
    .join('"')
    .split("&gt;")
    .join(">")
    .split("&lt;")
    .join("<")
    .split("&amp;")
    .join("&");
}

function attributeTextValue(value) {
  if (value === true) return "true";
  if (value === false) return "false";
  if (typeof value === "number") return String(value);
  return String(value === undefined || value === null ? "" : value);
}

function typedAttributeValue(type, text) {
  if (type === RBX_ATTRIBUTE_TYPES.BOOL) return text === "true";
  if (type === RBX_ATTRIBUTE_TYPES.NUMBER) {
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return text;
}

function attributeElementFor(entry) {
  const source = entry && typeof entry === "object" ? entry : {};
  return (
    ELEMENT_INDENT +
    '<Attribute name="' +
    escapeXmlText(source.name) +
    '" type="' +
    escapeXmlText(source.type) +
    '">' +
    escapeXmlText(attributeTextValue(source.value)) +
    "</Attribute>"
  );
}

export function serializeAttributesToXml(entries) {
  const list = Array.isArray(entries) ? entries : [];
  return [ATTRIBUTES_OPEN_TAG].concat(list.map(attributeElementFor)).concat([ATTRIBUTES_CLOSE_TAG]).join("\n");
}

export function parseAttributesFromXml(text) {
  const markup = typeof text === "string" ? text : "";
  const pattern = new RegExp(ATTRIBUTE_ELEMENT_PATTERN.source, "g");
  const entries = [];
  let match = pattern.exec(markup);
  while (match) {
    const type = unescapeXmlText(match[2]);
    entries.push({
      name: unescapeXmlText(match[1]),
      type,
      value: typedAttributeValue(type, unescapeXmlText(match[3])),
    });
    match = pattern.exec(markup);
  }
  return entries;
}
