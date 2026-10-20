export function createSection(parent, titleText) {
	const section = document.createElement("div")
	section.className = "sb-panel-section"
	const title = document.createElement("div")
	title.className = "sb-panel-section-title"
	title.textContent = titleText
	section.appendChild(title)
	parent.appendChild(section)
	return section
}

export function createButton(parent, labelText, handleClick) {
	const button = document.createElement("button")
	button.className = "sb-panel-button"
	button.type = "button"
	button.textContent = labelText
	button.addEventListener("click", handleClick)
	parent.appendChild(button)
	return button
}

export function createSelect(parent, labelText, optionList, handleChange) {
	const row = document.createElement("label")
	row.className = "sb-panel-row"
	const label = document.createElement("span")
	label.textContent = labelText
	const select = document.createElement("select")
	select.className = "sb-panel-select"
	select.setAttribute("aria-label", labelText)
	for (const option of optionList) {
		const optionElement = document.createElement("option")
		optionElement.value = option.value
		optionElement.textContent = option.label
		if (option.selected) optionElement.selected = true
		select.appendChild(optionElement)
	}
	const selected = optionList.find(option => option.selected)
	if (selected) select.value = selected.value
	select.addEventListener("change", () => handleChange(select.value))
	row.appendChild(label)
	row.appendChild(select)
	parent.appendChild(row)
	return select
}


export function createTriStateControl(parent, flagState, handleChange) {
	const row = document.createElement("div")
	row.className = "sb-panel-flag"
	row.dataset.flagId = flagState.id
	row.setAttribute("role", "group")
	row.setAttribute("aria-label", flagState.id)

	const label = document.createElement("span")
	label.className = "sb-panel-flag-label"
	label.textContent = flagState.id
	label.title = (flagState.owner ?? "") + ": " + (flagState.description ?? "")
	row.appendChild(label)

	const modeTag = document.createElement("span")
	modeTag.className = "sb-panel-flag-mode"
	modeTag.textContent = flagState.mode
	row.appendChild(modeTag)

	const options = [
		{ label: "AUTO", value: "auto" },
		{ label: "ON", value: "on" },
		{ label: "OFF", value: "off" },
	]
	const currentValue = flagState.override === null ? "auto" : flagState.override ? "on" : "off"

	for (const option of options) {
		const button = document.createElement("button")
		button.type = "button"
		button.className = "sb-panel-flag-button" + (option.value === currentValue ? " sb-panel-flag-button-active" : "")
		button.textContent = option.label
		button.setAttribute("aria-pressed", String(option.value === currentValue))
		button.setAttribute("aria-label", flagState.id + " " + option.label)
		button.addEventListener("click", () => {
			const nextValue = option.value === "auto" ? null : option.value === "on"
			handleChange(flagState.id, nextValue)
		})
		row.appendChild(button)
	}

	parent.appendChild(row)
	return row
}

export function createReadout(parent, labelText) {
	const row = document.createElement("div")
	row.className = "sb-panel-readout"
	const label = document.createElement("span")
	label.textContent = labelText
	const value = document.createElement("strong")
	value.textContent = "-"
	row.appendChild(label)
	row.appendChild(value)
	parent.appendChild(row)
	return value
}

export function clearChildren(element) {
	while (element.firstChild) element.removeChild(element.firstChild)
}
