import { inferProgram, parseModeDirective, neutralTypeInfo, TYPE_DIAGNOSTIC_CODES } from "./luauInfer.js";
export { TYPE_DIAGNOSTIC_CODES };

export const LUAU_KEYWORDS = [
  "and", "break", "continue", "do", "else", "elseif", "end", "false", "for",
  "function", "if", "in", "local", "nil", "not", "or", "repeat", "return",
  "then", "true", "until", "while",
];
const KEYWORD_SET = new Set(LUAU_KEYWORDS);


export const DEFAULT_GLOBALS = new Set([
  "print", "warn", "error", "assert", "type", "typeof", "tostring", "tonumber",
  "pairs", "ipairs", "next", "select", "unpack", "rawget", "rawset", "rawequal",
  "rawlen", "setmetatable", "getmetatable", "pcall", "xpcall", "require",
  "tick", "wait", "spawn", "delay", "elapsedTime", "collectgarbage", "gcinfo",
  "newproxy", "self", "shared", "_G", "_VERSION",
  "table", "string", "math", "os", "task", "bit32", "coroutine", "utf8", "buffer", "debug",
  "game", "workspace", "script", "plugin", "Enum", "Instance",
  "Vector3", "Vector2", "CFrame", "Color3", "BrickColor", "UDim", "UDim2",
  "Rect", "Ray", "Region3", "NumberRange", "NumberSequence", "ColorSequence",
  "ColorSequenceKeypoint", "NumberSequenceKeypoint", "TweenInfo",
  "PhysicalProperties", "OverlapParams", "RaycastParams", "Random", "DateTime",
]);

const VALID_ESCAPES = new Set([
  "a", "b", "f", "n", "r", "t", "v", "\\", '"', "'", "\n", "0", "1", "2", "3",
  "4", "5", "6", "7", "8", "9", "x", "u", "z",
]);

const MULTI_OPS = [
  "...", "//=", "..=", "==", "~=", "<=", ">=", "..", "::", "->", "+=", "-=",
  "*=", "/=", "%=", "^=", "//",
];

function issue(code, severity, message, line, column, endLine, endColumn, fix) {
  return {
    code, severity, message,
    line, column,
    endLine: endLine == null ? line : endLine,
    endColumn: endColumn == null ? column + 1 : endColumn,
    fix: fix || null,
  };
}


export function tokenizeLuau(source) {
  const text = String(source == null ? "" : source);
  const n = text.length;
  const tokens = [];
  const issues = [];
  let i = 0, line = 1, col = 1;

  function adv() {
    if (text[i] === "\n") { line++; col = 1; } else { col++; }
    i++;
  }

  function longBracketLevel(pos) {
    if (text[pos] !== "[") return null;
    let level = 0, p = pos + 1;
    while (text[p] === "=") { level++; p++; }
    return text[p] === "[" ? level : null;
  }

  function consumeLongBracket(level) {

    for (let s = 0; s < level + 2; s++) adv();
    const closer = "]" + "=".repeat(level) + "]";
    while (i < n) {
      if (text[i] === "]" && text.startsWith(closer, i)) {
        for (let s = 0; s < closer.length; s++) adv();
        return true;
      }
      adv();
    }
    return false;
  }

  while (i < n) {
    const ch = text[i];
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") { adv(); continue; }


    if (ch === "-" && text[i + 1] === "-") {
      const startLine = line, startCol = col;
      adv(); adv();
      const level = longBracketLevel(i);
      if (level !== null) {
        if (!consumeLongBracket(level)) {
          issues.push(issue("LUA001", "error", "Comentário longo não fechado (falta ']" + "=".repeat(level) + "]').", startLine, startCol, startLine, startCol + 4));
        }
      } else {
        while (i < n && text[i] !== "\n") adv();
      }
      continue;
    }


    if (ch === '"' || ch === "'") {
      const quote = ch;
      const startLine = line, startCol = col;
      adv();
      let value = quote;
      let closed = false;
      while (i < n) {
        const c = text[i];
        if (c === "\\") {
          const esc = text[i + 1];
          if (esc !== undefined && !VALID_ESCAPES.has(esc)) {
            issues.push(issue("LUA013", "warning",
              "Escape inválido '\\" + esc + "' em string. Use um escape válido ou remova a barra invertida.",
              line, col, line, col + 2,
              { title: "Remover barra invertida inválida", edits: [{ line, column: col, endLine: line, endColumn: col + 2, newText: esc }] }));
          }
          value += c; adv();
          if (i < n) { value += text[i]; adv(); }
          continue;
        }
        if (c === "\n") break;                                                 
        if (c === quote) { value += c; adv(); closed = true; break; }
        value += c; adv();
      }
      if (!closed) {
        issues.push(issue("LUA001", "error", "String não fechada (falta " + quote + ").", startLine, startCol, line, col));
      }
      tokens.push({ type: "string", value, line: startLine, col: startCol, endLine: line, endCol: col });
      continue;
    }


    if (ch === "[") {
      const level = longBracketLevel(i);
      if (level !== null) {
        const startLine = line, startCol = col;
        if (!consumeLongBracket(level)) {
          issues.push(issue("LUA001", "error", "String longa não fechada (falta ']" + "=".repeat(level) + "]').", startLine, startCol, startLine, startCol + 2));
        }
        tokens.push({ type: "string", value: "[[...]]", line: startLine, col: startCol, endLine: line, endCol: col });
        continue;
      }
    }


    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(text[i + 1] || ""))) {
      const startLine = line, startCol = col;
      let value = "";
      if (ch === "0" && (text[i + 1] === "x" || text[i + 1] === "X")) {
        value += text[i]; adv(); value += text[i]; adv();
        while (i < n && /[0-9a-fA-F_]/.test(text[i])) { value += text[i]; adv(); }
      } else if (ch === "0" && (text[i + 1] === "b" || text[i + 1] === "B")) {
        value += text[i]; adv(); value += text[i]; adv();
        while (i < n && /[01_]/.test(text[i])) { value += text[i]; adv(); }
      } else {
        while (i < n && /[0-9_.]/.test(text[i])) {

          if (text[i] === "." && text[i + 1] === ".") break;
          value += text[i]; adv();
        }
        if (i < n && (text[i] === "e" || text[i] === "E")) {
          value += text[i]; adv();
          if (text[i] === "+" || text[i] === "-") { value += text[i]; adv(); }
          while (i < n && /[0-9_]/.test(text[i])) { value += text[i]; adv(); }
        }
      }
      tokens.push({ type: "number", value, line: startLine, col: startCol, endLine: startLine, endCol: startCol + value.length });
      continue;
    }


    if (/[A-Za-z_]/.test(ch)) {
      const startLine = line, startCol = col;
      let value = "";
      while (i < n && /[A-Za-z0-9_]/.test(text[i])) { value += text[i]; adv(); }
      tokens.push({
        type: KEYWORD_SET.has(value) ? "keyword" : "name",
        value, line: startLine, col: startCol, endLine: startLine, endCol: startCol + value.length,
      });
      continue;
    }


    let matched = null;
    for (const op of MULTI_OPS) {
      if (text.startsWith(op, i)) { matched = op; break; }
    }
    if (matched) {
      tokens.push({ type: "op", value: matched, line, col, endLine: line, endCol: col + matched.length });
      for (let s = 0; s < matched.length; s++) adv();
      continue;
    }
    tokens.push({ type: "op", value: ch, line, col, endLine: line, endCol: col + 1 });
    adv();
  }
  return { tokens, issues };
}











export function analyzeLuau(source, options = {}) {
  const { tokens, issues: tokenIssues } = tokenizeLuau(source);
  const issues = tokenIssues.slice();
  const maxIssues = options.maxIssues || 200;
  const knownGlobals = new Set(DEFAULT_GLOBALS);
  if (options.knownGlobals) for (const g of options.knownGlobals) knownGlobals.add(g);
  const deprecatedGlobals = options.deprecatedGlobals || {};
  const deprecatedMembers = options.deprecatedMembers || {};

  const allLocals = [];
  const globalsDefined = new Set();

  const pendingReads = [];


  const scopes = [{ id: 0, parent: -1, locals: new Map() }];
  const scopeStack = [0];
  function currentScope() { return scopes[scopeStack[scopeStack.length - 1]]; }
  function pushScope() {
    const sc = { id: scopes.length, parent: scopeStack[scopeStack.length - 1], locals: new Map() };
    scopes.push(sc); scopeStack.push(sc.id);
    return sc;
  }
  function popScope() { if (scopeStack.length > 1) scopeStack.pop(); }
  function declareLocal(tok, tokenIndex, opts = {}) {
    const sc = currentScope();
    if (sc.locals.has(tok.value) && !opts.noShadowCheck) {
      addIssue(issue("LUA007", "warning",
        "A variável local '" + tok.value + "' sombreia outra declarada no mesmo escopo.",
        tok.line, tok.col, tok.line, tok.endCol));
    }
    const entry = {
      name: tok.value, line: tok.line, col: tok.col, endCol: tok.endCol,
      tokenIndex, scopeId: sc.id,
      annotation: opts.annotation || null,
      inferredType: opts.inferredType || null,
      valueLiteral: opts.valueLiteral !== undefined ? opts.valueLiteral : null,
      maybeNil: !!opts.maybeNil,
      isFunction: !!opts.isFunction,
      isParam: !!opts.isParam,
      refs: [],
    };
    sc.locals.set(tok.value, entry);
    allLocals.push(entry);
    return entry;
  }
  function resolveLocal(name) {
    for (let s = scopeStack.length - 1; s >= 0; s--) {
      const sc = scopes[scopeStack[s]];
      if (sc.locals.has(name)) return sc.locals.get(name);
    }
    return null;
  }
  function addIssue(it) { if (issues.length < maxIssues) issues.push(it); }


  const blockStack = [];
  function pushBlock(kind, tok, flags = {}) {
    blockStack.push({ kind, line: tok.line, col: tok.col, isLoop: !!flags.isLoop, isFunction: !!flags.isFunction, awaitingDo: !!flags.awaitingDo });
    pushScope();
  }
  function insideLoop() {
    for (let b = blockStack.length - 1; b >= 0; b--) {
      if (blockStack[b].isLoop) return true;
      if (blockStack[b].isFunction) return false;
    }
    return false;
  }


  const parenStack = [];
  const PAIRS = { ")": "(", "]": "[", "}": "{" };
  let tableDepth = 0;                                              

  const len = tokens.length;
  function tk(idx) { return idx >= 0 && idx < len ? tokens[idx] : null; }
  function prevSignificant(idx) { return tk(idx - 1); }


  function consumeTypeAnnotation(k) {
    let depth = 0;
    let parts = [];
    let j = k + 1;
    while (j < len) {
      const t = tokens[j];
      if (t.type === "op") {
        if (t.value === "{" || t.value === "(" || t.value === "<") { depth++; parts.push(t.value); j++; continue; }
        if (t.value === "}" || t.value === ")" || t.value === ">") {
          if (depth === 0) break;
          depth--; parts.push(t.value); j++; continue;
        }
        if (depth > 0) { parts.push(t.value); j++; continue; }
        if (t.value === "?" || t.value === "|" || t.value === "&" || t.value === "." || t.value === "->") { parts.push(t.value); j++; continue; }
        break;
      }
      if (t.type === "name" || (t.type === "keyword" && (t.value === "nil" || t.value === "true" || t.value === "false")) || t.type === "string" || t.type === "number") {

        const prev = parts[parts.length - 1];
        if (depth === 0 && parts.length > 0 && prev !== "." && prev !== "|" && prev !== "&" && prev !== "->" && prev !== "{" && prev !== "(" && prev !== "<" && prev !== ",") break;
        parts.push(t.value); j++; continue;
      }
      if (depth > 0) { parts.push(t.value); j++; continue; }
      break;
    }
    return { text: parts.join(""), next: j };
  }


  function consumeParams(k) {
    let j = k + 1;
    while (j < len) {
      const t = tokens[j];
      if (t.type === "op" && t.value === ")") return j + 1;
      if (t.type === "name") {
        const after = tk(j + 1);
        let annotation = null;
        let next = j + 1;
        if (after && after.type === "op" && after.value === ":") {
          const ann = consumeTypeAnnotation(j + 1);
          annotation = ann.text; next = ann.next;
        }
        declareLocal(t, j, { annotation, isParam: true, noShadowCheck: false });
        j = next;
        continue;
      }
      if (t.type === "op" && t.value === "...") { j++; continue; }
      if (t.type === "op" && t.value === ",") { j++; continue; }

      j++;
    }
    return j;
  }

  let k = 0;
  while (k < len) {
    const tok = tokens[k];


    if (tok.type === "op") {
      if (tok.value === "(" || tok.value === "[") {
        parenStack.push(tok); k++; continue;
      }
      if (tok.value === "{") {
        parenStack.push(tok); tableDepth++; k++; continue;
      }
      if (tok.value === ")" || tok.value === "]" || tok.value === "}") {
        const open = parenStack[parenStack.length - 1];
        if (!open || open.value !== PAIRS[tok.value]) {
          addIssue(issue("LUA004", "error", "'" + tok.value + "' sem abertura correspondente.", tok.line, tok.col, tok.line, tok.endCol));
        } else {
          parenStack.pop();
          if (tok.value === "}") tableDepth = Math.max(0, tableDepth - 1);
        }
        k++; continue;
      }
      if (tok.value === ";") {
        const next = tk(k + 1);
        if (next && ((next.type === "op" && next.value === ";") ||
          (next.type === "keyword" && (next.value === "end" || next.value === "else" || next.value === "elseif" || next.value === "until")))) {
          addIssue(issue("LUA008", "info", "Ponto e vírgula desnecessário.", tok.line, tok.col, tok.line, tok.endCol,
            { title: "Remover ';'", edits: [{ line: tok.line, column: tok.col, endLine: tok.line, endColumn: tok.endCol, newText: "" }] }));
        }
        k++; continue;
      }
      k++; continue;
    }


    if (tok.type === "keyword") {
      switch (tok.value) {
        case "local": {
          const next = tk(k + 1);
          if (next && next.type === "keyword" && next.value === "function") {

            const nameTok = tk(k + 2);
            if (nameTok && nameTok.type === "name") {
              declareLocal(nameTok, k + 2, { isFunction: true, inferredType: "function" });
              pushBlock("function", next, { isFunction: true });
              const parenIdx = k + 3;
              if (tk(parenIdx) && tk(parenIdx).type === "op" && tk(parenIdx).value === "(") {
                parenStack.push(tk(parenIdx));
                k = consumeParams(parenIdx);

                if (parenStack[parenStack.length - 1] === tk(parenIdx)) parenStack.pop();

                const after = tk(k);
                if (after && after.type === "op" && after.value === ":") k = consumeTypeAnnotation(k).next;
                continue;
              }
              k = k + 3; continue;
            }
            k += 2; continue;
          }

          let j = k + 1;
          const declared = [];
          while (j < len) {
            const t = tk(j);
            if (t && t.type === "name") {
              let annotation = null;
              let next2 = j + 1;
              const after = tk(j + 1);
              if (after && after.type === "op" && after.value === ":") {
                const ann = consumeTypeAnnotation(j + 1);
                annotation = ann.text; next2 = ann.next;
              }
              declared.push({ tok: t, idx: j, annotation });
              j = next2;
              const sep = tk(j);
              if (sep && sep.type === "op" && sep.value === ",") { j++; continue; }
              break;
            }
            break;
          }
          const eqTok = tk(j);
          const hasInit = eqTok && eqTok.type === "op" && eqTok.value === "=";
          for (let d = 0; d < declared.length; d++) {
            const { tok: nameTok, idx, annotation } = declared[d];
            let valueLiteral = null, inferredType = null, maybeNil = !hasInit;
            if (hasInit && d === 0 && declared.length === 1) {
              const v = tk(j + 1);
              if (v) {
                if (v.type === "number") { valueLiteral = v.value; inferredType = "number"; }
                else if (v.type === "string") { valueLiteral = v.value; inferredType = "string"; }
                else if (v.type === "keyword" && (v.value === "true" || v.value === "false")) { valueLiteral = v.value; inferredType = "boolean"; }
                else if (v.type === "keyword" && v.value === "nil") { valueLiteral = "nil"; inferredType = "nil"; maybeNil = true; }
                else if (v.type === "op" && v.value === "{") { inferredType = "table"; }
                else if (v.type === "keyword" && v.value === "function") { inferredType = "function"; }
              }
            }
            declareLocal(nameTok, idx, { annotation, valueLiteral, inferredType, maybeNil });
          }
          k = j; continue;
        }
        case "function": {

          pushBlock("function", tok, { isFunction: true });
          let j = k + 1;
          const nameTok = tk(j);
          let isMethod = false;
          if (nameTok && nameTok.type === "name") {

            const after = tk(j + 1);
            const isDotted = after && after.type === "op" && (after.value === "." || after.value === ":");
            if (!isDotted) {
              globalsDefined.add(nameTok.value);
            } else {

              const entry = resolveLocal(nameTok.value);
              if (entry) entry.refs.push({ line: nameTok.line, col: nameTok.col, endCol: nameTok.endCol });
              else if (!knownGlobals.has(nameTok.value) && !globalsDefined.has(nameTok.value)) {
                addIssue(issue("LUA005", "error", "Variável não definida: '" + nameTok.value + "'.", nameTok.line, nameTok.col, nameTok.line, nameTok.endCol));
              }
            }
            j++;
            while (j < len) {
              const t = tk(j);
              if (t && t.type === "op" && (t.value === "." || t.value === ":")) {
                if (t.value === ":") isMethod = true;
                j += 2; continue;
              }
              break;
            }
          }
          if (isMethod) {

            declareLocal({ value: "self", line: tok.line, col: tok.col, endCol: tok.col + 4 }, k, { noShadowCheck: true, inferredType: "any" });
          }
          const parenTok = tk(j);
          if (parenTok && parenTok.type === "op" && parenTok.value === "(") {
            parenStack.push(parenTok);
            k = consumeParams(j);
            if (parenStack[parenStack.length - 1] === parenTok) parenStack.pop();
            const after = tk(k);
            if (after && after.type === "op" && after.value === ":") k = consumeTypeAnnotation(k).next;
            continue;
          }
          k = j; continue;
        }
        case "if": pushBlock("if", tok); k++; continue;
        case "elseif":
        case "else": {
          const top = blockStack[blockStack.length - 1];
          if (!top || top.kind !== "if") {
            addIssue(issue("LUA003", "error", "'" + tok.value + "' sem 'if' correspondente.", tok.line, tok.col, tok.line, tok.endCol));
          } else {
            popScope(); pushScope();                           
          }
          k++; continue;
        }
        case "while": pushBlock("while", tok, { isLoop: true, awaitingDo: true }); k++; continue;
        case "for": {
          pushBlock("for", tok, { isLoop: true, awaitingDo: true });

          let j = k + 1;
          while (j < len) {
            const t = tk(j);
            if (t && t.type === "name") {
              let annotation = null; let next2 = j + 1;
              const after = tk(j + 1);
              if (after && after.type === "op" && after.value === ":") {
                const ann = consumeTypeAnnotation(j + 1);
                annotation = ann.text; next2 = ann.next;
              }
              declareLocal(t, j, { annotation, inferredType: annotation ? null : "any" });
              j = next2;
              const sep = tk(j);
              if (sep && sep.type === "op" && sep.value === ",") { j++; continue; }
              break;
            }
            break;
          }
          k = j; continue;
        }
        case "do": {
          const top = blockStack[blockStack.length - 1];
          if (top && top.awaitingDo) { top.awaitingDo = false; }
          else pushBlock("do", tok);
          k++; continue;
        }
        case "repeat": pushBlock("repeat", tok, { isLoop: true }); k++; continue;
        case "until": {
          const top = blockStack[blockStack.length - 1];
          if (!top || top.kind !== "repeat") {
            addIssue(issue("LUA003", "error", "'until' sem 'repeat' correspondente.", tok.line, tok.col, tok.line, tok.endCol));
          } else {
            blockStack.pop(); popScope();
          }
          k++; continue;
        }
        case "end": {
          const top = blockStack[blockStack.length - 1];
          if (!top || top.kind === "repeat") {
            addIssue(issue("LUA003", "error", "'end' sem bloco correspondente (function/if/while/for/do).", tok.line, tok.col, tok.line, tok.endCol));
          } else {
            blockStack.pop(); popScope();
          }
          k++; continue;
        }
        case "break": {
          if (!insideLoop()) {
            addIssue(issue("LUA010", "error", "'break' fora de um loop.", tok.line, tok.col, tok.line, tok.endCol));
          }
          k++; continue;
        }
        case "continue": {

          const next = tk(k + 1);
          const isStatement = !next || (next.type === "keyword" && next.value !== "and" && next.value !== "or") || (next.type === "op" && next.value === ";");
          if (isStatement && !insideLoop()) {
            addIssue(issue("LUA011", "error", "'continue' fora de um loop.", tok.line, tok.col, tok.line, tok.endCol));
          }
          k++; continue;
        }
        case "return": {


          let j = k + 1;
          let depth = 0;                                                           
          let pdepth = 0;                               
          while (j < len) {
            const t = tokens[j];
            if (t.type === "op") {
              if (t.value === "(" || t.value === "[" || t.value === "{") pdepth++;
              else if (t.value === ")" || t.value === "]" || t.value === "}") {
                if (pdepth === 0) break;                              
                pdepth--;
              } else if (t.value === ";" && depth === 0 && pdepth === 0) break;
              j++; continue;
            }
            if (t.type === "keyword") {
              if (t.value === "function" || t.value === "if" || t.value === "while" || t.value === "for" || t.value === "do" || t.value === "repeat") {

                depth++; j++; continue;
              }
              if (t.value === "end") {
                if (depth === 0) break;
                depth--; j++; continue;
              }
              if (t.value === "until") {
                if (depth === 0) break;
                depth--; j++; continue;
              }
              if ((t.value === "else" || t.value === "elseif") && depth === 0) break;
              if (depth === 0 && pdepth === 0 && (t.value === "local" || t.value === "return" || t.value === "break" || t.value === "continue")) {
                addIssue(issue("LUA009", "error", "'return' deve ser a última instrução do bloco.", t.line, t.col, t.line, t.endCol));
                break;
              }
              j++; continue;
            }
            j++;
          }
          k++; continue;
        }
        default:
          k++; continue;
      }
    }


    if (tok.type === "string" || tok.type === "number") { k++; continue; }


    if (tok.type === "name") {
      const prev = prevSignificant(k);
      const next = tk(k + 1);
      const isMemberAccess = prev && prev.type === "op" && (prev.value === "." || prev.value === ":");

      if (isMemberAccess) {

        if (Object.prototype.hasOwnProperty.call(deprecatedMembers, tok.value)) {
          const alt = deprecatedMembers[tok.value];
          const canFix = /^[A-Za-z_][A-Za-z0-9_]*$/.test(alt);
          addIssue(issue("LUA012", "warning",
            "'" + tok.value + "' é obsoleto. Use '" + alt + "'.",
            tok.line, tok.col, tok.line, tok.endCol,
            canFix ? { title: "Substituir por '" + alt + "'", edits: [{ line: tok.line, column: tok.col, endLine: tok.line, endColumn: tok.endCol, newText: alt }] } : null));
        }

        const base = tk(k - 2);
        if (base && base.type === "name" && base.value === "math" && prev.value === "." &&
          next && next.type === "op" && next.value === "(") {
          const arg = tk(k + 2);
          if (arg && arg.type === "string") {
            addIssue(issue("LUA014", "warning",
              "math." + tok.value + " espera um número, mas recebeu uma string.",
              arg.line, arg.col, arg.endLine, arg.endCol));
          }
        }
        k++; continue;
      }


      if ((tok.value === "type" || tok.value === "export") && next && ((tok.value === "export" && next.type === "name" && next.value === "type") || (tok.value === "type" && next.type === "name" && tk(k + 2) && ((tk(k + 2).type === "op" && (tk(k + 2).value === "=" || tk(k + 2).value === "<")))))) {

        let j = tok.value === "export" ? k + 2 : k + 1;                              
        j++;                  
        let depth2 = 0;
        while (j < len) {
          const t = tokens[j];
          if (t.type === "op") {
            if (t.value === "{" || t.value === "(" || t.value === "<") { depth2++; j++; continue; }
            if (t.value === "}" || t.value === ")" || t.value === ">") { depth2 = Math.max(0, depth2 - 1); j++; continue; }
            j++; continue;
          }
          if (depth2 === 0 && t.type === "keyword" && t.value !== "nil" && t.value !== "true" && t.value !== "false") break;
          if (depth2 === 0 && t.type === "name" && t.line > tok.line) {
            const prevT = tokens[j - 1];
            const cont = prevT && prevT.type === "op" && (prevT.value === "|" || prevT.value === "&" || prevT.value === "." || prevT.value === "=" || prevT.value === "," || prevT.value === "->");
            if (!cont) break;
          }
          j++;
        }
        k = j; continue;
      }


      const isAssign = next && next.type === "op" && next.value === "=";
      if (isAssign && tableDepth > 0) { k += 2; continue; }

      const entry = resolveLocal(tok.value);
      if (isAssign) {
        if (entry) {
          entry.refs.push({ line: tok.line, col: tok.col, endCol: tok.endCol });

          const v = tk(k + 2);
          if (v && !(v.type === "keyword" && v.value === "nil")) entry.maybeNil = false;
        } else if (!knownGlobals.has(tok.value) && !globalsDefined.has(tok.value)) {
          globalsDefined.add(tok.value);                                                
          addIssue(issue("LUA016", "warning",
            "A atribuição a '" + tok.value + "' cria uma global implícita. Declare com 'local'.",
            tok.line, tok.col, tok.line, tok.endCol,
            { title: "Adicionar 'local'", edits: [{ line: tok.line, column: tok.col, endLine: tok.line, endColumn: tok.col, newText: "local " }] }));
        }
        k++; continue;
      }


      if (entry) {
        entry.refs.push({ line: tok.line, col: tok.col, endCol: tok.endCol });
        if (k < entry.tokenIndex) {
          addIssue(issue("LUA006", "warning",
            "'" + tok.value + "' é usada antes da sua definição (linha " + entry.line + ").",
            tok.line, tok.col, tok.line, tok.endCol));
        }
        if (entry.maybeNil && next && next.type === "op" && (next.value === "." || next.value === ":")) {
          addIssue(issue("LUA015", "warning",
            "'" + tok.value + "' pode ser nil neste ponto; acessar membros causará erro.",
            tok.line, tok.col, tok.line, tok.endCol));
        }
        k++; continue;
      }
      if (globalsDefined.has(tok.value)) { k++; continue; }
      if (knownGlobals.has(tok.value)) {
        if (Object.prototype.hasOwnProperty.call(deprecatedGlobals, tok.value) && (!prev || !(prev.type === "op" && prev.value === "."))) {
          const alt = deprecatedGlobals[tok.value];
          const canFix = /^[A-Za-z_][A-Za-z0-9_.]*$/.test(alt);
          addIssue(issue("LUA012", "warning",
            "'" + tok.value + "' é obsoleto. Use '" + alt + "'.",
            tok.line, tok.col, tok.line, tok.endCol,
            canFix ? { title: "Substituir por '" + alt + "'", edits: [{ line: tok.line, column: tok.col, endLine: tok.line, endColumn: tok.endCol, newText: alt }] } : null));
        }
        k++; continue;
      }
      pendingReads.push({ tok, scopeId: scopeStack[scopeStack.length - 1] });
      k++; continue;
    }

    k++;
  }


  for (const pr of pendingReads) {
    let entry = null;
    let sid = pr.scopeId;
    while (sid >= 0) {
      const sc = scopes[sid];
      if (sc.locals.has(pr.tok.value)) { entry = sc.locals.get(pr.tok.value); break; }
      sid = sc.parent;
    }
    if (entry) {
      entry.refs.push({ line: pr.tok.line, col: pr.tok.col, endCol: pr.tok.endCol });
      addIssue(issue("LUA006", "warning",
        "'" + pr.tok.value + "' é usada antes da sua definição (linha " + entry.line + ").",
        pr.tok.line, pr.tok.col, pr.tok.line, pr.tok.endCol));
    } else if (!globalsDefined.has(pr.tok.value)) {
      addIssue(issue("LUA005", "error",
        "Variável não definida: '" + pr.tok.value + "'.",
        pr.tok.line, pr.tok.col, pr.tok.line, pr.tok.endCol));
    }
  }


  const lastTok = tokens[len - 1];
  const eofLine = lastTok ? lastTok.endLine || lastTok.line : 1;
  const eofCol = lastTok ? lastTok.endCol || 1 : 1;
  for (let b = blockStack.length - 1; b >= 0; b--) {
    const blk = blockStack[b];
    const closer = blk.kind === "repeat" ? "until" : "end";
    addIssue(issue("LUA002", "error",
      "Bloco '" + blk.kind + "' aberto na linha " + blk.line + " não foi fechado (falta '" + closer + "').",
      blk.line, blk.col, blk.line, blk.col + blk.kind.length,
      closer === "end" ? { title: "Adicionar 'end' no final", edits: [{ line: eofLine, column: eofCol, endLine: eofLine, endColumn: eofCol, newText: "\nend" }] } : null));
  }
  for (let p = parenStack.length - 1; p >= 0; p--) {
    const open = parenStack[p];
    const closer = open.value === "(" ? ")" : open.value === "[" ? "]" : "}";
    addIssue(issue("LUA004", "error",
      "'" + open.value + "' aberto na linha " + open.line + " não foi fechado (falta '" + closer + "').",
      open.line, open.col, open.line, open.col + 1,
      { title: "Adicionar '" + closer + "' no final", edits: [{ line: eofLine, column: eofCol, endLine: eofLine, endColumn: eofCol, newText: closer }] }));
  }


  const typeCheck = options.typeCheck !== false;
  const modeOpt = INFER_MODES.indexOf(options.mode) >= 0 ? options.mode : null;


  const mode = parseModeDirective(source) || modeOpt || "nonstrict";


  const inferEnabled = tokens.length > 0;
  let typeInfo = neutralTypeInfo(mode);
  let _inferWarnedOnce = false;
  if (inferEnabled) {
    try {
      typeInfo = inferProgram({
        source,
        tokens,
        mode,
        lintLocals: allLocals,

        maxIssues: typeCheck ? Math.max(0, maxIssues - issues.length) : 0,
        resolveRequire: options.resolveRequire || null,
        typeApi: options.typeApi || null,
      });
    } catch (e) {
      if (!_inferWarnedOnce) {
        _inferWarnedOnce = true;
        console.warn("[luauAnalysis] inferProgram falhou:", e && e.message);
      }
      typeInfo = neutralTypeInfo(mode);
    }
  }


  const typeIssuePosSet = new Set();
  for (const it of typeInfo.issues) {
    if (it.code === "LUA018" || it.code === "LUA022") {
      typeIssuePosSet.add(it.line + ":" + it.column);
    }
  }
  const filteredLintIssues = issues.filter(function (it) {
    if ((it.code === "LUA014" || it.code === "LUA015") && typeIssuePosSet.has(it.line + ":" + it.column)) return false;
    return true;
  });


  const merged = filteredLintIssues.concat(typeInfo.issues).sort(function (a, b) {
    return a.line !== b.line ? a.line - b.line : a.column - b.column;
  }).slice(0, maxIssues);

  return { issues: merged, locals: allLocals, globalsDefined, mode, typeInfo };
}

const INFER_MODES = ["strict", "nonstrict", "nocheck"];


export function countIssues(issues) {
  let errors = 0, warnings = 0, infos = 0;
  for (const it of issues) {
    if (it.severity === "error") errors++;
    else if (it.severity === "warning") warnings++;
    else infos++;
  }
  return { errors, warnings, infos };
}
