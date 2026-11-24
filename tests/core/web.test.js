// tests/core/web.test.js
// Chạy: node tests/core/web.test.js
// Nguồn: SPEC.md — ví dụ Web, dạng chuẩn (thụt 2 dấu cách, btn có ngoặc kép).
// (Prompt dán phẳng có thể mất thụt/nháy; đây mới là dạng đúng của ngôn ngữ.)

const { lex } = require('../../src/core/lex');
const { parse } = require('../../src/core/parse');

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; }
  else console.log('OK  :', msg);
}
function parseSource(src) {
  const { tokens, seed } = lex(src);
  return parse(tokens, seed);
}

const WEB = `page /
  tasks = []
  text = ""
  input text
  btn "Add"
    tasks = tasks + [text]
    text = ""
  each tasks t
    p t
`;

function run(label, src) {
  console.log('\n=== ' + label + ' ===');
  try {
    const { tokens, seed } = lex(src);
    console.log('seed:', seed);
    const ast = parse(tokens, seed);
    console.log(JSON.stringify(ast, null, 2));
  } catch (e) {
    console.log('ERROR (D13):');
    console.log(JSON.stringify(e.detail, null, 2));
  }
}

// 1. Ví dụ Web — kỳ vọng in ra AST đầy đủ
run('Web example (SPEC)', WEB);

// D12: canonical Web syntax and the three supported `+` operand types.
const webAst = parseSource(WEB);
assert(webAst.body[0].type === 'Page', 'canonical Web example parses');
const plusAst = parseSource(`page /\n  p 1 + 2\n  p "a" + "b"\n  p [1] + [2]\n`);
assert(plusAst.body[0].body.length === 3, 'number, text, and array + expressions parse');
for (const [label, src] of [
  ['f(x)', `page /\n  value = f(x)\n`],
  ['if', `page /\n  if condition\n    p "x"\n`],
  ['while', `page /\n  while condition\n    p "x"\n`],
]) {
  let error;
  try { parseSource(src); } catch (e) { error = e; }
  assert(error && error.detail && error.detail.error === 'syntax', `${label} is a hard syntax error`);
}
let aboutError;
try { parseSource('page /about\n  p "x"\n'); } catch (e) { aboutError = e; }
assert(aboutError && aboutError.detail && aboutError.detail.error === 'syntax',
  'page /about is a hard syntax error in v1');

const spec = require('fs').readFileSync(require('path').join(__dirname, '../../SPEC.md'), 'utf8');
assert(spec.includes(WEB.trimEnd()), 'SPEC Web example exactly matches the test fixture');
const canonical = spec.split('## Canonical D12')[1].split('## Grammar')[0];
const effects = spec.split('## Effects')[1] || '';
assert(/^\| Sai \/ không chuẩn \| Dạng chuẩn \| Sửa đúng \|$/m.test(spec),
  'Canonical table maps incorrect forms to canonical fixes');
assert(!canonical.includes('+') && spec.includes('## Polymorphic `+`'),
  'polymorphic + is documented separately from the Canonical table');
for (const effect of ['@store.get', '@store.add', '@store.del', '@store.set',
  '@net.fetch', '@time.now', '@rand.int']) {
  assert(effects.includes(effect), `${effect} is listed in SPEC`);
}
assert(spec.trimEnd().split('\n').length <= 60, 'SPEC is no more than 60 lines');

// 2. Bonus: lỗi cú pháp → JSON D13 (vị trí, mong đợi, bản sửa, seed)
run('Error case: "tasks == []"', `page /
  tasks == []
`);
