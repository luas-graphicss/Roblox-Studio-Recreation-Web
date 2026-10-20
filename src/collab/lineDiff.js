export const DIFF_MAX_LINES = 50000;
const LCS_CELL_BUDGET = 4000000;

export function splitLines(text) {
  const s = typeof text === "string" ? text : "";
  if (s === "") return [];
  return s.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
}

function lcsTable(a, b) {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const dp = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    const row = i * width;
    const next = (i + 1) * width;
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) dp[row + j] = dp[next + j + 1] + 1;
      else dp[row + j] = Math.max(dp[next + j], dp[row + j + 1]);
    }
  }
  return dp;
}

export function diffLines(aText, bText) {
  let aLines = splitLines(aText);
  let bLines = splitLines(bText);
  let truncated = false;
  if (aLines.length > DIFF_MAX_LINES) {
    aLines = aLines.slice(0, DIFF_MAX_LINES);
    truncated = true;
  }
  if (bLines.length > DIFF_MAX_LINES) {
    bLines = bLines.slice(0, DIFF_MAX_LINES);
    truncated = true;
  }
  const ops = [];
  let lo = 0;
  while (lo < aLines.length && lo < bLines.length && aLines[lo] === bLines[lo]) lo++;
  let aHi = aLines.length;
  let bHi = bLines.length;
  while (aHi > lo && bHi > lo && aLines[aHi - 1] === bLines[bHi - 1]) {
    aHi--;
    bHi--;
  }
  for (let i = 0; i < lo; i++) {
    ops.push({ type: "same", text: aLines[i], aLine: i + 1, bLine: i + 1 });
  }
  const aMid = aLines.slice(lo, aHi);
  const bMid = bLines.slice(lo, bHi);
  if (aMid.length && bMid.length && (aMid.length + 1) * (bMid.length + 1) <= LCS_CELL_BUDGET) {
    const width = bMid.length + 1;
    const dp = lcsTable(aMid, bMid);
    let i = 0;
    let j = 0;
    while (i < aMid.length && j < bMid.length) {
      if (aMid[i] === bMid[j]) {
        ops.push({ type: "same", text: aMid[i], aLine: lo + i + 1, bLine: lo + j + 1 });
        i++;
        j++;
      } else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
        ops.push({ type: "del", text: aMid[i], aLine: lo + i + 1 });
        i++;
      } else {
        ops.push({ type: "add", text: bMid[j], bLine: lo + j + 1 });
        j++;
      }
    }
    while (i < aMid.length) {
      ops.push({ type: "del", text: aMid[i], aLine: lo + i + 1 });
      i++;
    }
    while (j < bMid.length) {
      ops.push({ type: "add", text: bMid[j], bLine: lo + j + 1 });
      j++;
    }
  } else {
    for (let i = 0; i < aMid.length; i++) {
      ops.push({ type: "del", text: aMid[i], aLine: lo + i + 1 });
    }
    for (let j = 0; j < bMid.length; j++) {
      ops.push({ type: "add", text: bMid[j], bLine: lo + j + 1 });
    }
  }
  for (let k = 0; k < aLines.length - aHi; k++) {
    ops.push({
      type: "same",
      text: aLines[aHi + k],
      aLine: aHi + k + 1,
      bLine: bHi + k + 1,
    });
  }
  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.type === "add") added++;
    else if (op.type === "del") removed++;
  }
  return { ops, truncated, added, removed };
}

export function sideBySideRows(ops) {
  const rows = [];
  let k = 0;
  const list = Array.isArray(ops) ? ops : [];
  while (k < list.length) {
    const op = list[k];
    if (op.type === "same") {
      rows.push({
        kind: "same",
        leftNo: op.aLine,
        leftText: op.text,
        rightNo: op.bLine,
        rightText: op.text,
      });
      k++;
      continue;
    }
    const dels = [];
    const adds = [];
    while (k < list.length && list[k].type === "del") {
      dels.push(list[k]);
      k++;
    }
    while (k < list.length && list[k].type === "add") {
      adds.push(list[k]);
      k++;
    }
    const pairs = Math.max(dels.length, adds.length);
    for (let idx = 0; idx < pairs; idx++) {
      const d = dels[idx] || null;
      const a = adds[idx] || null;
      rows.push({
        kind: d && a ? "mod" : d ? "del" : "add",
        leftNo: d ? d.aLine : null,
        leftText: d ? d.text : "",
        rightNo: a ? a.bLine : null,
        rightText: a ? a.text : "",
      });
    }
  }
  return rows;
}

export function changeSummary(diff) {
  const d = diff && typeof diff === "object" ? diff : { added: 0, removed: 0 };
  const parts = [];
  if (d.added) parts.push("+" + d.added);
  if (d.removed) parts.push("\u2212" + d.removed);
  return parts.length ? parts.join(" / ") : "sem mudan\u00e7as";
}

export function changedLinePreview(diff, max = 3) {
  const out = [];
  const list = diff && Array.isArray(diff.ops) ? diff.ops : [];
  for (const op of list) {
    if (op.type === "same") continue;
    out.push({ type: op.type, text: String(op.text).slice(0, 80) });
    if (out.length >= max) break;
  }
  return out;
}
