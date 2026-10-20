const MAX_COLUMNS = 4;


const VALUE_CLASSES = new Set([
  "StringValue", "BoolValue", "IntValue", "NumberValue",
  "DoubleConstrainedValue", "IntConstrainedValue",
  "BrickColorValue", "Color3Value", "Vector3Value", "CFrameValue",
  "ObjectValue", "RayValue",
]);

function formatValue(inst) {
  let v;
  try { v = inst.getProperty("Value"); } catch (_) { v = null; }
  switch (inst.className) {
    case "BoolValue":
      return v ? "true" : "false";
    case "IntValue":
    case "IntConstrainedValue":
      return String(Math.trunc(Number(v) || 0));
    case "NumberValue":
    case "DoubleConstrainedValue": {
      const n = Number(v) || 0;
      return String(Number.isInteger(n) ? n : Math.round(n * 1000) / 1000);
    }
    case "ObjectValue":
      return v && v.name ? v.name : "";
    case "Vector3Value":
      return v ? `${v.x}, ${v.y}, ${v.z}` : "";
    default:
      return v == null ? "" : String(v);
  }
}

export function createLeaderstatsHud() {
  let host = null;
  let row = null;
  let lastSig = "";
  const cols = new Map();                                 

  function ensureHost() {
    if (host || typeof document === "undefined") return;
    host = document.createElement("div");
    host.className = "rsw-leaderstats";
    Object.assign(host.style, {
      position: "fixed", top: "12px", right: "12px", zIndex: "4200",
      display: "none", padding: "6px 8px", borderRadius: "8px",
      background: "rgba(20, 22, 28, 0.62)", border: "1px solid rgba(255, 255, 255, 0.18)",
      font: "12px system-ui, sans-serif", color: "#f2f4f8",
      backdropFilter: "blur(2px)", pointerEvents: "none",
    });
    row = document.createElement("div");
    Object.assign(row.style, { display: "flex", gap: "14px", alignItems: "flex-start" });
    host.appendChild(row);
    document.body.appendChild(host);
  }

  function hide() {
    if (host) host.style.display = "none";
  }

  function rebuild(stats) {
    cols.clear();
    row.replaceChildren();
    for (const s of stats) {
      const col = document.createElement("div");
      Object.assign(col.style, { display: "flex", flexDirection: "column", alignItems: "center", minWidth: "54px" });
      const name = document.createElement("div");
      name.textContent = s.name;
      Object.assign(name.style, { fontSize: "11px", opacity: "0.8", fontWeight: "600" });
      const val = document.createElement("div");
      Object.assign(val.style, { fontSize: "15px", fontWeight: "700", fontVariantNumeric: "tabular-nums" });
      col.append(name, val);
      row.appendChild(col);
      cols.set(s.name, { valEl: val, last: null });
    }
  }

  function update(player) {
    if (!player || typeof player.findFirstChild !== "function") { hide(); return; }
    const folder = player.findFirstChild("leaderstats");
    if (!folder || (folder.className !== "Folder" && folder.className !== "Model")) { hide(); return; }
    const stats = folder.getChildren()
      .filter((c) => VALUE_CLASSES.has(c.className))
      .slice(0, MAX_COLUMNS);
    if (!stats.length) { hide(); return; }
    ensureHost();
    if (!host) return;

    const sig = stats.map((s) => s.name + ":" + s.className).join("|");
    if (sig !== lastSig) {
      rebuild(stats);
      lastSig = sig;
    }
    for (const s of stats) {
      const c = cols.get(s.name);
      if (!c) continue;
      const v = formatValue(s);
      if (c.last !== v) { c.valEl.textContent = v; c.last = v; }                         
    }
    host.style.display = "";
  }

  function destroy() {
    if (host && host.parentNode) host.parentNode.removeChild(host);
    host = null;
    row = null;
    cols.clear();
    lastSig = "";
  }

  return { update, destroy };
}
