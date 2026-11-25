// tests/determinism.test.js
// Run: node tests/determinism.test.js
// Q1: No runtime CPU cost; this is test-only. Q2: No 10ms source/token cost.
// Q3: Keep it: existing smoke checks compare seals, not the complete compiler output (P4).

const { createHash } = require('node:crypto');
const { lex } = require('../src/core/lex');
const { parse } = require('../src/core/parse');
const { typeCheck } = require('../src/core/type');
const { cost } = require('../src/core/cost');
const { seal } = require('../src/core/seal');

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
const RUNS = 100;
const CPU_BATCHES = 100;
const RUNS_PER_BATCH = 50;

// WHY: Snapshot every observable compiler stage so P4 covers more than the source seal.
function compileOutput(source) {
  const { tokens, seed } = lex(source);
  const ast = parse(tokens, seed);
  return {
    tokens,
    seed,
    ast,
    type: typeCheck(ast, seed),
    cost: cost(ast, seed),
    seal: seal(source),
  };
}

// WHY: Report the first changed field, including key-order changes, to localize a P4 failure.
function firstDifference(left, right, path = 'output') {
  if (Object.is(left, right)) return null;
  const leftArray = Array.isArray(left);
  const rightArray = Array.isArray(right);
  if (leftArray || rightArray) {
    if (!leftArray || !rightArray) return path;
    if (left.length !== right.length) return `${path}.length`;
    for (let i = 0; i < left.length; i++) {
      const difference = firstDifference(left[i], right[i], `${path}[${i}]`);
      if (difference) return difference;
    }
    return null;
  }

  const leftObject = left !== null && typeof left === 'object';
  const rightObject = right !== null && typeof right === 'object';
  if (leftObject || rightObject) {
    if (!leftObject || !rightObject) return path;
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length || leftKeys.some((key, i) => key !== rightKeys[i])) {
      return `${path} (object keys/order)`;
    }
    for (const key of leftKeys) {
      const difference = firstDifference(left[key], right[key], `${path}.${key}`);
      if (difference) return difference;
    }
    return null;
  }
  return path;
}

// WHY: Summarize measured per-compilation CPU samples for the P1 proof without estimating.
function percentile(sortedValues, fraction) {
  return sortedValues[Math.max(0, Math.ceil(fraction * sortedValues.length) - 1)];
}

let baselineOutput;
let baselineJson;
let baselineHash;
for (let run = 1; run <= RUNS; run++) {
  const output = compileOutput(SOURCE);
  const serialized = JSON.stringify(output);
  const hash = createHash('sha256').update(serialized).digest('hex');

  if (run === 1) {
    baselineOutput = output;
    baselineJson = serialized;
    baselineHash = hash;
    continue;
  }

  if (serialized !== baselineJson) {
    const path = firstDifference(baselineOutput, output) || 'serialized output';
    console.error(`FAIL: run ${run}/${RUNS} differs at ${path}`);
    console.error(`baseline: ${baselineJson}`);
    console.error(`current:  ${serialized}`);
    process.exit(1);
  }
  if (hash !== baselineHash) {
    console.error(`FAIL: run ${run}/${RUNS} produced a different SHA-256 hash`);
    process.exit(1);
  }
}

// Warm the same pipeline before timing; benchmark CPU, not wall-clock wait time.
for (let i = 0; i < 20; i++) {
  const serialized = JSON.stringify(compileOutput(SOURCE));
  createHash('sha256').update(serialized).digest('hex');
}

const cpuMsPerRun = [];
for (let batch = 0; batch < CPU_BATCHES; batch++) {
  const start = process.cpuUsage();
  for (let run = 0; run < RUNS_PER_BATCH; run++) {
    const serialized = JSON.stringify(compileOutput(SOURCE));
    createHash('sha256').update(serialized).digest('hex');
  }
  const used = process.cpuUsage(start);
  cpuMsPerRun.push((used.user + used.system) / 1000 / RUNS_PER_BATCH);
}
cpuMsPerRun.sort((a, b) => a - b);
const p50 = percentile(cpuMsPerRun, 0.5);
const p90 = percentile(cpuMsPerRun, 0.9);

console.log(`PASS: ${RUNS}/${RUNS} identical compiler outputs`);
console.log(`SHA-256: ${baselineHash}`);
console.log(`CPU (Node process CPU per lex→parse→typeCheck→cost→seal + JSON/SHA-256; ${CPU_BATCHES} batches × ${RUNS_PER_BATCH} runs): p50=${p50.toFixed(6)} ms, p90=${p90.toFixed(6)} ms`);
console.log('Token delta: n/a (test-only; no 10ms program syntax or runtime code changed).');
