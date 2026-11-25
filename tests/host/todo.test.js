// tests/host/todo.test.js
// Run: node tests/host/todo.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { lex } = require('../../src/core/lex');
const { parse } = require('../../src/core/parse');
const { createWorker } = require('../../src/host/worker/index');

const SOURCE = fs.readFileSync(path.join(__dirname, '../../examples/todo.10ms'), 'utf8');
const { tokens, seed } = lex(SOURCE);
const AST = parse(tokens, seed);
assert.deepEqual(AST.body.map(node => node.type), ['Page', 'On', 'On'],
  'the full Todo source lexes and parses into a page and two Worker routes');
assert.deepEqual(AST.body.slice(1).map(route => [route.method, route.path]),
  [['GET', '/tasks'], ['POST', '/tasks']], 'the parsed source exposes GET and POST /tasks');
const pageStatements = AST.body[0].body;
assert.deepEqual(pageStatements.map(statement => statement.type),
  ['Assign', 'Assign', 'Input', 'Btn', 'Each'], 'the parsed page has input, Add, and list rendering');
assert.equal(pageStatements[3].label, 'Add');
assert.equal(pageStatements[4].body[0].type, 'P');

// Adapt @net.fetch's structured body to the local HTTP JSON boundary (P7), without real network calls.
function makeWorker(store, calls = []) {
  let worker;
  const fetchImpl = async (url, init = {}) => {
    const requestUrl = new URL(url, 'https://todo.test');
    const body = init.body && typeof init.body === 'object'
      ? JSON.stringify(init.body) : init.body;
    calls.push({ url: requestUrl.href, method: init.method, body: init.body });
    return worker.fetch(new Request(requestUrl, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init.headers || {}) },
      body,
    }));
  };
  worker = createWorker({ ast: AST, seed, store, fetchImpl });
  return worker;
}

// Read the serialized state the native form sends back with its button index (P4, P7).
function readState(html) {
  const match = html.match(/name="__state" value="([^"]*)"/);
  assert(match, 'rendered page carries serialized state');
  const decoded = match[1]
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return JSON.parse(decoded);
}

function submitAdd(value, state) {
  return new Request('https://todo.test/', {
    method: 'POST',
    body: new URLSearchParams({ __state: JSON.stringify(state), __btn: '0', text: value }),
  });
}

// Add through the page's @net.fetch, then create a new Worker over the same durable store (P4, P7).
async function addReloadFlow() {
  const store = new Map([['tasks', []]]);
  const calls = [];
  const writer = makeWorker(store, calls);
  const initialTasksResponse = await writer.fetch(new Request('https://todo.test/tasks'));
  const initialTasks = await initialTasksResponse.json();
  const initialPage = await writer.fetch(new Request('https://todo.test/'));
  const initialHtml = await initialPage.text();
  const addResponse = await writer.fetch(submitAdd('Ship T20b', readState(initialHtml)));
  const addedHtml = await addResponse.text();

  const reloadedWorker = makeWorker(store);
  const reloadResponse = await reloadedWorker.fetch(new Request('https://todo.test/tasks'));
  const reloadedTasks = await reloadResponse.json();
  return {
    initialTasks,
    initialHtml,
    addedHtml,
    reloadedTasks,
    calls,
    statuses: [initialTasksResponse.status, initialPage.status, addResponse.status, reloadResponse.status],
    logs: [writer.log.snapshot(), reloadedWorker.log.snapshot()],
  };
}

// Measure real Worker GET /tasks CPU in repeated batches (P1).
async function measureGetCpu(worker) {
  const url = 'https://todo.test/tasks';
  for (let i = 0; i < 20; i++) await worker.fetch(new Request(url));
  const samples = [];
  const requestsPerBatch = 100;
  for (let batch = 0; batch < 100; batch++) {
    const start = process.cpuUsage();
    for (let i = 0; i < requestsPerBatch; i++) {
      await worker.fetch(new Request(url));
    }
    const used = process.cpuUsage(start);
    samples.push((used.user + used.system) / 1000 / requestsPerBatch);
  }
  samples.sort((a, b) => a - b);
  return {
    p50: samples[Math.floor((samples.length - 1) * 0.50)],
    p90: samples[Math.floor((samples.length - 1) * 0.90)],
  };
}

async function main() {
  const hashes = new Set();
  let first;
  for (let i = 0; i < 100; i++) {
    const result = await addReloadFlow();
    assert.deepEqual(result.initialTasks, { tasks: [] });
    assert.deepEqual(result.statuses, [200, 200, 200, 200]);
    assert.match(result.initialHtml, /<input name="text" type="text" value="" \/>/);
    assert.match(result.initialHtml, /data-label="Add">Add<\/button>/);
    assert.deepEqual(readState(result.initialHtml), { tasks: [], text: '' });
    assert.match(result.addedHtml, /<p>Ship T20b<\/p>/,
      'clicking Add POSTs through @net.fetch and renders the task with each/p');
    assert.deepEqual(readState(result.addedHtml), {
      tasks: ['Ship T20b'], text: '', response: '',
    });
    assert.deepEqual(result.reloadedTasks, { tasks: ['Ship T20b'] },
      'GET /tasks from a fresh Worker sees the task persisted by POST /tasks');
    assert.equal(result.calls.length, 1);
    assert.equal(result.calls[0].url, 'https://todo.test/tasks');
    assert.equal(result.calls[0].method, 'POST');
    assert.deepEqual(result.calls[0].body, { text: 'Ship T20b' });
    const hash = createHash('sha256').update(JSON.stringify(result)).digest('hex');
    hashes.add(hash);
    first = first || result;
  }
  assert.equal(hashes.size, 1, '100 add→fresh Worker→reload runs have identical output and logs');
  console.log('Todo add→reload 100-run SHA-256:', hashes.values().next().value);

  const missingTextWorker = makeWorker(new Map([['tasks', []]]));
  const invalid = await missingTextWorker.fetch(new Request('https://todo.test/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  }));
  assert.equal(invalid.status, 400, 'POST /tasks rejects a missing required body.text');

  const cpu = await measureGetCpu(makeWorker(new Map([['tasks', ['persisted']]])));
  console.log('Todo GET /tasks CPU p50/p90:', cpu.p50.toFixed(6), '/', cpu.p90.toFixed(6),
    'ms/request (100 batches × 100 requests; process.cpuUsage user+system)');
  assert(cpu.p50 < 10 && cpu.p90 < 10, 'Todo GET /tasks CPU p50 and p90 are below 10ms/request');
  console.log('Todo persisted after fresh Worker reload:', first.reloadedTasks.tasks[0]);
  console.log('ALL PASSED');
}

main().catch(error => {
  console.error('FAILED:', error);
  process.exitCode = 1;
});
