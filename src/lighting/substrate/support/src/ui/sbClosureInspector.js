import { clearChildren, createButton, createReadout, createSection, createSelect } from "./sbPanelElements.js"

const PANEL_RIGHT_OFFSET_PIXELS = 648
const MAX_LISTED_CLOSURE_ROWS = 8

export function formatRampColor(color) {
	if (!Array.isArray(color)) return "nao pinta pixel"
	return color.map((channelValue) => channelValue.toFixed(3)).join(" / ")
}

export function formatClosureRow(row) {
	return (
		"slot " +
		row.slot +
		" | " +
		row.kind +
		" | " +
		row.bytes +
		" B | peso " +
		row.weight.toFixed(3) +
		" | camada " +
		row.layerIndex
	)
}

export function formatDroppedRow(row) {
	return row.kind + " descartada: " + row.dropReason
}


export function createClosureInspectorPanel(options) {
	const container = options?.container
	const visualization = options?.visualization
	if (!container || !visualization) return null

	const root = document.createElement("div")
	root.className = "sb-panel"
	root.dataset.panelId = "inspector"
	root.style.right = PANEL_RIGHT_OFFSET_PIXELS + "px"

	const header = document.createElement("div")
	header.className = "sb-panel-header"
	header.textContent = "SB-F35 debug de material"
	root.appendChild(header)

	const modeSection = createSection(root, "Modo")
	const modeOptions = visualization.modes().map((mode) => ({
		value: mode.id,
		label: mode.title,
		selected: mode.id === visualization.mode(),
	}))
	const modeSelect = createSelect(modeSection, "visualizacao", modeOptions, (selectedModeId) => {
		visualization.setMode(selectedModeId)
		refresh()
	})
	createButton(modeSection, "Atualizar leitura", () => refresh())

	const numbersSection = createSection(root, "Material selecionado (dados GPU)")
	const modeReadout = createReadout(numbersSection, "modo")
	const tierReadout = createReadout(numbersSection, "tier")
	const closureCountReadout = createReadout(numbersSection, "closures ativas")
	const bytesReadout = createReadout(numbersSection, "bytes dos registros")
	const colorReadout = createReadout(numbersSection, "cor da rampa")

	const closureSection = createSection(root, "Registros do material alvo")
	const closureList = document.createElement("div")
	closureList.className = "sb-panel-section"
	closureSection.appendChild(closureList)

	const refusalSection = createSection(root, "Aviso")
	const refusalReadout = createReadout(refusalSection, "portao")

	container.appendChild(root)

	function appendListLine(text) {
		const line = document.createElement("div")
		line.className = "sb-panel-readout"
		line.textContent = text
		closureList.appendChild(line)
	}

	function refresh() {
		const report = visualization.report()
		modeSelect.value = visualization.mode()
		modeReadout.textContent = report.modeTitle + " (codigo " + report.modeCode + ")"
		tierReadout.textContent = report.tier
		closureCountReadout.textContent =
			report.materialCount.closureCount +
			" de " +
			report.materialCount.tierCeiling +
			" (teto do contrato " +
			report.materialCount.contractCeiling +
			")"
		bytesReadout.textContent =
			report.bytes.bytesPerPixel +
			" B de " +
			report.bytes.tierCeiling +
			" B" +
			(report.bytes.withinTierCeiling ? "" : " ACIMA DO TETO DO TIER")
		colorReadout.textContent = report.paintsPixel ? formatRampColor(report.color) : "nao pinta pixel"

		clearChildren(closureList)
		if (report.inspector.rowCount === 0) appendListLine("nenhuma closure despachada")
		for (const row of report.inspector.rows.slice(0, MAX_LISTED_CLOSURE_ROWS)) appendListLine(formatClosureRow(row))
		for (const row of report.inspector.droppedRows.slice(0, MAX_LISTED_CLOSURE_ROWS)) appendListLine(formatDroppedRow(row))

		refusalReadout.textContent = report.problems.length === 0 ? "nenhum" : report.problems[0]
		return report
	}

	window.addEventListener("sb:state-change", refresh)
	refresh()

	return {
		element: root,
		refresh,
		dispose() {
			window.removeEventListener("sb:state-change", refresh)
			if (root.parentNode) root.parentNode.removeChild(root)
		},
	}
}
