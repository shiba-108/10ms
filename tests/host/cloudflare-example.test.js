// tests/host/cloudflare-example.test.js
// Run: node tests/host/cloudflare-example.test.js
// Execute the Cloudflare module from the guide so its AST cannot silently drift.
const fs = require('node:fs');
const vm = require('node:vm');
const { createWorker } = require('../../src/host/worker');

function assert(condition, message) {
  if (!condition) {
    console.error('FAIL:', message);
    process.exitCode = 1;
  } else {
    console.log('OK  :', message);
  }
}

function fencedBlock(markdown, heading, fence) {
  const section = markdown.split(heading)[1];
  if (!section) throw new Error(`Missing section: ${heading}`);
  const marker = `${fence}\n`;
  const start = section.indexOf(marker);
  if (start < 0) throw new Error(`Missing ${fence} block after ${heading}`);
  const contentStart = start + marker.length;
  const end = section.indexOf('\n```', contentStart);
  if (end < 0) throw new Error(`Unclosed ${fence} block after ${heading}`);
  return section.slice(contentStart, end);
}

const guide = fs.readFileSync(
  require('node:path').join(__dirname, '../../docs/cloudflare-worker.md'),
  'utf8'
);
const program = fencedBlock(guide, '## 10ms program', '```10ms');
const expectedProgram = [
  'on POST /count',
  '  need body.items array',
  '  total = 0',
  '  each body.items item',
  '    total = total + 1',
  '  reply {count: total}',
].join('\n');
assert(program === expectedProgram, 'documented 10ms program matches the canonical count example');

let moduleSource = fencedBlock(guide, '## Cloudflare module', '```js');
moduleSource = moduleSource.replace(
  'import { createWorker } from "./index.js";',
  'const { createWorker } = require("./index.js");'
).replace('export default {', 'module.exports = {');
if (moduleSource.includes('import { createWorker }') || moduleSource.includes('export default')) {
  throw new Error('Cloudflare module has unsupported or changed module syntax');
}
const moduleObject = { exports: {} };
vm.runInNewContext(moduleSource, {
  require(specifier) {
    if (specifier !== './index.js') throw new Error(`Unexpected import: ${specifier}`);
    return { createWorker };
  },
  module: moduleObject,
});
const worker = moduleObject.exports;
assert(worker && typeof worker.fetch === 'function', 'documented module exports a fetch handler');

function post(items) {
  return new Request('http://local/count', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ items }),
  });
}

async function main() {
  const response = await worker.fetch(post([1, 2, 3]));
  const body = await response.json();
  assert(response.status === 200 && body.count === 3,
    'POST /count returns {"count":3} for three items');

  const atLimit = await worker.fetch(post(Array(100).fill(1)));
  const atLimitBody = await atLimit.json();
  assert(atLimit.status === 200 && atLimitBody.count === 100,
    '100 items are accepted at the loop limit');

  const overLimit = await worker.fetch(post(Array(101).fill(1)));
  const overLimitBody = await overLimit.json();
  assert(overLimit.status === 400 && overLimitBody.error === 'cost' &&
    overLimitBody.fix === 'reduce each list to at most 100 items',
  '101 items return the machine-readable cost error and exact fix');

  const repeated = [];
  for (let i = 0; i < 100; i++) {
    const res = await worker.fetch(post([1, 2, 3]));
    repeated.push(`${res.status}:${JSON.stringify(await res.json())}`);
  }
  assert(repeated.every(value => value === '200:{"count":3}'),
    '100 repeated requests produce identical responses');

  // Measure the largest accepted list; this is a Node CPU gate, not a Cloudflare measurement.
  const maxItems = Array(100).fill(1);
  const batchCpuMs = [];
  for (let batch = 0; batch < 100; batch++) {
    const start = process.cpuUsage();
    for (let i = 0; i < 100; i++) {
      const result = await worker.fetch(post(maxItems));
      const resultBody = await result.json();
      if (result.status !== 200 || resultBody.count !== 100) {
        throw new Error('maximum-size request failed during CPU benchmark');
      }
    }
    const used = process.cpuUsage(start);
    batchCpuMs.push((used.user + used.system) / 100000);
  }
  batchCpuMs.sort((a, b) => a - b);
  const p50 = batchCpuMs[49];
  const p90 = batchCpuMs[89];
  console.log(`Node CPU ms/request, 100-item input (100 batches × 100 requests): p50=${p50.toFixed(6)}, p90=${p90.toFixed(6)}`);
  assert(p90 < 5, 'maximum-size example stays below the 5 ms Node CPU regression budget');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
