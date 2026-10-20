export function createPanelElements(document, run) {
  function element(tag, text, attributes = {}) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    for (const [name, value] of Object.entries(attributes)) {
      if (name === "className") node.className = value;
      else if (value !== false && value !== undefined) node.setAttribute(name, value === true ? "" : String(value));
    }
    return node;
  }
  function button(text, action, attributes = {}) {
    const node = element("button", text, { type: "button", ...attributes });
    node.addEventListener("click", () => run(action)); return node;
  }
  function select(label, options, value, change, id) {
    const wrapper = element("label", label, { className: "cp33-select-label" });
    const node = element("select", undefined, { "aria-label": label, id });
    for (const option of options) node.append(element("option", option.label ?? option, { value: option.value ?? option }));
    node.value = value;
    node.addEventListener("change", () => run(() => change(node.value)));
    wrapper.append(node); return wrapper;
  }
  function section(title, description) {
    const node = element("section", undefined, { className: "cp33-section" });
    node.append(element("h3", title));
    if (description) node.append(element("p", description, { className: "cp33-description" }));
    return node;
  }
  return Object.freeze({ element, button, select, section });
}
