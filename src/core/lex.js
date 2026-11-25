// src/core/lex.js
// 10ms core · lexer: chữ → token. Thuần, zero dependency.
// P1 zero dep · P4 deterministic · P6 một cách viết · D12 canonical · D13 errors are data.

// Seed = băm nguồn. Cùng nguồn → cùng seed → cùng lỗi (P4, D13).
function seedOf(src) {
  let h = 0;
  for (let i = 0; i < src.length; i++) {
    h = ((h * 31) + src.charCodeAt(i)) >>> 0;
  }
  return h;
}

// Mọi lỗi lexer đi qua đây: JSON đúng D13, không ném chuỗi thô.
function fail(line, col, expected, fix, seed) {
  const e = new Error('syntax');
  e.detail = { error: 'syntax', pos: { line, col }, expected, fix, seed };
  throw e;
}

function lex(src) {
  const seed = seedOf(src);
  const tokens = [];
  const text = src.endsWith('\n') ? src : src + '\n';
  const lines = text.split('\n');
  lines.pop();

  const stack = [0]; // ngăn xếp thụt lề, Python-style
  let lineNo = 0;

  for (const raw of lines) {
    lineNo++;

    // P6: chỉ dùng dấu cách thụt lề. Tab là lỗi, kèm bản sửa (D12).
    const tabAt = raw.indexOf('\t');
    if (tabAt !== -1) {
      fail(lineNo, tabAt + 1,
        'spaces only for indentation (no tab)',
        raw.slice(0, tabAt) + '  ' + raw.slice(tabAt + 1),
        seed);
    }

    // Đếm thụt lề đầu dòng
    let spaces = 0;
    while (spaces < raw.length && raw[spaces] === ' ') spaces++;
    const content = raw.slice(spaces);
    if (content.length === 0) continue; // dòng trống: bỏ

    // INDENT / DEDENT
    const top = stack[stack.length - 1];
    if (spaces > top) {
      stack.push(spaces);
      tokens.push({ type: 'INDENT', line: lineNo, col: 1 });
    } else if (spaces < top) {
      while (stack.length > 1 && stack[stack.length - 1] > spaces) {
        stack.pop();
        tokens.push({ type: 'DEDENT', line: lineNo, col: 1 });
      }
      if (stack[stack.length - 1] !== spaces) {
        const want = ' '.repeat(stack[stack.length - 1]);
        fail(lineNo, 1,
          'consistent indentation (' + stack[stack.length - 1] + ' spaces)',
          want + content,
          seed);
      }
    }

    // Tokenize phần thân dòng
    let p = 0;
    while (p < content.length) {
      const ch = content[p];
      const col = spaces + p + 1;

      if (ch === ' ') { p++; continue; }
      if (ch === '=') { tokens.push({ type: 'ASSIGN', value: '=', line: lineNo, col }); p++; continue; }
      if (ch === '+') { tokens.push({ type: 'PLUS',   value: '+', line: lineNo, col }); p++; continue; }
      if (ch === '@') { tokens.push({ type: 'AT', value: '@', line: lineNo, col }); p++; continue; }
      if (ch === '.') { tokens.push({ type: 'DOT', value: '.', line: lineNo, col }); p++; continue; }
      if (ch === '[') { tokens.push({ type: 'LBRACK', value: '[', line: lineNo, col }); p++; continue; }
      if (ch === ']') { tokens.push({ type: 'RBRACK', value: ']', line: lineNo, col }); p++; continue; }
      if (ch === '/') { tokens.push({ type: 'SLASH',  value: '/', line: lineNo, col }); p++; continue; }
      if (ch === '{') { tokens.push({ type: 'LBRACE', value: '{', line: lineNo, col }); p++; continue; }
      if (ch === '}') { tokens.push({ type: 'RBRACE', value: '}', line: lineNo, col }); p++; continue; }
      if (ch === ':') { tokens.push({ type: 'COLON', value: ':', line: lineNo, col }); p++; continue; }
      if (ch === ',') { tokens.push({ type: 'COMMA', value: ',', line: lineNo, col }); p++; continue; }

      if (ch === '"') {
        let j = p + 1;
        let s = '';
        let closed = false;
        while (j < content.length) {
          if (content[j] === '\\' && j + 1 < content.length) { s += content[j + 1]; j += 2; continue; }
          if (content[j] === '"') { closed = true; break; }
          s += content[j];
          j++;
        }
        if (!closed) {
          fail(lineNo, col, 'closing "', content.slice(0, p) + '"' + s + '"', seed);
        }
        tokens.push({ type: 'STRING', value: s, line: lineNo, col });
        p = j + 1;
        continue;
      }

      if (ch >= '0' && ch <= '9') {
        let j = p;
        while (j < content.length && content[j] >= '0' && content[j] <= '9') j++;
        const unit = content[j];
        const afterUnit = content[j + 1];
        if ((unit === 'h' || unit === 'm' || unit === 's') &&
            !(afterUnit && /[A-Za-z0-9_]/.test(afterUnit))) {
          tokens.push({ type: 'DURATION', value: content.slice(p, j + 1), line: lineNo, col });
          p = j + 1;
          continue;
        }
        tokens.push({ type: 'NUMBER', value: parseInt(content.slice(p, j), 10), line: lineNo, col });
        p = j;
        continue;
      }

      if (/[A-Za-z_]/.test(ch)) {
        let j = p;
        while (j < content.length && /[A-Za-z0-9_]/.test(content[j])) j++;
        tokens.push({ type: 'IDENT', value: content.slice(p, j), line: lineNo, col });
        p = j;
        continue;
      }

      fail(lineNo, col, 'a valid token', content.slice(0, p) + content.slice(p + 1), seed);
    }

    tokens.push({ type: 'NEWLINE', line: lineNo, col: spaces + content.length + 1 });
  }

  // Đóng mọi INDENT còn mở
  while (stack.length > 1) {
    stack.pop();
    tokens.push({ type: 'DEDENT', line: lineNo, col: 1 });
  }

  tokens.push({ type: 'EOF', line: lineNo + 1, col: 1 });
  return { tokens, seed };
}

module.exports = { lex, seedOf };
