// bench/t4.mjs
// Run with: node bench/t4.mjs (requires npx access to Wrangler; no project dependencies).
import { spawn } from 'node:child_process';
import worker from '../src/host/worker/cloudflare.mjs';

const SEED = 0x10_4;
const WARMUPS = 1000;
const RUNS = 5;
const REQUESTS_PER_RUN = 50000;
const WRANGLER_REQUESTS = 1000;
const WRANGLER_WARMUPS = 50;
const PORT = Number(process.env.T4_PORT || (8000 + (process.pid % 2000)));
const URL = `http://127.0.0.1:${PORT}/echo`;
const BATCH_SIZE = 100;

// WHY: a fixed LCG seed makes the same bounded payload set repeatable (P1 · P4).
function payloads() {
  let state = SEED;
  return Array.from({ length: REQUESTS_PER_RUN }, (_, i) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return `t4-${i}-${state.toString(16).padStart(8, '0')}`;
  });
}

// WHY: nearest-rank quantiles keep the reported percentiles deterministic (P1 · P4).
function quantile(sorted, p) {
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}

// WHY: same request shape in both runtimes isolates host work from input variation (P1 · P4).
function makeRequest(message) {
  return new Request(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ msg: message }),
  });
}

// WHY: verify the route before timing so startup failures cannot look like fast requests (P7).
async function assertEcho(send, message) {
  const response = await send(message);
  const body = await response.json();
  if (response.status !== 200 || body.echo !== message) {
    throw new Error(`POST /echo failed: status=${response.status}, body=${JSON.stringify(body)}`);
  }
}

// WHY: time each operation with process CPU, not elapsed time, for the Node host (P1).
async function cpuRun(send, inputs) {
  const samples = [];
  let totalCpu = 0;
  for (let offset = 0; offset < inputs.length; offset += BATCH_SIZE) {
    const batch = inputs.slice(offset, offset + BATCH_SIZE);
    const started = process.cpuUsage();
    for (const message of batch) await assertEcho(send, message);
    const used = process.cpuUsage(started);
    const batchCpu = (used.user + used.system) / 1000;
    totalCpu += batchCpu;
    samples.push(batchCpu / batch.length);
  }
  samples.sort((a, b) => a - b);
  return {
    samples,
    avg: totalCpu / inputs.length,
    p50: quantile(samples, 0.50),
    p95: quantile(samples, 0.95),
    p99: quantile(samples, 0.99),
  };
}

// WHY: reproduce request creation and response parsing without Worker logic (P1).
async function harnessSend(message) {
  makeRequest(message);
  return new Response(JSON.stringify({ echo: message }), {
    headers: { 'content-type': 'application/json' },
  });
}

// WHY: report request/response scaffolding separately from host CPU (P1).
async function harnessRun(send, inputs) {
  const samples = [];
  for (let offset = 0; offset < inputs.length; offset += BATCH_SIZE) {
    const batch = inputs.slice(offset, offset + BATCH_SIZE);
    const started = process.cpuUsage();
    for (const message of batch) await assertEcho(send, message);
    const used = process.cpuUsage(started);
    samples.push((used.user + used.system) / 1000 / batch.length);
  }
  samples.sort((a, b) => a - b);
  return {
    p50: quantile(samples, 0.50),
    p95: quantile(samples, 0.95),
    p99: quantile(samples, 0.99),
  };
}

// WHY: wrangler dev uses workerd, which does not expose Node process.cpuUsage (P1 · P7).
async function wallRun(send, inputs) {
  const samples = [];
  const clientCpu = process.cpuUsage();
  for (const message of inputs) {
    const started = performance.now();
    await assertEcho(send, message);
    samples.push(performance.now() - started);
  }
  const used = process.cpuUsage(clientCpu);
  samples.sort((a, b) => a - b);
  return {
    wall: {
      p50: quantile(samples, 0.50),
      p95: quantile(samples, 0.95),
      p99: quantile(samples, 0.99),
    },
    clientCpuMsPerRequest: (used.user + used.system) / 1000 / inputs.length,
  };
}

// WHY: poll the local endpoint so this command can launch and test Wrangler itself (P7).
async function waitForWrangler(proc) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error(`wrangler exited early (${proc.exitCode})`);
    try {
      const response = await fetch(URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ msg: 't4-ready' }),
      });
      if (response.status === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Wrangler did not become ready within 60 seconds');
}

// WHY: one fresh-clone command covers Node CPU and Wrangler execution without repo dependencies (P1 · P7).
async function main() {
  const inputs = payloads();
  const directSend = (message) => worker.fetch(makeRequest(message));
  for (let i = 0; i < WARMUPS; i++) await assertEcho(directSend, `warmup-${i}`);
  // WHY: full discarded passes warm V8 tiers before the five scored runs (P1 · P4).
  for (let run = 0; run < 3; run++) await cpuRun(directSend, inputs);

  const nodeRuns = [];
  for (let run = 0; run < RUNS; run++) nodeRuns.push(await cpuRun(directSend, inputs));
  const mean = nodeRuns.map((run) => run.avg);
  const runP50 = nodeRuns.map((run) => run.p50);
  const medianP50 = quantile([...runP50].sort((a, b) => a - b), 0.50);
  const spread = ((Math.max(...runP50) - Math.min(...runP50)) / medianP50) * 100;
  const combined = nodeRuns.flatMap((run) => run.samples).sort((a, b) => a - b);
  const harness = await harnessRun(harnessSend, inputs);

  const wrangler = spawn('npx', ['--yes', 'wrangler@4', 'dev', '--local', '--port', String(PORT)], {
    stdio: ['ignore', 'ignore', 'inherit'],
    detached: process.platform !== 'win32',
    env: { ...process.env, NO_UPDATE_NOTIFIER: '1' },
  });
  let wranglerResult;
  try {
    await waitForWrangler(wrangler);
    for (let i = 0; i < WRANGLER_WARMUPS; i++) await assertEcho((msg) => fetch(URL, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ msg }),
    }), `wrangler-warmup-${i}`);
    wranglerResult = await wallRun((msg) => fetch(URL, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ msg }),
    }), inputs.slice(0, WRANGLER_REQUESTS));
  } finally {
    if (process.platform === 'win32') wrangler.kill('SIGTERM');
    else if (wrangler.pid) {
      try { process.kill(-wrangler.pid, 'SIGTERM'); } catch {}
    }
  }

  console.log('| Runtime | Measure | p50 ms | p95 ms | p99 ms |');
  console.log('|---|---|---:|---:|---:|');
  console.log(`| Node host | CPU/request | ${quantile(combined, 0.50).toFixed(4)} | ${quantile(combined, 0.95).toFixed(4)} | ${quantile(combined, 0.99).toFixed(4)} |`);
  console.log(`| Wrangler dev | request wall time | ${wranglerResult.wall.p50.toFixed(3)} | ${wranglerResult.wall.p95.toFixed(3)} | ${wranglerResult.wall.p99.toFixed(3)} |`);
  console.log(`| Harness | request/response baseline CPU | ${harness.p50.toFixed(4)} | ${harness.p95.toFixed(4)} | ${harness.p99.toFixed(4)} |`);
  console.log(`\nNode batch CPU avg/request across ${RUNS} runs: ${mean.map((value) => value.toFixed(4)).join(', ')} ms`);
  console.log(`Per-run Node p50: ${runP50.map((value) => value.toFixed(4)).join(', ')} ms`);
  console.log(`5-run p50 spread: ${spread.toFixed(2)}% (limit 10%)`);
  console.log(`Wrangler client harness CPU/request: ${wranglerResult.clientCpuMsPerRequest.toFixed(4)} ms; this is not workerd CPU.`);

  if (mean.some((value) => value >= 10) || spread > 10) {
    throw new Error(`Node CPU gate failed: each run must be <10 ms/request and spread <=10% (observed ${spread.toFixed(2)}%)`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
