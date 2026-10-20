export const KEYWORDS = new Set([
  "and", "break", "do", "else", "elseif", "end", "false", "for", "function",
  "if", "in", "local", "nil", "not", "or", "repeat", "return", "then",
  "true", "until", "while", "continue",
]);

export class LuaSyntaxError extends Error {
  constructor(message, line) {
    super(line ? `${message} (linha ${line})` : message);
    this.name = "LuaSyntaxError";
    this.luaLine = line || 0;
  }
}

function isDigit(ch) {
  return ch >= "0" && ch <= "9";
}
function isHexDigit(ch) {
  return (ch >= "0" && ch <= "9") || (ch >= "a" && ch <= "f") || (ch >= "A" && ch <= "F");
}
function isNameStart(ch) {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
}
function isNamePart(ch) {
  return isNameStart(ch) || isDigit(ch);
}

export function tokenize(source) {
  const src = String(source == null ? "" : source);
  const tokens = [];
  let i = 0;
  let line = 1;
  const n = src.length;

  function push(type, value) {
    tokens.push({ type, value, line });
  }


  function longBracketLevel(pos) {
    if (src[pos] !== "[") return -1;
    let p = pos + 1;
    let level = 0;
    while (src[p] === "=") {
      level++;
      p++;
    }
    if (src[p] === "[") return level;
    return -1;
  }


  function readLongString(level) {

    let p = i + 2 + level;

    if (src[p] === "\r") p++;
    if (src[p] === "\n") {
      line++;
      p++;
    }
    const close = "]" + "=".repeat(level) + "]";
    const start = p;
    const idx = src.indexOf(close, p);
    if (idx === -1) {
      throw new LuaSyntaxError("String/Comentário longo não terminado", line);
    }
    const value = src.slice(start, idx);
    for (let k = start; k < idx; k++) if (src[k] === "\n") line++;
    return { value, end: idx + close.length };
  }

  function readString(quote) {
    let p = i + 1;
    let out = "";
    while (p < n) {
      const ch = src[p];
      if (ch === quote) {
        p++;
        return { value: out, end: p };
      }
      if (ch === "\n" || ch === "\r") {
        throw new LuaSyntaxError("String não terminada", line);
      }
      if (ch === "\\") {
        const esc = src[p + 1];
        switch (esc) {
          case "n": out += "\n"; p += 2; break;
          case "t": out += "\t"; p += 2; break;
          case "r": out += "\r"; p += 2; break;
          case "a": out += "\x07"; p += 2; break;
          case "b": out += "\b"; p += 2; break;
          case "f": out += "\f"; p += 2; break;
          case "v": out += "\v"; p += 2; break;
          case "\\": out += "\\"; p += 2; break;
          case '"': out += '"'; p += 2; break;
          case "'": out += "'"; p += 2; break;
          case "\n": out += "\n"; line++; p += 2; break;
          case "\r": {


            out += "\n";
            line++;
            p += 2;
            if (src[p] === "\n") p++;
            break;
          }
          case "x": {


            const hex = src.slice(p + 2, p + 4);
            if (!/^[0-9a-fA-F]{2}$/.test(hex)) {
              throw new LuaSyntaxError("Escape '\\x' malformado (esperava 2 dígitos hexadecimais)", line);
            }
            out += String.fromCharCode(parseInt(hex, 16));
            p += 4;
            break;
          }
          case "z": {

            p += 2;
            while (p < n && (src[p] === " " || src[p] === "\t" || src[p] === "\r" || src[p] === "\n" || src[p] === "\f" || src[p] === "\v")) {
              if (src[p] === "\n") line++;
              p++;
            }
            break;
          }
          case "u": {

            if (src[p + 2] !== "{") { out += "u"; p += 2; break; }
            let q = p + 3;
            while (q < n && src[q] !== "}") q++;
            if (q >= n) throw new LuaSyntaxError("Escape '\\u' não terminado (esperava '}')", line);
            const cpHex = src.slice(p + 3, q);


            const cp = /^[0-9a-fA-F]+$/.test(cpHex) ? parseInt(cpHex, 16) : NaN;
            if (isNaN(cp) || cp > 0x10ffff) {
              throw new LuaSyntaxError("Escape '\\u' com codepoint inválido", line);
            }
            out += String.fromCodePoint(cp);
            p = q + 1;
            break;
          }
          default:
            if (isDigit(esc)) {
              let num = "";
              let q = p + 1;
              while (num.length < 3 && isDigit(src[q])) {
                num += src[q];
                q++;
              }
              const code = parseInt(num, 10);


              if (code > 255) {
                throw new LuaSyntaxError("Escape decimal grande demais (máx. 255)", line);
              }
              out += String.fromCharCode(code);
              p = q;
            } else {
              out += esc;
              p += 2;
            }
        }
        continue;
      }
      out += ch;
      p++;
    }
    throw new LuaSyntaxError("String não terminada", line);
  }


  function readNumber() {
    let p = i;
    const isSep = (c) => c === "_";
    if (src[p] === "0" && (src[p + 1] === "x" || src[p + 1] === "X")) {
      p += 2;
      let digits = "";
      while (p < n && (isHexDigit(src[p]) || isSep(src[p]))) {
        if (!isSep(src[p])) digits += src[p];
        p++;
      }
      if (!digits) {
        throw new LuaSyntaxError("Literal hexadecimal inválido: '0x' sem dígitos", line);
      }
      if (p < n && isNameStart(src[p])) throw new LuaSyntaxError("Número malformado", line);
      return { value: parseInt(digits, 16), end: p };
    }
    if (src[p] === "0" && (src[p + 1] === "b" || src[p + 1] === "B")) {
      p += 2;
      let digits = "";
      while (p < n && (src[p] === "0" || src[p] === "1" || isSep(src[p]))) {
        if (!isSep(src[p])) digits += src[p];
        p++;
      }
      if (!digits) {
        throw new LuaSyntaxError("Literal binário inválido: '0b' sem dígitos", line);
      }
      if (p < n && (isNameStart(src[p]) || isDigit(src[p]))) {
        throw new LuaSyntaxError("Número malformado", line);
      }
      return { value: parseInt(digits, 2), end: p };
    }
    let str = "";
    while (p < n && (isDigit(src[p]) || isSep(src[p]))) {
      if (!isSep(src[p])) str += src[p];
      p++;
    }
    if (src[p] === ".") {
      str += ".";
      p++;
      while (p < n && (isDigit(src[p]) || isSep(src[p]))) {
        if (!isSep(src[p])) str += src[p];
        p++;
      }
    }
    if (src[p] === "e" || src[p] === "E") {
      str += "e";
      p++;
      if (src[p] === "+" || src[p] === "-") {
        str += src[p];
        p++;
      }
      if (!(p < n && isDigit(src[p]))) {
        throw new LuaSyntaxError("Número malformado: expoente sem dígitos", line);
      }
      while (p < n && (isDigit(src[p]) || isSep(src[p]))) {
        if (!isSep(src[p])) str += src[p];
        p++;
      }
    }
    if (p < n && isNameStart(src[p])) throw new LuaSyntaxError("Número malformado", line);
    return { value: parseFloat(str), end: p };
  }


  function readInterpString() {
    let p = i + 1;
    const parts = [];
    let cur = "";
    while (p < n) {
      const c = src[p];
      if (c === "`") {
        parts.push({ kind: "str", value: cur });
        return { parts, end: p + 1 };
      }
      if (c === "\n" || c === "\r") throw new LuaSyntaxError("String interpolada não terminada", line);
      if (c === "\\") {
        const esc = src[p + 1];
        switch (esc) {
          case "n": cur += "\n"; p += 2; break;
          case "t": cur += "\t"; p += 2; break;
          case "r": cur += "\r"; p += 2; break;
          case "\\": cur += "\\"; p += 2; break;
          case "`": cur += "`"; p += 2; break;
          case "{": cur += "{"; p += 2; break;
          case "}": cur += "}"; p += 2; break;
          case '"': cur += '"'; p += 2; break;
          case "'": cur += "'"; p += 2; break;
          case "a": cur += "\x07"; p += 2; break;
          case "b": cur += "\b"; p += 2; break;
          case "f": cur += "\f"; p += 2; break;
          case "v": cur += "\v"; p += 2; break;
          case "x": {


            const hex = src.slice(p + 2, p + 4);
            if (!/^[0-9a-fA-F]{2}$/.test(hex)) {
              throw new LuaSyntaxError("Escape '\\x' malformado (esperava 2 dígitos hexadecimais)", line);
            }
            cur += String.fromCharCode(parseInt(hex, 16));
            p += 4;
            break;
          }
          case "u": {
            if (src[p + 2] !== "{") { cur += "u"; p += 2; break; }
            let q2 = p + 3;
            while (q2 < n && src[q2] !== "}") q2++;
            if (q2 >= n) throw new LuaSyntaxError("Escape '\\u' não terminado (esperava '}')", line);
            const cpHex = src.slice(p + 3, q2);
            const cp = /^[0-9a-fA-F]+$/.test(cpHex) ? parseInt(cpHex, 16) : NaN;
            if (isNaN(cp) || cp > 0x10ffff) {
              throw new LuaSyntaxError("Escape '\\u' com codepoint inválido", line);
            }
            cur += String.fromCodePoint(cp);
            p = q2 + 1;
            break;
          }
          case "z": {
            p += 2;
            while (p < n && (src[p] === " " || src[p] === "\t" || src[p] === "\f" || src[p] === "\v")) p++;
            break;
          }
          default:
            if (esc !== undefined && isDigit(esc)) {
              let numS = "";
              let q2 = p + 1;
              while (numS.length < 3 && isDigit(src[q2])) {
                numS += src[q2];
                q2++;
              }
              const code = parseInt(numS, 10);
              if (code > 255) {
                throw new LuaSyntaxError("Escape decimal grande demais (máx. 255)", line);
              }
              cur += String.fromCharCode(code);
              p = q2;
              break;
            }
            cur += esc === undefined ? "\\" : esc;
            p += 2;
        }
        continue;
      }
      if (c === "{") {




        parts.push({ kind: "str", value: cur });
        cur = "";
        const q = scanInterpExprEnd(p + 1);
        const source = src.slice(p + 1, q);
        if (!source.trim()) throw new LuaSyntaxError("Expressão interpolada vazia", line);
        parts.push({ kind: "expr", source });
        p = q + 1;
        continue;
      }
      cur += c;
      p++;
    }
    throw new LuaSyntaxError("String interpolada não terminada", line);



    function skipLongAt(pos) {
      let lvl = 0;
      let k = pos + 1;
      while (k < n && src[k] === "=") { lvl++; k++; }
      if (src[k] !== "[") return -1;
      const close = "]" + "=".repeat(lvl) + "]";
      const idx = src.indexOf(close, k + 1);
      if (idx < 0) {
        throw new LuaSyntaxError("String longa não terminada dentro de expressão interpolada", line);
      }
      for (let t = pos; t < idx; t++) if (src[t] === "\n") line++;
      return idx + close.length;
    }



    function skipNestedInterp(pos) {
      let k = pos;
      while (k < n) {
        const cc = src[k];
        if (cc === "`") return k + 1;
        if (cc === "\\") { k += 2; continue; }
        if (cc === "\n" || cc === "\r") throw new LuaSyntaxError("String interpolada não terminada", line);
        if (cc === "{") { k = scanInterpExprEnd(k + 1) + 1; continue; }
        k++;
      }
      throw new LuaSyntaxError("String interpolada não terminada", line);
    }


    function scanInterpExprEnd(start) {
      let depth = 1;
      let q = start;
      while (q < n) {
        const c2 = src[q];
        if (c2 === '"' || c2 === "'") {
          const quote = c2;
          q++;
          while (q < n && src[q] !== quote) {
            if (src[q] === "\\") q++;
            else if (src[q] === "\n") line++;
            q++;
          }
          q++;
          continue;
        }
        if (c2 === "`") { q = skipNestedInterp(q + 1); continue; }
        if (c2 === "[") {
          const after = skipLongAt(q);
          if (after >= 0) { q = after; continue; }
          q++;
          continue;
        }
        if (c2 === "-" && src[q + 1] === "-") {
          if (src[q + 2] === "[") {
            const after = skipLongAt(q + 2);
            if (after >= 0) { q = after; continue; }
          }
          q += 2;
          while (q < n && src[q] !== "\n") q++;
          continue;
        }
        if (c2 === "{") { depth++; q++; continue; }
        if (c2 === "}") {
          depth--;
          if (depth === 0) return q;
          q++;
          continue;
        }
        if (c2 === "\n") line++;
        q++;
      }
      throw new LuaSyntaxError("Expressão interpolada não terminada", line);
    }
  }

  while (i < n) {
    const ch = src[i];


    if (ch === "\n") {
      line++;
      i++;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\f" || ch === "\v") {
      i++;
      continue;
    }


    if (ch === "-" && src[i + 1] === "-") {
      const lvl = longBracketLevel(i + 2);
      if (lvl >= 0) {

        const save = i;
        i = i + 2;
        const { end } = readLongString(lvl);
        i = end;
        continue;
      }

      i += 2;
      while (i < n && src[i] !== "\n") i++;
      continue;
    }


    const lbl = longBracketLevel(i);
    if (lbl >= 0) {
      const startLine = line;
      const { value, end } = readLongString(lbl);
      tokens.push({ type: "String", value, line: startLine });
      i = end;
      continue;
    }


    if (ch === "`") {
      const startLine = line;
      const { parts, end } = readInterpString();
      tokens.push({ type: "InterpString", value: parts, line: startLine });
      i = end;
      continue;
    }


    if (ch === '"' || ch === "'") {
      const startLine = line;
      const { value, end } = readString(ch);
      tokens.push({ type: "String", value, line: startLine });
      i = end;
      continue;
    }


    if (isDigit(ch) || (ch === "." && isDigit(src[i + 1]))) {
      const { value, end } = readNumber();
      push("Number", value);
      i = end;
      continue;
    }


    if (isNameStart(ch)) {
      let p = i + 1;
      while (p < n && isNamePart(src[p])) p++;
      const word = src.slice(i, p);
      if (KEYWORDS.has(word)) push("Keyword", word);
      else push("Name", word);
      i = p;
      continue;
    }


    const three = src.slice(i, i + 3);
    if (three === "...") {
      push("Op", "...");
      i += 3;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (
      two === "==" || two === "~=" || two === "<=" || two === ">=" ||
      two === ".." || two === "::" ||
      two === "+=" || two === "-=" || two === "*=" || two === "/=" ||
      two === "%=" || two === "^="
    ) {


      if (two === ".." && src[i + 2] === "=") {
        push("Op", "..=");
        i += 3;
        continue;
      }
      push("Op", two);
      i += 2;
      continue;
    }

    if (two === "//") {
      if (src[i + 2] === "=") {
        push("Op", "//=");
        i += 3;
      } else {
        push("Op", "//");
        i += 2;
      }
      continue;
    }

    if ("+-*/%^#=<>(){}[];:,.?|&".includes(ch)) {
      push("Op", ch);
      i++;
      continue;
    }

    throw new LuaSyntaxError(`Caractere inesperado '${ch}'`, line);
  }

  tokens.push({ type: "EOF", value: null, line });
  return tokens;
}
