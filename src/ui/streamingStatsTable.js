const CELL_PADDING = "2px 6px";
const HEADER_LABELS = Object.freeze([
  "Client",
  "Inst.",
  "Chunks",
  "Mem (KB)",
  "Fila in/out",
  "LOD N/M/F/C",
  "Persistent",
]);

function createCell(tagName, textValue, alignment) {
  const cell = document.createElement(tagName);
  cell.textContent = textValue == null ? "" : String(textValue);
  cell.style.padding = CELL_PADDING;
  cell.style.textAlign = alignment || "right";
  cell.style.borderBottom = tagName === "th" ? "1px solid #2a2f3a" : "1px solid #232833";
  if (tagName === "th") {
    cell.style.color = "#9aa3b2";
    cell.style.fontWeight = "600";
  }
  return cell;
}

function formatLodCounts(lodCounts) {
  const counts = lodCounts || {};
  return [counts.Near, counts.Mid, counts.Far, counts.Culled].join("/");
}

export function buildStreamingClientsTable(snapshot) {
  const table = document.createElement("table");
  table.style.width = "100%";
  table.style.borderCollapse = "collapse";
  table.style.fontSize = "11px";

  const headerRow = document.createElement("tr");
  for (const label of HEADER_LABELS) headerRow.appendChild(createCell("th", label));
  table.appendChild(headerRow);

  const clients = snapshot && Array.isArray(snapshot.clients) ? snapshot.clients : [];
  for (const client of clients) {
    const isActiveClient = client.id === snapshot.activeClientId;
    const row = document.createElement("tr");
    if (isActiveClient) row.style.color = "#8ec6ff";
    row.appendChild(createCell("td", (isActiveClient ? "\u25b8 " : "") + "Client " + client.id, "left"));
    row.appendChild(createCell("td", client.loadedUnits + "/" + client.totalUnits));
    row.appendChild(createCell("td", client.chunksLoaded + "/" + client.chunksTotal));
    row.appendChild(createCell("td", client.estMemKB));
    row.appendChild(createCell("td", client.queueIn + "/" + client.queueOut));
    row.appendChild(createCell("td", formatLodCounts(client.lodCounts)));
    row.appendChild(createCell("td", client.persistentLoadedAt ? "\u2713" : "\u2026"));
    table.appendChild(row);
  }
  return table;
}
