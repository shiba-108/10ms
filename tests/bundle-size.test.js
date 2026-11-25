// T21 bundle + CPU benchmark. Run: node tests/bundle-size.test.js
// P1: verify the deployed Worker stays lightweight without adding runtime dependencies.
// Web is server-rendered HTML here; there is no separate browser JavaScript bundle to measure.
'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { createWorker } = require('../src/host/worker');
const { lex } = require('../src/core/lex');
const { parse } = require('../src/core/parse');

const ROOT = path.resolve(__dirname, '..');
const MAX_BUNDLE_BYTES = 50 * 1024;
const TARGET_BUNDLE_BYTES = 20 * 1024;
const WRANGLER_VERSION = '4.168.0';
const WEB_SOURCE = `page /
  tasks = []
  text = ""
  input text
  btn "Add"
    tasks = tasks + [text]
    text = ""
  each tasks t
    p t
`;
const HITS_AST = {
  type: 'Program',
  body: [{
    type: 'On', method: 'GET', path: '/hits', line: 1,
    body: [{
      type: 'Reply', line: 2,
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
    }],
  }],
};

function percentile(sorted, p) {
  return sorted[Math.ceil(p * sorted.length) - 1];
}

async function main() {
  const outdir = fs.mkdtempSync(path.join(os.tmpdir(), '10ms-t21-worker-'));
  try {
    const output = execFileSync('npx', [
      '--yes', `wrangler@${WRANGLER_VERSION}`, 'deploy', '--dry-run', '--outdir', outdir,
    ], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const report = output.match(/Total Upload:\s*([\d.]+)\s*KiB\s*\/\s*gzip:\s*([\d.]+)\s*KiB/i);
    assert(report, 'Wrangler dry-run must report upload and gzip sizes');
    const bundlePath = path.join(outdir, 'cloudflare.js');
    assert(fs.existsSync(bundlePath), 'Wrangler must emit cloudflare.js');
    const bundleBytes = fs.statSync(bundlePath).size;
    assert(bundleBytes <= MAX_BUNDLE_BYTES, 'Worker upload must stay at or below 50 KiB');
    assert(bundleBytes <= TARGET_BUNDLE_BYTES, 'Minified Worker upload must meet the 20 KiB target');

    const { tokens, seed } = lex(WEB_SOURCE);
    const page = parse(tokens, seed);
    const web = createWorker({ ast: page, seed });
    const response = await web.fetch(new Request('https://10ms.test/'));
    const html = await response.text();
    const htmlBytes = Buffer.byteLength(html);
    const htmlGzipBytes = zlib.gzipSync(Buffer.from(html)).length;
    assert.equal(response.status, 200, 'Web example must render successfully');
    assert(htmlBytes <= MAX_BUNDLE_BYTES, 'Rendered Web HTML must stay below 50 KiB');

    const samples = [];
    const batches = 100;
    const requestsPerBatch = 100;
    for (let batch = 0; batch < batches; batch++) {
      const worker = createWorker({ ast: HITS_AST, seed: 7 });
      for (let i = 0; i < 20; i++) {
        await worker.fetch(new Request('https://10ms.test/hits'));
      }
      const start = process.cpuUsage();
      for (let i = 0; i < requestsPerBatch; i++) {
        await worker.fetch(new Request('https://10ms.test/hits'));
      }
      const cpu = process.cpuUsage(start);
      samples.push((cpu.user + cpu.system) / 1000 / requestsPerBatch);
    }
    samples.sort((a, b) => a - b);
    const p50 = percentile(samples, 0.50);
    const p90 = percentile(samples, 0.90);
    assert(p90 < 10, 'Worker CPU p90 must stay below 10 ms per request');

    console.log(`Worker bundle: ${bundleBytes} bytes (${(bundleBytes / 1024).toFixed(2)} KiB); Wrangler gzip ${report[2]} KiB`);
    console.log(`Worker hard cap 50 KiB: PASS; target 20 KiB: ${bundleBytes <= TARGET_BUNDLE_BYTES ? 'PASS' : 'NOT MET'}`);
    console.log(`Web response: ${htmlBytes} HTML bytes (${htmlGzipBytes} gzip bytes); no separate browser JS bundle`);
    console.log(`Worker /hits CPU (${batches} x ${requestsPerBatch} requests): p50=${p50.toFixed(5)} ms, p90=${p90.toFixed(5)} ms`);
    console.log('ALL PASSED');
  } finally {
    fs.rmSync(outdir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
