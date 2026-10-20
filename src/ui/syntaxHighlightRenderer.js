const ALLOWED_HIGHLIGHT_TAG = "span";
const ALLOWED_HIGHLIGHT_ATTRIBUTE = "class";

const TEXT_NODE_TYPE = 3;
const ELEMENT_NODE_TYPE = 1;

function copySanitizedChildren(sourceNode, destinationNode) {
  for (const child of Array.from(sourceNode.childNodes)) {
    if (child.nodeType === TEXT_NODE_TYPE) {
      destinationNode.appendChild(document.createTextNode(child.nodeValue || ""));
      continue;
    }
    if (child.nodeType !== ELEMENT_NODE_TYPE) continue;
    if (String(child.tagName || "").toLowerCase() !== ALLOWED_HIGHLIGHT_TAG) {
      destinationNode.appendChild(document.createTextNode(child.textContent || ""));
      continue;
    }
    const safeSpan = document.createElement(ALLOWED_HIGHLIGHT_TAG);
    const className = child.getAttribute(ALLOWED_HIGHLIGHT_ATTRIBUTE);
    if (className) safeSpan.setAttribute(ALLOWED_HIGHLIGHT_ATTRIBUTE, className);
    copySanitizedChildren(child, safeSpan);
    destinationNode.appendChild(safeSpan);
  }
}


export function renderHighlightedCode(targetElement, highlightedMarkup, fallbackCode) {
  if (!targetElement) return false;
  targetElement.textContent = String(fallbackCode == null ? "" : fallbackCode);
  if (typeof highlightedMarkup !== "string" || !highlightedMarkup) return false;


  const template = document.createElement("template");
  template.innerHTML = highlightedMarkup;

  const sanitizedFragment = document.createDocumentFragment();
  copySanitizedChildren(template.content, sanitizedFragment);
  targetElement.replaceChildren(sanitizedFragment);
  return true;
}
