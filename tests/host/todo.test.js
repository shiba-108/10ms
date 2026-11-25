// tests/host/todo.test.js
// Run: node tests/host/todo.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { createHash, randomBytes } = require('node:crypto');
const { lex } = require('../../src/core/lex');
const { parse } = require('../../src/core/parse');
const { createWorker } = require('../../src/host/worker/index');
const { compileSource, buildEntry } = require('../../scripts/ship');

const ROOT = path.resolve(__dirname, '../..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'examples/todo.10ms'), 'utf8');
const TODO_URL = 'https://todo.test/tasks';
const KV_NAMESPACE_ID = randomBytes(16).toString('hex');

function assertTodoShape(ast) {
  assert.deepEqual(ast.body.map(node => node.type), ['Page', 'On', 'On'],
    'the complete Todo source lexes and parses as a page and two Worker routes');
  assert.deepEqual(ast.body.slice(1).map(route => [route.method, route.path]),
    [['GET', '/tasks'], ['POST', '/tasks']], 'the parsed source retains GET and POST /tasks');
  const page = ast.body[0].body;
  assert.deepEqual(page.map(statement => statement.type),
    ['Assign', 'Assign', 'Input', 'Btn', 'Each'], 'the page keeps its Add button and task list');
  assert.equal(page[3].label, 'Add', 'Add remains the UI button label');
  assert.equal(page[4].body[0].type, 'P');
  const post = ast.body[2].body;
  assert.deepEqual(post.map(statement => statement.type),
    ['Need', 'Assign', 'Assign', 'EffectCall', 'Reply'],
    'POST reads tasks, appends, calls @store.set, then replies');
}

function readState(html) {
  const match = html.match(/name="__state" value="([^"]*)"/);
  assert(match, 'rendered page carries serialized state');
  const decoded = match[1]
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return JSON.parse(decoded);
}

function request(url, method = 'GET', body) {
  const init = { method };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  return new Request(url, init);
}

async function findFreePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function startWrangler(configPath, statePath, port) {
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const child = spawn(npx, [
    '--yes', 'wrangler@4.168.0', 'dev', '--config', configPath,
    '--local', '--ip', '127.0.0.1', '--port', String(port), '--persist-to', statePath,
  ], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
  child.output = '';
  const capture = chunk => {
    child.output = (child.output + chunk.toString()).slice(-12000);
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  return child;
}

async function waitForWorker(child, origin) {
  let lastError;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) {
      throw new Error(`Wrangler exited before ready (code ${child.exitCode}):\n${child.output}`);
    }
    try {
      const response = await fetch(`${origin}/tasks`);
      if (response.status === 200) return response;
      lastError = new Error(`Worker readiness returned HTTP ${response.status}`);
    } catch (error) { lastError = error; }
    await delay(250);
  }
  throw new Error(`Wrangler did not become ready: ${lastError}\n${child.output}`);
}

async function stopWrangler(child) {
  if (!child) return;
  const signalGroup = signal => {
    if (process.platform !== 'win32' && child.pid) {
      try { process.kill(-child.pid, signal); return; } catch (_) {}
    }
    child.kill(signal);
  };
  if (child.exitCode !== null) return;
  await new Promise(resolve => {
    const timer = setTimeout(() => {
      signalGroup('SIGKILL');
      resolve();
    }, 5000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    signalGroup('SIGTERM');
  });
}

async function postForm(origin, value, state) {
  return fetch(`${origin}/`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ __state: JSON.stringify(state), __btn: '0', text: value }),
  });
}

async function deterministicMemoryRun(ast, seed) {
  const store = new Map();
  const writer = createWorker({ ast, seed, store });
  const empty = await (await writer.fetch(request('http://todo.test/tasks'))).json();
  const first = await (await writer.fetch(request('http://todo.test/tasks', 'POST', { text: 'first' }))).json();
  const reader = createWorker({ ast, seed, store });
  const reloaded = await (await reader.fetch(request('http://todo.test/tasks'))).json();
  const second = await (await reader.fetch(request('http://todo.test/tasks', 'POST', { text: 'second' }))).json();
  const final = await (await reader.fetch(request('http://todo.test/tasks'))).json();
  assert.deepEqual({ empty, first, reloaded, second, final }, {
    empty: { tasks: [] },
    first: { tasks: ['first'] },
    reloaded: { tasks: ['first'] },
    second: { tasks: ['first', 'second'] },
    final: { tasks: ['first', 'second'] },
  });
  return {
    empty, first, reloaded, second, final,
    logs: [writer.log.snapshot(), reader.log.snapshot()],
  };
}

async function measureGetCpu(ast, seed) {
  const worker = createWorker({ ast, seed, store: new Map() });
  const url = 'http://todo.test/tasks';
  for (let i = 0; i < 20; i++) await worker.fetch(new Request(url));
  const samples = [];
  for (let batch = 0; batch < 100; batch++) {
    const start = process.cpuUsage();
    for (let i = 0; i < 100; i++) await worker.fetch(new Request(url));
    const used = process.cpuUsage(start);
    samples.push((used.user + used.system) / 1000 / 100);
  }
  samples.sort((a, b) => a - b);
  return {
    p50: samples[Math.floor((samples.length - 1) * 0.50)],
    p90: samples[Math.floor((samples.length - 1) * 0.90)],
  };
}

async function main() {
  const port = await findFreePort();
  const origin = `http://127.0.0.1:${port}`;
  const runtimeSource = SOURCE.replace(TODO_URL, `${origin}/tasks`);
  assert.notEqual(runtimeSource, SOURCE, 'test only redirects the HTTP origin to local Wrangler');

  // Exercise the repository source through the actual lexer and parser, not a hand-built AST.
  const { tokens, seed } = lex(runtimeSource);
  const ast = parse(tokens, seed);
  assertTodoShape(ast);
  const compiled = compileSource(runtimeSource);
  const wranglerProgram = path.join(ROOT, '.wrangler', `todo-test-${process.pid}.js`);
  const wranglerConfig = path.join(ROOT, '.wrangler', `todo-test-${process.pid}.toml`);
  const localData = fs.mkdtempSync(path.join(ROOT, '.wrangler', 'todo-kv-'));
  const statePath = path.join(localData, 'state');
  fs.writeFileSync(wranglerProgram, buildEntry(compiled));
  fs.writeFileSync(wranglerConfig, [
    'name = "tenms-todo-integration-test"',
    `main = "./${path.basename(wranglerProgram)}"`,
    'compatibility_date = "2026-11-24"',
    'workers_dev = true',
    '',
    '[[kv_namespaces]]',
    'binding = "STORE"',
    `id = "${KV_NAMESPACE_ID}"`,
    '',
  ].join('\n'));

  let child;
  try {
    child = startWrangler(wranglerConfig, statePath, port);
    const initial = await (await waitForWorker(child, origin)).json();
    assert.deepEqual(initial, { tasks: [] }, 'a genuinely empty local KV namespace reads as []');

    const firstPage = await fetch(`${origin}/`);
    assert.equal(firstPage.status, 200);
    const firstHtml = await firstPage.text();
    const firstAdd = await postForm(origin, 'first task', readState(firstHtml));
    assert.equal(firstAdd.status, 200, 'clicking Add makes the native @net.fetch POST /tasks');
    const firstAddedHtml = await firstAdd.text();
    assert.match(firstAddedHtml, /<p>first task<\/p>/);
    const beforeRestart = await (await fetch(`${origin}/tasks`)).json();
    assert.deepEqual(beforeRestart, { tasks: ['first task'] },
      'POST /tasks accepted the JSON body with application/json content type');
    await stopWrangler(child);
    child = null;

    // A separate Wrangler/Worker process reopens the same local KV persistence directory.
    child = startWrangler(wranglerConfig, statePath, port);
    const afterReload = await (await waitForWorker(child, origin)).json();
    assert.deepEqual(afterReload, { tasks: ['first task'] },
      'the first task survives a real Worker restart and KV reload');

    const secondPage = await fetch(`${origin}/`);
    const secondHtml = await secondPage.text();
    const secondAdd = await postForm(origin, 'second task', readState(secondHtml));
    assert.equal(secondAdd.status, 200);
    await secondAdd.text();
    const finalTasks = await (await fetch(`${origin}/tasks`)).json();
    assert.deepEqual(finalTasks, { tasks: ['first task', 'second task'] },
      'adding after reload leaves both tasks in KV');
    console.log('Wrangler local KV: empty → Add → Worker restart → persisted → Add → 2 tasks: PASS');

    const hashes = new Set();
    for (let i = 0; i < 100; i++) {
      const result = await deterministicMemoryRun(ast, seed);
      hashes.add(createHash('sha256').update(JSON.stringify(result)).digest('hex'));
    }
    assert.equal(hashes.size, 1, '100 parsed-source runs have identical results and logs');
    console.log('Todo 100-run SHA-256:', hashes.values().next().value);

    const cpu = await measureGetCpu(ast, seed);
    console.log('Todo GET /tasks CPU p50/p90:', cpu.p50.toFixed(6), '/', cpu.p90.toFixed(6),
      'ms/request (100 batches × 100; process.cpuUsage user+system)');
    assert(cpu.p50 < 10 && cpu.p90 < 10, 'Todo GET /tasks CPU p50 and p90 are below 10ms/request');
    console.log('ALL PASSED');
  } finally {
    await stopWrangler(child);
    for (const file of [wranglerProgram, wranglerConfig]) {
      try { fs.rmSync(file, { force: true }); } catch (_) {}
    }
    try { fs.rmSync(localData, { recursive: true, force: true }); } catch (_) {}
  }
}

main().catch(error => {
  console.error('FAILED:', error);
  process.exitCode = 1;
});
