import { createBootLoadingScreenController } from "./bootLoadingScreen.js"

let sharedLoadingScreen = null

export function getSharedLoadingScreen() {
	if (!sharedLoadingScreen) {
		sharedLoadingScreen = createBootLoadingScreenController()
	}
	return sharedLoadingScreen
}

export function resetSharedLoadingScreenForTests() {
	sharedLoadingScreen = null
}
