// tests/core/spec-examples.test.js
// Run: node tests/core/spec-examples.test.js
// P4: compile both canonical SPEC examples through the real lexer and parser.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { lex } = require('../../src/core/lex');
const { parse } = require('../../src/core/parse');

const spec = fs.readFileSync(path.join(__dirname, '../../SPEC.md'), 'utf8');
function readExample(label) {
  const section = spec.split('## Examples')[1];
  const labelAt = section.indexOf(label);
  assert.notEqual(labelAt, -1, `SPEC contains ${label}`);
  const fence = '```10ms\n';
  const start = section.indexOf(fence, labelAt);
  assert.notEqual(start, -1, `${label} has a 10ms code fence`);
  const codeStart = start + fence.length;
  const end = section.indexOf('\n```', codeStart);
  assert.notEqual(end, -1, `${label} code fence closes`);
  return section.slice(codeStart, end) + '\n';
}
function compile(source) {
  const { tokens, seed } = lex(source);
  return parse(tokens, seed);
}

const webSource = readExample('Web (');
const workerSource = readExample('Worker (');
const web = compile(webSource);
const worker = compile(workerSource);

assert.equal(web.type, 'Program');
assert.equal(web.body.length, 1);
assert.equal(web.body[0].type, 'Page');
assert.deepEqual(web.body[0].body.map((statement) => statement.type),
  ['Assign', 'Assign', 'Input', 'Btn', 'Each']);
assert.equal(web.body[0].body[3].body.length, 2);
assert.equal(web.body[0].body[4].body[0].type, 'P');

assert.equal(worker.type, 'Program');
assert.deepEqual(worker.body.map((handler) => handler.type), ['On', 'On', 'On']);
assert.deepEqual(worker.body.map((handler) => handler.method || handler.every),
  ['POST', 'GET', '1h']);
assert.equal(worker.body[0].path, '/echo');
assert.deepEqual(worker.body[0].body.map((statement) => statement.type), ['Need', 'Reply']);
assert.deepEqual(worker.body[1].body[0].value.entries[0].value, {
  type: 'Effect', path: 'store.add', args: [
    { type: 'String', value: 'hits' },
    { type: 'Number', value: 1 },
  ],
});
assert.deepEqual(worker.body[2].body[0], {
  type: 'EffectCall', path: 'store.del', line: 9,
  args: [{ type: 'String', value: 'hits' }],
});
console.log('PASS: both SPEC v1 examples compile through real lex and parse with expected AST nodes');

const hashes = [];
for (let i = 0; i < 100; i++) {
  const output = JSON.stringify({ web: compile(webSource), worker: compile(workerSource) });
  hashes.push(createHash('sha256').update(output).digest('hex'));
}
assert(hashes.every((hash) => hash === hashes[0]),
  '100 lex→parse runs of the same SPEC examples have identical AST hashes');
console.log(`100-run AST SHA-256: ${hashes[0]}`);

const samples = [];
for (let batch = 0; batch < 100; batch++) {
  const start = process.cpuUsage();
  for (let i = 0; i < 100; i++) {
    compile(webSource);
    compile(workerSource);
  }
  const used = process.cpuUsage(start);
  samples.push((used.user + used.system) / 1000 / 100);
}
samples.sort((a, b) => a - b);
const p50 = samples[Math.floor(samples.length * 0.50)];
const p90 = samples[Math.floor(samples.length * 0.90)];
assert(p90 < 10, `SPEC example lex→parse CPU p90 < 10ms (actual ${p90.toFixed(6)}ms)`);
console.log(`CPU (100 batches × 100 pairs, process.cpuUsage): p50=${p50.toFixed(6)}ms, p90=${p90.toFixed(6)}ms per pair`);
