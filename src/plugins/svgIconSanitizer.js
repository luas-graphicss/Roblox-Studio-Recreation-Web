export const MAX_SVG_ICON_LENGTH = 4096;

const ALLOWED_SVG_ELEMENTS = new Set([
  "svg",
  "g",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "title",
  "defs",
]);

const ALLOWED_SVG_ATTRIBUTES = new Set([
  "d",
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "stroke-opacity",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "width",
  "height",
  "viewbox",
  "points",
  "opacity",
  "transform",
]);


function isAllowedAttributeName(attributeName) {
  const normalizedName = String(attributeName || "").toLowerCase();
  if (normalizedName.startsWith("on")) return false;
  if (normalizedName.startsWith("xlink")) return false;
  return ALLOWED_SVG_ATTRIBUTES.has(normalizedName);
}

function removeDisallowedContent(element) {
  for (const child of Array.from(element.children)) {
    if (!ALLOWED_SVG_ELEMENTS.has(String(child.tagName || "").toLowerCase())) {
      child.remove();
      continue;
    }
    removeDisallowedContent(child);
  }
  for (const attribute of Array.from(element.attributes)) {
    if (!isAllowedAttributeName(attribute.name)) {
      element.removeAttribute(attribute.name);
    }
  }
}

export function isInlineSvgSource(candidate) {
  return typeof candidate === "string" && candidate.trim().startsWith("<svg");
}


export function parseSvgIconSafely(untrustedSvgSource, maxLength = MAX_SVG_ICON_LENGTH) {
  const source = typeof untrustedSvgSource === "string" ? untrustedSvgSource.trim() : "";
  if (!source || source.length > maxLength) return null;
  if (typeof DOMParser === "undefined") return null;

  let parsedDocument = null;
  try {
    parsedDocument = new DOMParser().parseFromString(source, "image/svg+xml");
  } catch (_) {
    return null;
  }

  const rootElement = parsedDocument ? parsedDocument.documentElement : null;
  if (!rootElement) return null;
  if (String(rootElement.tagName || "").toLowerCase() !== "svg") return null;
  if (parsedDocument.querySelector("parsererror")) return null;

  removeDisallowedContent(rootElement);
  return rootElement;
}
