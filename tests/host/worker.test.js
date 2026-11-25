// tests/host/worker.test.js
// Chạy: node tests/host/worker.test.js
// Worker example chính đi qua lexer/parser thật; fixture effect phụ giữ riêng.
const fs = require('node:fs');
const path = require('node:path');
const { createWorker } = require('../../src/host/worker/index');
const { evalExpr } = require('../../src/host/worker/run');
const { createLog } = require('../../src/host/worker/log');
const { createEffects } = require('../../src/host/worker/effects');
const { createHash } = require('node:crypto');
const { lex } = require('../../src/core/lex');
const { parse } = require('../../src/core/parse');

// Read the canonical example so this integration test exercises source → tokens → AST.
function readSpecExample(label) {
  const spec = fs.readFileSync(path.join(__dirname, '../../SPEC.md'), 'utf8');
  const examples = spec.split('## Examples')[1];
  const labelAt = examples.indexOf(label);
  const fence = '```10ms\n';
  const start = examples.indexOf(fence, labelAt) + fence.length;
  const end = examples.indexOf('\n```', start);
  return examples.slice(start, end) + '\n';
}
const WORKER_SOURCE = readSpecExample('Worker (');
const { tokens: workerTokens, seed: workerSeed } = lex(WORKER_SOURCE);
const WORKER_AST = parse(workerTokens, workerSeed);

const STORE_SET_AST = {
  type: 'Program',
  body: [
    {
      type: 'On', method: 'GET', path: '/set', body: [{
        type: 'Reply', value: {
          type: 'Object', entries: [{ key: 'value', value: {
            type: 'Effect', path: 'store.set', args: [
              { type: 'String', value: 'theme' },
              { type: 'String', value: 'dark' },
            ],
          } }],
        },
      }],
    },
    {
      type: 'On', method: 'GET', path: '/get', body: [{
        type: 'Reply', value: {
          type: 'Object', entries: [{ key: 'value', value: {
            type: 'Effect', path: 'store.get', args: [
              { type: 'String', value: 'theme' },
            ],
          } }],
        },
      }],
    },
  ],
};

const TIME_RAND_AST = {
  type: 'Program',
  body: [{
    type: 'On', method: 'GET', path: '/effects', body: [{
      type: 'Reply', value: {
        type: 'Object', entries: [
          { key: 'now', value: { type: 'Effect', path: 'time.now', args: [] } },
          { key: 'roll', value: { type: 'Effect', path: 'rand.int', args: [
            { type: 'Number', value: 1 }, { type: 'Number', value: 6 },
          ] } },
        ],
      },
    }],
  }],
};

const NET_FETCH_URL = 'https://api.example.test/items';
const NET_FETCH_AST = {
  type: 'Program',
  body: [{
    type: 'On', method: 'GET', path: '/net', body: [
      {
        type: 'Assign', name: 'response', value: {
          type: 'Effect', path: 'net.fetch', args: [
            { type: 'String', value: NET_FETCH_URL },
            { type: 'Object', entries: [{ key: 'method', value: { type: 'String', value: 'POST' } }] },
          ],
        },
      },
      {
        type: 'Reply', value: {
          type: 'Object', entries: [
            { key: 'status', value: { type: 'Path', path: 'response.status' } },
            { key: 'ok', value: { type: 'Path', path: 'response.ok' } },
            { key: 'statusText', value: { type: 'Path', path: 'response.statusText' } },
            { key: 'headers', value: { type: 'Path', path: 'response.headers' } },
            { key: 'body', value: { type: 'Path', path: 'response.body' } },
            { key: 'error', value: { type: 'Path', path: 'response.error' } },
          ],
        },
      },
    ],
  }],
};

function post(url, body) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function get(url) { return new Request(url, { method: 'GET' }); }

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; }
  else console.log('OK  :', msg);
}

// Keep a KV-shaped namespace across effect instances to verify persistent storage (P4, P7).
function createKVStoreMock() {
  const entries = new Map();
  return {
    async get(key, options = {}) {
      const entry = entries.get(key);
      if (!entry) return null;
      return options.type === 'json' ? JSON.parse(entry.value) : entry.value;
    },
    async getWithMetadata(key) {
      const entry = entries.get(key);
      return { value: entry ? entry.value : null, metadata: entry ? entry.metadata : null };
    },
    async put(key, value, options = {}) {
      entries.set(key, { value: String(value), metadata: options.metadata || null });
    },
    async delete(key) { entries.delete(key); },
  };
}

async function main() {
  const w = createWorker({ ast: WORKER_AST, seed: 7 });

  // --- 1. POST /echo đúng ---
  {
    const res = await w.fetch(post('http://x/echo', { msg: 'hello' }));
    const j = await res.json();
    assert(res.status === 200 && j.echo === 'hello', 'POST /echo → {"echo":"hello"}');
    console.log('       body:', JSON.stringify(j));
  }

  // --- 2. POST /echo thiếu msg → D13 ---
  {
    const res = await w.fetch(post('http://x/echo', {}));
    const j = await res.json();
    assert(res.status === 400 && j.error === 'type' && j.seed === 7,
      'POST /echo thiếu msg → D13 error có seed');
    console.log('       body:', JSON.stringify(j));
  }

  // --- 3. POST /echo sai kiểu → D13 ---
  {
    const res = await w.fetch(post('http://x/echo', { msg: 42 }));
    const j = await res.json();
    const again = await (await w.fetch(post('http://x/echo', { msg: 42 }))).json();
    assert(res.status === 400 && j.error === 'type' && j.seed === 7 &&
      /number/.test(j.fix || '') && JSON.stringify(j) === JSON.stringify(again),
      'POST /echo sai kiểu → D13 deterministic, có seed, fix nêu number');
  }

  // --- 4. GET /hits lần 1, 2, 3 ---
  {
    const j1 = await (await w.fetch(get('http://x/hits'))).json();
    const j2 = await (await w.fetch(get('http://x/hits'))).json();
    const j3 = await (await w.fetch(get('http://x/hits'))).json();
    assert(j1.hits === 1 && j2.hits === 2 && j3.hits === 3,
      'GET /hits tăng 1 → 2 → 3');
    console.log('       hits:', j1.hits, j2.hits, j3.hits);
  }

  // --- 5. 404 ---
  {
    const res = await w.fetch(get('http://x/nope'));
    assert(res.status === 404, 'GET /nope → 404');
  }

  // --- 6. CPU < 10ms cho 100 hit /hits ---
  {
    // warm-up
    for (let i = 0; i < 20; i++) await w.fetch(get('http://x/hits'));
    const N = 100;
    const cpuStart = process.cpuUsage();
    for (let i = 0; i < N; i++) await w.fetch(get('http://x/hits'));
    const cpu = process.cpuUsage(cpuStart);
    const cpuMs = (cpu.user + cpu.system) / 1000;
    const avg = cpuMs / N;
    console.log('       CPU avg:', avg.toFixed(4), 'ms CPU / request  (' + N + ' reqs in ' + cpuMs.toFixed(2) + ' ms CPU)');
    assert(avg < 10, 'CPU avg < 10ms (' + avg.toFixed(4) + ' ms)');
  }

  // --- 7. Log có 123 entry store.add (3 + 20 warm-up + 100 CPU = 123) ---
  {
    const snap = w.log.snapshot();
    const adds = snap.filter(e => e.kind === 'store.add').length;
    assert(adds === 123, 'Log ghi đủ 123 lần store.add (thấy ' + adds + ')');
  }

  // --- 8. Replay: cùng sổ + cùng input → cùng output (P4) ---
  {
    // replay 3 lần add đầu tiên
    const first3 = w.log.snapshot().slice(0, 3);
    const script = (drv) => [
      drv.call('store.add', ['hits', 1]),
      drv.call('store.add', ['hits', 1]),
      drv.call('store.add', ['hits', 1]),
    ];
    // Nạp log mới để replay 3 entry khớp đầu
    const log2 = require('../../src/host/worker/log').createLog();
    for (const e of first3) log2.record(e.kind, e.args, e.result);
    const r = log2.replay(script, 7);
    assert(
      r.result[0] === 1 && r.result[1] === 2 && r.result[2] === 3 && r.consumed === 3,
      'Replay 3 entry đầu → [1,2,3], consumed=3'
    );
  }

  // --- 9. scheduled() chạy `on every 1h` → del "hits" ---
  {
    const r = await w.scheduled({});
    assert(r.length === 1 && r[0].every === '1h', 'scheduled() chạy đúng 1 handler every');
    // store bị xoá → lần hits tiếp theo về 1
    const j = await (await w.fetch(get('http://x/hits'))).json();
    assert(j.hits === 1, 'Sau cron del → /hits reset về 1');
  }

  // --- 10. Page (Web) render qua parser thật, chỉ kiểm không 404 ---
  {
    const WEB_SRC = `page /
  tasks = []
  text = ""
  input text
  btn "Add"
    tasks = tasks + [text]
    text = ""
  each tasks t
    p t
`;
    const { lex } = require('../../src/core/lex');
    const { parse } = require('../../src/core/parse');
    const { tokens, seed } = lex(WEB_SRC);
    const webAst = parse(tokens, seed);
    const w2 = createWorker({ ast: webAst, seed });
    const res = await w2.fetch(get('http://x/'));
    const html = await res.text();
    assert(res.status === 200 && /<input name="text"/.test(html) && /<button/.test(html),
      'Page / render HTML có <input> và <button>');
    console.log('       html head:', html.slice(0, 100) + '…');
  }
  // --- 11. Polymorphic + for number, text, and list (SPEC D12) ---
  {
    const source = `page /\n  p 1 + 2\n  p "a" + "b"\n  p [1] + [2]\n`;
    const { lex } = require('../../src/core/lex');
    const { parse } = require('../../src/core/parse');
    const { tokens, seed } = lex(source);
    const ast = parse(tokens, seed);
    const ctx = { env: new Map() };
    const values = ast.body[0].body.map(s => evalExpr(s.expr, ctx));
    assert(values[0] === 3 && values[1] === 'ab' &&
      JSON.stringify(values[2]) === '[1,2]',
      'number + number, text + text, and list + list');
    console.log('       + results:', JSON.stringify(values));
  }
  // --- 12. Worker Assign and parsed SPEC fixture ---
  {
    const { runOn } = require('../../src/host/worker/run');
    const ctx = { env: new Map(), body: {}, seed: 7, response: null };
    await runOn({ body: [{ type: 'Assign', name: 'count', value: { type: 'Number', value: 2 } }] }, ctx);
    assert(ctx.env.get('count') === 2, 'Worker name = expr runs through Assign in execStmt');
    assert(WORKER_AST.body.length === 3 && WORKER_AST.body[0].path === '/echo' &&
      WORKER_AST.body[1].path === '/hits' && WORKER_AST.body[2].every === '1h',
      'SPEC Worker source lexes and parses into POST, GET, and scheduled handlers');
  }

  // --- 13. @store.set writes, returns, logs, and replays its output (D15) ---
  {
    const wSet = createWorker({
      ast: STORE_SET_AST, seed: 7, store: new Map([['theme', 'light']]),
    });
    const setBody = await (await wSet.fetch(get('http://x/set'))).json();
    const getBody = await (await wSet.fetch(get('http://x/get'))).json();
    const entry = wSet.log.snapshot().find(e => e.kind === 'store.set');
    assert(setBody.value === 'dark' && getBody.value === 'dark',
      '@store.set returns value and overwrites existing store entry');
    assert(JSON.stringify(entry) === JSON.stringify({
      seq: 0, kind: 'store.set', args: ['theme', 'dark'], result: 'dark',
    }), '@store.set output is recorded with its input for replay');

    const replayLog = createLog();
    replayLog.record(entry.kind, entry.args, entry.result);
    const replay = replayLog.replay(drv => drv.call('store.set', ['theme', 'dark']), 7);
    assert(replay.result === 'dark' && replay.consumed === 1,
      '@store.set log replays the same output');
  }

  // --- 13b. KV write → read and persistence across effects instances (P4, P7) ---
  {
    const namespace = createKVStoreMock();
    const firstLog = createLog();
    const writer = createEffects(firstLog, namespace, 7);
    const setResult = await writer.call('store.set', ['persist', { value: 'still here' }]);
    const readResult = await writer.call('store.get', ['persist']);
    const reader = createEffects(createLog(), namespace, 7);
    const persistedResult = await reader.call('store.get', ['persist']);
    assert(JSON.stringify(setResult) === '{"value":"still here"}' &&
      JSON.stringify(readResult) === '{"value":"still here"}' &&
      JSON.stringify(persistedResult) === '{"value":"still here"}',
      'KV @store writes, reads back, and retains the value in a fresh effects instance');
    assert(firstLog.snapshot().map(entry => entry.kind).join(',') === 'store.set,store.get',
      'KV @store logs completed writes and reads in order');

    const benchmarkLog = createLog();
    const benchmark = createEffects(benchmarkLog, createKVStoreMock(), 7);
    const N = 100;
    for (let i = 0; i < 20; i++) {
      await benchmark.call('store.set', ['cpu', 'value']);
      await benchmark.call('store.get', ['cpu']);
    }
    const samples = [];
    for (let batch = 0; batch < 100; batch++) {
      const start = process.cpuUsage();
      for (let i = 0; i < N; i++) {
        await benchmark.call('store.set', ['cpu', 'value']);
        await benchmark.call('store.get', ['cpu']);
      }
      const cpu = process.cpuUsage(start);
      samples.push((cpu.user + cpu.system) / 1000 / N);
    }
    samples.sort((a, b) => a - b);
    const p50 = samples[Math.floor((samples.length - 1) * 0.50)];
    const p90 = samples[Math.floor((samples.length - 1) * 0.90)];
    console.log('       KV @store set+get CPU p50/p90:', p50.toFixed(4), '/', p90.toFixed(4),
      'ms/round-trip (100 batches × ' + N + '; process.cpuUsage user+system)');
    assert(p50 < 10 && p90 < 10, 'KV @store set+get CPU p50 and p90 < 10ms');
  }

  // --- 14. @store.set: 100-run output hash and real Worker CPU p50/p90 (P1, P4) ---
  {
    const hashes = [];
    for (let i = 0; i < 100; i++) {
      const wSet = createWorker({
        ast: STORE_SET_AST, seed: 7, store: new Map([['theme', 'light']]),
      });
      const body = await (await wSet.fetch(get('http://x/set'))).json();
      const payload = JSON.stringify({ body, log: wSet.log.snapshot() });
      hashes.push(createHash('sha256').update(payload).digest('hex'));
    }
    const outputHash = hashes[0];
    assert(hashes.every(hash => hash === outputHash),
      '100 fresh @store.set runs have identical output+log hash (' + outputHash + ')');
    console.log('       @store.set 100-run SHA-256:', outputHash);

    const wSet = createWorker({ ast: STORE_SET_AST, seed: 7 });
    const N = 100;
    for (let i = 0; i < 20; i++) await wSet.fetch(get('http://x/set'));
    const samples = [];
    for (let batch = 0; batch < 100; batch++) {
      const start = process.cpuUsage();
      for (let i = 0; i < N; i++) await wSet.fetch(get('http://x/set'));
      const cpu = process.cpuUsage(start);
      samples.push((cpu.user + cpu.system) / 1000 / N);
    }
    samples.sort((a, b) => a - b);
    const p50 = samples[Math.floor((samples.length - 1) * 0.50)];
    const p90 = samples[Math.floor((samples.length - 1) * 0.90)];
    console.log('       @store.set CPU p50/p90:', p50.toFixed(4), '/', p90.toFixed(4),
      'ms/request (100 batches × ' + N + ' requests; process.cpuUsage user+system)');
    assert(p50 < 10 && p90 < 10, '@store.set CPU p50 and p90 < 10ms/request');
  }

  // --- 15. @time.now + @rand.int log outputs, replay, and keep P4 (D15) ---
  {
    const fixedTime = 1700000000123;
    const originalNow = Date.now;
    const hashes = [];
    let firstBody;
    let firstLog;
    Date.now = () => fixedTime;
    try {
      for (let i = 0; i < 100; i++) {
        const wEffects = createWorker({ ast: TIME_RAND_AST, seed: 314 });
        const body = await (await wEffects.fetch(get('http://x/effects'))).json();
        const entries = wEffects.log.snapshot();
        if (i === 0) {
          firstBody = body;
          firstLog = entries;
        }
        const payload = JSON.stringify({ body, log: entries });
        hashes.push(createHash('sha256').update(payload).digest('hex'));
      }
    } finally {
      Date.now = originalNow;
    }
    const outputHash = hashes[0];
    assert(firstBody.now === fixedTime && Number.isInteger(firstBody.roll) &&
      firstBody.roll >= 1 && firstBody.roll <= 6,
      '@time.now returns the clock value and @rand.int stays within inclusive bounds');
    assert(firstLog[0].kind === 'time.now' && firstLog[0].args.length === 0 &&
      firstLog[0].result === fixedTime && firstLog[1].kind === 'rand.int' &&
      JSON.stringify(firstLog[1].args) === '[1,6]' && firstLog[1].result === firstBody.roll,
      'both effect outputs are recorded with their inputs for D15 replay');
    assert(hashes.every(hash => hash === outputHash),
      '100 fresh runs with the same seed and clock have identical output+log hash (' + outputHash + ')');
    console.log('       @time.now + @rand.int 100-run SHA-256:', outputHash);

    const replayLog = createLog();
    for (const entry of firstLog) replayLog.record(entry.kind, entry.args, entry.result);
    const replay = replayLog.replay(drv => ({
      now: drv.call('time.now', []),
      roll: drv.call('rand.int', [1, 6]),
    }), 314);
    assert(JSON.stringify(replay.result) === JSON.stringify(firstBody) && replay.consumed === 2,
      'the recorded time and seeded integer replay as the same output');

    let invalidRange;
    try { createWorker({ ast: TIME_RAND_AST, seed: 314 }).fx.call('rand.int', [6, 1]); }
    catch (e) { invalidRange = e.detail; }
    assert(invalidRange && invalidRange.error === 'effect' && invalidRange.seed === 314,
      '@rand.int rejects reversed bounds with a seeded effect error');
  }

  // --- 16. @time.now + @rand.int real Worker CPU p50/p90 (P1) ---
  {
    const wEffects = createWorker({ ast: TIME_RAND_AST, seed: 314 });
    const N = 100;
    for (let i = 0; i < 20; i++) await wEffects.fetch(get('http://x/effects'));
    const samples = [];
    for (let batch = 0; batch < 100; batch++) {
      const start = process.cpuUsage();
      for (let i = 0; i < N; i++) await wEffects.fetch(get('http://x/effects'));
      const cpu = process.cpuUsage(start);
      samples.push((cpu.user + cpu.system) / 1000 / N);
    }
    samples.sort((a, b) => a - b);
    const p50 = samples[Math.floor((samples.length - 1) * 0.50)];
    const p90 = samples[Math.floor((samples.length - 1) * 0.90)];
    console.log('       @time.now + @rand.int CPU p50/p90:', p50.toFixed(4), '/', p90.toFixed(4),
      'ms/request (100 batches × ' + N + ' requests; process.cpuUsage user+system)');
    assert(p50 < 10 && p90 < 10, '@time.now + @rand.int CPU p50 and p90 < 10ms/request');
  }

  // --- 17. @net.fetch uses only injected mocks; log and replay every response (P4, D15) ---
  {
    const originalFetch = globalThis.fetch;
    let unmockedFetchCalls = 0;
    globalThis.fetch = async () => {
      unmockedFetchCalls++;
      throw new Error('real network forbidden in tests');
    };
    try {
      const calls = [];
      const mockFetch = async (url, init) => {
        calls.push({ url, init });
        return new Response('{"item":"ok"}', {
          status: 201,
          statusText: 'Created',
          headers: { 'content-type': 'application/json', 'x-test': 'mocked' },
        });
      };
      const wNet = createWorker({ ast: NET_FETCH_AST, seed: 7, fetchImpl: mockFetch });
      const body = await (await wNet.fetch(get('http://x/net'))).json();
      const entry = wNet.log.snapshot()[0];
      assert(body.status === 201 && body.ok && body.statusText === 'Created' &&
        body.body === '{"item":"ok"}' && body.headers['x-test'] === 'mocked',
        '@net.fetch returns a JSON-safe response envelope from the injected mock');
      assert(calls.length === 1 && calls[0].url === NET_FETCH_URL &&
        JSON.stringify(calls[0].init) === '{"method":"POST"}' &&
        entry.kind === 'net.fetch' && JSON.stringify(entry.args) ===
          JSON.stringify([NET_FETCH_URL, { method: 'POST' }]) &&
        entry.result.status === 201 && entry.result.body === '{"item":"ok"}',
        '@net.fetch records request inputs and normalized response output');

      const replayLog = createLog();
      replayLog.record(entry.kind, entry.args, entry.result);
      const replay = replayLog.replay(driver => driver.call('net.fetch',
        [NET_FETCH_URL, { method: 'POST' }]), 7);
      assert(JSON.stringify(replay.result) === JSON.stringify(entry.result) &&
        replay.consumed === 1 && calls.length === 1,
        'D15 replay returns the logged network output without issuing another request');

      // Reverse completion latency to prove awaited effects preserve source order (P4, D15).
      const firstUrl = 'https://api.example.test/first';
      const secondUrl = 'https://api.example.test/second';
      const started = [];
      const orderedWorker = createWorker({
        ast: { type: 'Program', body: [{ type: 'On', method: 'GET', path: '/ordered', body: [{
          type: 'Reply', value: { type: 'Array', items: [firstUrl, secondUrl].map(url => ({
            type: 'Effect', path: 'net.fetch', args: [{ type: 'String', value: url }],
          })) },
        }] }] },
        fetchImpl: async url => {
          started.push(url);
          await new Promise(resolve => setTimeout(resolve, url === firstUrl ? 5 : 0));
          return new Response(url);
        },
      });
      const orderedBody = await (await orderedWorker.fetch(get('http://x/ordered'))).json();
      const loggedOrder = orderedWorker.log.snapshot().map(item => item.args[0]);
      assert(JSON.stringify(started) === JSON.stringify([firstUrl, secondUrl]) &&
        JSON.stringify(loggedOrder) === JSON.stringify([firstUrl, secondUrl]) &&
        JSON.stringify(orderedBody.map(item => item.body)) === JSON.stringify([firstUrl, secondUrl]),
        'nested network effects run and log in source order');

      const failedWorker = createWorker({ ast: NET_FETCH_AST, seed: 7,
        fetchImpl: async () => { throw new Error('mock offline'); } });
      const failedBody = await (await failedWorker.fetch(get('http://x/net'))).json();
      const failedEntry = failedWorker.log.snapshot()[0];
      const failedReplayLog = createLog();
      failedReplayLog.record(failedEntry.kind, failedEntry.args, failedEntry.result);
      const failedReplay = failedReplayLog.replay(driver => driver.call('net.fetch',
        [NET_FETCH_URL, { method: 'POST' }]), 7);
      assert(failedBody.error === 'mock offline' && failedEntry.result.error === 'mock offline' &&
        JSON.stringify(failedReplay.result) === JSON.stringify(failedEntry.result),
        'network errors are normalized, logged, and replayable too');

      const hashes = [];
      for (let i = 0; i < 100; i++) {
        const worker = createWorker({ ast: NET_FETCH_AST, seed: 7,
          fetchImpl: async () => new Response('{"item":"ok"}', {
            status: 201,
            statusText: 'Created',
            headers: { 'content-type': 'application/json', 'x-test': 'mocked' },
          }) });
        const result = await (await worker.fetch(get('http://x/net'))).json();
        hashes.push(createHash('sha256').update(JSON.stringify({
          body: result, log: worker.log.snapshot(),
        })).digest('hex'));
      }
      const outputHash = hashes[0];
      assert(hashes.every(hash => hash === outputHash),
        '100 mocked @net.fetch runs have identical output+log hash (' + outputHash + ')');
      console.log('       @net.fetch 100-run SHA-256:', outputHash);

      const benchmark = createWorker({ ast: NET_FETCH_AST, seed: 7,
        fetchImpl: async () => new Response('{"item":"ok"}', {
          status: 201,
          statusText: 'Created',
          headers: { 'content-type': 'application/json', 'x-test': 'mocked' },
        }) });
      const N = 100;
      for (let i = 0; i < 20; i++) await benchmark.fetch(get('http://x/net'));
      const samples = [];
      for (let batch = 0; batch < 100; batch++) {
        const start = process.cpuUsage();
        for (let i = 0; i < N; i++) await benchmark.fetch(get('http://x/net'));
        const cpu = process.cpuUsage(start);
        samples.push((cpu.user + cpu.system) / 1000 / N);
      }
      samples.sort((a, b) => a - b);
      const p50 = samples[Math.floor((samples.length - 1) * 0.50)];
      const p90 = samples[Math.floor((samples.length - 1) * 0.90)];
      console.log('       @net.fetch mocked CPU p50/p90:', p50.toFixed(4), '/', p90.toFixed(4),
        'ms/request (100 batches × ' + N + ' requests; process.cpuUsage user+system)');
      assert(p50 < 10 && p90 < 10, '@net.fetch mocked CPU p50 and p90 < 10ms/request');
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert(unmockedFetchCalls === 0, '@net.fetch tests never call the runtime network');
  }
}

main().then(() => {
  console.log('\n' + (process.exitCode ? 'FAILED' : 'ALL PASSED'));
}).catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
