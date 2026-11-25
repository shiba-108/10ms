// tests/host/web.test.js
// Run: node tests/host/web.test.js
// Exercises native browser-form POSTs against the Web AST runtime (P1, P4, P7).

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { lex } = require('../../src/core/lex');
const { parse } = require('../../src/core/parse');
const { createWorker } = require('../../src/host/worker/index');

const SOURCE = `page /
  tasks = []
  text = ""
  input text
  btn "Add"
    tasks = tasks + [text]
    text = ""
  each tasks t
    p t
`;
const { tokens, seed } = lex(SOURCE);
const AST = parse(tokens, seed);

// Give each run an isolated host state so replay hashes are comparable (P4).
function pageWorker() { return createWorker({ ast: AST, seed }); }
// Exercise the page route without network or platform-specific APIs (P7).
function get(url = 'http://x/') { return new Request(url, { method: 'GET' }); }
// Submit the same fields a native browser form sends when Add is clicked (P3, P4).
function post(value, state, url = 'http://x/') {
  return new Request(url, {
    method: 'POST',
    body: new URLSearchParams({ __state: JSON.stringify(state), __btn: '0', text: value }),
  });
}
// Read the escaped hidden field so a second submit carries the prior page state (P4).
function readState(html) {
  const match = html.match(/name="__state" value="([^"]*)"/);
  assert(match, 'rendered form carries serialized page state');
  const decoded = match[1]
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return JSON.parse(decoded);
}

// Verify the browser interaction, bound, deterministic output and CPU ceiling (P1, P4, P7).
async function main() {
  const worker = pageWorker();
  const initial = await worker.fetch(get());
  const initialHtml = await initial.text();
  assert.equal(initial.status, 200, 'GET / returns the page');
  assert.match(initial.headers.get('content-type'), /text\/html/);
  assert.match(initialHtml, /<form method="post">/);
  assert.match(initialHtml, /<input name="text" type="text" value="" \/>/);
  assert.match(initialHtml, /<button type="submit" name="__btn" value="0"/);
  assert.deepEqual(readState(initialHtml), { tasks: [], text: '' });
  console.log('OK  : GET / renders page, input, Add button, and initial state');

  const afterFirst = await worker.fetch(post('Buy milk', readState(initialHtml)));
  const firstHtml = await afterFirst.text();
  assert.equal(afterFirst.status, 200, 'clicking Add submits the form successfully');
  assert.match(firstHtml, /<p>Buy milk<\/p>/, 'submitted text appears in the each-rendered list');
  assert.match(firstHtml, /name="text" type="text" value="" \/>/,
    'button handler clears the input before rerender');
  assert.deepEqual(readState(firstHtml), { tasks: ['Buy milk'], text: '' });
  console.log('OK  : Add submits text, runs its AST body, and each renders the new task');

  const afterSecond = await worker.fetch(post('Call <Sam> & prep', readState(firstHtml)));
  const secondHtml = await afterSecond.text();
  assert.equal(afterSecond.status, 200);
  assert.match(secondHtml, /<p>Buy milk<\/p><p>Call &lt;Sam&gt; &amp; prep<\/p>/,
    'each renders old and new tasks with HTML escaping');
  assert.deepEqual(readState(secondHtml), { tasks: ['Buy milk', 'Call <Sam> & prep'], text: '' });
  console.log('OK  : subsequent Add keeps existing tasks and safely escapes user text');

  const invalid = await worker.fetch(new Request('http://x/', {
    method: 'POST', body: new URLSearchParams({ __state: '[]', __btn: '0', text: 'x' }),
  }));
  assert.equal(invalid.status, 400, 'invalid submitted state is rejected');
  console.log('OK  : malformed page state returns a machine-readable 400');

  const oversized = await worker.fetch(post('extra', {
    tasks: Array.from({ length: 101 }, (_, i) => `task-${i}`), text: '',
  }));
  const limitError = await oversized.json();
  assert.equal(oversized.status, 400, 'state beyond the proven Each bound is rejected');
  assert.equal(limitError.error, 'cost');
  assert.match(limitError.expected, /100 items/);
  console.log('OK  : each over 100 items returns a D13 cost error');

  const hashes = [];
  for (let i = 0; i < 100; i++) {
    const fresh = pageWorker();
    const html = await (await fresh.fetch(post('Buy milk', { tasks: [], text: '' }))).text();
    hashes.push(createHash('sha256').update(html).digest('hex'));
  }
  assert(hashes.every(hash => hash === hashes[0]), '100 identical Add runs have the same output hash');
  console.log('100-run SHA-256:', hashes[0]);

  const bench = pageWorker();
  const body = new URLSearchParams({ __state: JSON.stringify({ tasks: [], text: '' }),
    __btn: '0', text: 'Buy milk' }).toString();
  const samples = [];
  for (let i = 0; i < 20; i++) await bench.fetch(new Request('http://x/', { method: 'POST', body }));
  for (let batch = 0; batch < 100; batch++) {
    const start = process.cpuUsage();
    for (let i = 0; i < 100; i++) {
      const response = await bench.fetch(new Request('http://x/', { method: 'POST', body }));
      await response.text();
    }
    const cpu = process.cpuUsage(start);
    samples.push((cpu.user + cpu.system) / 1000 / 100);
  }
  samples.sort((a, b) => a - b);
  const p50 = samples[Math.floor((samples.length - 1) * 0.50)];
  const p90 = samples[Math.floor((samples.length - 1) * 0.90)];
  console.log('Add POST CPU p50/p90:', p50.toFixed(4), '/', p90.toFixed(4),
    'ms/request (100 batches × 100 requests; process.cpuUsage user+system)');
  assert(p50 < 10 && p90 < 10, 'Add POST CPU p50 and p90 are below 10ms/request');
  console.log('ALL PASSED');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
