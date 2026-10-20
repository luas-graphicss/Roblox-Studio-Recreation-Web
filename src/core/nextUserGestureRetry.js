import { createListenerScope } from "./listenerScope.js";


const USER_GESTURE_EVENT_TYPES = ["pointerdown", "keydown"];

const USER_GESTURE_LISTENER_OPTIONS = true;

function doNothing() {}

export function runOnNextUserGesture(scopeName, onUserGesture) {
  if (typeof onUserGesture !== "function") return doNothing;
  if (typeof window === "undefined") return doNothing;
  const gestureListeners = createListenerScope(scopeName);
  const cancelWait = () => gestureListeners.disposeAll();
  const handleFirstUserGesture = () => {


    cancelWait();
    onUserGesture();
  };
  for (const eventType of USER_GESTURE_EVENT_TYPES) {
    gestureListeners.add(window, eventType, handleFirstUserGesture, USER_GESTURE_LISTENER_OPTIONS);
  }
  return cancelWait;
}
