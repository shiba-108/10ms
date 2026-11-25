// src/host/worker/effects.js
// 10ms host · effects: CHỖ DUY NHẤT chạm ra ngoài. @store.add/del/get/set, @net.fetch, @time.now, @rand.int.
// Lõi không gọi trực tiếp — mọi lần chạm đi qua log (D15). P1 · P4.

function d13(expected, fix, seed) {
  const e = new Error('effect');
  e.detail = { error: 'effect', pos: { line: 1, col: 1 }, expected, fix, seed };
  return e;
}

const ALLOWED = {
  store: ['add', 'del', 'get', 'set'],
  net: ['fetch'],
  time: ['now'],
  rand: ['int'],
};

// Accept only KV-shaped bindings, leaving ordinary Maps on the local path (P7).
function isKVNamespace(value) {
  return value && typeof value.get === 'function' &&
    typeof value.put === 'function' && typeof value.delete === 'function';
}

let runtimeStorePromise;

// Resolve Cloudflare's module env lazily so Node tests need no platform dependency (P7).
async function resolveRuntimeStore() {
  if (!runtimeStorePromise) {
    runtimeStorePromise = import('cloudflare:workers')
      .then(({ env }) => isKVNamespace(env && env.STORE) ? env.STORE : null)
      .catch(() => null);
  }
  return runtimeStorePromise;
}

function createEffects(log, store, seed = 0, fetchImpl) {
  const box = store instanceof Map ? store : new Map();
  const injectedKV = !(store instanceof Map) && isKVNamespace(store) ? store : null;
  const hasInjectedFetch = fetchImpl !== undefined;
  const request = hasInjectedFetch
    ? (typeof fetchImpl === 'function' ? fetchImpl : null)
    : (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
  // Keep random output stable for the same seed without adding entropy or dependencies (P1, P4).
  let randState = Number(seed) >>> 0;

  // Prefer the bound KV namespace; keep the Map only when running outside Workers (P7).
  async function resolveStore() {
    return injectedKV || await resolveRuntimeStore() || box;
  }

  // Decode one value through the same interface for KV and the local test Map (P4, P7).
  async function readStoreValue(target, key) {
    if (target instanceof Map) return target.has(key) ? target.get(key) : null;
    return target.get(String(key), { type: 'json' });
  }

  // Persist JSON values and mark their metadata so deletes preserve existence semantics (P4, P7).
  async function writeStoreValue(target, key, value) {
    if (target instanceof Map) {
      target.set(key, value);
      return;
    }
    await target.put(String(key), JSON.stringify(value), { metadata: { tenms: true } });
  }

  // KV delete returns no existence bit, so read the marker before removing the key (P4, P7).
  async function deleteStoreValue(target, key) {
    if (target instanceof Map) return target.delete(key);
    const stored = typeof target.getWithMetadata === 'function'
      ? await target.getWithMetadata(String(key))
      : { value: await target.get(String(key), { type: 'json' }), metadata: null };
    const existed = Boolean(stored && stored.value !== null) ||
      Boolean(stored && stored.metadata && stored.metadata.tenms === true);
    await target.delete(String(key));
    return existed;
  }

  // Log only completed writes so replay describes the durable effect result (P4, D15).
  async function add(key, delta) {
    const target = await resolveStore();
    const cur = Number(await readStoreValue(target, key) || 0);
    const next = cur + Number(delta);
    await writeStoreValue(target, key, next);
    log.record('store.add', [key, delta], next);
    return next;
  }

  // Return the previous existence state while recording the completed deletion (P4, D15).
  async function del(key) {
    const target = await resolveStore();
    const existed = await deleteStoreValue(target, key);
    log.record('store.del', [key], existed);
    return existed;
  }

  // Return the durable value and log the exact output for replay (P4, D15).
  async function get(key) {
    const target = await resolveStore();
    const v = await readStoreValue(target, key);
    log.record('store.get', [key], v);
    return v;
  }

  // Complete the durable write before exposing its value to the program (P1, P4).
  async function set(key, value) {
    const target = await resolveStore();
    await writeStoreValue(target, key, value);
    log.record('store.set', [key, value], value);
    return value;
  }

  // Capture the complete response as plain data so D15 replay never consumes a live stream again (P4, D15).
  async function netFetch(...args) {
    if (args.length < 1 || args.length > 2 || typeof args[0] !== 'string' ||
        !args[0] || (args.length === 2 &&
        (!args[1] || typeof args[1] !== 'object' || Array.isArray(args[1])))) {
      throw d13('a URL text and optional request options object for @net.fetch',
        '@net.fetch "url" [options]', seed);
    }

    let result;
    try {
      if (!request) throw new Error('runtime fetch is unavailable');
      const response = args.length === 1
        ? await request(args[0])
        : await request(args[0], args[1]);
      const headers = {};
      const entries = Array.from(response.headers.entries()).sort((a, b) =>
        a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
      for (const [name, value] of entries) headers[name] = value;
      result = {
        status: response.status,
        ok: response.ok,
        statusText: response.statusText,
        headers,
        body: await response.text(),
      };
    } catch (error) {
      result = {
        status: null,
        ok: false,
        statusText: '',
        headers: {},
        body: '',
        error: String(error && error.message ? error.message : error),
      };
    }
    log.record('net.fetch', args, result);
    return result;
  }

  // Capture wall-clock output once so D15 replay never reads a new time (P4).
  function now(...args) {
    if (args.length !== 0) {
      throw d13('no arguments for @time.now', '@time.now', seed);
    }
    const result = Date.now();
    log.record('time.now', [], result);
    return result;
  }

  // Expand one seed into a deterministic 32-bit stream for bounded integer draws (P1, P4).
  function nextUint32() {
    randState = (randState + 0x6D2B79F5) >>> 0;
    let t = randState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  // Use rejection sampling to avoid modulo bias while keeping the inclusive range exact (P4).
  function int(...args) {
    if (args.length !== 2) {
      throw d13('two safe integer bounds for @rand.int', '@rand.int <min> <max>', seed);
    }
    const [min, max] = args;
    const span = max - min + 1;
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min > max || span > 0x100000000) {
      throw d13(
        'safe integer bounds with min ≤ max and range ≤ 2^32 for @rand.int',
        '@rand.int <min> <max> with safe integer bounds and min ≤ max',
        seed
      );
    }
    const limit = Math.floor(0x100000000 / span) * span;
    let draw;
    do { draw = nextUint32(); } while (draw >= limit);
    const result = min + (draw % span);
    log.record('rand.int', args, result);
    return result;
  }

  function call(path, args) {
    const [ns, fn] = String(path).split('.');
    if (!ALLOWED[ns] || !ALLOWED[ns].includes(fn)) {
      const choices = Object.entries(ALLOWED)
        .flatMap(([name, fns]) => fns.map(nameFn => '@' + name + '.' + nameFn))
        .join(', ');
      throw d13(
        'one of: ' + choices,
        'call one declared @ effect with valid args',
        seed
      );
    }
    if (!Array.isArray(args)) {
      throw d13('args as array for @' + path, '@' + path + ' [arg1, arg2]', seed);
    }
    return { add, del, get, set, fetch: netFetch, now, int }[fn](...args);
  }

  // Snapshots remain limited to the in-memory adapter; KV is read through effects (P7).
  function snapshotStore() { return new Map(box); }

  return { call, add, del, get, set, netFetch, now, int, snapshotStore };
}

module.exports = { createEffects };
