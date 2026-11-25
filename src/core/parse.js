// src/core/parse.js
// 10ms core · parser: token → cây AST. Thuần, zero dependency.
// P4 deterministic · P6 một cách viết · D12 canonical · D13 errors are data · D16 intent.

function fail(tok, expected, fix, seed) {
  const e = new Error('syntax');
  e.detail = {
    error: 'syntax',
    pos: { line: tok.line, col: tok.col },
    expected,
    fix,
    seed,
  };
  throw e;
}

function parse(tokens, seed = 0) {
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function expect(type, expectedDesc, fix) {
    const t = peek();
    if (!t || t.type !== type) {
      fail(t || tokens[tokens.length - 1], expectedDesc, fix, seed);
    }
    return next();
  }

  // Keep Web and Worker bodies on their own statement grammars (P6, P7).
  function parseBlock(statementParser = parseStatement) {
    expect('NEWLINE', 'end of line', 'add a newline');
    expect('INDENT', 'an indented block (2 spaces)', '  <statement>');
    const body = [];
    while (peek() && peek().type !== 'DEDENT' && peek().type !== 'EOF') {
      body.push(statementParser());
      if (peek() && peek().type === 'NEWLINE') next();
    }
    if (peek() && peek().type === 'DEDENT') next();
    return body;
  }

  // Statement: Web keywords, Worker handlers, or a canonical assignment.
  function parseStatement() {
    const t = peek();
    if (!t || t.type !== 'IDENT') {
      fail(t || tokens[tokens.length - 1],
        'one of: page, input, btn, p, each, on, or <name> =',
        '<statement>', seed);
    }
    if (t.value === 'page')  return parsePage();
    if (t.value === 'input') return parseInput();
    if (t.value === 'btn')   return parseBtn();
    if (t.value === 'p')     return parseP();
    if (t.value === 'each')  return parseEach();
    if (t.value === 'on')    return parseOn();
    return parseAssign();
  }

  function parsePage() {
    const kw = next();
    expect('SLASH', '"/" (page path)', 'page /');
    const body = parseBlock();
    return { type: 'Page', path: '/', body, line: kw.line };
  }

  function parseInput() {
    const kw = next();
    const name = expect('IDENT', 'a variable name', 'input <name>');
    return { type: 'Input', var: name.value, line: kw.line };
  }

  function parseBtn() {
    const kw = next();
    const label = expect('STRING', 'a button label in quotes', 'btn "Label"');
    const body = parseBlock(); // click handler
    return { type: 'Btn', label: label.value, body, line: kw.line };
  }

  function parseP() {
    const kw = next();
    const expr = parseExpr();
    return { type: 'P', expr, line: kw.line };
  }

  function parseEach() {
    const kw = next();
    const list = parseExpr();
    const name = expect('IDENT', 'a loop variable name', 'each <list> <name>');
    const body = parseBlock();
    return { type: 'Each', list, var: name.value, body, line: kw.line };
  }

  function parseAssign() {
    const name = expect('IDENT', 'a variable name', '<name> = <expr>');
    expect('ASSIGN', '"=" after the name', name.value + ' = <expr>');
    const value = parseExpr();
    return { type: 'Assign', name: name.value, value, line: name.line };
  }

  // A Worker handler is either on GET/POST /path or on every <duration>.
  function parseOn() {
    const kw = next();
    const kind = expect('IDENT', 'GET, POST, or every after on', 'on GET /path');
    if (kind.value === 'every') {
      const duration = expect('DURATION', 'a duration such as 1h, 1m, or 1s', 'on every 1h');
      return { type: 'On', every: duration.value, line: kw.line, body: parseBlock(parseWorkerStatement) };
    }
    if (kind.value !== 'GET' && kind.value !== 'POST') {
      fail(kind, 'GET, POST, or every after on', 'on GET /path', seed);
    }
    expect('SLASH', 'a route path beginning with /', 'on ' + kind.value + ' /path');
    const first = expect('IDENT', 'a route path after /', 'on ' + kind.value + ' /path');
    let path = '/' + first.value;
    while (peek() && peek().type === 'SLASH') {
      next();
      path += '/' + expect('IDENT', 'a route path segment', 'on ' + kind.value + ' /path').value;
    }
    return { type: 'On', method: kind.value, path, line: kw.line, body: parseBlock(parseWorkerStatement) };
  }

  // Dotted request paths are data in Need and Path AST nodes (P7).
  function parseDottedPath() {
    const first = expect('IDENT', 'a path name', 'body.msg');
    let path = first.value;
    let dotted = false;
    while (peek() && peek().type === 'DOT') {
      next();
      path += '.' + expect('IDENT', 'a path segment after .', 'body.msg').value;
      dotted = true;
    }
    return { path, line: first.line, dotted };
  }

  function parseNeed() {
    const kw = next();
    const path = parseDottedPath();
    const ty = expect('IDENT', 'a need type', 'need body.msg text');
    return { type: 'Need', path: path.path, ty: ty.value, line: kw.line };
  }

  function parseWorkerStatement() {
    const t = peek();
    if (t && t.type === 'AT') {
      const effect = parseEffect();
      return { type: 'EffectCall', path: effect.path, args: effect.args, line: t.line };
    }
    if (!t || t.type !== 'IDENT') {
      fail(t || tokens[tokens.length - 1],
        'need, reply, @effect, or <name> =', '<worker statement>', seed);
    }
    if (t.value === 'need') return parseNeed();
    if (t.value === 'reply') {
      const kw = next();
      return { type: 'Reply', value: parseExpr(), line: kw.line };
    }
    return parseAssign();
  }

  // Expr: atom (('+' atom)*) — kết hợp trái, một phép cộng duy nhất (P6).
  function parseExpr() {
    let left = parseAtom();
    while (peek() && peek().type === 'PLUS') {
      next();
      const right = parseAtom();
      left = { type: 'Binary', op: '+', left, right };
    }
    return left;
  }

  // Parse an effect path and its space-separated expressions up to its enclosing delimiter.
  function parseEffect() {
    expect('AT', '@ before an effect name', '@store.add <args>');
    const namespace = expect('IDENT', 'an effect namespace', '@store.add');
    expect('DOT', '. between effect namespace and name', '@store.add');
    const name = expect('IDENT', 'an effect name', '@store.add');
    const args = [];
    while (peek() && !['NEWLINE', 'DEDENT', 'EOF', 'RBRACE', 'RBRACK', 'COMMA'].includes(peek().type)) {
      args.push(parseExpr());
    }
    return { type: 'Effect', path: namespace.value + '.' + name.value, args };
  }

  function parseObject() {
    expect('LBRACE', '"{" before an object', '{key: expr}');
    const entries = [];
    if (!peek() || peek().type !== 'RBRACE') {
      while (true) {
        const key = expect('IDENT', 'an object key', '{key: expr}');
        expect('COLON', ': after an object key', key.value + ': <expr>');
        entries.push({ key: key.value, value: parseExpr() });
        if (!peek() || peek().type !== 'COMMA') break;
        next();
      }
    }
    expect('RBRACE', '"}" after an object', '{key: expr}');
    return { type: 'Object', entries };
  }

  // Atom: Web values plus the Worker paths, objects and effects in SPEC v1.
  function parseAtom() {
    const t = peek();
    if (!t) fail(tokens[tokens.length - 1], 'an expression', '<expr>', seed);
    if (t.type === 'NUMBER') { next(); return { type: 'Number', value: t.value }; }
    if (t.type === 'STRING') { next(); return { type: 'String', value: t.value }; }
    if (t.type === 'IDENT') {
      const path = parseDottedPath();
      return path.dotted ? { type: 'Path', path: path.path } : { type: 'Var', name: path.path };
    }
    if (t.type === 'AT') return parseEffect();
    if (t.type === 'LBRACE') return parseObject();
    if (t.type === 'LBRACK') {
      next();
      const items = [];
      if (peek() && peek().type !== 'RBRACK') items.push(parseExpr());
      expect('RBRACK', '"]"', '[] or [<expr>]');
      return { type: 'Array', items };
    }
    fail(t, 'an expression (number, string, name, array, object, or @effect)', '<expr>', seed);
  }

  // Program = statement*.
  const body = [];
  while (peek() && peek().type !== 'EOF') {
    if (peek().type === 'NEWLINE') { next(); continue; }
    body.push(parseStatement());
    if (peek() && peek().type === 'NEWLINE') next();
  }
  return { type: 'Program', body };
}

module.exports = { parse };
