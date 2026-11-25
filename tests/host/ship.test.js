// tests/host/ship.test.js
// Chạy: node tests/host/ship.test.js
const fs = require('fs');
const path = require('path');
const { compileSource, buildEntry } = require('../../scripts/ship');
const { createSealedWorker } = require('../../src/host/worker/ship');
const { seal, verifySeal } = require('../../src/core/seal');

// Keep failures and proof output visible in plain Node test runs. P4 · D18.
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; }
  else console.log('OK  :', msg);
}

// Exercise the same file the one-step ship command reads. P3 · P4 · P7 · D18.
async function main() {
  const sourcePath = path.join(__dirname, '../../web.10ms');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const spec = fs.readFileSync(path.join(__dirname, '../../SPEC.md'), 'utf8');
  const program = compileSource(source);
  assert(spec.includes(source.trimEnd()), 'web.10ms matches the canonical SPEC example');
  assert(program.budget.ok && program.budget.ms < 10, 'source passes the static ≤10ms cost proof');
  assert(verifySeal(source, program.seal), 'build seal verifies against the exact source');

  const outputs = new Set();
  for (let i = 0; i < 100; i++) {
    const run = compileSource(source);
    outputs.add(run.seal + ':' + seal(JSON.stringify(run.ast)));
  }
  assert(outputs.size === 1, '100 compile runs produce one source seal and AST hash');

  const entry = buildEntry(program);
  assert(entry.includes(program.seal) && entry.includes('createSealedWorker'),
    'generated Wrangler entry embeds the checked AST seal and runtime adapter');

  const worker = createSealedWorker(program);
  const response = await worker.fetch(new Request('https://10ms.invalid/'));
  const html = await response.text();
  assert(response.status === 200 && response.headers.get('x-10ms-seal') === program.seal,
    'GET / returns 200 with the source seal header');
  assert(/<form method="post">/.test(html) && /<input name="text"[^>]*>/.test(html) &&
    /<button[^>]*data-label="Add"/.test(html),
    'GET / renders the interactive web.10ms form');
  console.log('       URL response body:', html);

  let rejected;
  try { compileSource('p "not a page"\n'); } catch (error) { rejected = error; }
  assert(rejected && rejected.detail && rejected.detail.error === 'ship',
    'non-Web program is rejected before Wrangler deploy');

  for (let i = 0; i < 25; i++) {
    const responseWarm = await worker.fetch(new Request('https://10ms.invalid/'));
    await responseWarm.arrayBuffer();
  }
  const samples = [];
  for (let batch = 0; batch < 100; batch++) {
    const start = process.cpuUsage();
    for (let i = 0; i < 100; i++) {
      const sample = await worker.fetch(new Request('https://10ms.invalid/'));
      await sample.arrayBuffer();
    }
    const used = process.cpuUsage(start);
    samples.push((used.user + used.system) / 1000 / 100);
  }
  samples.sort((a, b) => a - b);
  const p50 = samples[Math.floor((samples.length - 1) * 0.50)];
  const p90 = samples[Math.floor((samples.length - 1) * 0.90)];
  console.log(`       CPU p50 ${p50.toFixed(4)}ms / p90 ${p90.toFixed(4)}ms per request (100 batches × 100)`);
  assert(p50 < 10 && p90 < 10, 'runtime CPU p50 and p90 remain below 10ms');
}

main().then(() => {
  console.log('\n' + (process.exitCode ? 'FAILED' : 'ALL PASSED'));
}).catch((error) => {
  console.error('FATAL:', error && error.detail ? JSON.stringify(error.detail) : error);
  process.exit(1);
});
