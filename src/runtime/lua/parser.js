import { tokenize, LuaSyntaxError } from "./lexer.js";

export { LuaSyntaxError };

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }
  peek(o = 0) {
    return this.tokens[this.pos + o];
  }
  next() {
    return this.tokens[this.pos++];
  }
  get line() {
    return this.peek().line;
  }
  is(type, value) {
    const t = this.peek();
    if (t.type !== type) return false;
    if (value !== undefined) {
      if (Array.isArray(value)) return value.includes(t.value);
      return t.value === value;
    }
    return true;
  }
  accept(type, value) {
    if (this.is(type, value)) return this.next();
    return null;
  }
  expect(type, value) {
    if (this.is(type, value)) return this.next();
    const t = this.peek();
    const want = value !== undefined ? `'${value}'` : type;
    throw new LuaSyntaxError(`Esperava ${want}, encontrou '${t.value == null ? t.type : t.value}'`, t.line);
  }

  parseChunk() {
    const body = this.parseBlock();
    this.expect("EOF");
    return { type: "Chunk", body };
  }

  blockEnd() {
    return (
      this.is("EOF") ||
      this.is("Keyword", "end") ||
      this.is("Keyword", "else") ||
      this.is("Keyword", "elseif") ||
      this.is("Keyword", "until")
    );
  }

  parseBlock() {
    const stmts = [];
    while (!this.blockEnd()) {
      if (this.accept("Op", ";")) continue;
      if (this.is("Keyword", "return")) {
        stmts.push(this.parseReturn());
        break;
      }
      const st = this.parseStatement();
      if (st) stmts.push(st);
    }
    return stmts;
  }

  parseReturn() {
    const line = this.line;
    this.next();          
    const args = [];
    if (!this.blockEnd() && !this.is("Op", ";")) {
      args.push(this.parseExpr());
      while (this.accept("Op", ",")) args.push(this.parseExpr());
    }
    this.accept("Op", ";");
    return { type: "Return", args, line };
  }

  parseStatement() {
    const t = this.peek();
    if (t.type === "Keyword") {
      switch (t.value) {
        case "local": return this.parseLocal();
        case "if": return this.parseIf();
        case "while": return this.parseWhile();
        case "repeat": return this.parseRepeat();
        case "for": return this.parseFor();
        case "do": {
          this.next();
          const body = this.parseBlock();
          this.expect("Keyword", "end");
          return { type: "Do", body };
        }
        case "function": return this.parseFunctionStatement();
        case "break": this.next(); return { type: "Break", line: t.line };
        case "continue": this.next(); return { type: "Continue", line: t.line };
        default:
          throw new LuaSyntaxError(`Palavra-chave inesperada '${t.value}'`, t.line);
      }
    }

    if (t.type === "Name" && (t.value === "type" || t.value === "export")) {
      const alias = this.tryParseTypeAlias();
      if (alias) return alias;
    }

    return this.parseExprStatement();
  }

  parseLocal() {
    const line = this.line;
    this.next();         
    if (this.accept("Keyword", "function")) {
      const name = this.expect("Name").value;
      const fn = this.parseFunctionBody(false);
      return { type: "LocalFunction", name, fn, line };
    }
    const names = [this.expect("Name").value];

    this.skipTypeAnnotation();
    while (this.accept("Op", ",")) {
      names.push(this.expect("Name").value);
      this.skipTypeAnnotation();
    }
    let inits = [];
    if (this.accept("Op", "=")) {
      inits.push(this.parseExpr());
      while (this.accept("Op", ",")) inits.push(this.parseExpr());
    }
    return { type: "Local", names, inits, line };
  }


  skipTypeAnnotation() {
    if (!this.is("Op", ":")) return;
    this.next();
    this.parseTypeExpr();
  }


  parseTypeExpr() {

    if (this.is("Op", "|") || this.is("Op", "&")) this.next();
    this.parseTypePrefix();
    while (this.is("Op", "|") || this.is("Op", "&")) {
      this.next();
      this.parseTypePrefix();
    }
  }

  parseTypePrefix() {
    this.parseTypeAtom();
    for (;;) {
      if (this.is("Op", "?")) {
        this.next();
        continue;
      }

      const nx = this.peek(1);
      if (this.is("Op", "-") && nx && nx.type === "Op" && nx.value === ">") {
        this.next();
        this.next();
        this.parseTypePrefix();
        continue;
      }
      break;
    }
  }

  parseTypeAtom() {
    if (this.accept("Keyword", "nil")) return;
    if (this.accept("Keyword", "true") || this.accept("Keyword", "false")) return;
    if (this.is("String")) {
      this.next();
      return;
    }
    if (this.is("Op", "(")) {
      this._skipBalancedType("(", ")");
      return;
    }
    if (this.is("Op", "{")) {
      this._skipBalancedType("{", "}");
      return;
    }
    if (this.is("Op", "...")) {

      this.next();
      this.parseTypeAtom();
      return;
    }
    if (this.is("Name")) {
      const nm = this.next().value;
      if (nm === "typeof" && this.is("Op", "(")) {
        this._skipBalancedType("(", ")");
        return;
      }
      while (this.accept("Op", ".")) this.expect("Name");
      if (this.is("Op", "<")) this._skipBalancedType("<", ">");
      return;
    }
    const t = this.peek();
    throw new LuaSyntaxError(`Tipo inválido perto de '${t.value == null ? t.type : t.value}'`, t.line);
  }


  _skipBalancedType(open, close) {
    const pairs = { "(": ")", "{": "}", "<": ">" };
    const t0 = this.expect("Op", open);
    const stack = [pairs[open]];
    while (stack.length) {
      const t = this.peek();
      if (t.type === "EOF") {
        throw new LuaSyntaxError(`Tipo não terminado: esperava '${close}'`, t0.line);
      }


      if (t.type === "Op" && t.value === "-") {
        const nx = this.peek(1);
        if (nx && nx.type === "Op" && nx.value === ">") {
          this.next();
          this.next();
          continue;
        }
      }
      if (t.type === "Op" && (t.value === "(" || t.value === "{" || t.value === "<")) {
        stack.push(pairs[t.value]);
      } else if (t.type === "Op" && (t.value === ")" || t.value === "}" || t.value === ">")) {
        stack.pop();
      }
      this.next();
    }
  }


  tryParseTypeAlias() {
    const save = this.pos;
    if (this.is("Name", "export")) this.next();
    if (!this.is("Name", "type")) {
      this.pos = save;
      return null;
    }
    const line = this.line;
    this.next();
    if (!this.is("Name")) {
      this.pos = save;
      return null;
    }
    this.next();
    if (this.is("Op", "<")) this._skipBalancedType("<", ">");
    if (!this.is("Op", "=")) {
      this.pos = save;
      return null;
    }
    this.next();
    this.parseTypeExpr();
    return { type: "TypeAlias", line };
  }

  parseIf() {
    const line = this.line;
    this.next();      
    const clauses = [];
    const cond = this.parseExpr();
    this.expect("Keyword", "then");
    clauses.push({ cond, body: this.parseBlock() });
    while (this.is("Keyword", "elseif")) {
      this.next();
      const c = this.parseExpr();
      this.expect("Keyword", "then");
      clauses.push({ cond: c, body: this.parseBlock() });
    }
    let elseBody = null;
    if (this.accept("Keyword", "else")) {
      elseBody = this.parseBlock();
    }
    this.expect("Keyword", "end");
    return { type: "If", clauses, elseBody, line };
  }

  parseWhile() {
    const line = this.line;
    this.next();
    const cond = this.parseExpr();
    this.expect("Keyword", "do");
    const body = this.parseBlock();
    this.expect("Keyword", "end");
    return { type: "While", cond, body, line };
  }

  parseRepeat() {
    const line = this.line;
    this.next();
    const body = this.parseBlock();
    this.expect("Keyword", "until");
    const cond = this.parseExpr();
    return { type: "Repeat", body, cond, line };
  }

  parseFor() {
    const line = this.line;
    this.next();       
    const first = this.expect("Name").value;
    this.skipTypeAnnotation();
    if (this.accept("Op", "=")) {

      const start = this.parseExpr();
      this.expect("Op", ",");
      const limit = this.parseExpr();
      let step = null;
      if (this.accept("Op", ",")) step = this.parseExpr();
      this.expect("Keyword", "do");
      const body = this.parseBlock();
      this.expect("Keyword", "end");
      return { type: "NumericFor", var: first, start, limit, step, body, line };
    }

    const names = [first];
    while (this.accept("Op", ",")) {
      names.push(this.expect("Name").value);
      this.skipTypeAnnotation();
    }
    this.expect("Keyword", "in");
    const exprs = [this.parseExpr()];
    while (this.accept("Op", ",")) exprs.push(this.parseExpr());
    this.expect("Keyword", "do");
    const body = this.parseBlock();
    this.expect("Keyword", "end");
    return { type: "GenericFor", names, exprs, body, line };
  }

  parseFunctionStatement() {
    const line = this.line;
    this.next();            

    let target = { type: "Name", name: this.expect("Name").value, line };
    let isMethod = false;
    while (this.is("Op", ".")) {
      this.next();
      const key = this.expect("Name").value;
      target = { type: "Index", obj: target, key: { type: "String", value: key }, line };
    }
    if (this.accept("Op", ":")) {
      const key = this.expect("Name").value;
      target = { type: "Index", obj: target, key: { type: "String", value: key }, line };
      isMethod = true;
    }
    const fn = this.parseFunctionBody(isMethod);
    return { type: "Assign", targets: [target], values: [fn], line };
  }


  parseFunctionBody(isMethod) {
    const line = this.line;

    if (this.is("Op", "<")) this._skipBalancedType("<", ">");
    this.expect("Op", "(");
    const params = [];
    let hasVararg = false;
    if (isMethod) params.push("self");
    if (!this.is("Op", ")")) {
      for (;;) {
        if (this.accept("Op", "...")) {
          hasVararg = true;

          this.skipTypeAnnotation();
          break;
        }
        params.push(this.expect("Name").value);
        this.skipTypeAnnotation();
        if (!this.accept("Op", ",")) break;
      }
    }
    this.expect("Op", ")");

    if (this.is("Op", ":")) this.skipTypeAnnotation();
    const body = this.parseBlock();
    this.expect("Keyword", "end");
    return { type: "Function", params, hasVararg, body, line };
  }

  parseExprStatement() {
    const line = this.line;
    const first = this.parseSuffixed();
    if (this.is("Op", "=") || this.is("Op", ",")) {
      const targets = [first];
      while (this.accept("Op", ",")) targets.push(this.parseSuffixed());
      this.expect("Op", "=");
      const values = [this.parseExpr()];
      while (this.accept("Op", ",")) values.push(this.parseExpr());
      for (const tg of targets) {
        if (tg.type !== "Name" && tg.type !== "Index") {
          throw new LuaSyntaxError("Alvo de atribuição inválido", line);
        }
      }
      return { type: "Assign", targets, values, line };
    }

    const compound = ["+=", "-=", "*=", "/=", "//=", "%=", "^=", "..="];
    if (this.is("Op") && compound.includes(this.peek().value)) {
      const op = this.next().value;
      const value = this.parseExpr();
      if (first.type !== "Name" && first.type !== "Index") {
        throw new LuaSyntaxError("Alvo de atribuição inválido", line);
      }
      return { type: "CompoundAssign", target: first, op: op.slice(0, op.length - 1), value, line };
    }
    if (first.type !== "Call" && first.type !== "MethodCall") {
      throw new LuaSyntaxError("Expressão não pode ser usada como comando", line);
    }
    return { type: "ExprStatement", expr: first, line };
  }


  parseExpr() {
    return this.parseOr();
  }
  parseOr() {
    let left = this.parseAnd();
    while (this.is("Keyword", "or")) {
      const line = this.line;
      this.next();
      const right = this.parseAnd();
      left = { type: "Logical", op: "or", left, right, line };
    }
    return left;
  }
  parseAnd() {
    let left = this.parseComparison();
    while (this.is("Keyword", "and")) {
      const line = this.line;
      this.next();
      const right = this.parseComparison();
      left = { type: "Logical", op: "and", left, right, line };
    }
    return left;
  }
  parseComparison() {
    let left = this.parseConcat();
    while (this.is("Op", ["==", "~=", "<", ">", "<=", ">="])) {
      const op = this.next().value;
      const right = this.parseConcat();
      left = { type: "Binary", op, left, right };
    }
    return left;
  }
  parseConcat() {

    const left = this.parseAdd();
    if (this.is("Op", "..")) {
      this.next();
      const right = this.parseConcat();
      return { type: "Binary", op: "..", left, right };
    }
    return left;
  }
  parseAdd() {
    let left = this.parseMul();
    while (this.is("Op", ["+", "-"])) {
      const op = this.next().value;
      const right = this.parseMul();
      left = { type: "Binary", op, left, right };
    }
    return left;
  }
  parseMul() {
    let left = this.parseUnary();
    while (this.is("Op", ["*", "/", "//", "%"])) {
      const op = this.next().value;
      const right = this.parseUnary();
      left = { type: "Binary", op, left, right };
    }
    return left;
  }
  parseUnary() {
    if (this.is("Keyword", "not")) {
      const line = this.line;
      this.next();
      return { type: "Unary", op: "not", expr: this.parseUnary(), line };
    }
    if (this.is("Op", "-")) {
      const line = this.line;
      this.next();
      return { type: "Unary", op: "-", expr: this.parseUnary(), line };
    }
    if (this.is("Op", "#")) {
      const line = this.line;
      this.next();
      return { type: "Unary", op: "#", expr: this.parseUnary(), line };
    }
    return this.parsePow();
  }
  parsePow() {
    const base = this.parseSuffixed();


    while (this.is("Op", "::")) {
      this.next();
      this.parseTypeExpr();
    }
    if (this.is("Op", "^")) {
      this.next();

      const exp = this.parseUnary();
      return { type: "Binary", op: "^", left: base, right: exp };
    }
    return base;
  }

  parseSuffixed() {
    let node = this.parsePrimary();
    for (;;) {
      const t = this.peek();
      if (t.type === "Op" && t.value === ".") {
        this.next();
        const key = this.expect("Name").value;
        node = { type: "Index", obj: node, key: { type: "String", value: key }, line: t.line };
      } else if (t.type === "Op" && t.value === "[") {
        this.next();
        const key = this.parseExpr();
        this.expect("Op", "]");
        node = { type: "Index", obj: node, key, computed: true, line: t.line };
      } else if (t.type === "Op" && t.value === ":") {
        this.next();
        const method = this.expect("Name").value;
        const args = this.parseCallArgs();
        node = { type: "MethodCall", obj: node, method, args, line: t.line };
      } else if (t.type === "Op" && t.value === "(") {
        const args = this.parseCallArgs();
        node = { type: "Call", func: node, args, line: t.line };
      } else if (t.type === "String") {

        const arg = { type: "String", value: this.next().value };
        node = { type: "Call", func: node, args: [arg], line: t.line };
      } else if (t.type === "InterpString") {

        const arg = this._interpNodeFromToken(this.next());
        node = { type: "Call", func: node, args: [arg], line: t.line };
      } else if (t.type === "Op" && t.value === "{") {

        const arg = this.parseTable();
        node = { type: "Call", func: node, args: [arg], line: t.line };
      } else {
        break;
      }
    }
    return node;
  }


  _interpNodeFromToken(t) {
    const parts = [];
    for (const part of t.value) {
      if (part.kind === "str") {
        if (part.value) parts.push({ kind: "str", value: part.value });
      } else {
        const sub = new Parser(tokenize(part.source));
        const expr = sub.parseExpr();
        sub.expect("EOF");
        parts.push({ kind: "expr", expr });
      }
    }
    return { type: "Interp", parts, line: t.line };
  }

  parseCallArgs() {
    const t = this.peek();
    if (t.type === "String") {
      return [{ type: "String", value: this.next().value }];
    }
    if (t.type === "InterpString") {

      return [this._interpNodeFromToken(this.next())];
    }
    if (t.type === "Op" && t.value === "{") {
      return [this.parseTable()];
    }
    this.expect("Op", "(");
    const args = [];
    if (!this.is("Op", ")")) {
      args.push(this.parseExpr());
      while (this.accept("Op", ",")) args.push(this.parseExpr());
    }
    this.expect("Op", ")");
    return args;
  }

  parsePrimary() {
    const t = this.peek();
    if (t.type === "Number") {
      this.next();
      return { type: "Number", value: t.value };
    }
    if (t.type === "String") {
      this.next();
      return { type: "String", value: t.value };
    }
    if (t.type === "InterpString") {
      this.next();
      return this._interpNodeFromToken(t);
    }
    if (t.type === "Keyword") {
      if (t.value === "nil") { this.next(); return { type: "Nil" }; }
      if (t.value === "true") { this.next(); return { type: "Boolean", value: true }; }
      if (t.value === "false") { this.next(); return { type: "Boolean", value: false }; }
      if (t.value === "function") {
        this.next();
        return this.parseFunctionBody(false);
      }
      if (t.value === "if") {

        this.next();
        const clauses = [];
        const cond = this.parseExpr();
        this.expect("Keyword", "then");
        clauses.push({ cond, value: this.parseExpr() });
        while (this.accept("Keyword", "elseif")) {
          const c = this.parseExpr();
          this.expect("Keyword", "then");
          clauses.push({ cond: c, value: this.parseExpr() });
        }
        this.expect("Keyword", "else");
        const elseValue = this.parseExpr();
        return { type: "IfExpr", clauses, elseValue, line: t.line };
      }
    }
    if (t.type === "Op" && t.value === "...") {
      this.next();
      return { type: "Vararg", line: t.line };
    }
    if (t.type === "Op" && t.value === "(") {
      this.next();
      const expr = this.parseExpr();
      this.expect("Op", ")");
      return { type: "Paren", expr };
    }
    if (t.type === "Op" && t.value === "{") {
      return this.parseTable();
    }
    if (t.type === "Name") {
      this.next();
      return { type: "Name", name: t.value, line: t.line };
    }
    throw new LuaSyntaxError(`Expressão inesperada '${t.value == null ? t.type : t.value}'`, t.line);
  }

  parseTable() {
    const line = this.line;
    this.expect("Op", "{");
    const fields = [];
    while (!this.is("Op", "}")) {
      if (this.is("Op", "[")) {
        this.next();
        const key = this.parseExpr();
        this.expect("Op", "]");
        this.expect("Op", "=");
        const value = this.parseExpr();
        fields.push({ kind: "keyed", key, value });
      } else if (this.is("Name") && this.peek(1).type === "Op" && this.peek(1).value === "=") {
        const key = this.next().value;
        this.next();     
        const value = this.parseExpr();
        fields.push({ kind: "named", key, value });
      } else {
        fields.push({ kind: "item", value: this.parseExpr() });
      }
      if (!this.accept("Op", ",") && !this.accept("Op", ";")) break;
    }
    this.expect("Op", "}");
    return { type: "Table", fields, line };
  }
}

export function parse(source) {
  const tokens = tokenize(source);
  const p = new Parser(tokens);
  return p.parseChunk();
}
