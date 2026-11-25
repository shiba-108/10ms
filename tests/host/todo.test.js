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
assert.deepEqual(AST.body.map(route => route.method), ['GET', 'POST'],
  'the real Todo source parses into GET and POST handlers only');

// Recreate the host while keeping the backing store, modeling a reload with persisted storage (P7).
function makeWorker(store) {
  return createWorker({ ast: AST, seed, store });
}

// Send JSON only for POST so the test follows the Worker's real request boundary (P4, P7).
function send(worker, method, body) {
  const init = { method };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  return worker.fetch(new Request('https://todo.test/todo', init));
}

// Exercise a new task write followed by a new Worker instance reading the same store (P4, P7).
async function addReloadFlow() {
  const store = new Map();
  const writer = makeWorker(store);
  const emptyResponse = await send(writer, 'GET');
  const empty = await emptyResponse.json();
  const addResponse = await send(writer, 'POST', { task: 'Ship T20b' });
  const added = await addResponse.json();
  const reloadedWorker = makeWorker(store);
  const reloadResponse = await send(reloadedWorker, 'GET');
  const reloaded = await reloadResponse.json();
  assert.equal(emptyResponse.status, 200);
  assert.equal(addResponse.status, 200);
  assert.equal(reloadResponse.status, 200);
  return {
    empty,
    added,
    reloaded,
    logs: [writer.log.snapshot(), reloadedWorker.log.snapshot()],
  };
}

// Measure host CPU per GET across batches, matching the repository's process.cpuUsage convention (P1).
async function measureGetCpu(worker) {
  const url = 'https://todo.test/todo';
  for (let i = 0; i < 20; i++) {
    await worker.fetch(new Request(url));
  }
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

// Prove repeatable behavior from the same parsed source and fresh storage (P4).
async function main() {
  const hashes = new Set();
  let outputHash;
  let first;
  for (let i = 0; i < 100; i++) {
    const result = await addReloadFlow();
    assert.deepEqual(result.empty, { task: null });
    assert.deepEqual(result.added, { task: 'Ship T20b' });
    assert.deepEqual(result.reloaded, { task: 'Ship T20b' });
    const hash = createHash('sha256').update(JSON.stringify(result)).digest('hex');
    hashes.add(hash);
    outputHash = outputHash || hash;
    first = first || result;
  }
  assert.equal(hashes.size, 1, '100 add→reload runs have identical output and effect logs');
  console.log('Todo add→reload 100-run SHA-256:', outputHash);

  const deleteResponse = await send(makeWorker(new Map()), 'DELETE');
  assert.equal(deleteResponse.status, 404, 'Todo exposes no DELETE route');

  const cpu = await measureGetCpu(makeWorker(new Map([['task', 'persisted']])));
  console.log('Todo GET CPU p50/p90:', cpu.p50.toFixed(6), '/', cpu.p90.toFixed(6),
    'ms/request (100 batches × 100 requests; process.cpuUsage user+system)');
  assert(cpu.p50 < 10 && cpu.p90 < 10, 'Todo GET CPU p50 and p90 are below 10ms/request');
  console.log('Todo persisted after reload:', first.reloaded.task);
  console.log('ALL PASSED');
}

main().catch(error => {
  console.error('FAILED:', error);
  process.exitCode = 1;
});
