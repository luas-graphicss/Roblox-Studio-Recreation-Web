import { clearChildren, createButton, createReadout, createSection, createSelect } from "./sbPanelElements.js"


const PANEL_RIGHT_OFFSET_PIXELS = 324


export function parseAuthoredValue(text) {
	const trimmed = String(text ?? "").trim()
	if (trimmed.length === 0) return { ok: false, value: null, reason: "valor vazio: use o botao AUTO para delegar ao contrato" }
	const parts = trimmed.split(",").map((part) => Number(part.trim()))
	if (parts.some((part) => !Number.isFinite(part))) {
		return { ok: false, value: null, reason: "esperado numero ou lista de numeros separados por virgula" }
	}
	return { ok: true, value: parts.length === 1 ? parts[0] : parts, reason: null }
}

function createValueInput(parent, labelText) {
	const row = document.createElement("label")
	row.className = "sb-panel-row"
	const label = document.createElement("span")
	label.textContent = labelText
	const input = document.createElement("input")
	input.className = "sb-panel-select"
	input.type = "text"
	input.placeholder = "0.4 ou 0.8,0.8,0.8"
	row.appendChild(label)
	row.appendChild(input)
	parent.appendChild(row)
	return input
}

function describeNodeOption(node) {
	const kind = node.operator ?? node.bsdf ?? node.kind
	const label = node.label === null ? "" : " " + node.label
	return node.path + " " + kind + label
}

export function createMaterialGraphPanel(options) {
	const container = options.container
	const session = options.session
	const materialRuntime = options.materialRuntime
	let loadedSelectionKey = materialRuntime?.selectionKey() ?? null

	let selectedPath = session.nodes()[0]?.path ?? "root"
	let selectedParameterName = null

	const root = document.createElement("div")
	root.className = "sb-panel"
	root.style.right = PANEL_RIGHT_OFFSET_PIXELS + "px"
	container.appendChild(root)

	const header = document.createElement("div")
	header.className = "sb-panel-header"
	header.textContent = "Autoria de material"
	root.appendChild(header)

	const targetSection = createSection(root, "Material da cena")
	const targetHost = document.createElement("div")
	targetSection.appendChild(targetHost)
	createButton(targetSection, "restaurar material da cena", () => {
		materialRuntime?.useSceneMaterial()
		const tree = materialRuntime?.tree()
		if (tree) session.loadTree(tree)
		window.__sbLab?.redraw?.()
		refresh()
	})
	const targetNote = document.createElement("p")
	targetNote.className = "sb-panel-note"
	targetNote.textContent = "As edicoes aceitas alteram somente o material selecionado. AUTO usa o contrato; o piso nao e alterado."
	targetSection.appendChild(targetNote)

	const presetSection = createSection(root, "Preset")
	const presetHost = document.createElement("div")
	presetSection.appendChild(presetHost)

	const nodeSection = createSection(root, "Arvore")
	const nodeHost = document.createElement("div")
	nodeSection.appendChild(nodeHost)

	const parameterSection = createSection(root, "Parametro")
	const parameterHost = document.createElement("div")
	parameterSection.appendChild(parameterHost)
	const valueInput = createValueInput(parameterSection, "valor")
	createButton(parameterSection, "gravar", () => {
		const parsed = parseAuthoredValue(valueInput.value)
		if (!parsed.ok) {
			refusalReadout.textContent = parsed.reason
			return
		}
		session.setParameter({ path: selectedPath, parameterName: selectedParameterName, value: parsed.value })
		refresh()
	})
	createButton(parameterSection, "AUTO", () => {
		session.setParameter({ path: selectedPath, parameterName: selectedParameterName, value: null })
		refresh()
	})

	const editSection = createSection(root, "Editar")
	createButton(editSection, "camada", () => {
		session.addLayer({ path: selectedPath })
		refresh()
	})
	createButton(editSection, "mistura", () => {
		session.addMix({ path: selectedPath })
		refresh()
	})
	createButton(editSection, "remover", () => {
		session.removeAt({ path: selectedPath })
		refresh()
	})

	const statusSection = createSection(root, "Estado")
	const graphReadout = createReadout(statusSection, "arvore")
	const autoReadout = createReadout(statusSection, "AUTO")
	const roundTripReadout = createReadout(statusSection, "ida e volta")
	const refusalReadout = createReadout(statusSection, "recusa")

	function refreshTargets() {
		clearChildren(targetHost)
		createSelect(targetHost, "alvo", (materialRuntime?.targets() ?? []).map(target => ({ value: target.id, label: target.label, selected: target.id === materialRuntime.target() })), id => {
			materialRuntime.target(id)
			loadedSelectionKey = materialRuntime.selectionKey()
			const tree = materialRuntime.tree()
			if (tree) session.loadTree(tree)
			selectedPath = session.nodes()[0]?.path ?? "root"
			selectedParameterName = null
			refresh()
		})
	}

	function refreshPresets() {
		clearChildren(presetHost)
		const currentPresetId = session.presetId()
		createSelect(
			presetHost,
			"preset",
			session.presets().map((presetId) => ({ value: presetId, label: presetId, selected: presetId === currentPresetId })),
			(presetId) => {
				session.loadPreset(presetId)
				selectedPath = session.nodes()[0]?.path ?? "root"
				selectedParameterName = null
				refresh()
			},
		)
	}

	function refreshNodes() {
		clearChildren(nodeHost)
		const nodes = session.nodes()
		if (!nodes.some((node) => node.path === selectedPath)) selectedPath = nodes[0]?.path ?? "root"
		createSelect(
			nodeHost,
			"no",
			nodes.map((node) => ({ value: node.path, label: describeNodeOption(node), selected: node.path === selectedPath })),
			(path) => {
				selectedPath = path
				selectedParameterName = null
				refresh()
			},
		)
	}

	function refreshParameters() {
		clearChildren(parameterHost)
		const node = session.nodes().find((candidate) => candidate.path === selectedPath)
		const parameterNames = node?.parameterNames ?? []
		if (!parameterNames.includes(selectedParameterName)) selectedParameterName = parameterNames[0] ?? null
		createSelect(
			parameterHost,
			"nome",
			parameterNames.map((parameterName) => ({
				value: parameterName,
				label: (node?.autoParameterNames ?? []).includes(parameterName) ? parameterName + " (AUTO)" : parameterName,
				selected: parameterName === selectedParameterName,
			})),
			(parameterName) => {
				selectedParameterName = parameterName
				refreshValue()
			},
		)
	}

	function refreshValue() {
		const pending = [session.root()]
		let selectedNode = null
		while (pending.length) {
			const node = pending.pop()
			if (node?.path === selectedPath) { selectedNode = node; break }
			pending.push(...(node?.children ?? []))
		}
		const value = selectedNode?.parameters?.[selectedParameterName]
		valueInput.value = value === null || value === undefined ? "" : Array.isArray(value) ? value.join(", ") : String(value)
		valueInput.placeholder = value === null || value === undefined ? "AUTO (contrato / tier)" : "numero ou vetor"
	}

	function refreshReadouts() {
		const report = session.describe()
		const graph = report.graph
		graphReadout.textContent =
			graph.nodeCount + " nos / " + graph.slabCount + " slabs / nivel " + graph.depth + (graph.ok ? " ok" : " invalida")
		autoReadout.textContent = report.roundTrip.autoParameterCount + " em AUTO" + (report.roundTrip.autoPreserved ? " preservado" : " PERDIDO")
		roundTripReadout.textContent = report.roundTrip.identical
			? report.roundTrip.byteLength + " B " + report.roundTrip.fingerprint
			: "divergiu na volta"
		const refusals = [...report.refusals, ...graph.refusals]
		refusalReadout.textContent = refusals.length === 0 ? "nenhuma" : refusals[0]
	}

	function refresh() {
		loadedSelectionKey = materialRuntime?.selectionKey() ?? null
		refreshTargets()
		refreshPresets()
		refreshNodes()
		refreshParameters()
		refreshValue()
		refreshReadouts()
	}

	const unsubscribe = session.subscribe?.(refresh)
	const targetTimer = setInterval(() => {
		const key = materialRuntime?.selectionKey() ?? null
		if (key === loadedSelectionKey) return
		loadedSelectionKey = key
		const tree = materialRuntime?.tree()
		if (tree) session.loadTree(tree)
		refresh()
	}, 500)
	refresh()

	return {
		element: root,
		refresh,
		dispose() {
			unsubscribe?.()
			clearInterval(targetTimer)
			if (root.parentNode) root.parentNode.removeChild(root)
		},
	}
}
