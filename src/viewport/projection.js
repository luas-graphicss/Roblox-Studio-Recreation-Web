let current = null;                                                                             

export function setProjection(p) {
  current = p && typeof p.project === "function" ? p : null;
}

export function clearProjection(p) {
  if (!p || current === p) current = null;
}

export function getProjection() {
  return current;
}
