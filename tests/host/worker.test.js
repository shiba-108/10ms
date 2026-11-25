// tests/host/worker.test.js
// Chạy: node tests/host/worker.test.js
// Lưu ý: parse.js chưa sinh node Worker → dựng Worker AST bằng tay theo SPEC.
const { createWorker } = require('../../src/host/worker/index');
const { evalExpr } = require('../../src/host/worker/run');
const { createLog } = require('../../src/host/worker/log');
const { createHash } = require('node:crypto');

// ---- Worker AST đúng SPEC ----
// on POST /echo
//   need body.msg text
//   reply {echo: body.msg}
// on GET /hits
//   reply {hits: @store.add "hits" 1}
// on every 1h
//   @store.del "hits"
const WORKER_AST = {
  type: 'Program',
  body: [
    {
      type: 'On', method: 'POST', path: '/echo', line: 1,
      body: [
        { type: 'Need', path: 'body.msg', ty: 'text', line: 2 },
        {
          type: 'Reply', line: 3,
          value: {
            type: 'Object',
            entries: [{ key: 'echo', value: { type: 'Path', path: 'body.msg' } }],
          },
        },
      ],
    },
    {
      type: 'On', method: 'GET', path: '/hits', line: 5,
      body: [
        {
          type: 'Reply', line: 6,
          value: {
            type: 'Object',
            entries: [{
              key: 'hits',
              value: {
                type: 'Effect', path: 'store.add',
                args: [
                  { type: 'String', value: 'hits' },
                  { type: 'Number', value: 1 },
                ],
              },
            }],
          },
        },
      ],
    },
    {
      type: 'On', every: '1h', line: 8,
      body: [
        {
          type: 'EffectCall', path: 'store.del', line: 9,
          args: [{ type: 'String', value: 'hits' }],
        },
      ],
    },
  ],
};

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
  // --- 12. Worker Assign and exact SPEC fixture ---
  {
    const { runOn } = require('../../src/host/worker/run');
    const ctx = { env: new Map(), body: {}, seed: 7, response: null };
    runOn({ body: [{ type: 'Assign', name: 'count', value: { type: 'Number', value: 2 } }] }, ctx);
    assert(ctx.env.get('count') === 2, 'Worker name = expr runs through Assign in execStmt');
    const workerExample = `on POST /echo
  need body.msg text
  reply {echo: body.msg}

on GET /hits
  reply {hits: @store.add "hits" 1}

on every 1h
  @store.del "hits"
`;
    const spec = require('fs').readFileSync(require('path').join(__dirname, '../../SPEC.md'), 'utf8');
    assert(spec.includes(workerExample.trimEnd()), 'SPEC Worker example exactly matches the test fixture');
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
}

main().then(() => {
  console.log('\n' + (process.exitCode ? 'FAILED' : 'ALL PASSED'));
}).catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
