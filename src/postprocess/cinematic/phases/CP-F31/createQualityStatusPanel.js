export function createQualityStatusPanel(root) {
  if (!root?.ownerDocument) throw new TypeError("A status panel root is required");
  const document = root.ownerDocument;
  let disposed = false;
  return Object.freeze({
    update(state) {
      if (disposed) throw new Error("Quality status panel is disposed");
      root.replaceChildren();
      const heading = document.createElement("h2");
      heading.textContent = "Applied quality";
      const status = document.createElement("p");
      status.setAttribute("role", "status");
      status.textContent = state.applied === false ? "Host bridge required — no settings applied" : "Profile: " + state.profileId;
      root.append(heading, status);
      const list = document.createElement("ul");
      list.className = "quality-options";
      for (const option of state.options ?? []) {
        const item = document.createElement("li");
        const label = document.createElement("strong");
        const value = document.createElement("span");
        const detail = document.createElement("p");
        label.textContent = option.id;
        value.textContent = JSON.stringify(option.value) + " · " + option.status;
        detail.textContent = option.reason + " Cost: " + option.cost + ". Quality: " + option.qualityEffect;
        item.append(label, value, detail); list.append(item);
      }
      root.append(list);
    },
    dispose() { if (disposed) return; disposed = true; root.replaceChildren(); }
  });
}
