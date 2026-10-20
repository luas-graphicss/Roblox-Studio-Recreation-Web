export function flattenVisible({ roots, isExpanded, filterSet = null, hides = null }) {
  const out = [];
  if (!roots || !roots.length) return out;
  const stack = [];
  for (let i = roots.length - 1; i >= 0; i--) stack.push([roots[i], 0]);
  while (stack.length) {
    const [inst, depth] = stack.pop();
    if (!inst) continue;
    if (filterSet && !filterSet.has(inst.id)) continue;
    if (hides && hides(inst)) continue;
    out.push({ inst, depth });
    const open = filterSet ? true : !!isExpanded(inst.id);
    if (!open) continue;
    const children = typeof inst.getChildren === "function" ? inst.getChildren() : null;
    if (!children || !children.length) continue;
    for (let i = children.length - 1; i >= 0; i--) stack.push([children[i], depth + 1]);
  }
  return out;
}

export function computeWindow({ scrollTop, viewportHeight, rowHeight, total, buffer = 8 }) {
  const rh = Math.max(1, Math.floor(rowHeight) || 1);
  const t = Math.max(0, Math.floor(total) || 0);
  const top = Math.max(0, Number(scrollTop) || 0);
  const height = Math.max(0, Number(viewportHeight) || 0);
  let first = Math.floor(top / rh) - buffer;
  if (first < 0) first = 0;
  const visibleCount = Math.ceil(height / rh) + buffer * 2;
  let last = first + visibleCount;
  if (last > t - 1) last = t - 1;
  if (first > last) first = Math.max(0, last);
  return { first, last, totalHeight: t * rh };
}
